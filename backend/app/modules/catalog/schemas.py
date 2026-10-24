import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

# Money is stored as exact decimals, sent to the app as plain numbers (e.g. 45.5).
Money = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]
PriceIn = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]

AttributeType = Literal["text", "number", "select", "boolean"]


# ---------- attributes (product features) ----------


class AttributeIn(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$", examples=["weight_kg"])
    label: str = Field(min_length=1, max_length=80, examples=["Pack weight"])
    type: AttributeType
    unit: str | None = Field(default=None, max_length=20, examples=["kg"])
    options: list[Annotated[str, Field(min_length=1, max_length=60)]] = Field(default_factory=list)
    required: bool = False
    is_filter: bool = False
    sort_order: int = 0

    @model_validator(mode="after")
    def _options_only_for_select(self):
        if self.type == "select":
            if not self.options:
                raise ValueError("A 'select' feature needs at least one option")
            if len({o.lower() for o in self.options}) != len(self.options):
                raise ValueError("Options must be unique")
        else:
            self.options = []
        return self


class AttributeUpdate(BaseModel):
    """Key and type cannot change; delete and re-create the feature instead."""

    label: str | None = Field(default=None, min_length=1, max_length=80)
    unit: str | None = Field(default=None, max_length=20)
    options: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = None
    required: bool | None = None
    is_filter: bool | None = None
    sort_order: int | None = None


class AttributeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    key: str
    label: str
    type: str
    unit: str | None
    options: list[str]
    required: bool
    is_filter: bool
    sort_order: int


class EffectiveAttributeOut(AttributeOut):
    inherited: bool  # defined on a parent category


# ---------- categories ----------


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: uuid.UUID | None = None
    image_url: str | None = Field(default=None, max_length=500)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    image_url: str | None = Field(default=None, max_length=500)
    sort_order: int | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    image_url: str | None
    sort_order: int
    attributes: list[AttributeOut] = []  # own features only


class CategoryNode(BaseModel):
    id: uuid.UUID
    name: str
    image_url: str | None
    children: list["CategoryNode"]


# ---------- pack sizes ----------


class UnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=40, examples=["Carton"])
    pieces_per_unit: int = Field(ge=1, examples=[24])
    price: PriceIn = Field(examples=[1080])
    min_qty: int = Field(default=1, ge=1)
    step_qty: int = Field(default=1, ge=1)
    max_qty: int | None = Field(default=None, ge=1)
    is_default: bool = False
    sort_order: int = 0

    @model_validator(mode="after")
    def _max_after_min(self):
        if self.max_qty is not None and self.max_qty < self.min_qty:
            raise ValueError("max_qty cannot be less than min_qty")
        return self


class UnitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    pieces_per_unit: int | None = Field(default=None, ge=1)
    price: PriceIn | None = None
    min_qty: int | None = Field(default=None, ge=1)
    step_qty: int | None = Field(default=None, ge=1)
    max_qty: int | None = Field(default=None, ge=1)
    is_default: bool | None = None
    sort_order: int | None = None


class UnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    pieces_per_unit: int
    price: Money
    price_per_piece: Money
    min_qty: int
    step_qty: int
    max_qty: int | None
    is_default: bool
    sort_order: int


class CatalogUnitOut(UnitOut):
    in_stock: bool  # enough stock for at least the minimum order of this unit


# ---------- products (distributor side) ----------


class ProductIn(BaseModel):
    category_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200, examples=["Madhur Sugar 1 kg"])
    brand: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    search_aliases: str | None = Field(
        default=None, max_length=1000, examples=["cheeni, chini, शक्कर, sugar"],
        description="Other words shops may type: Hindi, Hinglish, local names",
    )
    sku: str | None = Field(default=None, max_length=64)
    mrp: PriceIn | None = None
    attributes: dict[str, Any] = Field(default_factory=dict, examples=[{"weight_kg": 1, "grain": "Medium"}])
    images: list[Annotated[str, Field(max_length=500)]] = Field(default_factory=list, max_length=10)
    status: Literal["active", "hidden"] = "active"
    units: list[UnitIn] = Field(min_length=1)
    opening_stock_pieces: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _unit_names_unique(self):
        names = [u.name.strip().lower() for u in self.units]
        if len(set(names)) != len(names):
            raise ValueError("Pack size names must be unique")
        return self


class ProductUpdate(BaseModel):
    """Send only the fields you want to change. Pack sizes and stock have their own endpoints."""

    category_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    search_aliases: str | None = Field(default=None, max_length=1000)
    sku: str | None = Field(default=None, max_length=64)
    mrp: PriceIn | None = None
    attributes: dict[str, Any] | None = None
    images: list[Annotated[str, Field(max_length=500)]] | None = Field(default=None, max_length=10)
    status: Literal["active", "hidden"] | None = None


class ProductOut(BaseModel):
    id: uuid.UUID
    category_id: uuid.UUID
    name: str
    brand: str | None
    description: str | None
    search_aliases: str | None
    sku: str | None
    mrp: Money | None
    attributes: dict[str, Any]
    images: list[str]
    thumbnails: list[str]
    status: str
    units: list[UnitOut]
    stock_pieces: int
    created_at: datetime
    updated_at: datetime


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int


# ---------- shop catalog ----------


class FeatureOut(BaseModel):
    key: str
    label: str
    value: Any
    unit: str | None


class CatalogCard(BaseModel):
    id: uuid.UUID
    name: str
    brand: str | None
    category_id: uuid.UUID
    image: str | None  # small 200px thumbnail
    mrp: Money | None
    default_unit: CatalogUnitOut
    in_stock: bool


class CatalogPage(BaseModel):
    items: list[CatalogCard]
    total: int


class CatalogDetail(BaseModel):
    id: uuid.UUID
    name: str
    brand: str | None
    description: str | None
    category_id: uuid.UUID
    category_path: list[str]
    mrp: Money | None
    images: list[str]  # 800px
    thumbnails: list[str]  # 200px, same order
    features: list[FeatureOut]
    units: list[CatalogUnitOut]
    in_stock: bool


class FilterOut(BaseModel):
    key: str
    label: str
    type: str
    unit: str | None
    values: list[Any]  # options to show in the filter


class CategoryFiltersOut(BaseModel):
    brands: list[str]
    filters: list[FilterOut]
