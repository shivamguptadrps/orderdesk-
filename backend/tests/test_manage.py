"""M6 backend: dashboard, low stock, queue order, join code QR / new code, logo, Excel import page."""

from io import BytesIO

from PIL import Image

from tests.conftest import sugar


def _png() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (400, 300), (30, 100, 200)).save(buf, "PNG")
    return buf.getvalue()


async def _order(client, o, qty=2):
    await client.post(f"{o['t']}/cart/items", json={"unit_id": o["bag"], "qty": qty}, headers=o["shop"])
    res = await client.post(f"{o['t']}/orders", json={}, headers=o["shop"])
    assert res.status_code == 201, res.text
    return res.json()


async def test_dashboard_counts(client, o, make_shop):
    t, owner = o["t"], o["owner"]
    empty = (await client.get(f"{t}/dashboard", headers=owner)).json()
    assert empty["pending_orders"] == 0 and empty["today_orders"] == 0

    first = await _order(client, o, 2)  # 2 bags = ₹2580
    await _order(client, o, 1)
    await client.post(f"{t}/orders/{first['id']}/approve", json={}, headers=owner)
    headers, _ = await make_shop("9777777777")
    await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    # chips: 1000 in stock with 1-piece default pack -> fine; sugar: 300 pieces, 30-piece bag -> fine
    await client.post(f"{t}/stock/adjust", json={"product_id": o["chips"]["id"], "set_to": 0}, headers=owner)

    d = (await client.get(f"{t}/dashboard", headers=owner)).json()
    assert d == {
        "pending_orders": 1,
        "to_dispatch": 1,
        "shops_waiting": 1,
        "low_stock": 1,
        "out_of_stock": 1,
        "today_orders": 2,
        "today_value": 3870.0,
    }


async def test_low_stock_and_sort_by_stock(client, o):
    t, owner = o["t"], o["owner"]
    # sugar's default pack is a 30-piece bag: below 60 pieces counts as low
    await client.post(f"{t}/stock/adjust", json={"product_id": o["sugar"]["id"], "set_to": 59}, headers=owner)
    low = (await client.get(f"{t}/products", params={"low_stock": "true"}, headers=owner)).json()
    assert [p["name"] for p in low["items"]] == ["Madhur Sugar 1 kg"]
    await client.post(f"{t}/stock/adjust", json={"product_id": o["sugar"]["id"], "set_to": 60}, headers=owner)
    assert (await client.get(f"{t}/products", params={"low_stock": "true"}, headers=owner)).json()["total"] == 0

    by_stock = (await client.get(f"{t}/products", params={"sort": "stock"}, headers=owner)).json()
    assert [p["stock_pieces"] for p in by_stock["items"]] == [60, 1000]
    assert (await client.get(f"{t}/products", params={"sort": "price"}, headers=owner)).status_code == 422


async def test_queue_oldest_first(client, o):
    first = await _order(client, o)
    second = await _order(client, o)
    newest = (await client.get(f"{o['t']}/orders", headers=o["owner"])).json()["items"]
    oldest = (await client.get(f"{o['t']}/orders", params={"oldest_first": "true"}, headers=o["owner"])).json()["items"]
    assert [x["id"] for x in newest] == [second["id"], first["id"]]
    assert [x["id"] for x in oldest] == [first["id"], second["id"]]


async def test_join_qr_and_new_code(client, o, make_shop, add_member):
    t, owner = o["t"], o["owner"]
    res = await client.get(f"{t}/join-qr.png", headers=owner)
    assert res.status_code == 200 and res.headers["content-type"] == "image/png"
    assert Image.open(BytesIO(res.content)).size[0] > 100

    await add_member(o["a"], "9333333333", "staff")
    staff = await _login(client, "9333333333")
    assert (await client.get(f"{t}/join-qr.png", headers=staff)).status_code == 200
    assert (await client.post(f"{t}/join-code/regenerate", headers=staff)).status_code == 403

    res = await client.post(f"{t}/join-code/regenerate", headers=owner)
    new_code = res.json()["join_code"]
    assert new_code != "GUPTA7" and len(new_code) == 6
    headers, _ = await make_shop("9777777777")
    assert (await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)).status_code == 404
    assert (await client.post("/shops/me/distributors", json={"join_code": new_code}, headers=headers)).status_code == 201
    # the shop that joined with the old code is still a customer
    assert (await client.get(f"{t}/catalog/products", headers=o["shop"])).status_code == 200


async def _login(client, phone):
    from tests.conftest import TEST_OTP

    await client.post("/auth/otp/request", json={"phone": phone})
    res = await client.post("/auth/otp/verify", json={"phone": phone, "code": TEST_OTP})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_logo_upload(client, o):
    t, owner = o["t"], o["owner"]
    res = await client.post(f"{t}/logo", files={"file": ("logo.png", _png(), "image/png")}, headers=owner)
    assert res.status_code == 200
    first = res.json()["logo_url"]
    assert "/logo/" in first and (await client.get(first)).status_code == 200

    second = (await client.post(f"{t}/logo", files={"file": ("logo.png", _png(), "image/png")}, headers=owner)).json()["logo_url"]
    assert second != first
    assert (await client.get(first)).status_code == 404  # old logo removed
    mine = (await client.get("/shops/me/distributors", headers=o["shop"])).json()
    assert mine[0]["logo_url"] == second

    assert (await client.post(f"{t}/logo", files={"file": ("x.png", b"nope", "image/png")}, headers=owner)).status_code == 422
    assert (await client.post(f"{t}/logo", files={"file": ("l.png", _png(), "image/png")}, headers=o["shop"])).status_code == 403


async def test_import_page_is_served(client):
    res = await client.get("/import")
    assert res.status_code == 200 and "text/html" in res.headers["content-type"]
    assert "product-import" in res.text


async def test_manage_endpoints_are_tenant_scoped(client, o):
    a, b, owner_b = o["a"], o["b"], o["owner_b"]
    for path in ["dashboard", "join-qr.png"]:
        assert (await client.get(f"/t/{a.id}/{path}", headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{a.id}/join-code/regenerate", headers=owner_b)).status_code == 404
    res = await client.post(f"/t/{a.id}/logo", files={"file": ("l.png", _png(), "image/png")}, headers=owner_b)
    assert res.status_code == 404
    # B's dashboard does not count A's orders
    await _order(client, o)
    assert (await client.get(f"/t/{b.id}/dashboard", headers=owner_b)).json()["pending_orders"] == 0
    # B's low-stock list never shows A's products
    await client.post(f"/t/{b.id}/products", json=sugar((await _first_cat(client, b, owner_b)), opening_stock_pieces=0), headers=owner_b)
    low_b = (await client.get(f"/t/{b.id}/products", params={"low_stock": "true"}, headers=owner_b)).json()
    assert all(p["sku"] == "MAD-SUG-1" for p in low_b["items"]) and low_b["total"] == 1


async def _first_cat(client, tenant, headers):
    cats = (await client.get(f"/t/{tenant.id}/categories", headers=headers)).json()
    return next(c["id"] for c in cats if c["name"] == "Sugar")
