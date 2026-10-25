"""Shared product queries: loading, search, filters, and output shaping."""

import json
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.media import thumb_url
from app.modules.catalog.models import Product, ProductUnit
from app.modules.catalog.schemas import CatalogCard, CatalogUnitOut, ProductOut, SizeOut, UnitOut
from app.modules.inventory.service import stock_map

# word_similarity() score above which a fuzzy match counts (0..1). Catches typos like "chini" for "cheeni".
SEARCH_SIMILARITY = 0.4


async def get_product_or_404(db: AsyncSession, tenant_id: uuid.UUID, product_id: uuid.UUID) -> Product:
    product = await db.scalar(
        select(Product)
        .where(Product.id == product_id, Product.tenant_id == tenant_id)
        .execution_options(populate_existing=True)
    )
    if product is None:
        raise HTTPException(404, "Product not found")
    return product


def price_per_piece(unit: ProductUnit) -> Decimal:
    return (unit.price / unit.pieces_per_unit).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def unit_out(unit: ProductUnit) -> UnitOut:
    return UnitOut(
        id=unit.id,
        name=unit.name,
        pieces_per_unit=unit.pieces_per_unit,
        price=unit.price,
        price_per_piece=price_per_piece(unit),
        min_qty=unit.min_qty,
        step_qty=unit.step_qty,
        max_qty=unit.max_qty,
        is_default=unit.is_default,
        sort_order=unit.sort_order,
    )


def catalog_unit_out(unit: ProductUnit, stock_pieces: int) -> CatalogUnitOut:
    return CatalogUnitOut(
        **unit_out(unit).model_dump(),
        in_stock=stock_pieces >= unit.pieces_per_unit * unit.min_qty,
    )


def default_unit(product: Product) -> ProductUnit | None:
    if not product.units:
        return None
    return next((u for u in product.units if u.is_default), product.units[0])


def shop_visible():
    """Conditions for a product a shop may see: active and with at least one pack size."""
    return (Product.status == "active", exists().where(ProductUnit.product_id == Product.id))


def group_key():
    """Products without a size group are a group of one."""
    return func.coalesce(Product.variant_group_id, Product.id)


def collapse_variants(query: Select) -> Select:
    """Keep one product per size group (the first one made among those matching), so a list shows
    "India Gate Basmati · 3 sizes" once instead of three cards. Keeps the query's own order."""
    sub = query.order_by(None).with_only_columns(
        Product.id.label("id"), group_key().label("g"), Product.created_at.label("c")
    ).subquery()
    first = select(sub.c.id).ext(distinct_on(sub.c.g)).order_by(sub.c.g, sub.c.c, sub.c.id)
    return query.where(Product.id.in_(first))


