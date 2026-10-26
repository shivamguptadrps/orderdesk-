"""M2: categories, features, products, pack sizes, search, filters, and tenant isolation."""

import json

import pytest

from tests.conftest import sugar


async def _create(client, c, body):
    res = await client.post(f"/t/{c['a'].id}/products", json=body, headers=c["owner"])
    assert res.status_code == 201, res.text
    return res.json()


# ---------- template and features ----------


async def test_fmcg_template_loaded(client, cat):
    ids = cat["ids"]
    for name in ["Ration", "Sugar", "Rice", "Atta & Flour", "Oil", "Snacks", "Chips", "Biscuits", "Drinks"]:
        assert name in ids

    a, owner = cat["a"], cat["owner"]
    sugar_attrs = (await client.get(f"/t/{a.id}/categories/{ids['Sugar']}/attributes", headers=owner)).json()
    assert [(x["key"], x["inherited"]) for x in sugar_attrs] == [("weight_kg", False), ("grain", False)]

    chips_attrs = (await client.get(f"/t/{a.id}/categories/{ids['Chips']}/attributes", headers=owner)).json()
    assert {x["key"]: x["inherited"] for x in chips_attrs} == {"weight_g": True, "flavour": True}


async def test_create_product_with_units_and_opening_stock(client, cat):
    p = await _create(client, cat, sugar(cat["ids"]["Sugar"]))
    assert p["attributes"] == {"weight_kg": 1, "grain": "Medium"}  # option normalised
    assert p["stock_pieces"] == 300
    assert p["mrp"] == 50.0
    bag = next(u for u in p["units"] if u["name"] == "Bag")
    assert bag["is_default"] is True and bag["price_per_piece"] == 43.0
    assert sum(u["is_default"] for u in p["units"]) == 1

    ledger = (await client.get(f"/t/{cat['a'].id}/stock/ledger", headers=cat["owner"])).json()
    assert [(e["reason"], e["change_pieces"], e["balance_after"]) for e in ledger] == [("opening", 300, 300)]


async def test_attribute_validation(client, cat):
    a, owner, sid = cat["a"], cat["owner"], cat["ids"]["Sugar"]
    url = f"/t/{a.id}/products"

    res = await client.post(url, json=sugar(sid, attributes={"grain": "Fine"}), headers=owner)
    assert res.status_code == 422 and "Pack weight is required" in res.json()["detail"]

    res = await client.post(url, json=sugar(sid, attributes={"weight_kg": "abc", "grain": "Huge", "colour": "red"}), headers=owner)
    detail = res.json()["detail"]
    assert res.status_code == 422
    assert "'colour' is not a feature" in detail and "must be a number" in detail and "Fine, Medium, Bold" in detail

    p = await _create(client, cat, sugar(sid, sku=None, attributes={"weight_kg": "5"}))
    assert p["attributes"] == {"weight_kg": 5}


async def test_duplicate_sku_and_unit_names(client, cat):
    sid = cat["ids"]["Sugar"]
    await _create(client, cat, sugar(sid))
    res = await client.post(f"/t/{cat['a'].id}/products", json=sugar(sid), headers=cat["owner"])
    assert res.status_code == 409

    units = [{"name": "Bag", "pieces_per_unit": 1, "price": 1}, {"name": "bag", "pieces_per_unit": 2, "price": 2}]
    res = await client.post(f"/t/{cat['a'].id}/products", json=sugar(sid, sku="X", units=units), headers=cat["owner"])
    assert res.status_code == 422


async def test_update_product_revalidates_on_category_change(client, cat):
    a, owner, ids = cat["a"], cat["owner"], cat["ids"]
    p = await _create(client, cat, sugar(ids["Sugar"]))
    url = f"/t/{a.id}/products/{p['id']}"

    # Sugar features are not valid for Oil
    res = await client.put(url, json={"category_id": ids["Oil"]}, headers=owner)
    assert res.status_code == 422

    res = await client.put(url, json={"category_id": ids["Oil"], "attributes": {"volume_l": 1}}, headers=owner)
    assert res.status_code == 200
    assert res.json()["attributes"] == {"volume_l": 1}

    res = await client.put(url, json={"name": "Renamed", "brand": None}, headers=owner)
    assert res.json()["name"] == "Renamed" and res.json()["brand"] is None


