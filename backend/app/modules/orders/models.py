import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, CreatedAt, Timestamps, UUIDPk, utcnow

ORDER_STATUSES = ("pending", "approved", "dispatched", "delivered", "rejected", "cancelled")
ORDER_SOURCES = ("shop", "agent", "admin")
PAYMENT_STATUSES = ("unpaid", "partial", "paid")


class Cart(UUIDPk, Base):
    """One cart per shop, per distributor, per person filling it (shop owner, or an agent in M4)."""

    __tablename__ = "carts"
    __table_args__ = (UniqueConstraint("tenant_id", "shop_id", "user_id"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    note: Mapped[str | None] = mapped_column(String(500))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    items: Mapped[list["CartItem"]] = relationship(
        order_by="CartItem.created_at", cascade="all, delete-orphan", lazy="selectin"
    )


class CartItem(UUIDPk, Timestamps, Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        UniqueConstraint("cart_id", "unit_id"),
        CheckConstraint("qty > 0", name="qty_positive"),
    )

    cart_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"))
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_units.id", ondelete="CASCADE"), index=True)
    qty: Mapped[int]


class Order(UUIDPk, Timestamps, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("tenant_id", "order_no"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'dispatched', 'delivered', 'rejected', 'cancelled')", name="status"
        ),
        CheckConstraint("source IN ('shop', 'agent', 'admin')", name="source"),
        CheckConstraint("payment_status IN ('unpaid', 'partial', 'paid')", name="payment_status"),
        Index("ix_orders_tenant_id_status_created_at", "tenant_id", "status", "created_at"),
        Index("ix_orders_shop_id_created_at", "shop_id", "created_at"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    order_no: Mapped[int]
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id", ondelete="RESTRICT"))
    placed_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    source: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(12), default="pending", server_default="pending")
    note: Mapped[str | None] = mapped_column(String(500))
    items_total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    payment_status: Mapped[str] = mapped_column(String(10), default="unpaid", server_default="unpaid")
    # Copied at order time so old bills never change
    shop_name: Mapped[str] = mapped_column(String(150))
    shop_address: Mapped[str] = mapped_column(Text)

    items: Mapped[list["OrderItem"]] = relationship(
        order_by="OrderItem.sort_order", cascade="all, delete-orphan", lazy="selectin"
    )
    events: Mapped[list["OrderEvent"]] = relationship(
        order_by="OrderEvent.created_at", cascade="all, delete-orphan", lazy="selectin"
    )


class OrderItem(UUIDPk, Base):
    """A line with product name, pack size and rate copied from the catalog at order time."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("qty_ordered > 0", name="qty_ordered_positive"),
        CheckConstraint("qty_approved IS NULL OR qty_approved >= 0", name="qty_approved_not_negative"),
        CheckConstraint("qty_dispatched IS NULL OR qty_dispatched >= 0", name="qty_dispatched_not_negative"),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), index=True)
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_units.id", ondelete="SET NULL"))
    product_name: Mapped[str] = mapped_column(String(200))
    unit_name: Mapped[str] = mapped_column(String(40))
    pieces_per_unit: Mapped[int]
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    qty_ordered: Mapped[int]
    qty_approved: Mapped[int | None]
    qty_dispatched: Mapped[int | None]
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")

    @property
    def qty_effective(self) -> int:
        """The quantity that counts now: dispatched, else approved, else ordered."""
        if self.qty_dispatched is not None:
            return self.qty_dispatched
        if self.qty_approved is not None:
            return self.qty_approved
        return self.qty_ordered


class OrderEvent(UUIDPk, CreatedAt, Base):
    """Every status change: who, when, and a note (e.g. reject reason or quantity edits)."""

    __tablename__ = "order_events"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    from_status: Mapped[str | None] = mapped_column(String(12))
    to_status: Mapped[str] = mapped_column(String(12))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
