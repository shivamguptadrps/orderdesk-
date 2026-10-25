"""Related products ("customers also buy").

Score for product A -> B (0..1):
    0.40 x bought together   (orders with both, relative to A's most common partner; last 180 days)
    0.25 x same category     (1 for the same category, 0.5 for a sibling sub-category)
    0.15 x matching features (share of feature values that are equal; only within related categories)
    0.10 x pinned            (the distributor linked them by hand)
    0.10 x shop bought B before   - added per shop when asked, never stored

`rebuild` stores the best links in product_relations (nightly, and for single products after a pin).
Before the first rebuild, or for a brand-new product, links are worked out on the fly.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, delete, exists, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal, utcnow
from app.modules.catalog.models import Product, ProductRelation, ProductUnit
from app.modules.catalog.service import load_tree
from app.modules.inventory.service import stock_map
from app.modules.orders.models import Order, OrderItem

log = logging.getLogger(__name__)

W_BOUGHT, W_CATEGORY, W_FEATURES, W_PINNED, W_SHOP = 0.40, 0.25, 0.15, 0.10, 0.10
KEEP_PER_PRODUCT = 12  # computed links stored per product (pinned ones are always kept)
LOOKBACK_DAYS = 180
COUNTED = ("pending", "approved", "dispatched", "delivered")  # not rejected / cancelled


@dataclass
class Link:
    related_id: uuid.UUID
    score: float
    bought_together: int
    pinned: bool


@dataclass
class _Item:
    id: uuid.UUID
    category_id: uuid.UUID
    group: uuid.UUID  # parent category (or own category at the top level): siblings share it
    attributes: dict[str, Any]
    name: str


def _norm(value: Any) -> Any:
    return value.strip().lower() if isinstance(value, str) else value


def feature_match(a: dict[str, Any], b: dict[str, Any]) -> float:
    keys = set(a) | set(b)
    if not keys:
        return 0.0
    same = sum(1 for k in keys if k in a and k in b and _norm(a[k]) == _norm(b[k]))
    return same / len(keys)


def _visible_products(tenant_id: uuid.UUID):
    return select(Product.id, Product.category_id, Product.attributes, Product.name).where(
        Product.tenant_id == tenant_id,
        Product.status == "active",
        exists().where(ProductUnit.product_id == Product.id),
    )


async def _bought_together(
    db: AsyncSession, tenant_id: uuid.UUID, only: set[uuid.UUID] | None
) -> dict[uuid.UUID, dict[uuid.UUID, int]]:
    a, b = OrderItem.__table__.alias("a"), OrderItem.__table__.alias("b")
    query = (
        select(a.c.product_id, b.c.product_id, func.count(func.distinct(a.c.order_id)))
        .select_from(a)
        .join(b, and_(a.c.order_id == b.c.order_id, a.c.product_id != b.c.product_id))
        .join(Order, Order.id == a.c.order_id)
        .where(
            Order.tenant_id == tenant_id,
            Order.status.in_(COUNTED),
            Order.created_at >= utcnow() - timedelta(days=LOOKBACK_DAYS),
            a.c.product_id.is_not(None),
            b.c.product_id.is_not(None),
        )
        .group_by(a.c.product_id, b.c.product_id)
    )
    if only is not None:
        query = query.where(a.c.product_id.in_(only))
    out: dict[uuid.UUID, dict[uuid.UUID, int]] = {}
    for pid, rid, n in await db.execute(query):
        out.setdefault(pid, {})[rid] = n
    return out


async def compute(
    db: AsyncSession, tenant_id: uuid.UUID, only: set[uuid.UUID] | None = None
) -> dict[uuid.UUID, list[Link]]:
    """Best links for every visible product (or just `only`), best first."""
    tree = await load_tree(db, tenant_id)
    items: dict[uuid.UUID, _Item] = {}
    groups: dict[uuid.UUID, list[uuid.UUID]] = {}
    for pid, cid, attrs, name in await db.execute(_visible_products(tenant_id)):
        cat = tree.by_id.get(cid)
        group = cat.parent_id if cat and cat.parent_id else cid
        items[pid] = _Item(pid, cid, group, attrs or {}, name)
        groups.setdefault(group, []).append(pid)

    bought = await _bought_together(db, tenant_id, only)
    pinned_query = select(ProductRelation.product_id, ProductRelation.related_id).where(
        ProductRelation.tenant_id == tenant_id, ProductRelation.pinned.is_(True)
    )
    if only is not None:
        pinned_query = pinned_query.where(ProductRelation.product_id.in_(only))
    pinned: dict[uuid.UUID, set[uuid.UUID]] = {}
    for pid, rid in await db.execute(pinned_query):
        pinned.setdefault(pid, set()).add(rid)

    result: dict[uuid.UUID, list[Link]] = {}
    for pid in only if only is not None else items:
        me = items.get(pid)
        if me is None:  # hidden, deleted, or no pack size
            result[pid] = []
            continue
        partners = bought.get(pid, {})
        top = max(partners.values(), default=0)
        my_pins = pinned.get(pid, set())
        candidates = (set(groups.get(me.group, [])) | set(partners) | my_pins) - {pid}
        links = []
        for rid in candidates:
            other = items.get(rid)
            if other is None:
                continue
            if other.category_id == me.category_id:
                category = 1.0
            elif other.group == me.group:
                category = 0.5
            else:
                category = 0.0
            features = feature_match(me.attributes, other.attributes) if category else 0.0
            together = partners.get(rid, 0)
            is_pinned = rid in my_pins
            score = (
                W_BOUGHT * (together / top if top else 0)
                + W_CATEGORY * category
                + W_FEATURES * features
                + W_PINNED * is_pinned
            )
            if score > 0:
                links.append(Link(rid, round(score, 4), together, is_pinned))
        links.sort(key=lambda link: (-link.score, items[link.related_id].name))
        result[pid] = [link for link in links if link.pinned] + [link for link in links if not link.pinned][
            :KEEP_PER_PRODUCT
        ]
        result[pid].sort(key=lambda link: (-link.score, items[link.related_id].name))
    return result


async def rebuild(db: AsyncSession, tenant_id: uuid.UUID, only: set[uuid.UUID] | None = None) -> int:
    """Recompute and store links (all products, or just `only`). Caller commits. Returns links stored."""
    computed = await compute(db, tenant_id, only)
    clear = delete(ProductRelation).where(ProductRelation.tenant_id == tenant_id)
    if only is not None:
        clear = clear.where(ProductRelation.product_id.in_(only))
    await db.execute(clear)
    now = utcnow()
    rows = [
        {
            "product_id": pid,
            "related_id": link.related_id,
            "tenant_id": tenant_id,
            "score": Decimal(str(link.score)),
            "bought_together": link.bought_together,
            "pinned": link.pinned,
            "updated_at": now,
        }
        for pid, links in computed.items()
        for link in links
    ]
    for start in range(0, len(rows), 1000):
        await db.execute(insert(ProductRelation), rows[start : start + 1000])
    return len(rows)


async def set_pin(db: AsyncSession, tenant_id: uuid.UUID, a: uuid.UUID, b: uuid.UUID, pinned: bool) -> None:
    """Link (or unlink) two products both ways, then refresh both products' links. Caller commits."""
    for pid, rid in ((a, b), (b, a)):
        row = await db.get(ProductRelation, (pid, rid))
        if row is None and pinned:
            db.add(ProductRelation(product_id=pid, related_id=rid, tenant_id=tenant_id, pinned=True))
        elif row is not None:
            row.pinned = pinned
    await db.flush()
    await rebuild(db, tenant_id, {a, b})


