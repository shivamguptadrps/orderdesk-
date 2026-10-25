"""Platform admin (you, the OrderDesk operator): add and manage distributors from the app.

Two locks, both required:
  1. the logged-in phone is listed in PLATFORM_ADMIN_PHONES (server .env), and
  2. the request carries X-Admin-Key equal to PLATFORM_ADMIN_KEY (server .env).
Anyone else gets 404, as if these endpoints did not exist.
"""

import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.phone import normalize_phone
from app.modules.auth.models import User
from app.modules.catalog.models import Product
from app.modules.orders.models import Order
from app.modules.shops.models import DistributorShop
from app.modules.tenants.models import Tenant, TenantMember
from app.modules.tenants.service import create_tenant

router = APIRouter(tags=["platform admin"])
MIN_KEY_LENGTH = 24  # a short key could be guessed; the feature stays off


def admin_phones() -> set[str]:
    raw = get_settings().platform_admin_phones
    out = set()
    for part in raw.split(","):
        part = part.strip()
        if part:
            try:
                out.add(normalize_phone(part))
            except ValueError:
                continue
    return out


def is_platform_admin(user: User) -> bool:
    """Shows the admin menu in the app. The key is still needed for every admin call."""
    key = get_settings().platform_admin_key
    return len(key) >= MIN_KEY_LENGTH and user.phone in admin_phones()


async def require_platform_admin(
    x_admin_key: str | None = Header(default=None, description="Platform admin key from the server settings"),
    user: User = Depends(get_current_user),
) -> User:
    if not is_platform_admin(user):
        raise HTTPException(404, "Not found")
    if not x_admin_key or not secrets.compare_digest(x_admin_key, get_settings().platform_admin_key):
        raise HTTPException(403, "Admin key is wrong")
    return user


class TenantAdminOut(BaseModel):
    id: uuid.UUID
    name: str
    join_code: str
    status: str
    owner_phone: str | None
    owner_name: str | None
    shops: int
    products: int
    orders: int
    created_at: datetime


class TenantCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120, examples=["Gupta Traders"])
    owner_phone: str = Field(examples=["9876543210"])
    owner_name: str | None = Field(default=None, max_length=120)
    join_code: str | None = Field(default=None, min_length=4, max_length=12, pattern=r"^[A-Za-z0-9]+$")

    @field_validator("owner_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


async def _rows(db: AsyncSession, tenant_id: uuid.UUID | None = None) -> list[TenantAdminOut]:
    def count(model, *where):
        return select(func.count()).select_from(model).where(model.tenant_id == Tenant.id, *where).scalar_subquery()

    owner = (
        select(User.id)
        .join(TenantMember, TenantMember.user_id == User.id)
        .where(TenantMember.tenant_id == Tenant.id, TenantMember.role == "owner")
        .order_by(TenantMember.created_at)
        .limit(1)
        .scalar_subquery()
    )
    query = (
        select(
            Tenant,
            User.phone,
            User.name,
            count(DistributorShop, DistributorShop.status == "active"),
            count(Product),
            count(Order),
        )
        .outerjoin(User, User.id == owner)
        .order_by(Tenant.created_at.desc())
    )
    if tenant_id:
        query = query.where(Tenant.id == tenant_id)
    return [
        TenantAdminOut(
            id=t.id, name=t.name, join_code=t.join_code, status=t.status, owner_phone=phone, owner_name=name,
            shops=shops, products=products, orders=orders, created_at=t.created_at,
        )
        for t, phone, name, shops, products, orders in await db.execute(query)
    ]


@router.get("/admin/tenants", response_model=list[TenantAdminOut])
async def list_tenants(_: User = Depends(require_platform_admin), db: AsyncSession = Depends(get_db)):
    """Every distributor on the platform, newest first."""
    return await _rows(db)


@router.post("/admin/tenants", response_model=TenantAdminOut, status_code=201)
async def add_tenant(body: TenantCreateIn, _: User = Depends(require_platform_admin), db: AsyncSession = Depends(get_db)):
    """New distributor with its owner (they log in with owner_phone) and the FMCG starter categories."""
    code = body.join_code.upper() if body.join_code else None
    if code and await db.scalar(select(Tenant.id).where(Tenant.join_code == code)):
        raise HTTPException(409, f"Join code {code} is already used. Pick another or leave it empty.")
    tenant = await create_tenant(
        db, name=body.name.strip(), owner_phone=body.owner_phone, owner_name=(body.owner_name or "").strip() or None, join_code=code
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That join code was just taken. Try again.") from None
    return (await _rows(db, tenant.id))[0]


async def _set_status(db: AsyncSession, tenant_id: uuid.UUID, status: str) -> TenantAdminOut:
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(404, "Distributor not found")
    tenant.status = status
    await db.commit()
    return (await _rows(db, tenant_id))[0]


@router.post("/admin/tenants/{tenant_id}/suspend", response_model=TenantAdminOut)
async def suspend_tenant(tenant_id: uuid.UUID, _: User = Depends(require_platform_admin), db: AsyncSession = Depends(get_db)):
    """Turn a distributor off: its team and shops can't use it until reactivated. Nothing is deleted."""
    return await _set_status(db, tenant_id, "suspended")


@router.post("/admin/tenants/{tenant_id}/activate", response_model=TenantAdminOut)
async def activate_tenant(tenant_id: uuid.UUID, _: User = Depends(require_platform_admin), db: AsyncSession = Depends(get_db)):
    return await _set_status(db, tenant_id, "active")
