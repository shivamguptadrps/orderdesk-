"""Product sizes (variants): Rice 1 kg / 5 kg as one product for shops, each with its own price and stock.

Old apps don't send group_variants, so they keep seeing every size as its own product.
"""

import uuid

from tests.test_catalog_media_import import ROW, _fill, _import, _template

FIVE_KG = {
    "variant_label": "5 kg",
    "source_label": "1 kg",
    "name": "Madhur Sugar 5 kg",
    "sku": "MAD-SUG-5",
    "mrp": 240,
    "attributes": {"weight_kg": 5},
    "units": [{"name": "Bag", "pieces_per_unit": 1, "price": 215}],
    "opening_stock_pieces": 40,
}


async def add_five(client, o):
    res = await client.post(f"{o['t']}/products/{o['sugar']['id']}/sizes", json=FIVE_KG, headers=o["owner"])
    assert res.status_code == 201, res.text
    return res.json()


async def shop_list(client, o, **params):
    res = await client.get(f"{o['t']}/catalog/products", params=params, headers=o["shop"])
    assert res.status_code == 200, res.text
    return res.json()


async def test_add_size_copies_details_and_links_both(client, o):
    five = await add_five(client, o)
    assert five["variant_label"] == "5 kg" and five["variant_group_id"]
    assert five["brand"] == "Madhur" and five["search_aliases"] == o["sugar"]["search_aliases"]
    assert five["attributes"] == {"weight_kg": 5, "grain": "Medium"}  # copied, with the size's own weight
    assert five["stock_pieces"] == 40 and five["units"][0]["is_default"]
    assert [s["label"] for s in five["sizes"]] == ["1 kg"]

    one = (await client.get(f"{o['t']}/products/{o['sugar']['id']}", headers=o["owner"])).json()
    assert one["variant_group_id"] == five["variant_group_id"] and one["variant_label"] == "1 kg"
    assert [(s["label"], s["price"], s["stock_pieces"]) for s in one["sizes"]] == [("5 kg", 215.0, 40)]

    dup = await client.post(f"{o['t']}/products/{o['sugar']['id']}/sizes", json=FIVE_KG, headers=o["owner"])
    assert dup.status_code == 409  # same SKU


async def test_shop_sees_one_card_with_sizes_only_when_asked(client, o):
    five = await add_five(client, o)
    old_app = await shop_list(client, o, q="madhur")
    assert sorted(p["name"] for p in old_app["items"]) == ["Madhur Sugar 1 kg", "Madhur Sugar 5 kg"]  # unchanged

    new_app = await shop_list(client, o, q="madhur", group_variants="true")
    assert new_app["total"] == 1
    card = new_app["items"][0]
    assert card["name"] == "Madhur Sugar 1 kg" and card["variant_count"] == 2

    # a filter picks the matching size as the card
    filtered = await shop_list(client, o, category_id=o["ids"]["Sugar"], filters='{"weight_kg": 5}', group_variants="true")
    assert [p["name"] for p in filtered["items"]] == ["Madhur Sugar 5 kg"]

    detail = (await client.get(f"{o['t']}/catalog/products/{five['id']}", headers=o["shop"])).json()
    assert detail["variant_label"] == "5 kg"
    assert [(v["variant_label"], v["default_unit"]["price"]) for v in detail["variants"]] == [("1 kg", 1290.0), ("5 kg", 215.0)]  # smaller size (cheaper per piece) first
    plain = (await client.get(f"{o['t']}/catalog/products/{o['chips']['id']}", headers=o["shop"])).json()
    assert plain["variants"] == [] and plain["variant_label"] is None


async def test_hidden_size_is_not_offered_to_shops(client, o):
    five = await add_five(client, o)
    await client.put(f"{o['t']}/products/{five['id']}", json={"status": "hidden"}, headers=o["owner"])
    card = (await shop_list(client, o, q="madhur", group_variants="true"))["items"][0]
    assert card["variant_count"] == 1
    detail = (await client.get(f"{o['t']}/catalog/products/{o['sugar']['id']}", headers=o["shop"])).json()
    assert detail["variants"] == []  # only one size left to pick
    one = (await client.get(f"{o['t']}/products/{o['sugar']['id']}", headers=o["owner"])).json()
    assert [s["status"] for s in one["sizes"]] == ["hidden"]  # distributor still sees it


