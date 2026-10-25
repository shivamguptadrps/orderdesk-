"""Play Store rules: people can delete their account; the store reviewer has a fixed login."""

from app.core.config import get_settings
from app.modules.auth import router as auth_router
from tests.test_agents import ag  # noqa: F401  (fixture)
from tests.test_orders import placed_order
from tests.conftest import TEST_OTP


async def test_shop_deletes_account(client, o, login):
    order = await placed_order(client, o)
    shop_id = (await client.get("/shops/me", headers=o["shop"])).json()["id"]
    assert (await client.delete("/me", headers=o["shop"])).status_code == 204

    # old login stops working everywhere
    assert (await client.get("/me", headers=o["shop"])).status_code == 401
    # the distributor keeps the order (business record) but the shop is gone from their list
    kept = (await client.get(f"{o['t']}/orders/{order['id']}", headers=o["owner"])).json()
    assert kept["shop_name"] == "Sharma Kirana Store"
    shops = (await client.get(f"{o['t']}/shops", headers=o["owner"])).json()
    assert all(s["shop_id"] != shop_id for s in (shops["items"] if isinstance(shops, dict) else shops))
    # the same number can start fresh
    res = await client.post("/auth/otp/request", json={"phone": "9876543210"})
    assert res.status_code == 202
    fresh = (await client.post("/auth/otp/verify", json={"phone": "9876543210", "code": TEST_OTP})).json()
    assert fresh["is_new_user"] is True
    me = (await client.get("/me", headers={"Authorization": f"Bearer {fresh['access_token']}"})).json()
    assert me["shop"] is None and me["memberships"] == []


async def test_refresh_stops_after_deletion(client, login):
    await client.post("/auth/otp/request", json={"phone": "9876500000"})
    t = (await client.post("/auth/otp/verify", json={"phone": "9876500000", "code": TEST_OTP})).json()
    headers = {"Authorization": f"Bearer {t['access_token']}"}
    assert (await client.delete("/me", headers=headers)).status_code == 204
    assert (await client.post("/auth/refresh", json={"refresh_token": t["refresh_token"]})).status_code == 401


async def test_team_members_and_owners(client, ag, add_member):  # noqa: F811
    # an agent leaving frees their shops
    assert (await client.delete("/me", headers=ag["agent"])).status_code == 204
    shops = (await client.get(f"{ag['t']}/shops", headers=ag["owner"])).json()
    rows = shops["items"] if isinstance(shops, dict) else shops
    assert all(s.get("agent_user_id") != ag["agent_id"] for s in rows)
    members = (await client.get(f"{ag['t']}/members", headers=ag["owner"])).json()
    assert ag["agent_id"] not in {m["user_id"] for m in members}

    # the only owner can't delete themselves; with a second owner they can
    res = await client.delete("/me", headers=ag["owner"])
    assert res.status_code == 409 and "only owner" in res.json()["detail"]
    await add_member(ag["a"], "9000000009", "owner")
    assert (await client.delete("/me", headers=ag["owner"])).status_code == 204


async def test_review_login(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "review_phone", "+919999900001")
    monkeypatch.setattr(s, "review_code", "424242")
    sent = []

    async def fake_send(phone, code):
        sent.append(phone)

    monkeypatch.setattr(auth_router, "send_otp", fake_send)
    for _ in range(5):  # no rate limit, no message for the reviewer's number
        assert (await client.post("/auth/otp/request", json={"phone": "9999900001"})).status_code == 202
    res = await client.post("/auth/otp/verify", json={"phone": "9999900001", "code": "424242"})
    assert res.status_code == 200, res.text
    assert sent == []
    # everyone else still gets a real message
    await client.post("/auth/otp/request", json={"phone": "9876543210"})
    assert sent == ["+919876543210"]


async def test_privacy_and_delete_pages(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "support_email", "help@example.com")
    for path in ("/privacy", "/delete-account"):
        res = await client.get(path)
        assert res.status_code == 200 and "mailto:help@example.com" in res.text and "{{SUPPORT}}" not in res.text