# ---------- search and filters ----------


@pytest.fixture
async def products(client, cat):
    ids = cat["ids"]
    s1 = await _create(client, cat, sugar(ids["Sugar"]))
    s5 = await _create(client, cat, sugar(ids["Sugar"], name="Madhur Sugar 5 kg", sku="MAD-SUG-5", attributes={"weight_kg": 5, "grain": "Bold"}))
    rice = await _create(client, cat, sugar(ids["Rice"], name="India Gate Basmati Rice 5 kg", brand="India Gate", sku="IG-5",
                                            search_aliases="chawal, चावल", attributes={"weight_kg": 5, "variety": "Basmati"}))
    oil = await _create(client, cat, sugar(ids["Oil"], name="Fortune Mustard Oil 1 L", brand="Fortune", sku="FO-1",
                                           search_aliases="sarson tel, सरसों तेल", attributes={"volume_l": 1, "oil_type": "Mustard"},
                                           opening_stock_pieces=0))
    return {"s1": s1, "s5": s5, "rice": rice, "oil": oil}


async def _search(client, cat, **params):
    res = await client.get(f"/t/{cat['a'].id}/catalog/products", params=params, headers=cat["shop"])
    assert res.status_code == 200, res.text
    return [p["name"] for p in res.json()["items"]]


@pytest.mark.parametrize("q", ["cheeni", "chini", "CHEENI", "शक्कर", "sugar", "suger", "madhur"])
async def test_search_hindi_english_hinglish(client, cat, products, q):
    names = await _search(client, cat, q=q)
    assert names and all("Sugar" in n for n in names), (q, names)


async def test_search_other_products(client, cat, products):
    assert await _search(client, cat, q="chawal") == ["India Gate Basmati Rice 5 kg"]
    assert await _search(client, cat, q="सरसों") == ["Fortune Mustard Oil 1 L"]
    assert await _search(client, cat, q="zzzz") == []


async def test_category_and_attribute_filters(client, cat, products):
    ids = cat["ids"]
    staples = await _search(client, cat, category_id=ids["Ration"])
    assert len(staples) == 3  # includes sub-categories (oil is under Oil & Ghee)

    assert await _search(client, cat, category_id=ids["Sugar"], filters=json.dumps({"grain": "bold"})) == ["Madhur Sugar 5 kg"]
    assert await _search(client, cat, filters=json.dumps({"weight_kg": "1"})) == ["Madhur Sugar 1 kg"]
    assert len(await _search(client, cat, filters=json.dumps({"weight_kg": [1, 5]}))) == 3
    assert await _search(client, cat, brand="fortune") == ["Fortune Mustard Oil 1 L"]
    assert "Fortune Mustard Oil 1 L" not in await _search(client, cat, in_stock_only=True)

    res = await client.get(f"/t/{cat['a'].id}/catalog/products", params={"filters": "not json"}, headers=cat["shop"])
    assert res.status_code == 422


async def test_filters_endpoint(client, cat, products):
    res = await client.get(f"/t/{cat['a'].id}/catalog/categories/{cat['ids']['Sugar']}/filters", headers=cat["shop"])
    body = res.json()
    assert body["brands"] == ["Madhur"]
    by_key = {f["key"]: f for f in body["filters"]}
    assert by_key["weight_kg"]["values"] == [1, 5]
    assert by_key["grain"]["values"] == ["Fine", "Medium", "Bold"]


