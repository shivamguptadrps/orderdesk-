"""Tenant context for /t/{tenant_id}/... routes.

Every tenant route depends on get_tenant_context (or require_roles). A user who is not a member
of the tenant, and whose shop is not an active customer of it, gets 404 - as if it does not exist.
"""

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.auth.models import User
from app.modules.shops.models import DistributorShop, Shop
from app.modules.tenants.models import Tenant, TenantMember

STAFF_ROLES = ("owner", "staff")


@dataclass
class TenantContext:
    tenant: Tenant
    user: User
    role: str  # owner, staff, agent, or shop
    shop_id: uuid.UUID | None = None

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.tenant.id


async def get_tenant_context(
    tenant_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    not_found = HTTPException(404, "Distributor not found")
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.status != "active":
        raise not_found

    role = await db.scalar(
        select(TenantMember.role).where(TenantMember.tenant_id == tenant_id, TenantMember.user_id == user.id)
    )
    if role is not None:
        return TenantContext(tenant=tenant, user=user, role=role)

    shop_id = await db.scalar(
        select(DistributorShop.shop_id)
        .join(Shop, Shop.id == DistributorShop.shop_id)
        .where(
            DistributorShop.tenant_id == tenant_id,
            DistributorShop.status == "active",
            Shop.owner_user_id == user.id,
        )
    )
    if shop_id is not None:
        return TenantContext(tenant=tenant, user=user, role="shop", shop_id=shop_id)

    raise not_found


async def resolve_shop(
    db: AsyncSession, ctx: TenantContext, shop_id: uuid.UUID | None, required: bool = True
) -> uuid.UUID | None:
    """Which shop a request is for. A shop is always itself. An agent may pick one of its assigned
    active shops, staff any active shop. Anything else is 404, so other tenants' shops stay invisible."""
    if ctx.role == "shop":
        if shop_id is not None and shop_id != ctx.shop_id:
            raise HTTPException(404, "Shop not found")
        return ctx.shop_id
    if shop_id is None:
        if required:
            raise HTTPException(422, "shop_id is required: which shop are you ordering for?")
        return None
    link = await db.scalar(
        select(DistributorShop).where(
            DistributorShop.tenant_id == ctx.tenant_id,
            DistributorShop.shop_id == shop_id,
            DistributorShop.status == "active",
        )
    )
    if link is None or (ctx.role == "agent" and link.agent_user_id != ctx.user.id):
        raise HTTPException(404, "Shop not found")
    return shop_id


def require_roles(*roles: str):
    async def dependency(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if ctx.role not in roles:
            raise HTTPException(403, "You don't have access to this")
        return ctx

    return dependency
