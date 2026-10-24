"""Cart (/t/{tenant_id}/cart), orders (/t/{tenant_id}/orders) and a shop's orders across distributors (/shops/me/orders)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.tenancy import STAFF_ROLES, TenantContext, get_tenant_context, require_roles
from app.modules.auth.models import User
from app.modules.catalog.queries import count
from app.modules.orders import service
from app.modules.orders.bill import render_bill
from app.modules.orders.models import ORDER_STATUSES, Order
from app.modules.orders.schemas import (
    ApproveIn,
    CartAddIn,
    CartNoteIn,
    CartOut,
    CartQtyIn,
    DispatchIn,
    NoteIn,
    OrderOut,
    OrderPage,
    PlaceOrderIn,
    ReasonIn,
    ReorderOut,
)
from app.modules.shops.models import Shop
from app.modules.tenants.models import Tenant

router = APIRouter(tags=["orders"])
_shop = require_roles("shop")
_staff = require_roles(*STAFF_ROLES)


# ---------- cart (shop) ----------


async def _cart_response(db: AsyncSession, ctx: TenantContext) -> CartOut:
    cart = await service.find_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    return service.cart_out(cart, await service.evaluate_cart(db, cart))


@router.get("/t/{tenant_id}/cart", response_model=CartOut)
async def get_cart(ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    """The cart for this distributor. Lines with a `problem` must be fixed before ordering."""
    return await _cart_response(db, ctx)


@router.post("/t/{tenant_id}/cart/items", response_model=CartOut)
async def add_to_cart(body: CartAddIn, ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    """Add packs to the cart. If this pack size is already there, the quantities are added up."""
    unit, product = await service.get_sellable_unit(db, ctx.tenant_id, body.unit_id)
    cart = await service.lock_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    existing = next((i.qty for i in cart.items if i.unit_id == unit.id), 0)
    await service.set_cart_qty(db, cart, unit, product, existing + body.qty)
    await db.commit()
    return await _cart_response(db, ctx)


async def _locked_line(db, ctx: TenantContext, item_id: uuid.UUID):
    cart = await service.lock_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    line = next((i for i in cart.items if i.id == item_id), None)
    if line is None:
        raise HTTPException(404, "Item not in your cart")
    return cart, line


@router.put("/t/{tenant_id}/cart/items/{item_id}", response_model=CartOut)
async def update_cart_item(
    item_id: uuid.UUID, body: CartQtyIn, ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)
):
    cart, line = await _locked_line(db, ctx, item_id)
    unit, product = await service.get_sellable_unit(db, ctx.tenant_id, line.unit_id)
    await service.set_cart_qty(db, cart, unit, product, body.qty)
    await db.commit()
    return await _cart_response(db, ctx)


@router.delete("/t/{tenant_id}/cart/items/{item_id}", response_model=CartOut)
async def remove_cart_item(item_id: uuid.UUID, ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    cart, line = await _locked_line(db, ctx, item_id)
    cart.items.remove(line)
    await db.commit()
    return await _cart_response(db, ctx)


@router.put("/t/{tenant_id}/cart/note", response_model=CartOut)
async def set_cart_note(body: CartNoteIn, ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    cart = await service.lock_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    cart.note = (body.note or "").strip() or None
    await db.commit()
    return await _cart_response(db, ctx)


@router.delete("/t/{tenant_id}/cart", response_model=CartOut)
async def clear_cart(ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    cart = await service.lock_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    cart.items.clear()
    cart.note = None
    await db.commit()
    return await _cart_response(db, ctx)


# ---------- placing and viewing orders ----------


@router.post("/t/{tenant_id}/orders", response_model=OrderOut, status_code=201)
async def place_order(body: PlaceOrderIn, ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    """Place an order from the cart. It waits for the distributor's approval."""
    cart = await service.lock_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    shop = await db.get(Shop, ctx.shop_id)
    order = await service.place_order(db, cart=cart, shop=shop, user_id=ctx.user.id, source="shop", note=body.note)
    await db.commit()
    return await service.order_out(db, order)