async def _bought_by_shop(db: AsyncSession, tenant_id: uuid.UUID, shop_id: uuid.UUID | None) -> dict[uuid.UUID, int]:
    """Products this shop ordered before, with how many orders they were in."""
    if shop_id is None:
        return {}
    rows = await db.execute(
        select(OrderItem.product_id, func.count(func.distinct(OrderItem.order_id)))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.tenant_id == tenant_id,
            Order.shop_id == shop_id,
            Order.status.in_(COUNTED),
            OrderItem.product_id.is_not(None),
        )
        .group_by(OrderItem.product_id)
    )
    return {pid: n for pid, n in rows}


async def _stored(db: AsyncSession, tenant_id: uuid.UUID, product_ids: set[uuid.UUID]) -> dict[uuid.UUID, list[Link]]:
    rows = await db.scalars(
        select(ProductRelation).where(
            ProductRelation.tenant_id == tenant_id, ProductRelation.product_id.in_(product_ids)
        )
    )
    out: dict[uuid.UUID, list[Link]] = {}
    for r in rows:
        out.setdefault(r.product_id, []).append(Link(r.related_id, float(r.score), r.bought_together, r.pinned))
    return out


async def links_for(db: AsyncSession, tenant_id: uuid.UUID, product_ids: set[uuid.UUID]) -> dict[uuid.UUID, list[Link]]:
    """Stored links, worked out on the fly for products that have none yet."""
    links = await _stored(db, tenant_id, product_ids)
    missing = product_ids - set(links)
    if missing:
        links.update(await compute(db, tenant_id, missing))
    return links


