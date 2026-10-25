"""Platform admin: adding and suspending distributors from the app (phone allow-list + admin key)."""

import pytest

from app.core.config import get_settings

ADMIN = "9898989898"
KEY = "k" * 32


@pytest.fixture
def admin_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "platform_admin_phones", f"+91{ADMIN}, 7000000000")
    monkeypatch.setattr(s, "platform_admin_key", KEY)


def key(headers):
    return headers | {"X-Admin-Key": KEY}


async def test_admin_adds_and_lists_distributors(client, login, admin_on):
    h = await login(ADMIN)
    assert (await client.get("/me", headers=h)).json()["is_platform_admin"] is True
    res = await client.post(
        "/admin/tenants",
        json={"name": "Gupta Traders", "owner_phone": "9123456780", "owner_name": "Ramesh", "join_code": "gupta7"},
        headers=key(h),
    )
    assert res.status_code == 201, res.text
    t = res.json()
    assert t["join_code"] == "GUPTA7" and t["owner_phone"] == "+919123456780" and t["status"] == "active"

    # the owner logs in and runs it, with starter categories ready
    owner = await login("9123456780")
    me = (await client.get("/me", headers=owner)).json()
    assert me["memberships"] == [{"tenant_id": t["id"], "tenant_name": "Gupta Traders", "role": "owner"}]
    assert me["is_platform_admin"] is False
    cats = (await client.get(f"/t/{t['id']}/categories", headers=owner)).json()
    assert any(c["name"] == "Sugar" for c in cats)

    # random code when none given; duplicate code refused
    other = (await client.post("/admin/tenants", json={"name": "Verma Agencies", "owner_phone": "9123456781"}, headers=key(h))).json()
    assert len(other["join_code"]) == 6
    dup = await client.post("/admin/tenants", json={"name": "Xyz Traders", "owner_phone": "9123456782", "join_code": "GUPTA7"}, headers=key(h))
    assert dup.status_code == 409
    listed = (await client.get("/admin/tenants", headers=key(h))).json()
    assert [x["name"] for x in listed] == ["Verma Agencies", "Gupta Traders"]
    assert listed[1]["shops"] == 0 and listed[1]["products"] == 0


async def test_suspend_blocks_the_distributor(client, login, admin_on):
    h = await login(ADMIN)
    t = (await client.post("/admin/tenants", json={"name": "Gupta Traders", "owner_phone": "9123456780"}, headers=key(h))).json()
    owner = await login("9123456780")
    assert (await client.get(f"/t/{t['id']}/dashboard", headers=owner)).status_code == 200
    res = await client.post(f"/admin/tenants/{t['id']}/suspend", headers=key(h))
    assert res.json()["status"] == "suspended"
    assert (await client.get(f"/t/{t['id']}/dashboard", headers=owner)).status_code == 404
    assert (await client.get("/me", headers=owner)).json()["memberships"] == []
    await client.post(f"/admin/tenants/{t['id']}/activate", headers=key(h))
    assert (await client.get(f"/t/{t['id']}/dashboard", headers=owner)).status_code == 200


async def test_admin_locks(client, login, admin_on, monkeypatch):
    stranger = await login("9555555555")
    admin = await login(ADMIN)
    body = {"name": "Evil Traders", "owner_phone": "9123456780"}
    # not on the list: 404 even with the right key
    assert (await client.post("/admin/tenants", json=body, headers=key(stranger))).status_code == 404
    assert (await client.get("/me", headers=stranger)).json()["is_platform_admin"] is False
    # on the list but wrong / missing key: 403
    assert (await client.post("/admin/tenants", json=body, headers=admin | {"X-Admin-Key": "wrong"})).status_code == 403
    assert (await client.get("/admin/tenants", headers=admin)).status_code == 403
    # not logged in
    assert (await client.get("/admin/tenants", headers={"X-Admin-Key": KEY})).status_code == 401
    # a short key switches the feature off entirely
    monkeypatch.setattr(get_settings(), "platform_admin_key", "short")
    assert (await client.get("/admin/tenants", headers=admin | {"X-Admin-Key": "short"})).status_code == 404


async def test_admin_off_by_default(client, login):
    h = await login(ADMIN)
    assert (await client.get("/me", headers=h)).json()["is_platform_admin"] is False
    assert (await client.get("/admin/tenants", headers=h | {"X-Admin-Key": ""})).status_code == 404
