"""Push notifications about shops joining a distributor. Run as background tasks with their own session."""

import logging
import uuid

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.tenancy import STAFF_ROLES
from app.modules.notifications.service import Push, send
from app.modules.shops.models import Shop
from app.modules.tenants.models import Tenant, TenantMember

log = logging.getLogger("uvicorn.error")


async def shop_wants_to_join(tenant_id: uuid.UUID, shop_id: uuid.UUID) -> None:
    """Tell the distributor's owner and staff that a shop is waiting for approval."""
    try:
        async with SessionLocal() as db:
            shop = await db.get(Shop, shop_id)
            staff = set(
                await db.scalars(
                    select(TenantMember.user_id).where(
                        TenantMember.tenant_id == tenant_id, TenantMember.role.in_(STAFF_ROLES)
                    )
                )
            )
            place = f", {shop.city}" if shop.city else ""
            await send(
                db,
                [
                    Push(
                        staff,
                        "New shop wants to join",
                        f"{shop.shop_name}{place} · tap to approve",
                        {"type": "shop", "tenant_id": str(tenant_id), "shop_id": str(shop_id), "for": "manage"},
                    )
                ],
            )
    except Exception:
        log.exception("Shop join notification failed")


async def shop_approved(tenant_id: uuid.UUID, shop_id: uuid.UUID, actor_id: uuid.UUID) -> None:
    """Tell the shop owner they can order now."""
    try:
        async with SessionLocal() as db:
            shop = await db.get(Shop, shop_id)
            tenant = await db.get(Tenant, tenant_id)
            if shop.owner_user_id == actor_id:
                return
            await send(
                db,
                [
                    Push(
                        {shop.owner_user_id},
                        f"You can order from {tenant.name}",
                        f"{tenant.name} approved {shop.shop_name}. Start ordering.",
                        {"type": "distributor", "tenant_id": str(tenant_id), "for": "shop"},
                    )
                ],
            )
    except Exception:
        log.exception("Shop approved notification failed")