def _check_status_filter(status: str | None) -> None:
    if status is not None and status not in ORDER_STATUSES:
        raise HTTPException(422, f"status must be one of {', '.join(ORDER_STATUSES)}")


@router.get("/t/{tenant_id}/orders", response_model=OrderPage)
async def list_orders(
    status: str | None = None,
    shop_id: uuid.UUID | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db),
):
    """Distributor staff see all orders (filter by status for the queue); a shop sees its own."""
    _check_status_filter(status)
    query = select(Order).where(Order.tenant_id == ctx.tenant_id)
    if ctx.role in STAFF_ROLES:
        if shop_id:
            query = query.where(Order.shop_id == shop_id)
    elif ctx.role == "shop":
        query = query.where(Order.shop_id == ctx.shop_id)
    else:
        raise HTTPException(403, "You don't have access to this")
    if status:
        query = query.where(Order.status == status)
    query = query.order_by(Order.created_at.desc(), Order.order_no.desc())
    total = await count(db, query)
    orders = (await db.scalars(query.limit(limit).offset(offset))).all()
    return OrderPage(items=await service.summaries_out(db, orders), total=total)


async def _visible_order(db: AsyncSession, ctx: TenantContext, order_id: uuid.UUID) -> Order:
    order = await db.scalar(
        select(Order).where(Order.id == order_id, Order.tenant_id == ctx.tenant_id).execution_options(populate_existing=True)
    )
    if order is None or (ctx.role == "shop" and order.shop_id != ctx.shop_id) or ctx.role not in (*STAFF_ROLES, "shop"):
        raise HTTPException(404, "Order not found")
    return order


@router.get("/t/{tenant_id}/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: uuid.UUID, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    return await service.order_out(db, await _visible_order(db, ctx, order_id))


async def _bill_response(db: AsyncSession, order: Order) -> Response:
    tenant = await db.get(Tenant, order.tenant_id)
    details = await service.order_out(db, order)
    pdf = render_bill(order, tenant.name, details.shop_phone)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="order-{order.order_no}.pdf"'},
    )