async def variant_counts(db: AsyncSession, tenant_id: uuid.UUID, group_ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    """How many shop-visible sizes each group has."""
    if not group_ids:
        return {}
    rows = await db.execute(
        select(Product.variant_group_id, func.count())
        .where(Product.tenant_id == tenant_id, Product.variant_group_id.in_(group_ids), *shop_visible())
        .group_by(Product.variant_group_id)
    )
    return dict(rows.all())


async def catalog_cards(db: AsyncSession, products: list[Product], count_variants: bool = False) -> list[CatalogCard]:
    """Product cards as a shop sees them in lists. Products must have at least one pack size."""
    stock = await stock_map(db, [p.id for p in products])
    counts: dict[uuid.UUID, int] = {}
    if count_variants and products:
        counts = await variant_counts(db, products[0].tenant_id, {p.variant_group_id for p in products if p.variant_group_id})
    cards = []
    for p in products:
        pieces = stock.get(p.id, 0)
        cards.append(
            CatalogCard(
                id=p.id,
                name=p.name,
                brand=p.brand,
                category_id=p.category_id,
                image=thumb_url(p.images[0]) if p.images else None,
                mrp=p.mrp,
                default_unit=catalog_unit_out(default_unit(p), pieces),
                in_stock=pieces > 0,
                variant_group_id=p.variant_group_id,
                variant_label=p.variant_label,
                variant_count=counts.get(p.variant_group_id, 1) if p.variant_group_id else 1,
            )
        )
    return cards


async def shop_sizes(db: AsyncSession, product: Product) -> list[CatalogCard]:
    """All shop-visible sizes of this product (itself included), cheapest default pack first."""
    if product.variant_group_id is None:
        return []
    group = (
        await db.scalars(
            select(Product).where(
                Product.tenant_id == product.tenant_id, Product.variant_group_id == product.variant_group_id, *shop_visible()
            )
        )
    ).all()
    if len(group) < 2:
        return []
    cards = await catalog_cards(db, list(group))
    for c in cards:
        c.variant_count = len(cards)
    return sorted(cards, key=lambda c: (c.default_unit.price / c.default_unit.pieces_per_unit, c.default_unit.price, c.name))


async def manage_sizes(db: AsyncSession, product: Product) -> list[SizeOut]:
    """The other sizes in this product's group, as the distributor sees them (hidden ones too)."""
    if product.variant_group_id is None:
        return []
    others = (
        await db.scalars(
            select(Product).where(
                Product.tenant_id == product.tenant_id,
                Product.variant_group_id == product.variant_group_id,
                Product.id != product.id,
            ).order_by(Product.created_at)
        )
    ).all()
    stock = await stock_map(db, [p.id for p in others])
    out = []
    for p in others:
        unit = default_unit(p)
        out.append(
            SizeOut(
                id=p.id, label=p.variant_label or p.name, name=p.name, status=p.status,
                price=unit.price if unit else None, stock_pieces=stock.get(p.id, 0),
            )
        )
    return out


def product_out(product: Product, stock_pieces: int) -> ProductOut:
    return ProductOut(
        id=product.id,
        category_id=product.category_id,
        name=product.name,
        brand=product.brand,
        description=product.description,
        search_aliases=product.search_aliases,
        sku=product.sku,
        mrp=product.mrp,
        attributes=product.attributes,
        images=product.images,
        thumbnails=[thumb_url(u) for u in product.images],
        status=product.status,
        units=[unit_out(u) for u in product.units],
        stock_pieces=stock_pieces,
        created_at=product.created_at,
        updated_at=product.updated_at,
        variant_group_id=product.variant_group_id,
        variant_label=product.variant_label,
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def apply_search(db: AsyncSession, query: Select, q: str | None) -> Select:
    """Search name, brand and aliases in any script.

    1. Exact: every word typed appears somewhere (e.g. "sugar 1 kg").
    2. Only if nothing matches exactly: fuzzy match to catch typos ("suger" -> sugar).
    Hinglish works because distributors put spellings like 'cheeni, chini, शक्कर' in search_aliases.
    """
    q = " ".join((q or "").lower().split())
    if not q:
        return query.order_by(Product.name)
    similarity = func.word_similarity(q, Product.search_text)
    exact = query.where(
        *[Product.search_text.like(f"%{_escape_like(word)}%", escape="\\") for word in q.split(" ")]
    )
    if await db.scalar(select(exact.order_by(None).exists())):
        return exact.order_by(similarity.desc(), Product.name)
    return query.where(similarity >= SEARCH_SIMILARITY).order_by(similarity.desc(), Product.name)


def parse_filters(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(422, 'filters must be JSON, e.g. {"grain": "Medium"}') from None
    if not isinstance(data, dict):
        raise HTTPException(422, 'filters must be a JSON object, e.g. {"grain": "Medium"}')
    return data


def _candidates(value: Any) -> list[Any]:
    """A filter value from a URL may be '1' meaning the number 1, or 'true' meaning a boolean."""
    out = [value]
    if isinstance(value, str):
        text = value.strip()
        if text.lower() in ("true", "false"):
            out.append(text.lower() == "true")
        try:
            number = float(text)
            out.append(int(number) if number.is_integer() else number)
        except ValueError:
            pass
    return out


def apply_attribute_filters(query: Select, filters: dict[str, Any]) -> Select:
    for key, value in filters.items():
        values = value if isinstance(value, list) else [value]  # a list means "any of these"
        conditions = [
            Product.attributes.contains({key: candidate}) for v in values for candidate in _candidates(v)
        ]
        # select options are matched case-insensitively
        texts = [str(v).lower() for v in values if isinstance(v, str)]
        if texts:
            conditions.append(func.lower(Product.attributes[key].astext).in_(texts))
        query = query.where(or_(*conditions))
    return query


async def count(db: AsyncSession, query: Select) -> int:
    return await db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
