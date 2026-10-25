"""Distributor contact number: shops see it to call and confirm an order fast."""

from tests.conftest import CAT_OWNER_A


async def test_contact_phone_defaults_to_owner_and_can_be_changed(client, cat):
    t = f"/t/{cat['a'].id}"
    owner_phone = "+91" + CAT_OWNER_A

    mine = (await client.get("/shops/me/distributors", headers=cat["shop"])).json()
    assert [d["phone"] for d in mine] == [owner_phone]  # nothing set: the owner's phone
    seen_by_shop = (await client.get(t, headers=cat["shop"])).json()
    assert seen_by_shop["contact_phone"] == owner_phone and seen_by_shop["contact_phone_custom"] is None

    res = await client.put(f"{t}/settings", json={"contact_phone": "98111 22233"}, headers=cat["owner"])
    assert res.status_code == 200, res.text
    assert res.json()["contact_phone"] == res.json()["contact_phone_custom"] == "+919811122233"
    mine = (await client.get("/shops/me/distributors", headers=cat["shop"])).json()
    assert mine[0]["phone"] == "+919811122233"

    landline = await client.put(f"{t}/settings", json={"contact_phone": "0512-2345678"}, headers=cat["owner"])
    assert landline.json()["contact_phone"] == "05122345678"
    bad = await client.put(f"{t}/settings", json={"contact_phone": "12345"}, headers=cat["owner"])
    assert bad.status_code == 422

    cleared = await client.put(f"{t}/settings", json={"contact_phone": ""}, headers=cat["owner"])
    assert cleared.json()["contact_phone"] == owner_phone and cleared.json()["contact_phone_custom"] is None

    # other settings keep the number untouched
    await client.put(f"{t}/settings", json={"contact_phone": "9811122233"}, headers=cat["owner"])
    other = await client.put(f"{t}/settings", json={"brand_color": "#123456"}, headers=cat["owner"])
    assert other.json()["contact_phone"] == "+919811122233"


async def test_contact_phone_tenant_isolation(client, cat):
    # owner of B can't change A's number
    res = await client.put(f"/t/{cat['a'].id}/settings", json={"contact_phone": "9811122233"}, headers=cat["owner_b"])
    assert res.status_code == 404
