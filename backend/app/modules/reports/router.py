"""Distributor reports: /t/{tenant_id}/reports. Owner and staff only.

Orders count from the day they were placed (India time). Rejected and cancelled orders are left out
of sales, but shown in the status counts. Values use the latest quantities (dispatched, else approved,
else ordered), the same as the bill.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.tenancy import STAFF_ROLES, TenantContext, require_roles
from app.modules.auth.models import User
from app.modules.orders.models import Order, OrderItem
from app.modules.shops.models import DistributorShop

router = APIRouter(tags=["reports"])
_staff = require_roles(*STAFF_ROLES)

IST = timezone(timedelta(hours=5, minutes=30))
SALES = ("pending", "approved", "dispatched", "delivered")
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
    by_source: dict[str, int]  # shop / agent / admin -> orders
    by_day: list[DayOut]
    top_products: list[ProductRow]
    top_shops: list[ShopRow]
    top_agents: list[AgentRow]


@router.get("/t/{tenant_id}/reports", response_model=ReportOut)
async def report(
    days: int = Query(default=7, description="1 (today), 7, 30 or 90"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    if days not in PERIODS:
        raise HTTPException(422, "days must be 1, 7, 30 or 90")
    tid = ctx.tenant_id
    today = datetime.now(IST).date()
    first = today - timedelta(days=days - 1)
    start = datetime.combine(first, datetime.min.time(), tzinfo=IST)
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
    by_source = dict(
        (await db.execute(select(Order.source, func.count()).where(*sales).group_by(Order.source))).all()
    )

    day = cast(func.timezone("Asia/Kolkata", Order.created_at), Date)
    per_day = {
        d: (n, float(v))
        for d, n, v in await db.execute(
            select(day, func.count(), func.coalesce(func.sum(Order.items_total), 0)).where(*sales).group_by(day)
        )
    }
    by_day = []
    for i in range(days):
        d = first + timedelta(days=i)
        n, v = per_day.get(d, (0, 0.0))
        by_day.append(DayOut(date=d, orders=n, value=v))

    qty = func.coalesce(OrderItem.qty_dispatched, OrderItem.qty_approved, OrderItem.qty_ordered)
    product_rows = await db.execute(
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
        .limit(10)
    )
    top_products = [
        ProductRow(product_id=pid, name=name, pieces=int(pieces or 0), value=float(value or 0), orders=n)
        for pid, name, pieces, value, n in product_rows
    ]

    shop_rows = await db.execute(
        select(Order.shop_id, func.max(Order.shop_name), func.count(), func.sum(Order.items_total))
        .where(*sales)
        .group_by(Order.shop_id)
        .order_by(func.sum(Order.items_total).desc())
        .limit(10)
    )
    top_shops = [ShopRow(shop_id=s, name=name, orders=n, value=float(v)) for s, name, n, v in shop_rows]

    agent_rows = await db.execute(
        select(User.id, func.coalesce(User.name, User.phone), func.count(), func.sum(Order.items_total))
        .join(User, User.id == Order.placed_by_user_id)
        .where(*sales, Order.source == "agent")
        .group_by(User.id)
        .order_by(func.sum(Order.items_total).desc())
        .limit(10)
    )
    top_agents = [AgentRow(user_id=u, name=name, orders=n, value=float(v)) for u, name, n, v in agent_rows]

    new_shops = await db.scalar(
        select(func.count())
        .select_from(DistributorShop)
        .where(DistributorShop.tenant_id == tid, DistributorShop.created_at >= start)
    )
    value = float(total_value)
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
        by_day=by_day,
        top_products=top_products,
        top_shops=top_shops,
        top_agents=top_agents,
    )
