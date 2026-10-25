import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.modules.catalog.schemas import Money

# ---------- cart ----------


class CartAddIn(BaseModel):
    unit_id: uuid.UUID
    qty: int = Field(ge=1, le=100_000, description="Number of packs of this size to add")


class CartQtyIn(BaseModel):
    qty: int = Field(ge=1, le=100_000)


class CartNoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class CartLineOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    unit_id: uuid.UUID
    product_name: str
    brand: str | None
    image: str | None
    unit_name: str
    pieces_per_unit: int
    price: Money
    qty: int
    line_total: Money
    min_qty: int
    step_qty: int
    max_qty: int | None
    problem: str | None  # why this line can't be ordered right now (e.g. out of stock), else null


class CartOut(BaseModel):
    items: list[CartLineOut]
    item_count: int
    total: Money
    note: str | None
    can_place_order: bool


class ReorderOut(BaseModel):
    cart: CartOut
    added: int
    skipped: list[str]  # products that are no longer available


# ---------- orders ----------


class PlaceOrderIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    expected_total: Decimal | None = Field(
        default=None, ge=0, description="The total the buyer confirmed. If the cart now costs something else, the order is refused (409)."
    )


class LineQty(BaseModel):
    item_id: uuid.UUID
    qty: int = Field(ge=0, le=100_000)


class ApproveIn(BaseModel):
    """Leave `items` empty to approve everything as ordered. qty 0 removes a line."""

    items: list[LineQty] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=500)


class DispatchIn(BaseModel):
    """Leave `items` empty to dispatch the approved quantities. You can send less, not more."""

    items: list[LineQty] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=500)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class NoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class OrderItemOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID | None
    unit_id: uuid.UUID | None
    product_name: str
    unit_name: str
    pieces_per_unit: int
    rate: Money
    qty_ordered: int
    qty_approved: int | None
    qty_dispatched: int | None
    qty: int  # the quantity that counts now
    line_total: Money


class OrderEventOut(BaseModel):
    from_status: str | None
    to_status: str
    by_name: str | None
    note: str | None
    at: datetime


class OrderSummaryOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    distributor_name: str
    order_no: int
    shop_id: uuid.UUID
    shop_name: str
    status: str
    source: str
    placed_by_name: str | None
    item_count: int
    items_total: Money
    payment_status: str
    created_at: datetime
    updated_at: datetime


class OrderOut(OrderSummaryOut):
    note: str | None
    shop_address: str
    shop_lat: float | None = None
    shop_lng: float | None = None
    shop_phone: str | None
    items: list[OrderItemOut]
    events: list[OrderEventOut]


class OrderPage(BaseModel):
    items: list[OrderSummaryOut]
    total: int


class ShortLine(BaseModel):
    item_id: uuid.UUID
    product_name: str
    unit_name: str
    qty_wanted: int
    qty_possible: int  # most packs that can be dispatched with current stock
    pieces_needed: int
    pieces_available: int
