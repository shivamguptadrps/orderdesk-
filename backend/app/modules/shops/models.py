import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamps, UUIDPk

LINK_STATUSES = ("pending", "active", "blocked")


class Shop(UUIDPk, Timestamps, Base):
    """Platform-level shop (no tenant_id). Linked to distributors via distributor_shops."""

    __tablename__ = "shops"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    shop_name: Mapped[str] = mapped_column(String(150))
    owner_name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(Text)
    city: Mapped[str] = mapped_column(String(80))
    pincode: Mapped[str] = mapped_column(String(6))
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    photo_url: Mapped[str | None] = mapped_column(String(500))


class DistributorShop(UUIDPk, Timestamps, Base):
    __tablename__ = "distributor_shops"
    __table_args__ = (
        UniqueConstraint("tenant_id", "shop_id"),
        CheckConstraint("status IN ('pending', 'active', 'blocked')", name="status"),
        Index("ix_distributor_shops_tenant_id_status", "tenant_id", "status"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    shop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    agent_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    joined_via_code: Mapped[str | None] = mapped_column(String(12))
