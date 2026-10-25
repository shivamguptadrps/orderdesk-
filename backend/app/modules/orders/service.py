"""Cart and order rules. Every state change locks the row it changes, so taps from two phones can't race."""

import uuid
from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.media import thumb_url
from app.modules.auth.models import User
from app.modules.catalog.models import Product, ProductUnit
from app.modules.inventory.models import Stock
from app.modules.inventory.service import change_stock, stock_map
from app.modules.orders.models import Cart, CartItem, Order, OrderEvent, OrderItem
from app.modules.orders.schemas import (
    CartLineOut,
    CartOut,
    LineQty,
    OrderEventOut,
    OrderItemOut,
    OrderOut,
    OrderSummaryOut,
    ShortLine,
)
from app.modules.shops.models import Shop
from app.modules.tenants.models import Tenant

# ---------- pack size rules ----------


def qty_problem(unit: ProductUnit, qty: int) -> str | None:
    if qty < unit.min_qty:
        return f"Minimum order is {unit.min_qty} {unit.name}"
    if qty % unit.step_qty:
        return f"Order {unit.name} in multiples of {unit.step_qty}"
    if unit.max_qty is not None and qty > unit.max_qty:
        return f"Maximum {unit.max_qty} {unit.name} per order"
    return None


# ---------- cart ----------


