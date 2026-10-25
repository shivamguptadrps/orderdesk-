"""Push notifications through Expo's push service (works for both Android and iOS builds).

PUSH_MODE=expo sends, log only prints (tests, offline dev), off does nothing.
Sending never raises: a failed notification must not fail the order action that caused it.
"""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.notifications.models import PushToken

log = logging.getLogger("uvicorn.error")
EXPO_BATCH = 100  # Expo accepts up to 100 messages per request

# Tests look at what would have been sent.
sent_log: list[dict[str, Any]] = []


@dataclass
class Push:
    user_ids: set[uuid.UUID]
    title: str
    body: str
    data: dict[str, Any] = field(default_factory=dict)


async def send(db: AsyncSession, pushes: list[Push]) -> int:
    """Send each push to every phone of its users. Returns how many messages went out."""
    settings = get_settings()
    if settings.push_mode == "off":
        return 0
    user_ids = {u for p in pushes for u in p.user_ids}
    if not user_ids:
        return 0
    tokens: dict[uuid.UUID, list[str]] = {}
    for user_id, token in await db.execute(
        select(PushToken.user_id, PushToken.token).where(PushToken.user_id.in_(user_ids))
    ):
        tokens.setdefault(user_id, []).append(token)
    messages = [
        {"to": token, "title": p.title, "body": p.body, "data": p.data, "sound": "default", "priority": "high"}
        for p in pushes
        for user_id in p.user_ids
        for token in tokens.get(user_id, [])
    ]
    if not messages:
        return 0
    if settings.push_mode == "log":
        for m in messages:
            log.info("PUSH to %s: %s - %s", m["to"], m["title"], m["body"])
        sent_log.extend(messages)
        return len(messages)
    dead = await _send_expo(messages)
    if dead:
        await db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
        await db.commit()
    return len(messages)


async def _send_expo(messages: list[dict[str, Any]]) -> set[str]:
    """POST to Expo. Returns tokens Expo says are dead (app uninstalled), so we can forget them."""
    settings = get_settings()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.expo_access_token:
        headers["Authorization"] = f"Bearer {settings.expo_access_token}"
    dead: set[str] = set()
    async with httpx.AsyncClient(timeout=15) as client:
        for start in range(0, len(messages), EXPO_BATCH):
            batch = messages[start : start + EXPO_BATCH]
            try:
                res = await client.post(settings.expo_push_url, json=batch, headers=headers)
                res.raise_for_status()
                tickets = res.json().get("data", [])
            except Exception:
                log.exception("Expo push failed for %d messages", len(batch))
                continue
            for message, ticket in zip(batch, tickets, strict=False):
                if ticket.get("status") == "error":
                    reason = (ticket.get("details") or {}).get("error")
                    log.warning("Expo push error %s: %s", reason, ticket.get("message"))
                    if reason == "DeviceNotRegistered":
                        dead.add(message["to"])
    return dead
