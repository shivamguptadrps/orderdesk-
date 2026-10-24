import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAt, UUIDPk, utcnow

STOCK_REASONS = ("opening", "purchase", "dispatch", "adjust", "return")
MANUAL_REASONS = ("opening", "purchase", "adjust", "return")  # dispatch only comes from orders


class Stock(Base):
    """Current stock of one product, in pieces. Changed only together with a stock_ledger row."""

    __tablename__ = "stock"
    __table_args__ = (CheckConstraint("qty_pieces >= 0", name="not_negative"),)

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    qty_pieces: Mapped[int] = mapped_column(default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )


class StockLedger(UUIDPk, CreatedAt, Base):
    """Every stock movement. Current stock = sum of change_pieces for the product."""

    __tablename__ = "stock_ledger"
    __table_args__ = (
        CheckConstraint(
            "reason IN ('opening', 'purchase', 'dispatch', 'adjust', 'return')",
            name="reason",
        ),
        Index("ix_stock_ledger_tenant_id_product_id_created_at", "tenant_id", "product_id", "created_at"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    change_pieces: Mapped[int]
    balance_after: Mapped[int]
    reason: Mapped[str] = mapped_column(String(10))
    ref_order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(300))
