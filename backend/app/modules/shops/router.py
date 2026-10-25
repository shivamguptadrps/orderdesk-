"""Shop owner endpoints (/shops/...) and distributor-side shop management (/t/{tenant_id}/shops/...)."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.tenancy import STAFF_ROLES, TenantContext, require_roles
from app.modules.auth.models import User
from app.modules.orders.models import Order
from app.modules.shops import notify
from app.modules.shops.models import LINK_STATUSES, DistributorShop, Shop
from app.modules.shops.schemas import (
    AgentShopsIn,
    AssignAgentIn,
    JoinDistributorIn,
    MyDistributorOut,
    OnboardShopIn,
    ShopCreateIn,
    ShopOut,
    ShopUpdateIn,
    TenantShopOut,
)
from app.modules.tenants.models import Tenant, TenantMember
from app.modules.tenants.service import get_or_create_user

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
    background: BackgroundTasks,
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
    background.add_task(notify.shop_wants_to_join, tenant.id, shop.id)
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


_Agent = aliased(User)


def _last_order_at():
    return (
        select(func.max(Order.created_at))
        .where(Order.tenant_id == DistributorShop.tenant_id, Order.shop_id == DistributorShop.shop_id)
        .correlate(DistributorShop)
        .scalar_subquery()
    )


def _tenant_shop_query(tenant_id: uuid.UUID):
    return (
        select(DistributorShop, Shop, User.phone, func.coalesce(_Agent.name, _Agent.phone), _last_order_at())
        .join(Shop, Shop.id == DistributorShop.shop_id)
        .join(User, User.id == Shop.owner_user_id)
        .outerjoin(_Agent, _Agent.id == DistributorShop.agent_user_id)
        .where(DistributorShop.tenant_id == tenant_id)
    )


def _tenant_shop_out(link: DistributorShop, shop: Shop, phone: str, agent_name=None, last_order_at=None) -> TenantShopOut:
    return TenantShopOut(
        shop_id=shop.id,
        shop_name=shop.shop_name,
        owner_name=shop.owner_name,
        owner_phone=phone,
        address=shop.address,
        city=shop.city,
        pincode=shop.pincode,
        lat=float(shop.lat) if shop.lat is not None else None,
        lng=float(shop.lng) if shop.lng is not None else None,
        status=link.status,
        agent_user_id=link.agent_user_id,
        agent_name=agent_name,
        added_by_agent=link.added_by_user_id is not None,
        last_order_at=last_order_at,
        joined_at=link.created_at,
    )


async def _fresh(db: AsyncSession, tenant_id: uuid.UUID, shop_id: uuid.UUID) -> TenantShopOut:
    return _tenant_shop_out(*await _get_tenant_shop(db, tenant_id, shop_id))


async def _get_tenant_shop(db: AsyncSession, tenant_id: uuid.UUID, shop_id: uuid.UUID):
    row = (await db.execute(_tenant_shop_query(tenant_id).where(DistributorShop.shop_id == shop_id))).first()
    if row is None:
        raise HTTPException(404, "Shop not found")
    return row


@router.get("/t/{tenant_id}/shops", response_model=list[TenantShopOut])
async def list_tenant_shops(
    status: str | None = None,
    agent_user_id: uuid.UUID | None = None,
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    _check_link_status(status)
    query = _tenant_shop_query(ctx.tenant_id).order_by(DistributorShop.created_at.desc())
    if status:
        query = query.where(DistributorShop.status == status)
    if agent_user_id:
        query = query.where(DistributorShop.agent_user_id == agent_user_id)
    return [_tenant_shop_out(*row) for row in await db.execute(query)]


def _check_link_status(status: str | None) -> None:
    if status is not None and status not in LINK_STATUSES:
        raise HTTPException(422, f"status must be one of {', '.join(LINK_STATUSES)}")


async def _set_status(db: AsyncSession, ctx: TenantContext, shop_id: uuid.UUID, status: str) -> tuple[TenantShopOut, str]:
    """Returns the shop and its status before the change."""
    link, *_ = await _get_tenant_shop(db, ctx.tenant_id, shop_id)
    before, link.status = link.status, status
    await db.commit()
    return await _fresh(db, ctx.tenant_id, shop_id), before


@router.post("/t/{tenant_id}/shops/{shop_id}/approve", response_model=TenantShopOut)
async def approve_shop(
    shop_id: uuid.UUID, background: BackgroundTasks, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    out, before = await _set_status(db, ctx, shop_id, "active")
    if before == "pending":
        background.add_task(notify.shop_approved, ctx.tenant_id, shop_id, ctx.user.id)
    return out


@router.post("/t/{tenant_id}/shops/{shop_id}/block", response_model=TenantShopOut)
async def block_shop(shop_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    return (await _set_status(db, ctx, shop_id, "blocked"))[0]


@router.put("/t/{tenant_id}/shops/{shop_id}/agent", response_model=TenantShopOut)
async def assign_agent(
    shop_id: uuid.UUID,
    body: AssignAgentIn,
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Assign one of this distributor's agents to the shop, or send null to unassign."""
    link, *_ = await _get_tenant_shop(db, ctx.tenant_id, shop_id)
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
    return await _fresh(db, ctx.tenant_id, shop_id)


