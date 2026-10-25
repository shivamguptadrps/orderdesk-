"""The app registers its push token after login: /me/push-tokens."""

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db, utcnow
from app.core.deps import get_current_user
from app.modules.auth.models import User
from app.modules.notifications.models import PushToken

router = APIRouter(tags=["notifications"])


class PushTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200, pattern=r"^(Exponent|Expo)PushToken\[.+\]$",
                       examples=["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"])
    platform: Literal["ios", "android", "web"]


class TokenIn(BaseModel):
    token: str = Field(max_length=200)


@router.post("/me/push-tokens", status_code=204)
async def register_push_token(body: PushTokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Save this phone's push token. If someone else used this phone before, it now belongs to you."""
    row = await db.scalar(select(PushToken).where(PushToken.token == body.token).with_for_update())
    if row is None:
        db.add(PushToken(user_id=user.id, token=body.token, platform=body.platform))
    else:
        row.user_id, row.platform, row.updated_at = user.id, body.platform, utcnow()
    await db.commit()


@router.post("/me/push-tokens/remove", status_code=204)
async def remove_push_token(body: TokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Stop notifications to this phone (e.g. notifications turned off)."""
    await db.execute(delete(PushToken).where(PushToken.token == body.token, PushToken.user_id == user.id))
    await db.commit()
