import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.phone import normalize_phone


class ShopBase(BaseModel):
    shop_name: str = Field(min_length=1, max_length=150)
    owner_name: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=500)
    city: str = Field(min_length=1, max_length=80)
    pincode: str = Field(pattern=r"^[1-9]\d{5}$")
    lat: Decimal | None = Field(default=None, ge=-90, le=90)
    lng: Decimal | None = Field(default=None, ge=-180, le=180)
    photo_url: str | None = Field(default=None, max_length=500)


class ShopCreateIn(ShopBase):
    pass


class ShopUpdateIn(BaseModel):
    """Send only the fields you want to change."""

    shop_name: str | None = Field(default=None, min_length=1, max_length=150)
    owner_name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, min_length=1, max_length=500)
    city: str | None = Field(default=None, min_length=1, max_length=80)
    pincode: str | None = Field(default=None, pattern=r"^[1-9]\d{5}$")
    lat: Decimal | None = Field(default=None, ge=-90, le=90)
    lng: Decimal | None = Field(default=None, ge=-180, le=180)
    photo_url: str | None = Field(default=None, max_length=500)


class ShopOut(ShopBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


class JoinDistributorIn(BaseModel):
    join_code: str = Field(min_length=4, max_length=12, examples=["GUPTA7"])


class MyDistributorOut(BaseModel):
    """A distributor this shop has joined, as the shop sees it."""

    tenant_id: uuid.UUID
    name: str
    logo_url: str | None
    brand_color: str | None
    status: str  # pending, active, blocked
    joined_at: datetime


class TenantShopOut(BaseModel):
    """A shop linked to a distributor, as the distributor sees it."""

    shop_id: uuid.UUID
    shop_name: str
    owner_name: str
    owner_phone: str
    address: str
    city: str
    pincode: str
    status: str
    agent_user_id: uuid.UUID | None
    agent_name: str | None = None
    added_by_agent: bool = False
    last_order_at: datetime | None = None
    joined_at: datetime


class AssignAgentIn(BaseModel):
    agent_user_id: uuid.UUID | None = None


class OnboardShopIn(ShopBase):
    """An agent signs up a shop: the shop owner's phone plus the shop profile."""

    owner_phone: str = Field(examples=["9123456789"])

    @field_validator("owner_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)