@router.put("/t/{tenant_id}/members/{user_id}/shops", response_model=list[TenantShopOut])
async def set_agent_shops(
    user_id: uuid.UUID, body: AgentShopsIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Give an agent exactly these shops. Shops ticked here move to this agent (from any other agent);
    shops this agent had that are not in the list become unassigned."""
    role = await db.scalar(
        select(TenantMember.role).where(TenantMember.tenant_id == ctx.tenant_id, TenantMember.user_id == user_id)
    )
    if role is None:
        raise HTTPException(404, "Not a member")
    if role != "agent":
        raise HTTPException(400, "Shops can only be assigned to agents")
    wanted = set(body.shop_ids)
    links = list(await db.scalars(
        select(DistributorShop)
        .where(DistributorShop.tenant_id == ctx.tenant_id)
        .where(or_(DistributorShop.agent_user_id == user_id, DistributorShop.shop_id.in_(wanted)))
        .with_for_update()
    ))
    found = {link.shop_id for link in links}
    if wanted - found:
        raise HTTPException(404, "Shop not found")
    for link in links:
        link.agent_user_id = user_id if link.shop_id in wanted else None
    await db.commit()
    query = _tenant_shop_query(ctx.tenant_id).where(DistributorShop.agent_user_id == user_id).order_by(Shop.shop_name)
    return [_tenant_shop_out(*row) for row in await db.execute(query)]


# ---------- agents ----------

_agent = require_roles("agent")


@router.get("/t/{tenant_id}/agent/shops", response_model=list[TenantShopOut])
async def my_assigned_shops(
    status: str | None = None, ctx: TenantContext = Depends(_agent), db: AsyncSession = Depends(get_db)
):
    """Shops this agent looks after (all active shops if the distributor allows it). Only 'active'
    shops can be ordered for."""
    _check_link_status(status)
    mine = DistributorShop.agent_user_id == ctx.user.id
    if ctx.tenant.agents_see_all_shops:
        mine = or_(mine, DistributorShop.status == "active")
    query = _tenant_shop_query(ctx.tenant_id).where(mine)
    if status:
        query = query.where(DistributorShop.status == status)
    return [_tenant_shop_out(*row) for row in await db.execute(query.order_by(Shop.shop_name))]


@router.post("/t/{tenant_id}/agent/shops", response_model=TenantShopOut, status_code=201)
async def sign_up_shop(
    body: OnboardShopIn,
    ctx: TenantContext = Depends(require_roles("agent", *STAFF_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Sign up a shop on the spot (agent or staff). The shop owner can later log in with their phone.

    If that phone already has a shop profile, the existing profile is linked and left unchanged.
    Shops added by an agent wait for approval unless the distributor turned on auto-approve;
    shops added by staff are active straight away.
    """
    owner = await get_or_create_user(db, body.owner_phone, body.owner_name)
    shop = await db.scalar(select(Shop).where(Shop.owner_user_id == owner.id))
    if shop is None:
        shop = Shop(owner_user_id=owner.id, **body.model_dump(exclude={"owner_phone"}))
        db.add(shop)
        await db.flush()
    existing = await db.scalar(
        select(DistributorShop.status).where(
            DistributorShop.tenant_id == ctx.tenant_id, DistributorShop.shop_id == shop.id
        )
    )
    if existing:
        raise HTTPException(409, f"This shop is already linked to you (status: {existing})")
    is_agent = ctx.role == "agent"
    db.add(
        DistributorShop(
            tenant_id=ctx.tenant_id,
            shop_id=shop.id,
            status="pending" if is_agent and not ctx.tenant.agent_shops_auto_approve else "active",
            agent_user_id=ctx.user.id if is_agent else None,
            added_by_user_id=ctx.user.id,
        )
    )
    await db.commit()
    return await _fresh(db, ctx.tenant_id, shop.id)
