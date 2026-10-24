import logging

import httpx
from fastapi import HTTPException

from app.core.config import get_settings

log = logging.getLogger("uvicorn.error")


async def send_otp(phone: str, code: str) -> None:
    settings = get_settings()
    if settings.otp_mode == "log":
        log.info("DEV OTP for %s: %s", phone, code)
        return
    if settings.otp_mode == "whatsapp":
        await _send_whatsapp(phone, code)
        return
    raise RuntimeError(f"Unknown OTP_MODE: {settings.otp_mode}")


async def _send_whatsapp(phone: str, code: str) -> None:
    """Sends an approved WhatsApp 'authentication' template with a copy-code button."""
    s = get_settings()
    url = f"https://graph.facebook.com/{s.whatsapp_api_version}/{s.whatsapp_phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": phone.lstrip("+"),
        "type": "template",
        "template": {
            "name": s.whatsapp_otp_template,
            "language": {"code": s.whatsapp_template_language},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": code}],
                },
            ],
        },
    }
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(url, json=payload, headers={"Authorization": f"Bearer {s.whatsapp_token}"})
    if res.status_code >= 400:
        log.error("WhatsApp OTP send failed (%s): %s", res.status_code, res.text[:500])
        raise HTTPException(502, "Could not send OTP on WhatsApp. Please try again.")