async def test_catalog_card_and_detail(client, cat, products):
    a = cat["a"]
    page = (await client.get(f"/t/{a.id}/catalog/products", params={"q": "sugar 1 kg"}, headers=cat["shop"])).json()
    card = page["items"][0]
    assert card["default_unit"]["name"] == "Bag" and card["in_stock"] is True

    detail = (await client.get(f"/t/{a.id}/catalog/products/{products['s1']['id']}", headers=cat["shop"])).json()
    assert detail["category_path"] == ["Ration / राशन", "Sugar / चीनी"]
    assert detail["features"] == [
        {"key": "weight_kg", "label": "Pack weight", "value": 1, "unit": "kg"},
        {"key": "grain", "label": "Grain", "value": "Medium", "unit": None},
    ]
    assert {u["name"]: u["in_stock"] for u in detail["units"]} == {"Packet": True, "Bag": True}

    tree = (await client.get(f"/t/{a.id}/catalog/categories", headers=cat["shop"])).json()
    staples = next(n for n in tree if n["name"].startswith("Ration"))
    assert [c["name"].split(" / ")[0] for c in staples["children"]] == ["Rice", "Atta & Flour", "Dal", "Sugar", "Poha & Daliya", "Salt & Gud"]


async def test_hidden_products_not_in_catalog(client, cat, products):
    a, pid = cat["a"], products["s1"]["id"]
    await client.put(f"/t/{a.id}/products/{pid}", json={"status": "hidden"}, headers=cat["owner"])
    assert "Madhur Sugar 1 kg" not in await _search(client, cat)
    assert (await client.get(f"/t/{a.id}/catalog/products/{pid}", headers=cat["shop"])).status_code == 404
    # still visible to the distributor
    listed = (await client.get(f"/t/{a.id}/products", params={"status": "hidden"}, headers=cat["owner"])).json()
    assert [p["name"] for p in listed["items"]] == ["Madhur Sugar 1 kg"]


# ---------- pack sizes ----------


async def test_unit_management(client, cat):
    a, owner = cat["a"], cat["owner"]
    p = await _create(client, cat, sugar(cat["ids"]["Sugar"], units=[{"name": "Packet", "pieces_per_unit": 1, "price": 45}]))
    packet_id = p["units"][0]["id"]
    assert p["units"][0]["is_default"] is True

    # the only pack size can't be deleted or un-defaulted
    assert (await client.delete(f"/t/{a.id}/units/{packet_id}", headers=owner)).status_code == 409
    res = await client.put(f"/t/{a.id}/units/{packet_id}", json={"is_default": False}, headers=owner)
    assert res.json()["is_default"] is True

    res = await client.post(
        f"/t/{a.id}/products/{p['id']}/units",
        json={"name": "Carton", "pieces_per_unit": 24, "price": 1050, "is_default": True, "step_qty": 2},
        headers=owner,
    )
    assert res.status_code == 201
    carton_id = res.json()["id"]
    assert (await client.post(f"/t/{a.id}/products/{p['id']}/units", json={"name": "Carton", "pieces_per_unit": 1, "price": 1}, headers=owner)).status_code == 409

    product = (await client.get(f"/t/{a.id}/products/{p['id']}", headers=owner)).json()
    assert {u["name"]: u["is_default"] for u in product["units"]} == {"Packet": False, "Carton": True}

    res = await client.put(f"/t/{a.id}/units/{carton_id}", json={"is_default": False}, headers=owner)
    product = (await client.get(f"/t/{a.id}/products/{p['id']}", headers=owner)).json()
    assert {u["name"]: u["is_default"] for u in product["units"]} == {"Packet": True, "Carton": False}

    assert (await client.put(f"/t/{a.id}/units/{carton_id}", json={"min_qty": 5, "max_qty": 2}, headers=owner)).status_code == 422
    assert (await client.delete(f"/t/{a.id}/units/{carton_id}", headers=owner)).status_code == 204


# ---------- stock ----------


