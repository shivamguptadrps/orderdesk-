import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAt, Timestamps, UUIDPk


class User(UUIDPk, Timestamps, Base):
    """Platform-level person, identified by phone. Roles come from tenant_members and shops."""

    __tablename__ = "users"

    phone: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str | None] = mapped_column(String(120))
    # Set when the person deleted their account; the phone is replaced so the number can sign up again.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OtpRequest(UUIDPk, CreatedAt, Base):
    __tablename__ = "otp_requests"
    __table_args__ = (Index("ix_otp_requests_phone_created_at", "phone", "created_at"),)

    phone: Mapped[str] = mapped_column(String(16))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(UUIDPk, CreatedAt, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
