from tests.conftest import SHOP


async def test_create_get_update_shop(client, login):
    headers = await login("9876543210")
    assert (await client.get("/shops/me", headers=headers)).status_code == 404

    res = await client.post("/shops", json=SHOP, headers=headers)
    assert res.status_code == 201
    assert res.json()["shop_name"] == "Sharma Kirana Store"

    assert (await client.post("/shops", json=SHOP, headers=headers)).status_code == 409

    res = await client.put("/shops/me", json={"city": "Lucknow", "pincode": "226001"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["city"] == "Lucknow"
    assert res.json()["shop_name"] == "Sharma Kirana Store"

    me = (await client.get("/me", headers=headers)).json()
    assert me["shop"]["city"] == "Lucknow"


async def test_shop_validation(client, login):
    headers = await login("9876543210")
    res = await client.post("/shops", json={**SHOP, "pincode": "12"}, headers=headers)
    assert res.status_code == 422


async def test_shop_requires_login(client):
    assert (await client.post("/shops", json=SHOP)).status_code == 401


async def test_join_distributor_by_code(client, make_shop, make_tenant):
    await make_tenant("Gupta Traders", owner_phone="9000000001", join_code="GUPTA7")
    headers, _ = await make_shop("9876543210")

    res = await client.post("/shops/me/distributors", json={"join_code": " gupta7 "}, headers=headers)
    assert res.status_code == 201
    assert res.json()["name"] == "Gupta Traders"
    assert res.json()["status"] == "pending"

    # joining again returns the same link
    res = await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "pending"

    listed = (await client.get("/shops/me/distributors", headers=headers)).json()
    assert [d["name"] for d in listed] == ["Gupta Traders"]


async def test_join_unknown_code(client, make_shop):
    headers, _ = await make_shop("9876543210")
    res = await client.post("/shops/me/distributors", json={"join_code": "NOPE99"}, headers=headers)
    assert res.status_code == 404


async def test_join_needs_shop_profile(client, login, make_tenant):
    await make_tenant("Gupta Traders", owner_phone="9000000001", join_code="GUPTA7")
    headers = await login("9876543210")
    res = await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    assert res.status_code == 404
    assert "shop profile" in res.json()["detail"]
