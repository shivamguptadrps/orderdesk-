import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamps, UUIDPk

ATTRIBUTE_TYPES = ("text", "number", "select", "boolean")
PRODUCT_STATUSES = ("active", "hidden")
MAX_CATEGORY_DEPTH = 3

# Lower-cased name + brand + aliases, kept up to date by Postgres. Trigram-indexed for fuzzy search.
SEARCH_TEXT_SQL = "lower(name || ' ' || coalesce(brand, '') || ' ' || coalesce(search_aliases, ''))"


class Category(UUIDPk, Timestamps, Base):
    """Category tree per distributor (category > sub-category > optional third level)."""

    __tablename__ = "categories"
    __table_args__ = (Index("ix_categories_tenant_id_parent_id", "tenant_id", "parent_id"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(80))
    image_url: Mapped[str | None] = mapped_column(String(500))
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")


class AttributeDefinition(UUIDPk, Timestamps, Base):
    """A product feature a category asks for, e.g. Sugar: weight_kg (number, kg). Sub-categories inherit."""

    __tablename__ = "attribute_definitions"
    __table_args__ = (
        UniqueConstraint("category_id", "key"),
        CheckConstraint("type IN ('text', 'number', 'select', 'boolean')", name="type"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(10))
    unit: Mapped[str | None] = mapped_column(String(20))
    options: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    required: Mapped[bool] = mapped_column(default=False, server_default=false())
    is_filter: Mapped[bool] = mapped_column(default=False, server_default=false())
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")


class Product(UUIDPk, Timestamps, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku"),
        CheckConstraint("status IN ('active', 'hidden')", name="status"),
        Index("ix_products_tenant_id_category_id", "tenant_id", "category_id"),
        Index(
            "ix_products_search_text_trgm",
            "search_text",
            postgresql_using="gin",
            postgresql_ops={"search_text": "gin_trgm_ops"},
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    search_aliases: Mapped[str | None] = mapped_column(Text)
    sku: Mapped[str | None] = mapped_column(String(64))
    mrp: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    images: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    status: Mapped[str] = mapped_column(String(10), default="active", server_default="active")
    search_text: Mapped[str] = mapped_column(Text, Computed(SEARCH_TEXT_SQL, persisted=True))

    units: Mapped[list["ProductUnit"]] = relationship(
        order_by="(ProductUnit.sort_order, ProductUnit.pieces_per_unit)",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ProductUnit(UUIDPk, Timestamps, Base):
    """A pack size: 'N pieces at price P'. Stock is always counted in pieces."""

    __tablename__ = "product_units"
    __table_args__ = (
        UniqueConstraint("product_id", "name"),
        CheckConstraint("pieces_per_unit > 0", name="pieces_positive"),
        CheckConstraint("price >= 0", name="price_not_negative"),
        CheckConstraint("min_qty >= 1 AND step_qty >= 1", name="qty_rules"),
        CheckConstraint("max_qty IS NULL OR max_qty >= min_qty", name="max_qty"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    pieces_per_unit: Mapped[int]
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    min_qty: Mapped[int] = mapped_column(default=1, server_default="1")
    step_qty: Mapped[int] = mapped_column(default=1, server_default="1")
    max_qty: Mapped[int | None]
    is_default: Mapped[bool] = mapped_column(default=False, server_default=false())
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