async def test_stock_adjust_modes(client, cat):
    a, owner = cat["a"], cat["owner"]
    p = await _create(client, cat, sugar(cat["ids"]["Sugar"]))
    bag = next(u for u in p["units"] if u["name"] == "Bag")
    url = f"/t/{a.id}/stock/adjust"

    res = await client.post(url, json={"product_id": p["id"], "change": 2, "unit_id": bag["id"], "reason": "purchase"}, headers=owner)
    assert res.json() == {"product_id": p["id"], "change_pieces": 60, "stock_pieces": 360}

    res = await client.post(url, json={"product_id": p["id"], "set_to": 350, "note": "count"}, headers=owner)
    assert res.json()["change_pieces"] == -10 and res.json()["stock_pieces"] == 350

    res = await client.post(url, json={"product_id": p["id"], "change": -351}, headers=owner)
    assert res.status_code == 409

    assert (await client.post(url, json={"product_id": p["id"], "change": 1, "set_to": 1}, headers=owner)).status_code == 422
    assert (await client.post(url, json={"product_id": p["id"], "change": 1, "reason": "dispatch"}, headers=owner)).status_code == 422

    ledger = (await client.get(f"/t/{a.id}/stock/ledger", params={"product_id": p["id"]}, headers=owner)).json()
    assert [e["balance_after"] for e in ledger] == [350, 360, 300]