@router.get("/t/{tenant_id}/orders/{order_id}/bill.pdf", response_class=Response)
async def order_bill(order_id: uuid.UUID, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    """Simple bill (not a tax invoice) to share on WhatsApp."""
    return await _bill_response(db, await _visible_order(db, ctx, order_id))


# ---------- shop actions on its own orders ----------


async def _locked_own_order(db: AsyncSession, ctx: TenantContext, order_id: uuid.UUID) -> Order:
    order = await service.lock_order(db, ctx.tenant_id, order_id)
    if order.shop_id != ctx.shop_id:
        raise HTTPException(404, "Order not found")
    return order


@router.post("/t/{tenant_id}/orders/{order_id}/reorder", response_model=ReorderOut)
async def reorder(order_id: uuid.UUID, ctx: TenantContext = Depends(_shop), db: AsyncSession = Depends(get_db)):
    """Put a past order's items back in the cart at today's prices. Unavailable items are skipped."""
    order = await _visible_order(db, ctx, order_id)
    cart = await service.lock_cart(db, ctx.tenant_id, ctx.shop_id, ctx.user.id)
    added, skipped = 0, []
    for item in order.items:
        if item.qty_ordered <= 0:
            continue
        try:
            if item.unit_id is None:
                raise HTTPException(404)
            unit, product = await service.get_sellable_unit(db, ctx.tenant_id, item.unit_id)
        except HTTPException:
            skipped.append(item.product_name)
            continue
        line = next((i for i in cart.items if i.unit_id == unit.id), None)
        if line is None:
            cart.items.append(
                service.CartItem(tenant_id=ctx.tenant_id, product_id=product.id, unit_id=unit.id, qty=item.qty_ordered)
            )
        else:
            line.qty += item.qty_ordered
        added += 1
    await db.commit()
    return ReorderOut(cart=await _cart_response(db, ctx), added=added, skipped=skipped)


# ---------- distributor actions ----------


async def _after(db: AsyncSession, order: Order) -> OrderOut:
    await db.commit()
    return await service.order_out(db, order)


@router.post("/t/{tenant_id}/orders/{order_id}/approve", response_model=OrderOut)
async def approve_order(
    order_id: uuid.UUID, body: ApproveIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Approve, optionally changing quantities (qty 0 removes a line). Stock is not touched yet."""
    order = await service.lock_order(db, ctx.tenant_id, order_id)
    service.approve(order, body.items, ctx.user.id, body.note)
    return await _after(db, order)


@router.post("/t/{tenant_id}/orders/{order_id}/reject", response_model=OrderOut)
async def reject_order(
    order_id: uuid.UUID, body: ReasonIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    order = await service.lock_order(db, ctx.tenant_id, order_id)
    service.reject(order, ctx.user.id, body.reason.strip())
    return await _after(db, order)


@router.post(
    "/t/{tenant_id}/orders/{order_id}/dispatch",
    response_model=OrderOut,
    responses={409: {"description": "Not enough stock; `detail.short` lists the lines to reduce"}},
)
async def dispatch_order(
    order_id: uuid.UUID, body: DispatchIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Dispatch: stock is deducted now, in one transaction. You may dispatch less than approved."""
    order = await service.lock_order(db, ctx.tenant_id, order_id)
    await service.dispatch(db, order, body.items, ctx.user.id, body.note)
    return await _after(db, order)


@router.post("/t/{tenant_id}/orders/{order_id}/deliver", response_model=OrderOut)
async def deliver_order(
    order_id: uuid.UUID, body: NoteIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    order = await service.lock_order(db, ctx.tenant_id, order_id)
    service.deliver(order, ctx.user.id, body.note)
    return await _after(db, order)


@router.post("/t/{tenant_id}/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_order(
    order_id: uuid.UUID, body: NoteIn, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)
):
    """A shop can cancel its own order while pending. Staff can cancel pending or approved orders."""
    if ctx.role == "shop":
        order = await _locked_own_order(db, ctx, order_id)
        service.cancel(order, ctx.user.id, body.note, by_shop=True)
    elif ctx.role in STAFF_ROLES:
        order = await service.lock_order(db, ctx.tenant_id, order_id)
        service.cancel(order, ctx.user.id, body.note, by_shop=False)
    else:
        raise HTTPException(403, "You don't have access to this")
    return await _after(db, order)


# ---------- a shop's orders across all distributors ----------


async def _my_shop_id(db: AsyncSession, user: User) -> uuid.UUID:
    shop_id = await db.scalar(select(Shop.id).where(Shop.owner_user_id == user.id))
    if shop_id is None:
        raise HTTPException(404, "Create your shop profile first")
    return shop_id


@router.get("/shops/me/orders", response_model=OrderPage)
async def my_orders(
    tenant_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """All my orders from every distributor, newest first. Works even if a distributor later blocks the shop."""
    _check_status_filter(status)
    query = select(Order).where(Order.shop_id == await _my_shop_id(db, user))
    if tenant_id:
        query = query.where(Order.tenant_id == tenant_id)
    if status:
        query = query.where(Order.status == status)
    query = query.order_by(Order.created_at.desc())
    total = await count(db, query)
    orders = (await db.scalars(query.limit(limit).offset(offset))).all()
    return OrderPage(items=await service.summaries_out(db, orders), total=total)


async def _my_order(db: AsyncSession, user: User, order_id: uuid.UUID) -> Order:
    order = await db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.shop_id == await _my_shop_id(db, user))
        .execution_options(populate_existing=True)
    )
    if order is None:
        raise HTTPException(404, "Order not found")
    return order


@router.get("/shops/me/orders/{order_id}", response_model=OrderOut)
async def my_order(order_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await service.order_out(db, await _my_order(db, user, order_id))


@router.get("/shops/me/orders/{order_id}/bill.pdf", response_class=Response)
async def my_order_bill(order_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _bill_response(db, await _my_order(db, user, order_id))