async def _sellable(db: AsyncSession, tenant_id: uuid.UUID, ids: list[uuid.UUID]) -> dict[uuid.UUID, Product]:
    """Visible products that are in stock, by id."""
    if not ids:
        return {}
    stock = await stock_map(db, ids)
    products = (
        await db.scalars(
            select(Product).where(
                Product.tenant_id == tenant_id,
                Product.id.in_(ids),
                Product.status == "active",
                exists().where(ProductUnit.product_id == Product.id),
            )
        )
    ).all()
    return {p.id: p for p in products if stock.get(p.id, 0) > 0}


async def related_products(
    db: AsyncSession, tenant_id: uuid.UUID, product_id: uuid.UUID, shop_id: uuid.UUID | None, limit: int
) -> list[Product]:
    """Products to show under a product, best first. Only in-stock products."""
    links = (await links_for(db, tenant_id, {product_id})).get(product_id, [])
    bought = await _bought_by_shop(db, tenant_id, shop_id)
    scored = sorted(
        ((link.score + (W_SHOP if link.related_id in bought else 0), link.related_id) for link in links),
        key=lambda s: -s[0],
    )
    products = await _sellable(db, tenant_id, [rid for _, rid in scored])
    return [products[rid] for _, rid in scored if rid in products][:limit]


async def cart_suggestions(
    db: AsyncSession, tenant_id: uuid.UUID, cart_product_ids: set[uuid.UUID], shop_id: uuid.UUID, limit: int
) -> list[Product]:
    """'You may also need' for a cart: things bought with what's in it, then this shop's usual items.

    Look-alikes from the same category (another brand of the same sugar) are skipped unless shops
    really buy them together or the distributor pinned them - in a cart, those would be noise.
    """
    bought = await _bought_by_shop(db, tenant_id, shop_id)
    scores: dict[uuid.UUID, float] = {}
    if cart_product_ids:
        cart_categories = set(
            await db.scalars(select(Product.category_id).where(Product.id.in_(cart_product_ids)))
        )
        all_links = (await links_for(db, tenant_id, cart_product_ids)).values()
        related_ids = {link.related_id for links in all_links for link in links}
        categories = dict(
            (await db.execute(select(Product.id, Product.category_id).where(Product.id.in_(related_ids)))).all()
        )
        for links in all_links:
            for link in links:
                rid = link.related_id
                if rid in cart_product_ids:
                    continue
                if categories.get(rid) in cart_categories and not (link.bought_together or link.pinned):
                    continue
                score = link.score + (W_SHOP if rid in bought else 0)
                scores[rid] = max(scores.get(rid, 0), score)
    # Fill up with what this shop usually orders (most orders first), at a lower score.
    for pid, n in sorted(bought.items(), key=lambda kv: -kv[1]):
        if pid not in cart_product_ids and pid not in scores:
            scores[pid] = W_SHOP * min(1.0, n / 5)
    ranked = sorted(scores, key=lambda pid: -scores[pid])
    products = await _sellable(db, tenant_id, ranked)
    return [products[pid] for pid in ranked if pid in products][:limit]


# ---------- nightly job ----------

IST = timezone(timedelta(hours=5, minutes=30))


async def rebuild_all() -> None:
    """Rebuild links for every active distributor, each in its own transaction."""
    from app.modules.tenants.models import Tenant

    async with SessionLocal() as db:
        tenant_ids = list(await db.scalars(select(Tenant.id).where(Tenant.status == "active")))
    for tenant_id in tenant_ids:
        try:
            async with SessionLocal() as db:
                stored = await rebuild(db, tenant_id)
                await db.commit()
            log.info("related products: tenant %s, %d links", tenant_id, stored)
        except Exception:
            log.exception("related products rebuild failed for tenant %s", tenant_id)


def seconds_until(hour_ist: int, now: datetime | None = None) -> float:
    now = (now or datetime.now(IST)).astimezone(IST)
    run = now.replace(hour=hour_ist, minute=30, second=0, microsecond=0)
    if run <= now:
        run += timedelta(days=1)
    return (run - now).total_seconds()


async def nightly_loop(hour_ist: int) -> None:
    """Runs inside the API process: rebuild every night at hour_ist:30 India time."""
    while True:
        await asyncio.sleep(seconds_until(hour_ist))
        await rebuild_all()