async def test_concurrent_stock_changes_cannot_oversell(client, cat):
    import asyncio

    a, owner = cat["a"], cat["owner"]
    p = await _create(client, cat, sugar(cat["ids"]["Sugar"], opening_stock_pieces=100))
    url = f"/t/{a.id}/stock/adjust"
    results = await asyncio.gather(
        *[client.post(url, json={"product_id": p["id"], "change": -60}, headers=owner) for _ in range(2)]
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    product = (await client.get(f"/t/{a.id}/products/{p['id']}", headers=owner)).json()
    assert product["stock_pieces"] == 40


# ---------- categories and features management ----------


async def test_category_crud_and_rules(client, cat):
    a, owner, ids = cat["a"], cat["owner"], cat["ids"]
    url = f"/t/{a.id}/categories"

    res = await client.post(url, json={"name": "Dal", "parent_id": ids["Ration"]}, headers=owner)
    assert res.status_code == 201
    dal = res.json()["id"]
    assert (await client.post(url, json={"name": " dal ", "parent_id": ids["Ration"]}, headers=owner)).status_code == 409

    lvl3 = (await client.post(url, json={"name": "Toor", "parent_id": dal}, headers=owner)).json()["id"]
    assert (await client.post(url, json={"name": "Too deep", "parent_id": lvl3}, headers=owner)).status_code == 400

    assert (await client.delete(f"{url}/{dal}", headers=owner)).status_code == 409  # has a child
    assert (await client.delete(f"{url}/{lvl3}", headers=owner)).status_code == 204

    await _create(client, cat, sugar(ids["Sugar"]))
    assert (await client.delete(f"{url}/{ids['Sugar']}", headers=owner)).status_code == 409  # has products

    res = await client.put(f"{url}/{dal}", json={"name": "Dal & Pulses"}, headers=owner)
    assert res.json()["name"] == "Dal & Pulses"


async def test_feature_management(client, cat):
    a, owner, ids = cat["a"], cat["owner"], cat["ids"]
    url = f"/t/{a.id}/categories/{ids['Sugar']}/attributes"

    res = await client.post(url, json={"key": "packing", "label": "Packing", "type": "select"}, headers=owner)
    assert res.status_code == 422  # select needs options

    # 'weight_g' is inherited by Chips from Snacks, so Chips can't define it again
    chips = f"/t/{a.id}/categories/{ids['Chips']}/attributes"
    assert (await client.post(chips, json={"key": "weight_g", "label": "W", "type": "number"}, headers=owner)).status_code == 409

    res = await client.post(url, json={"key": "sulphur_free", "label": "Sulphur free", "type": "boolean", "is_filter": True}, headers=owner)
    assert res.status_code == 201
    attr_id = res.json()["id"]

    p = await _create(client, cat, sugar(ids["Sugar"], attributes={"weight_kg": 1, "sulphur_free": "yes"}))
    assert p["attributes"]["sulphur_free"] is True

    assert (await client.delete(f"/t/{a.id}/attributes/{attr_id}", headers=owner)).status_code == 204
    product = (await client.get(f"/t/{a.id}/products/{p['id']}", headers=owner)).json()
    assert "sulphur_free" not in product["attributes"]


# ---------- roles and tenant isolation ----------


async def test_shop_cannot_manage_catalog(client, cat):
    a, shop = cat["a"], cat["shop"]
    assert (await client.get(f"/t/{a.id}/products", headers=shop)).status_code == 403
    assert (await client.post(f"/t/{a.id}/products", json=sugar(cat["ids"]["Sugar"]), headers=shop)).status_code == 403
    assert (await client.post(f"/t/{a.id}/stock/adjust", json={"product_id": cat["ids"]["Sugar"], "change": 1}, headers=shop)).status_code == 403


async def test_pending_shop_cannot_see_catalog(client, cat, make_shop):
    headers, _ = await make_shop("9123456789")
    await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    assert (await client.get(f"/t/{cat['a'].id}/catalog/products", headers=headers)).status_code == 404


async def test_other_tenant_cannot_touch_catalog(client, cat, products):
    a, b, owner_b, ids = cat["a"], cat["b"], cat["owner_b"], cat["ids"]
    pid = products["s1"]["id"]
    unit_id = products["s1"]["units"][0]["id"]

    # through A's URLs: tenant itself is invisible
    for path in [f"/t/{a.id}/products", f"/t/{a.id}/products/{pid}", f"/t/{a.id}/catalog/products", f"/t/{a.id}/categories"]:
        assert (await client.get(path, headers=owner_b)).status_code == 404, path

    # through B's own URLs with A's ids: not found
    assert (await client.get(f"/t/{b.id}/products/{pid}", headers=owner_b)).status_code == 404
    assert (await client.put(f"/t/{b.id}/products/{pid}", json={"name": "x"}, headers=owner_b)).status_code == 404
    assert (await client.delete(f"/t/{b.id}/products/{pid}", headers=owner_b)).status_code == 404
    assert (await client.put(f"/t/{b.id}/units/{unit_id}", json={"price": 1}, headers=owner_b)).status_code == 404
    assert (await client.delete(f"/t/{b.id}/units/{unit_id}", headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{b.id}/products/{pid}/units", json={"name": "X", "pieces_per_unit": 1, "price": 1}, headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{b.id}/stock/adjust", json={"product_id": pid, "change": -1}, headers=owner_b)).status_code == 404
    assert (await client.get(f"/t/{b.id}/catalog/products/{pid}", headers=owner_b)).status_code == 404
    assert (await client.get(f"/t/{b.id}/stock/ledger", params={"product_id": pid}, headers=owner_b)).json() == []

    # A's categories can't be used in B
    assert (await client.post(f"/t/{b.id}/products", json=sugar(ids["Sugar"]), headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{b.id}/categories", json={"name": "X", "parent_id": ids["Ration"]}, headers=owner_b)).status_code == 404
    assert (await client.delete(f"/t/{b.id}/categories/{ids['Atta & Flour']}", headers=owner_b)).status_code == 404
    attr = (await client.get(f"/t/{a.id}/categories/{ids['Sugar']}/attributes", headers=cat["owner"])).json()[0]
    assert (await client.delete(f"/t/{b.id}/attributes/{attr['id']}", headers=owner_b)).status_code == 404

    # A's product is untouched
    product = (await client.get(f"/t/{a.id}/products/{pid}", headers=cat["owner"])).json()
    assert product["name"] == "Madhur Sugar 1 kg" and product["stock_pieces"] == 300

    # A's shop doesn't see B's catalog
    assert (await client.get(f"/t/{b.id}/catalog/products", headers=cat["shop"])).status_code == 404


async def test_exact_matches_beat_fuzzy_ones(client, cat, products):
    """'chawal' must not pull in products that merely start with 'cha' (chai, chakki...)."""
    ids = cat["ids"]
    await _create(client, cat, sugar(ids["Drinks"], name="Chai Bahar Tea", brand="Chai Bahar", sku="TEA", search_aliases="chai patti", attributes={}))
    assert await _search(client, cat, q="chawal") == ["India Gate Basmati Rice 5 kg"]
    assert await _search(client, cat, q="sugar 5 kg") == ["Madhur Sugar 5 kg"]
