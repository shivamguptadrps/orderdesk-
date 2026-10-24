import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamps, UUIDPk

TENANT_STATUSES = ("active", "suspended")
MEMBER_ROLES = ("owner", "staff", "agent")


class Tenant(UUIDPk, Timestamps, Base):
    """A distributor. Every business table (except shops/users) carries its id."""

    __tablename__ = "tenants"
    __table_args__ = (CheckConstraint("status IN ('active', 'suspended')", name="status"),)

    name: Mapped[str] = mapped_column(String(120))
    join_code: Mapped[str] = mapped_column(String(12), unique=True)
    logo_url: Mapped[str | None] = mapped_column(String(500))
    brand_color: Mapped[str | None] = mapped_column(String(7))
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")


class TenantMember(UUIDPk, Timestamps, Base):
    __tablename__ = "tenant_members"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id"),
        CheckConstraint("role IN ('owner', 'staff', 'agent')", name="role"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
