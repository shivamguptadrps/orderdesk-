import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint, false
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
    # Next order number for this distributor. Taken with a row lock, so numbers have no gaps or repeats.
    next_order_no: Mapped[int] = mapped_column(default=1, server_default="1")
    # Shops added by an agent start active (True) or wait for approval (False)
    agent_shops_auto_approve: Mapped[bool] = mapped_column(default=False, server_default=false())


class TenantMember(UUIDPk, Timestamps, Base):
    __tablename__ = "tenant_members"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id"),
        CheckConstraint("role IN ('owner', 'staff', 'agent')", name="role"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
