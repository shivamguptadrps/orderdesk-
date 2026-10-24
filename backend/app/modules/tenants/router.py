import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Literal

import qrcode

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.media import MAX_UPLOAD_BYTES, delete_image, save_image
from app.core.phone import normalize_phone
from app.core.tenancy import STAFF_ROLES, TenantContext, get_tenant_context, require_roles
from app.modules.auth.models import User
from app.modules.catalog.models import Product, ProductUnit
from app.modules.inventory.models import Stock
from app.modules.orders.models import Cart, Order
from app.modules.shops.models import DistributorShop, Shop
from app.modules.tenants.models import TenantMember
from app.modules.tenants.service import get_or_create_user, unique_join_code

router = APIRouter(tags=["tenants"])
_staff = require_roles(*STAFF_ROLES)
_owner = require_roles("owner")


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    logo_url: str | None
    brand_color: str | None
    my_role: str  # owner, staff, agent or shop
    join_code: str | None  # only shown to owner/staff
    agent_shops_auto_approve: bool | None  # only shown to owner/staff


def _tenant_out(ctx: TenantContext) -> TenantOut:
    t, is_staff = ctx.tenant, ctx.role in STAFF_ROLES
    return TenantOut(
        id=t.id,
        name=t.name,
        logo_url=t.logo_url,
        brand_color=t.brand_color,
        my_role=ctx.role,
        join_code=t.join_code if is_staff else None,
        agent_shops_auto_approve=t.agent_shops_auto_approve if is_staff else None,
    )


@router.get("/t/{tenant_id}", response_model=TenantOut)
async def get_tenant(ctx: TenantContext = Depends(get_tenant_context)):
    return _tenant_out(ctx)


class TenantSettingsIn(BaseModel):
    """Send only what you want to change."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    logo_url: str | None = Field(default=None, max_length=500)
    brand_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$", examples=["#1F6FEB"])
    agent_shops_auto_approve: bool | None = None


@router.put("/t/{tenant_id}/settings", response_model=TenantOut)
async def update_settings(body: TenantSettingsIn, ctx: TenantContext = Depends(_owner), db: AsyncSession = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is None and field in ("name", "agent_shops_auto_approve"):
            continue
        setattr(ctx.tenant, field, value.strip() if isinstance(value, str) and field == "name" else value)
    await db.commit()
    return _tenant_out(ctx)


# ---------- team: staff and agents ----------


class MemberIn(BaseModel):
    phone: str = Field(examples=["9123456789"])
    name: str | None = Field(default=None, max_length=120)
    role: Literal["staff", "agent"]

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class MemberOut(BaseModel):
    user_id: uuid.UUID
    phone: str
    name: str | None
    role: str
    assigned_shops: int
    added_at: datetime


async def _members(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID | None = None) -> list[MemberOut]:
    assigned = (
        select(DistributorShop.agent_user_id, func.count().label("n"))
        .where(DistributorShop.tenant_id == tenant_id, DistributorShop.agent_user_id.is_not(None))
        .group_by(DistributorShop.agent_user_id)
        .subquery()
    )
    query = (
        select(TenantMember, User, func.coalesce(assigned.c.n, 0))
        .join(User, User.id == TenantMember.user_id)
        .outerjoin(assigned, assigned.c.agent_user_id == TenantMember.user_id)
        .where(TenantMember.tenant_id == tenant_id)
    )
    if user_id:
        query = query.where(TenantMember.user_id == user_id)
    rows = await db.execute(query.order_by(TenantMember.role, User.name, User.phone))
    return [
        MemberOut(user_id=u.id, phone=u.phone, name=u.name, role=m.role, assigned_shops=n, added_at=m.created_at)
        for m, u, n in rows
    ]


@router.get("/t/{tenant_id}/members", response_model=list[MemberOut])
async def list_members(
    role: Literal["owner", "staff", "agent"] | None = None,
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Owner, staff and agents of this distributor, with how many shops each agent looks after."""
    members = await _members(db, ctx.tenant_id)
    return [m for m in members if role is None or m.role == role]


