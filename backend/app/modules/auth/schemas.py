import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.phone import normalize_phone
from app.modules.shops.schemas import ShopOut


class PhoneIn(BaseModel):
    phone: str = Field(examples=["9876543210"])

    @field_validator("phone")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return normalize_phone(v)


class OtpRequestIn(PhoneIn):
    pass


class OtpRequestOut(BaseModel):
    sent: bool
    expires_in_seconds: int
    dev_code: str | None = None  # only in local development (APP_ENV=dev, OTP_MODE=log)


class OtpVerifyIn(PhoneIn):
    code: str = Field(pattern=r"^\d{6}$", examples=["123456"])


class RefreshIn(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    phone: str
    name: str | None


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
    is_new_user: bool = False


class MembershipOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    role: str


class MeOut(UserOut):
    shop: ShopOut | None
    memberships: list[MembershipOut]


class MeUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
