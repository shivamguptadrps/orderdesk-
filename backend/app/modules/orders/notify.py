"""Who gets a push notification when an order changes.

- New order, or a shop/agent cancels: the distributor's owner and staff. A new order rings (bell sound).
- Approved, rejected, dispatched, delivered, or cancelled by the distributor: the shop owner,
  and the agent who placed it (if any).
The person who made the change is never notified about their own action.

Runs after the response is sent (FastAPI background task) with its own DB session.
"""

import logging
import uuid

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.tenancy import STAFF_ROLES
from app.modules.notifications.service import Push, send
from app.modules.orders.bill import inr
from app.modules.orders.models import Order
from app.modules.shops.models import Shop
from app.modules.tenants.models import Tenant, TenantMember

log = logging.getLogger("uvicorn.error")

TO_SHOP = {
    "approved": ("Order #{no} approved", "{tenant} approved your order · {total}"),
    "rejected": ("Order #{no} rejected", "{tenant}: {reason}"),
    "dispatched": ("Order #{no} is on the way", "{tenant} dispatched your order · {total}"),
    "delivered": ("Order #{no} delivered", "Delivered by {tenant} · {total}"),
    "cancelled": ("Order #{no} cancelled", "{tenant} cancelled your order{reason_suffix}"),
}


async def order_changed(order_id: uuid.UUID, event: str, actor_id: uuid.UUID) -> None:
    try:
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            if order is None:
                return
            tenant = await db.get(Tenant, order.tenant_id)
            last = order.events[-1] if order.events else None
            reason = (last.note if last and last.to_status == event else None) or ""
            values = {
                "no": order.order_no,
                "tenant": tenant.name,
                "shop": order.shop_name,
                "total": inr(order.items_total),
                "items": len([i for i in order.items if i.qty_effective > 0]),
                "reason": reason or "No reason given",
                "reason_suffix": f": {reason}" if reason else "",
            }
            staff = set(
                await db.scalars(
                    select(TenantMember.user_id).where(
                        TenantMember.tenant_id == order.tenant_id, TenantMember.role.in_(STAFF_ROLES)
                    )
                )
            )
            pushes: list[Push] = []
            data = {"type": "order", "tenant_id": str(order.tenant_id), "order_id": str(order.id)}
            if event == "placed" or (event == "cancelled" and actor_id not in staff):
                if event == "placed":
                    title = "New order #{no}".format(**values)
                    body = "{shop} · {total} · {items} item{s}".format(**values, s="" if values["items"] == 1 else "s")
                else:
                    title = "Order #{no} cancelled".format(**values)
                    body = "{shop} cancelled the order{reason_suffix}".format(**values)
                pushes.append(Push(staff - {actor_id}, title, body, data | {"for": "manage"}, ring=event == "placed"))
            elif event in TO_SHOP:
                title, body = (t.format(**values) for t in TO_SHOP[event])
                owner = await db.scalar(select(Shop.owner_user_id).where(Shop.id == order.shop_id))
                if owner and owner != actor_id:
                    pushes.append(Push({owner}, title, body, data | {"for": "shop"}))
                placer = order.placed_by_user_id
                if order.source == "agent" and placer not in (owner, actor_id):
                    pushes.append(Push({placer}, title, f"{order.shop_name}: {body}", data | {"for": "agent", "shop_id": str(order.shop_id)}))
            await send(db, pushes)
    except Exception:
        log.exception("Order notification failed (order %s, %s)", order_id, event)