@router.post("/t/{tenant_id}/members", response_model=MemberOut, status_code=201)
async def add_member(body: MemberIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Add staff (owner only) or an agent (owner or staff) by phone. They log in with that number."""
    if body.role == "staff" and ctx.role != "owner":
        raise HTTPException(403, "Only the owner can add staff")
    user = await get_or_create_user(db, body.phone, (body.name or "").strip() or None)
    if user.name is None and body.name:
        user.name = body.name.strip()
    existing = await db.scalar(
        select(TenantMember.role).where(TenantMember.tenant_id == ctx.tenant_id, TenantMember.user_id == user.id)
    )
    if existing:
        raise HTTPException(409, f"{body.phone} is already {existing} here")
    db.add(TenantMember(tenant_id=ctx.tenant_id, user_id=user.id, role=body.role))
    await db.commit()
    return (await _members(db, ctx.tenant_id, user.id))[0]


@router.delete("/t/{tenant_id}/members/{user_id}", status_code=204)
async def remove_member(user_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Remove staff or an agent. Their shops become unassigned; orders they placed stay as they are."""
    member = await db.scalar(
        select(TenantMember).where(TenantMember.tenant_id == ctx.tenant_id, TenantMember.user_id == user_id)
    )
    if member is None:
        raise HTTPException(404, "Not a member")
    if member.role == "owner":
        raise HTTPException(400, "The owner can't be removed")
    if member.role == "staff" and ctx.role != "owner":
        raise HTTPException(403, "Only the owner can remove staff")
    await db.execute(
        update(DistributorShop)
        .where(DistributorShop.tenant_id == ctx.tenant_id, DistributorShop.agent_user_id == user_id)
        .values(agent_user_id=None)
    )
    # Carts they filled for other shops go; their own shop's cart (if they also own a shop) stays.
    await db.execute(
        delete(Cart).where(
            Cart.tenant_id == ctx.tenant_id,
            Cart.user_id == user_id,
            Cart.shop_id.not_in(select(Shop.id).where(Shop.owner_user_id == user_id)),
        )
    )
    await db.delete(member)
    await db.commit()


# ---------- dashboard ----------


class DashboardOut(BaseModel):
    pending_orders: int  # waiting for approval
    to_dispatch: int  # approved, not dispatched yet
    shops_waiting: int  # shops asking to join
    low_stock: int  # active products with less than 2 of their main pack
    out_of_stock: int
    today_orders: int  # placed today (India time), not rejected/cancelled
    today_value: float


IST = timezone(timedelta(hours=5, minutes=30))


@router.get("/t/{tenant_id}/dashboard", response_model=DashboardOut)
async def dashboard(ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    tid = ctx.tenant_id
    status_counts = dict(
        (await db.execute(select(Order.status, func.count()).where(Order.tenant_id == tid).group_by(Order.status))).all()
    )
    shops_waiting = await db.scalar(
        select(func.count()).select_from(DistributorShop).where(DistributorShop.tenant_id == tid, DistributorShop.status == "pending")
    )
    default_pieces = func.coalesce(
        select(ProductUnit.pieces_per_unit)
        .where(ProductUnit.product_id == Product.id, ProductUnit.is_default.is_(True))
        .limit(1)
        .scalar_subquery(),
        1,
    )
    stock = func.coalesce(Stock.qty_pieces, 0)
    active = select(Product.id).outerjoin(Stock, Stock.product_id == Product.id).where(
        Product.tenant_id == tid, Product.status == "active"
    )
    low = await db.scalar(select(func.count()).select_from(active.where(stock < 2 * default_pieces).subquery()))
    out = await db.scalar(select(func.count()).select_from(active.where(stock == 0).subquery()))
    start = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    today = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Order.items_total), 0)).where(
                Order.tenant_id == tid,
                Order.created_at >= start,
                Order.status.not_in(("rejected", "cancelled")),
            )
        )
    ).one()
    return DashboardOut(
        pending_orders=status_counts.get("pending", 0),
        to_dispatch=status_counts.get("approved", 0),
        shops_waiting=shops_waiting,
        low_stock=low,
        out_of_stock=out,
        today_orders=today[0],
        today_value=float(today[1]),
    )


# ---------- join code, QR, logo ----------


def join_link(code: str) -> str:
    """What the QR holds. The app's scanner reads the code from '/join/CODE'."""
    return f"orderdesk://join/{code}"


@router.get("/t/{tenant_id}/join-qr.png", response_class=Response)
async def join_qr(ctx: TenantContext = Depends(_staff)):
    """QR code for the join code, to print on cards and bills or share on WhatsApp."""
    img = qrcode.make(join_link(ctx.tenant.join_code), box_size=10, border=2)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/t/{tenant_id}/join-code/regenerate", response_model=TenantOut)
async def regenerate_join_code(ctx: TenantContext = Depends(_owner), db: AsyncSession = Depends(get_db)):
    """New join code (e.g. if the old one was shared too widely). Shops already joined stay joined."""
    ctx.tenant.join_code = await unique_join_code(db)
    await db.commit()
    return _tenant_out(ctx)


@router.post("/t/{tenant_id}/logo", response_model=TenantOut)
async def upload_logo(
    file: UploadFile = File(description="JPG, PNG or WebP, max 8 MB"),
    ctx: TenantContext = Depends(_owner),
    db: AsyncSession = Depends(get_db),
):
    old = ctx.tenant.logo_url
    ctx.tenant.logo_url = save_image(ctx.tenant_id, await file.read(MAX_UPLOAD_BYTES + 1), "logo")
    await db.commit()
    if old:
        delete_image(ctx.tenant_id, old, "logo")
    return _tenant_out(ctx)