async def test_link_existing_products_and_leave(client, o):
    t, sugar_id, chips_id = o["t"], o["sugar"]["id"], o["chips"]["id"]
    res = await client.put(f"{t}/products/{chips_id}/size-group", json={"join_product_id": sugar_id}, headers=o["owner"])
    assert res.status_code == 200, res.text
    assert [s["id"] for s in res.json()["sizes"]] == [sugar_id]
    await client.put(f"{t}/products/{chips_id}", json={"variant_label": "52 g"}, headers=o["owner"])
    five = await add_five(client, o)
    assert len(five["sizes"]) == 2

    # leaving keeps the other two together
    left = await client.put(f"{t}/products/{chips_id}/size-group", json={"join_product_id": None}, headers=o["owner"])
    assert left.json()["variant_group_id"] is None and left.json()["sizes"] == []
    one = (await client.get(f"{t}/products/{sugar_id}", headers=o["owner"])).json()
    assert [s["id"] for s in one["sizes"]] == [five["id"]]

    # deleting the last other size dissolves the group
    assert (await client.delete(f"{t}/products/{five['id']}", headers=o["owner"])).status_code == 204
    one = (await client.get(f"{t}/products/{sugar_id}", headers=o["owner"])).json()
    assert one["variant_group_id"] is None and one["sizes"] == []

    bad = await client.put(f"{t}/products/{sugar_id}/size-group", json={"join_product_id": sugar_id}, headers=o["owner"])
    assert bad.status_code == 422


async def test_sizes_tenant_isolation(client, o):
    t, sugar_id = o["t"], o["sugar"]["id"]
    res = await client.post(f"{t}/products/{sugar_id}/sizes", json=FIVE_KG, headers=o["owner_b"])
    assert res.status_code == 404
    res = await client.put(f"{t}/products/{sugar_id}/size-group", json={"join_product_id": None}, headers=o["owner_b"])
    assert res.status_code == 404
    # can't join a product that isn't ours
    res = await client.put(f"{t}/products/{sugar_id}/size-group", json={"join_product_id": str(uuid.uuid4())}, headers=o["owner"])
    assert res.status_code == 404
    res = await client.get(f"{t}/catalog/products", params={"group_variants": "true"}, headers=o["owner_b"])
    assert res.status_code == 404


async def test_excel_size_columns(client, cat):
    sizes = {"Size group (same text = sizes of one product)": "Mithas", "Size label (e.g. 5 kg)": "1 kg"}
    rows = [
        ROW | sizes,
        ROW | sizes | {"Name *": "Mithas Sugar 5 kg", "SKU": "MIT-5", "Pack weight (kg) * [weight_kg]": 5, "Size label (e.g. 5 kg)": "5 kg"},
    ]
    res = await _import(client, cat, _fill(await _template(client, cat), rows), dry_run=False)
    assert res.json()["saved"] is True, res.text
    listed = (await client.get(f"/t/{cat['a'].id}/products", params={"q": "mithas"}, headers=cat["owner"])).json()["items"]
    assert len({p["variant_group_id"] for p in listed}) == 1 and listed[0]["variant_group_id"]
    assert sorted(p["variant_label"] for p in listed) == ["1 kg", "5 kg"]
    grouped = (await client.get(f"/t/{cat['a'].id}/catalog/products", params={"q": "mithas", "group_variants": "true"}, headers=cat["shop"])).json()
    assert grouped["total"] == 1 and grouped["items"][0]["variant_count"] == 2

    # blank size cells (or an old sheet without the columns) leave the groups alone
    await _import(client, cat, _fill(await _template(client, cat), [ROW | {"MRP": 55}]), dry_run=False)
    again = (await client.get(f"/t/{cat['a'].id}/products", params={"q": "mithas"}, headers=cat["owner"])).json()["items"]
    assert len({p["variant_group_id"] for p in again}) == 1
