import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamps, UUIDPk


class PushToken(UUIDPk, Timestamps, Base):
    """An Expo push token for one phone. A phone belongs to the last user who logged in on it."""

    __tablename__ = "push_tokens"
    __table_args__ = (CheckConstraint("platform IN ('ios', 'android', 'web')", name="platform"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(200), unique=True)
    platform: Mapped[str] = mapped_column(String(10))
