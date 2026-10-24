from datetime import timedelta

from sqlalchemy import update

from app.core.db import SessionLocal, utcnow
from app.modules.auth.models import OtpRequest
from tests.conftest import TEST_OTP


async def _request(client, phone="9876543210"):
    return await client.post("/auth/otp/request", json={"phone": phone})


async def _verify(client, phone="9876543210", code=TEST_OTP):
    return await client.post("/auth/otp/verify", json={"phone": phone, "code": code})


async def test_login_creates_user_then_reuses_it(client):
    assert (await _request(client)).status_code == 202
    first = await _verify(client)
    assert first.status_code == 200
    body = first.json()
    assert body["is_new_user"] is True
    assert body["user"]["phone"] == "+919876543210"
    assert body["access_token"] and body["refresh_token"]

    await _request(client)
    second = (await _verify(client)).json()
    assert second["is_new_user"] is False
    assert second["user"]["id"] == body["user"]["id"]


async def test_phone_formats_are_normalized(client):
    await _request(client, "+91 98765-43210")
    res = await _verify(client, "09876543210")
    assert res.status_code == 200
    assert res.json()["user"]["phone"] == "+919876543210"


async def test_invalid_phone_rejected(client):
    for bad in ["12345", "5876543210", "98765432101", "abc"]:
        assert (await _request(client, bad)).status_code == 422, bad


async def test_wrong_code_then_too_many_attempts(client):
    await _request(client)
    for _ in range(5):
        assert (await _verify(client, code="000000")).status_code == 400
    # even the right code is refused once attempts are used up
    assert (await _verify(client)).status_code == 429


async def test_code_works_only_once(client):
    await _request(client)
    assert (await _verify(client)).status_code == 200
    assert (await _verify(client)).status_code == 400


async def test_expired_code_rejected(client):
    await _request(client)
    async with SessionLocal() as db:
        await db.execute(update(OtpRequest).values(expires_at=utcnow() - timedelta(seconds=1)))
        await db.commit()
    assert (await _verify(client)).status_code == 400


async def test_rate_limit_three_requests_per_window(client):
    for _ in range(3):
        assert (await _request(client)).status_code == 202
    assert (await _request(client)).status_code == 429
    # another number is not affected
    assert (await _request(client, "9123456789")).status_code == 202


async def test_refresh_rotates_token(client):
    await _request(client)
    tokens = (await _verify(client)).json()

    res = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 200
    new_tokens = res.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]

    # old refresh token no longer works
    res = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 401


async def test_logout_revokes_refresh_token(client):
    await _request(client)
    tokens = (await _verify(client)).json()
    assert (await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})).status_code == 204
    assert (await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).status_code == 401


async def test_me_requires_login(client):
    assert (await client.get("/me")).status_code == 401
    assert (await client.get("/me", headers={"Authorization": "Bearer garbage"})).status_code == 401


async def test_me_and_update_name(client, login):
    headers = await login("9876543210")
    me = (await client.get("/me", headers=headers)).json()
    assert me["phone"] == "+919876543210"
    assert me["shop"] is None
    assert me["memberships"] == []

    res = await client.put("/me", json={"name": "Raj"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "Raj"


async def test_me_lists_memberships(client, login, make_tenant):
    tenant = await make_tenant("Gupta Traders", owner_phone="9000000001")
    headers = await login("9000000001")
    me = (await client.get("/me", headers=headers)).json()
    assert me["memberships"] == [{"tenant_id": str(tenant.id), "tenant_name": "Gupta Traders", "role": "owner"}]