async def lock_cart(db: AsyncSession, tenant_id: uuid.UUID, shop_id: uuid.UUID, user_id: uuid.UUID) -> Cart:
    """Get (or create) the cart and lock it until commit. All cart changes go through here."""
    await db.execute(
        pg_insert(Cart)
        .values(id=uuid.uuid4(), tenant_id=tenant_id, shop_id=shop_id, user_id=user_id)
        .on_conflict_do_nothing(index_elements=["tenant_id", "shop_id", "user_id"])
    )
    return await db.scalar(
        select(Cart)
        .where(Cart.tenant_id == tenant_id, Cart.shop_id == shop_id, Cart.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def find_cart(db: AsyncSession, tenant_id: uuid.UUID, shop_id: uuid.UUID, user_id: uuid.UUID) -> Cart | None:
    return await db.scalar(
        select(Cart)
        .where(Cart.tenant_id == tenant_id, Cart.shop_id == shop_id, Cart.user_id == user_id)
        .execution_options(populate_existing=True)
    )


@dataclass
class Line:
    item: CartItem
    product: Product | None
    unit: ProductUnit | None
    problem: str | None


async def evaluate_cart(db: AsyncSession, cart: Cart | None) -> list[Line]:
    """Check every cart line against the live catalog and stock (stock is summed per product)."""
    if cart is None or not cart.items:
        return []
    products = {
        p.id: p
        for p in await db.scalars(
            select(Product).where(Product.id.in_({i.product_id for i in cart.items}), Product.tenant_id == cart.tenant_id)
        )
    }
    units = {u.id: u for p in products.values() for u in p.units}
    stock = await stock_map(db, list(products))
    pieces_needed: dict[uuid.UUID, int] = {}
    for i in cart.items:
        unit = units.get(i.unit_id)
        if unit is not None:
            pieces_needed[i.product_id] = pieces_needed.get(i.product_id, 0) + i.qty * unit.pieces_per_unit

    lines = []
    for i in cart.items:
        product, unit = products.get(i.product_id), units.get(i.unit_id)
        if product is None or unit is None or product.status != "active":
            problem = "No longer available"
        else:
            problem = qty_problem(unit, i.qty)
            available = stock.get(product.id, 0)
            if problem is None and pieces_needed[product.id] > available:
                packs = available // unit.pieces_per_unit
                problem = "Out of stock" if available == 0 else f"Only {packs} {unit.name} available" if packs else f"Only {available} pieces left"
        lines.append(Line(i, product, unit, problem))
    return lines


def cart_out(cart: Cart | None, lines: list[Line]) -> CartOut:
    out, total = [], Decimal("0")
    for line in lines:
        p, u, i = line.product, line.unit, line.item
        price = u.price if u else Decimal("0")
        line_total = price * i.qty
        if line.problem is None:
            total += line_total
        out.append(
            CartLineOut(
                id=i.id,
                product_id=i.product_id,
                unit_id=i.unit_id,
                product_name=p.name if p else "Removed product",
                brand=p.brand if p else None,
                image=thumb_url(p.images[0]) if p and p.images else None,
                unit_name=u.name if u else "",
                pieces_per_unit=u.pieces_per_unit if u else 0,
                price=price,
                qty=i.qty,
                line_total=line_total,
                min_qty=u.min_qty if u else 1,
                step_qty=u.step_qty if u else 1,
                max_qty=u.max_qty if u else None,
                problem=line.problem,
            )
        )
    return CartOut(
        items=out,
        item_count=len(out),
        total=total,
        note=cart.note if cart else None,
        can_place_order=bool(out) and all(line.problem is None for line in lines),
    )


async def get_sellable_unit(db: AsyncSession, tenant_id: uuid.UUID, unit_id: uuid.UUID) -> tuple[ProductUnit, Product]:
    unit = await db.scalar(select(ProductUnit).where(ProductUnit.id == unit_id, ProductUnit.tenant_id == tenant_id))
    product = await db.get(Product, unit.product_id) if unit else None
    if unit is None or product is None or product.status != "active":
        raise HTTPException(404, "Product not found")
    return unit, product


async def set_cart_qty(db: AsyncSession, cart: Cart, unit: ProductUnit, product: Product, qty: int) -> None:
    """Set a line's quantity after checking pack rules and stock. Cart must be locked."""
    problem = qty_problem(unit, qty)
    if problem:
        raise HTTPException(422, problem)
    others = {i.unit_id: i.qty for i in cart.items if i.product_id == product.id and i.unit_id != unit.id}
    other_units = {u.id: u.pieces_per_unit for u in product.units}
    pieces = qty * unit.pieces_per_unit + sum(q * other_units.get(uid, 0) for uid, q in others.items())
    available = (await stock_map(db, [product.id])).get(product.id, 0)
    if pieces > available:
        if available == 0:
            raise HTTPException(409, f"{product.name} is out of stock")
        in_cart = pieces - qty * unit.pieces_per_unit
        possible = max(0, (available - in_cart) // unit.pieces_per_unit)
        raise HTTPException(409, f"Only {possible} {unit.name} of {product.name} available")
    line = next((i for i in cart.items if i.unit_id == unit.id), None)
    if line is None:
        cart.items.append(CartItem(tenant_id=cart.tenant_id, product_id=product.id, unit_id=unit.id, qty=qty))
    else:
        line.qty = qty


# ---------- orders ----------


async def _take_order_no(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    new_next = await db.scalar(
        update(Tenant)
        .where(Tenant.id == tenant_id)
        .values(next_order_no=Tenant.next_order_no + 1)
        .returning(Tenant.next_order_no)
    )
    return new_next - 1


def _event(order: Order, to_status: str, user_id: uuid.UUID | None, note: str | None = None) -> None:
    order.events.append(
        OrderEvent(tenant_id=order.tenant_id, from_status=order.status, to_status=to_status, user_id=user_id, note=note)
    )
    order.status = to_status


def recompute_totals(order: Order) -> None:
    total = Decimal("0")
    for item in order.items:
        item.line_total = item.rate * item.qty_effective
        total += item.line_total
    order.items_total = total


async def place_order(
    db: AsyncSession,
    *,
    cart: Cart,
    shop: Shop,
    user_id: uuid.UUID,
    source: str,
    note: str | None,
    expected_total: Decimal | None = None,
) -> Order:
    """Turn a locked cart into a pending order. Caller commits."""
    if not cart.items:
        raise HTTPException(400, "Your cart is empty")
    lines = await evaluate_cart(db, cart)
    if any(line.problem for line in lines):
        raise HTTPException(409, "Some items in your cart need attention. Please check your cart.")
    if expected_total is not None:
        total = sum((line.unit.price * line.item.qty for line in lines), Decimal("0"))
        if total != expected_total:
            raise HTTPException(
                409,
                {"message": "Prices or quantities changed since you checked. Please review your order again.",
                 "code": "total_changed", "total": float(total)},
            )

    order = Order(
        tenant_id=cart.tenant_id,
        order_no=await _take_order_no(db, cart.tenant_id),
        shop_id=shop.id,
        placed_by_user_id=user_id,
        source=source,
        status="pending",
        note=(note if note is not None else cart.note) or None,
        items_total=Decimal("0"),
        shop_name=shop.shop_name,
        shop_address=f"{shop.address}, {shop.city} - {shop.pincode}",
        shop_lat=shop.lat,
        shop_lng=shop.lng,
    )
    order.items = [
        OrderItem(
            tenant_id=cart.tenant_id,
            product_id=line.product.id,
            unit_id=line.unit.id,
            product_name=line.product.name,
            unit_name=line.unit.name,
            pieces_per_unit=line.unit.pieces_per_unit,
            rate=line.unit.price,
            qty_ordered=line.item.qty,
            line_total=Decimal("0"),
            sort_order=n,
        )
        for n, line in enumerate(lines)
    ]
    order.events = [OrderEvent(tenant_id=cart.tenant_id, from_status=None, to_status="pending", user_id=user_id)]
    recompute_totals(order)
    db.add(order)
    cart.items.clear()
    cart.note = None
    await db.flush()
    return order


async def lock_order(db: AsyncSession, tenant_id: uuid.UUID, order_id: uuid.UUID) -> Order:
    order = await db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.tenant_id == tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if order is None:
        raise HTTPException(404, "Order not found")
    return order


def _require_status(order: Order, *allowed: str) -> None:
    if order.status not in allowed:
        raise HTTPException(409, f"Order #{order.order_no} is {order.status}; this can't be done now")


def _apply_edits(order: Order, edits: list[LineQty]) -> dict[uuid.UUID, int]:
    by_id = {i.id: i for i in order.items}
    result = {}
    for e in edits:
        if e.item_id not in by_id:
            raise HTTPException(422, "One of the lines is not part of this order")
        if e.item_id in result:
            raise HTTPException(422, "A line is listed twice")
        result[e.item_id] = e.qty
    return result


def _change_note(order: Order, field: str, before: dict[uuid.UUID, int]) -> str | None:
    changes = []
    for item in order.items:
        old, new = before[item.id], getattr(item, field)
        if old != new:
            label = f"{item.product_name} ({item.unit_name})"
            changes.append(f"{label} removed" if new == 0 else f"{label}: {old} → {new}")
    return "; ".join(changes) or None


def _join(*parts: str | None) -> str | None:
    text = " | ".join(p for p in parts if p)
    return text or None


def approve(order: Order, edits: list[LineQty], user_id: uuid.UUID, note: str | None) -> None:
    _require_status(order, "pending")
    new_qty = _apply_edits(order, edits)
    before = {i.id: i.qty_ordered for i in order.items}
    for item in order.items:
        item.qty_approved = new_qty.get(item.id, item.qty_ordered)
    if all(i.qty_approved == 0 for i in order.items):
        raise HTTPException(422, "Nothing left to approve. Reject the order instead.")
    recompute_totals(order)
    _event(order, "approved", user_id, _join(_change_note(order, "qty_approved", before), note))


def reject(order: Order, user_id: uuid.UUID, reason: str) -> None:
    _require_status(order, "pending")
    _event(order, "rejected", user_id, reason)


def cancel(order: Order, user_id: uuid.UUID, reason: str | None, by_shop: bool) -> None:
    if by_shop:
        _require_status(order, "pending")
    else:
        _require_status(order, "pending", "approved")
    _event(order, "cancelled", user_id, reason)


def deliver(order: Order, user_id: uuid.UUID, note: str | None) -> None:
    _require_status(order, "dispatched")
    _event(order, "delivered", user_id, note)


async def dispatch(db: AsyncSession, order: Order, edits: list[LineQty], user_id: uuid.UUID, note: str | None) -> None:
    """Deduct stock and mark dispatched, all in the caller's transaction.

    Locks the stock rows of every product on the order (in a fixed order, so two dispatches can't
    deadlock). If any product is short, nothing changes and a 409 lists the short lines.
    """
    _require_status(order, "approved")
    new_qty = _apply_edits(order, edits)
    for item in order.items:
        qty = new_qty.get(item.id, item.qty_approved)
        if qty > item.qty_approved:
            raise HTTPException(422, f"{item.product_name}: can't dispatch more than approved ({item.qty_approved})")
        if qty > 0 and item.product_id is None:
            raise HTTPException(409, f"{item.product_name} was deleted from the catalog; set its quantity to 0")
        item.qty_dispatched = qty
    if all(i.qty_dispatched == 0 for i in order.items):
        raise HTTPException(422, "Nothing to dispatch. Cancel the order instead.")

    need: dict[uuid.UUID, int] = {}
    for item in order.items:
        if item.qty_dispatched:
            need[item.product_id] = need.get(item.product_id, 0) + item.qty_dispatched * item.pieces_per_unit
    locked = await db.execute(
        select(Stock.product_id, Stock.qty_pieces)
        .where(Stock.product_id.in_(need), Stock.tenant_id == order.tenant_id)
        .order_by(Stock.product_id)
        .with_for_update()
    )
    available = dict(locked.all())

    short = []
    for item in order.items:
        if item.qty_dispatched and need[item.product_id] > available.get(item.product_id, 0):
            have = available.get(item.product_id, 0)
            short.append(
                ShortLine(
                    item_id=item.id,
                    product_name=item.product_name,
                    unit_name=item.unit_name,
                    qty_wanted=item.qty_dispatched,
                    qty_possible=min(item.qty_dispatched, have // item.pieces_per_unit),
                    pieces_needed=need[item.product_id],
                    pieces_available=have,
                ).model_dump(mode="json")
            )
    if short:
        raise HTTPException(409, {"message": "Not enough stock for some lines. Reduce them and try again.", "short": short})

    for product_id in sorted(need):
        await change_stock(
            db, tenant_id=order.tenant_id, product_id=product_id, change_pieces=-need[product_id],
            reason="dispatch", user_id=user_id, note=f"Order #{order.order_no}", ref_order_id=order.id,
        )
    before = {i.id: i.qty_approved for i in order.items}
    recompute_totals(order)
    _event(order, "dispatched", user_id, _join(_change_note(order, "qty_dispatched", before), note))


# ---------- output ----------


async def _names(db: AsyncSession, user_ids: set[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    ids = {u for u in user_ids if u}
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.name, User.phone).where(User.id.in_(ids)))
    return {uid: name or phone for uid, name, phone in rows}


async def _tenant_names(db: AsyncSession, tenant_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    rows = await db.execute(select(Tenant.id, Tenant.name).where(Tenant.id.in_(tenant_ids)))
    return dict(rows.all())


def _summary(order: Order, distributor: str, names: dict) -> dict:
    return dict(
        id=order.id,
        tenant_id=order.tenant_id,
        distributor_name=distributor,
        order_no=order.order_no,
        shop_id=order.shop_id,
        shop_name=order.shop_name,
        status=order.status,
        source=order.source,
        placed_by_name=names.get(order.placed_by_user_id),
        item_count=sum(1 for i in order.items if i.qty_effective > 0),
        items_total=order.items_total,
        payment_status=order.payment_status,
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


async def summaries_out(db: AsyncSession, orders: list[Order]) -> list[OrderSummaryOut]:
    names = await _names(db, {o.placed_by_user_id for o in orders})
    tenants = await _tenant_names(db, {o.tenant_id for o in orders}) if orders else {}
    return [OrderSummaryOut(**_summary(o, tenants[o.tenant_id], names)) for o in orders]


async def order_out(db: AsyncSession, order: Order) -> OrderOut:
    names = await _names(db, {order.placed_by_user_id} | {e.user_id for e in order.events})
    distributor = (await _tenant_names(db, {order.tenant_id}))[order.tenant_id]
    shop_phone = await db.scalar(
        select(User.phone).join(Shop, Shop.owner_user_id == User.id).where(Shop.id == order.shop_id)
    )
    return OrderOut(
        **_summary(order, distributor, names),
        note=order.note,
        shop_address=order.shop_address,
        shop_lat=float(order.shop_lat) if order.shop_lat is not None else None,
        shop_lng=float(order.shop_lng) if order.shop_lng is not None else None,
        shop_phone=shop_phone,
        items=[
            OrderItemOut(
                id=i.id, product_id=i.product_id, unit_id=i.unit_id, product_name=i.product_name,
                unit_name=i.unit_name, pieces_per_unit=i.pieces_per_unit, rate=i.rate,
                qty_ordered=i.qty_ordered, qty_approved=i.qty_approved, qty_dispatched=i.qty_dispatched,
                qty=i.qty_effective, line_total=i.line_total,
            )
            for i in order.items
        ],
        events=[
            OrderEventOut(from_status=e.from_status, to_status=e.to_status, by_name=names.get(e.user_id),
                          note=e.note, at=e.created_at)
            for e in order.events
        ],
    )
