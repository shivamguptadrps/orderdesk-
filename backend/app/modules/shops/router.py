"""Shop owner endpoints (/shops/...) and distributor-side shop management (/t/{tenant_id}/shops/...)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.tenancy import STAFF_ROLES, TenantContext, require_roles
from app.modules.auth.models import User
from app.modules.shops.models import LINK_STATUSES, DistributorShop, Shop
from app.modules.shops.schemas import (
    AssignAgentIn,
    JoinDistributorIn,
    MyDistributorOut,
    ShopCreateIn,
    ShopOut,
    ShopUpdateIn,
    TenantShopOut,
)
from app.modules.tenants.models import Tenant, TenantMember

router = APIRouter(tags=["shops"])


# ---------- shop owner ----------


async def _my_shop(db: AsyncSession, user: User) -> Shop | None:
    return await db.scalar(select(Shop).where(Shop.owner_user_id == user.id))


async def _require_my_shop(db: AsyncSession, user: User) -> Shop:
    shop = await _my_shop(db, user)
    if shop is None:
        raise HTTPException(404, "Create your shop profile first")
    return shop


@router.post("/shops", response_model=ShopOut, status_code=201)
async def create_shop(body: ShopCreateIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if await _my_shop(db, user) is not None:
        raise HTTPException(409, "You already have a shop profile")
    shop = Shop(owner_user_id=user.id, **body.model_dump())
    db.add(shop)
    await db.commit()
    return shop


@router.get("/shops/me", response_model=ShopOut)
async def get_my_shop(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _require_my_shop(db, user)


@router.put("/shops/me", response_model=ShopOut)
async def update_my_shop(body: ShopUpdateIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shop = await _require_my_shop(db, user)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None and field not in ("lat", "lng", "photo_url"):
            continue  # required fields cannot be cleared
        setattr(shop, field, value)
    await db.commit()
    return shop


def _my_distributor_out(link: DistributorShop, tenant: Tenant) -> MyDistributorOut:
    return MyDistributorOut(
        tenant_id=tenant.id,
        name=tenant.name,
        logo_url=tenant.logo_url,
        brand_color=tenant.brand_color,
        status=link.status,
        joined_at=link.created_at,
    )


@router.post("/shops/me/distributors", response_model=MyDistributorOut, status_code=201)
async def join_distributor(
    body: JoinDistributorIn,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a distributor by its join code. The link stays 'pending' until the distributor approves."""
    shop = await _require_my_shop(db, user)
    code = body.join_code.strip().upper()
    tenant = await db.scalar(select(Tenant).where(Tenant.join_code == code, Tenant.status == "active"))
    if tenant is None:
        raise HTTPException(404, "No distributor found with this code")

    link = await db.scalar(
        select(DistributorShop).where(DistributorShop.tenant_id == tenant.id, DistributorShop.shop_id == shop.id)
    )
    if link is not None:
        response.status_code = 200  # already joined; return the existing link
        return _my_distributor_out(link, tenant)

    link = DistributorShop(tenant_id=tenant.id, shop_id=shop.id, status="pending", joined_via_code=code)
    db.add(link)
    await db.commit()
    return _my_distributor_out(link, tenant)


@router.get("/shops/me/distributors", response_model=list[MyDistributorOut])
async def list_my_distributors(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shop = await _require_my_shop(db, user)
    rows = await db.execute(
        select(DistributorShop, Tenant)
        .join(Tenant, Tenant.id == DistributorShop.tenant_id)
        .where(DistributorShop.shop_id == shop.id, Tenant.status == "active")
        .order_by(Tenant.name)
    )
    return [_my_distributor_out(link, tenant) for link, tenant in rows]


# ---------- distributor side ----------

_staff = require_roles(*STAFF_ROLES)


def _tenant_shop_query(tenant_id: uuid.UUID):
    return (
        select(DistributorShop, Shop, User.phone)
        .join(Shop, Shop.id == DistributorShop.shop_id)
        .join(User, User.id == Shop.owner_user_id)
        .where(DistributorShop.tenant_id == tenant_id)
    )


def _tenant_shop_out(link: DistributorShop, shop: Shop, phone: str) -> TenantShopOut:
    return TenantShopOut(
        shop_id=shop.id,
        shop_name=shop.shop_name,
        owner_name=shop.owner_name,
        owner_phone=phone,
        address=shop.address,
        city=shop.city,
        pincode=shop.pincode,
        status=link.status,
        agent_user_id=link.agent_user_id,
        joined_at=link.created_at,
    )


async def _get_tenant_shop(db: AsyncSession, tenant_id: uuid.UUID, shop_id: uuid.UUID):
    row = (await db.execute(_tenant_shop_query(tenant_id).where(DistributorShop.shop_id == shop_id))).first()
    if row is None:
        raise HTTPException(404, "Shop not found")
    return row


@router.get("/t/{tenant_id}/shops", response_model=list[TenantShopOut])
async def list_tenant_shops(
    status: str | None = None,
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    if status is not None and status not in LINK_STATUSES:
        raise HTTPException(422, f"status must be one of {', '.join(LINK_STATUSES)}")
    query = _tenant_shop_query(ctx.tenant_id).order_by(DistributorShop.created_at.desc())
    if status:
        query = query.where(DistributorShop.status == status)
    return [_tenant_shop_out(*row) for row in await db.execute(query)]


async def _set_status(db: AsyncSession, ctx: TenantContext, shop_id: uuid.UUID, status: str) -> TenantShopOut:
    link, shop, phone = await _get_tenant_shop(db, ctx.tenant_id, shop_id)
    link.status = status
    await db.commit()
    return _tenant_shop_out(link, shop, phone)


@router.post("/t/{tenant_id}/shops/{shop_id}/approve", response_model=TenantShopOut)
async def approve_shop(shop_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    return await _set_status(db, ctx, shop_id, "active")


@router.post("/t/{tenant_id}/shops/{shop_id}/block", response_model=TenantShopOut)
async def block_shop(shop_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    return await _set_status(db, ctx, shop_id, "blocked")


@router.put("/t/{tenant_id}/shops/{shop_id}/agent", response_model=TenantShopOut)
async def assign_agent(
    shop_id: uuid.UUID,
    body: AssignAgentIn,
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Assign one of this distributor's agents to the shop, or send null to unassign."""
    link, shop, phone = await _get_tenant_shop(db, ctx.tenant_id, shop_id)
    if body.agent_user_id is not None:
        is_agent = await db.scalar(
            select(TenantMember.id).where(
                TenantMember.tenant_id == ctx.tenant_id,
                TenantMember.user_id == body.agent_user_id,
                TenantMember.role == "agent",
            )
        )
        if is_agent is None:
            raise HTTPException(400, "This person is not an agent of your business")
    link.agent_user_id = body.agent_user_id
    await db.commit()
    return _tenant_shop_out(link, shop, phone)
