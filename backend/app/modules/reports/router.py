"""Distributor reports: /t/{tenant_id}/reports (+ /reports/agents/{user_id}). Owner and staff only.

Orders count from the day they were placed (India time). Rejected and cancelled orders are left out
of sales, but shown in the status counts. Values use the latest quantities (dispatched, else approved,
else ordered), the same as the bill. New fields are only ever added, so older apps keep working.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Date, Integer, and_, cast, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.tenancy import STAFF_ROLES, TenantContext, require_roles
from app.modules.auth.models import User
from app.modules.catalog.models import Product
from app.modules.catalog.service import load_tree
from app.modules.orders.models import Order, OrderItem
from app.modules.shops.models import DistributorShop, Shop
from app.modules.tenants.models import TenantMember

router = APIRouter(tags=["reports"])
_staff = require_roles(*STAFF_ROLES)

IST = timezone(timedelta(hours=5, minutes=30))
SALES = ("pending", "approved", "dispatched", "delivered")
GOODS_OUT = ("dispatched", "delivered")  # money is due once goods have left
PERIODS = (1, 7, 30, 90)


class DayOut(BaseModel):
    date: date
    orders: int
    value: float


class ProductRow(BaseModel):
    product_id: uuid.UUID | None
    name: str
    pieces: int
    value: float
    orders: int


class ShopRow(BaseModel):
    shop_id: uuid.UUID
    name: str
    orders: int
    value: float


class AgentRow(BaseModel):
    user_id: uuid.UUID
    name: str
    orders: int
    value: float


class ChannelRow(BaseModel):
    source: str  # shop (shop's own app), agent, admin (office), counter
    orders: int
    value: float


class CategoryRow(BaseModel):
    category_id: uuid.UUID | None
    name: str
    value: float
    pieces: int


class HourRow(BaseModel):
    hour: int  # 0-23, India time
    orders: int


class PaymentsOut(BaseModel):
    """Orders whose goods have gone out (dispatched/delivered) in the period."""

    paid_value: float
    unpaid_value: float
    unpaid_orders: int


class AgentStat(BaseModel):
    user_id: uuid.UUID
    name: str
    phone: str
    orders: int
    value: float
    average_order: float
    shops_ordered: int  # different shops they ordered for
    assigned_shops: int  # active shops assigned to them now
    shops_signed_up: int  # shops they added in the period
    last_order_at: datetime | None  # ever, not just this period
    share: float  # % of all sales in the period


class QuietShop(BaseModel):
    shop_id: uuid.UUID
    name: str
    city: str
    last_order_at: datetime
    agent_name: str | None


class ReportOut(BaseModel):
    days: int
    start: date
    end: date
    orders: int
    value: float
    average_order: float
    shops_ordering: int
    new_shops: int
    status_counts: dict[str, int]
    by_source: dict[str, int]  # shop / agent / admin / counter -> orders
    by_day: list[DayOut]
    top_products: list[ProductRow]
    top_shops: list[ShopRow]
    top_agents: list[AgentRow]
    # added later
    prev_orders: int = 0  # same length period just before
    prev_value: float = 0
    channels: list[ChannelRow] = []
    payments: PaymentsOut | None = None
    top_categories: list[CategoryRow] = []
    by_hour: list[HourRow] = []
    agents: list[AgentStat] = []  # every agent, including those with no sales
    quiet_shops: list[QuietShop] = []  # ordered before, not in this period (latest first)
    quiet_shops_total: int = 0


class IdleShop(BaseModel):
    shop_id: uuid.UUID
    name: str
    city: str
    last_order_at: datetime | None


class AgentReportOut(BaseModel):
    days: int
    start: date
    end: date
    agent: AgentStat
    by_day: list[DayOut]
    top_shops: list[ShopRow]
    top_products: list[ProductRow]
    idle_shops: list[IdleShop]  # assigned shops with no order from anyone in the period


def _period(days: int) -> tuple[date, date, datetime]:
    if days not in PERIODS:
        raise HTTPException(422, "days must be 1, 7, 30 or 90")
    today = datetime.now(IST).date()
    first = today - timedelta(days=days - 1)
    return first, today, datetime.combine(first, datetime.min.time(), tzinfo=IST)


async def _by_day(db: AsyncSession, sales: tuple, first: date, days: int) -> list[DayOut]:
    day = cast(func.timezone("Asia/Kolkata", Order.created_at), Date)
    per_day = {
        d: (n, float(v))
        for d, n, v in await db.execute(
            select(day, func.count(), func.coalesce(func.sum(Order.items_total), 0)).where(*sales).group_by(day)
        )
    }
    out = []
    for i in range(days):
        d = first + timedelta(days=i)
        n, v = per_day.get(d, (0, 0.0))
        out.append(DayOut(date=d, orders=n, value=v))
    return out


async def _top_products(db: AsyncSession, sales: tuple, limit: int = 10) -> list[ProductRow]:
    qty = func.coalesce(OrderItem.qty_dispatched, OrderItem.qty_approved, OrderItem.qty_ordered)
    rows = await db.execute(
        select(
            OrderItem.product_id,
            func.max(OrderItem.product_name),
            func.sum(qty * OrderItem.pieces_per_unit),
            func.sum(OrderItem.line_total),
            func.count(func.distinct(OrderItem.order_id)),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(*sales, qty > 0)
        .group_by(OrderItem.product_id, func.coalesce(OrderItem.product_id, OrderItem.id))
        .order_by(func.sum(OrderItem.line_total).desc())
        .limit(limit)
    )
    return [
        ProductRow(product_id=pid, name=name, pieces=int(pieces or 0), value=float(value or 0), orders=n)
        for pid, name, pieces, value, n in rows
    ]


async def _top_shops(db: AsyncSession, sales: tuple, limit: int = 10) -> list[ShopRow]:
    rows = await db.execute(
        select(Order.shop_id, func.max(Order.shop_name), func.count(), func.sum(Order.items_total))
        .where(*sales, Order.shop_id.is_not(None))  # counter sales have no shop
        .group_by(Order.shop_id)
        .order_by(func.sum(Order.items_total).desc())
        .limit(limit)
    )
    return [ShopRow(shop_id=s, name=name, orders=n, value=float(v)) for s, name, n, v in rows]


async def _agent_stats(
    db: AsyncSession, tid: uuid.UUID, sales: tuple, start: datetime, total_value: float, only: uuid.UUID | None = None
) -> list[AgentStat]:
    members = select(User.id, User.name, User.phone).join(TenantMember, TenantMember.user_id == User.id).where(
        TenantMember.tenant_id == tid, TenantMember.role == "agent"
    )
    if only:
        members = members.where(User.id == only)
    agents = (await db.execute(members)).all()
    if not agents:
        return []
    ids = [a[0] for a in agents]
    sold = {
        uid: (n, float(v), shops)
        for uid, n, v, shops in await db.execute(
            select(Order.placed_by_user_id, func.count(), func.sum(Order.items_total), func.count(func.distinct(Order.shop_id)))
            .where(*sales, Order.source == "agent", Order.placed_by_user_id.in_(ids))
            .group_by(Order.placed_by_user_id)
        )
    }
    last = dict(
        (
            await db.execute(
                select(Order.placed_by_user_id, func.max(Order.created_at))
                .where(Order.tenant_id == tid, Order.source == "agent", Order.status.in_(SALES), Order.placed_by_user_id.in_(ids))
                .group_by(Order.placed_by_user_id)
            )
        ).all()
    )
    assigned = dict(
        (
            await db.execute(
                select(DistributorShop.agent_user_id, func.count())
                .where(DistributorShop.tenant_id == tid, DistributorShop.status == "active", DistributorShop.agent_user_id.in_(ids))
                .group_by(DistributorShop.agent_user_id)
            )
        ).all()
    )
    signed = dict(
        (
            await db.execute(
                select(DistributorShop.added_by_user_id, func.count())
                .where(DistributorShop.tenant_id == tid, DistributorShop.created_at >= start, DistributorShop.added_by_user_id.in_(ids))
                .group_by(DistributorShop.added_by_user_id)
            )
        ).all()
    )
    out = []
    for uid, name, phone in agents:
        n, v, shops = sold.get(uid, (0, 0.0, 0))
        out.append(
            AgentStat(
                user_id=uid, name=name or phone, phone=phone, orders=n, value=v,
                average_order=round(v / n, 2) if n else 0.0, shops_ordered=shops,
                assigned_shops=assigned.get(uid, 0), shops_signed_up=signed.get(uid, 0),
                last_order_at=last.get(uid), share=round(100 * v / total_value, 1) if total_value else 0.0,
            )
        )
    return sorted(out, key=lambda a: (-a.value, -a.orders, a.name.lower()))


async def _top_categories(db: AsyncSession, tid: uuid.UUID, sales: tuple, limit: int = 8) -> list[CategoryRow]:
    """Sales per top-level category (Staples, Snacks...)."""
    qty = func.coalesce(OrderItem.qty_dispatched, OrderItem.qty_approved, OrderItem.qty_ordered)
    rows = await db.execute(
        select(Product.category_id, func.sum(OrderItem.line_total), func.sum(qty * OrderItem.pieces_per_unit))
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(Product, Product.id == OrderItem.product_id)
        .where(*sales, qty > 0)
        .group_by(Product.category_id)
    )
    tree = await load_tree(db, tid)
    totals: dict[uuid.UUID | None, list[float]] = {}
    for cat_id, value, pieces in rows:
        chain = tree.ancestors(cat_id) if cat_id else []
        top = chain[0] if chain else None
        slot = totals.setdefault(top, [0.0, 0])
        slot[0] += float(value or 0)
        slot[1] += int(pieces or 0)
    out = [
        CategoryRow(category_id=c, name=tree.by_id[c].name if c else "Other", value=v, pieces=p)
        for c, (v, p) in totals.items()
    ]
    return sorted(out, key=lambda r: -r.value)[:limit]


@router.get("/t/{tenant_id}/reports", response_model=ReportOut)
async def report(
    days: int = Query(default=7, description="1 (today), 7, 30 or 90"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    first, today, start = _period(days)
    tid = ctx.tenant_id
    in_period = (Order.tenant_id == tid, Order.created_at >= start)
    sales = (*in_period, Order.status.in_(SALES))

    status_counts = dict(
        (await db.execute(select(Order.status, func.count()).where(*in_period).group_by(Order.status))).all()
    )
    total_orders, total_value, shops_ordering = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Order.items_total), 0), func.count(func.distinct(Order.shop_id))).where(
                *sales
            )
        )
    ).one()
    value = float(total_value)

    prev_start = start - timedelta(days=days)
    prev_orders, prev_value = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Order.items_total), 0)).where(
                Order.tenant_id == tid, Order.created_at >= prev_start, Order.created_at < start, Order.status.in_(SALES)
            )
        )
    ).one()

    channel_rows = (
        await db.execute(
            select(Order.source, func.count(), func.coalesce(func.sum(Order.items_total), 0)).where(*sales).group_by(Order.source)
        )
    ).all()
    by_source = {s: n for s, n, _ in channel_rows}
    channels = sorted((ChannelRow(source=s, orders=n, value=float(v)) for s, n, v in channel_rows), key=lambda c: -c.value)

    paid_value, unpaid_value, unpaid_orders = (
        await db.execute(
            select(
                func.coalesce(func.sum(Order.items_total).filter(Order.payment_status == "paid"), 0),
                func.coalesce(func.sum(Order.items_total).filter(Order.payment_status != "paid"), 0),
                func.count().filter(Order.payment_status != "paid"),
            ).where(*in_period, Order.status.in_(GOODS_OUT))
        )
    ).one()

    hour = cast(extract("hour", func.timezone("Asia/Kolkata", Order.created_at)), Integer)
    by_hour = [
        HourRow(hour=h, orders=n)
        for h, n in await db.execute(select(hour, func.count()).where(*sales).group_by(hour).order_by(hour))
    ]

    top_agents = [
        AgentRow(user_id=u, name=name, orders=n, value=float(v))
        for u, name, n, v in await db.execute(
            select(User.id, func.coalesce(User.name, User.phone), func.count(), func.sum(Order.items_total))
            .join(User, User.id == Order.placed_by_user_id)
            .where(*sales, Order.source == "agent")
            .group_by(User.id)
            .order_by(func.sum(Order.items_total).desc())
            .limit(10)
        )
    ]

    # Shops that ordered before this period but not during it (most recent first)
    ordered_now = select(Order.shop_id).where(*sales, Order.shop_id.is_not(None))
    last_before = (
        select(Order.shop_id.label("shop_id"), func.max(Order.created_at).label("last"))
        .where(Order.tenant_id == tid, Order.created_at < start, Order.status.in_(SALES), Order.shop_id.is_not(None))
        .group_by(Order.shop_id)
        .subquery()
    )
    agent = User.__table__.alias("agent")
    quiet_q = (
        select(Shop.id, Shop.shop_name, Shop.city, last_before.c.last, func.coalesce(agent.c.name, agent.c.phone))
        .join(last_before, last_before.c.shop_id == Shop.id)
        .join(DistributorShop, and_(DistributorShop.shop_id == Shop.id, DistributorShop.tenant_id == tid))
        .outerjoin(agent, agent.c.id == DistributorShop.agent_user_id)
        .where(DistributorShop.status == "active", Shop.id.not_in(ordered_now))
    )
    quiet_total = await db.scalar(select(func.count()).select_from(quiet_q.subquery()))
    quiet = [
        QuietShop(shop_id=sid, name=name, city=city, last_order_at=last, agent_name=agent_name)
        for sid, name, city, last, agent_name in await db.execute(quiet_q.order_by(last_before.c.last.desc()).limit(10))
    ]

    new_shops = await db.scalar(
        select(func.count())
        .select_from(DistributorShop)
        .where(DistributorShop.tenant_id == tid, DistributorShop.created_at >= start)
    )
    return ReportOut(
        days=days,
        start=first,
        end=today,
        orders=total_orders,
        value=value,
        average_order=round(value / total_orders, 2) if total_orders else 0.0,
        shops_ordering=shops_ordering,
        new_shops=new_shops,
        status_counts=status_counts,
        by_source=by_source,
        by_day=await _by_day(db, sales, first, days),
        top_products=await _top_products(db, sales),
        top_shops=await _top_shops(db, sales),
        top_agents=top_agents,
        prev_orders=prev_orders,
        prev_value=float(prev_value),
        channels=channels,
        payments=PaymentsOut(paid_value=float(paid_value), unpaid_value=float(unpaid_value), unpaid_orders=unpaid_orders),
        top_categories=await _top_categories(db, tid, sales),
        by_hour=by_hour,
        agents=await _agent_stats(db, tid, sales, start, value),
        quiet_shops=quiet,
        quiet_shops_total=quiet_total or 0,
    )


@router.get("/t/{tenant_id}/reports/agents/{user_id}", response_model=AgentReportOut)
async def agent_report(
    user_id: uuid.UUID,
    days: int = Query(default=7, description="1 (today), 7, 30 or 90"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """One agent: sales per day, best shops and products, and assigned shops with no order in the period."""
    first, today, start = _period(days)
    tid = ctx.tenant_id
    in_period = (Order.tenant_id == tid, Order.created_at >= start, Order.status.in_(SALES))
    total_value = float(
        await db.scalar(select(func.coalesce(func.sum(Order.items_total), 0)).where(*in_period)) or 0
    )
    stats = await _agent_stats(db, tid, in_period, start, total_value, only=user_id)
    if not stats:
        raise HTTPException(404, "Agent not found")
    mine = (*in_period, Order.source == "agent", Order.placed_by_user_id == user_id)

    ordered = select(Order.shop_id).where(*in_period, Order.shop_id.is_not(None))
    last_any = (
        select(Order.shop_id.label("shop_id"), func.max(Order.created_at).label("last"))
        .where(Order.tenant_id == tid, Order.status.in_(SALES), Order.shop_id.is_not(None))
        .group_by(Order.shop_id)
        .subquery()
    )
    idle = [
        IdleShop(shop_id=sid, name=name, city=city, last_order_at=last)
        for sid, name, city, last in await db.execute(
            select(Shop.id, Shop.shop_name, Shop.city, last_any.c.last)
            .join(DistributorShop, and_(DistributorShop.shop_id == Shop.id, DistributorShop.tenant_id == tid))
            .outerjoin(last_any, last_any.c.shop_id == Shop.id)
            .where(DistributorShop.agent_user_id == user_id, DistributorShop.status == "active", Shop.id.not_in(ordered))
            .order_by(last_any.c.last.asc().nulls_first(), Shop.shop_name)
            .limit(50)
        )
    ]
    return AgentReportOut(
        days=days,
        start=first,
        end=today,
        agent=stats[0],
        by_day=await _by_day(db, mine, first, days),
        top_shops=await _top_shops(db, mine),
        top_products=await _top_products(db, mine),
        idle_shops=idle,
    )
