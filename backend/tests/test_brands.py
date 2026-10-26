"""Brands: one clean name per brand, matched however it's typed; picker, merge, shop filter, Excel."""

from tests.conftest import sugar
from tests.test_catalog_media_import import ROW, _fill, _import, _template


async def make(client, o, **over):
    res = await client.post(f"{o['t']}/products", json=sugar(o["ids"]["Sugar"], **over), headers=o["owner"])
    assert res.status_code == 201, res.text
    return res.json()


async def brands(client, o):
    return {b["name"]: b for b in (await client.get(f"{o['t']}/brands", headers=o["owner"])).json()}


async def test_typed_brands_are_matched_not_duplicated(client, o):
    # `o` already has "Madhur" (sugar) and "Munch" (chips)
    p = await make(client, o, name="Madhur Sugar 5 kg", sku="M5", brand="  MADHUR  ")
    assert p["brand"] == "Madhur" and p["brand_id"]
    b = await brands(client, o)
    assert set(b) == {"Madhur", "Munch"} and b["Madhur"]["product_count"] == 2

    # other spellings: Hindi name finds the same brand, and search by it works
    res = await client.put(f"{o['t']}/brands/{b['Madhur']['id']}", json={"aliases": "मधुर, madhur sweets"}, headers=o["owner"])
    assert res.status_code == 200 and res.json()["aliases"] == "मधुर, madhur sweets"
    p2 = await make(client, o, name="Madhur Sugar 2 kg", sku="M2", brand="मधुर")
    assert p2["brand"] == "Madhur"
    found = (await client.get(f"{o['t']}/catalog/products", params={"q": "मधुर"}, headers=o["shop"])).json()
    assert found["total"] == 3

    # a spelling can't belong to two brands
    clash = await client.post(f"{o['t']}/brands", json={"name": "Madhur Sweets"}, headers=o["owner"])
    assert clash.status_code == 409


async def test_pick_rename_merge_delete(client, o):
    t = o["t"]
    new = (await client.post(f"{t}/brands", json={"name": "Mithas", "aliases": "मिठास"}, headers=o["owner"])).json()
    p = await make(client, o, name="Mithas Sugar", sku="MI1", brand_id=new["id"], brand=None)
    assert p["brand"] == "Mithas"

    # rename: products follow
    await client.put(f"{t}/brands/{new['id']}", json={"name": "Mithaas"}, headers=o["owner"])
    assert (await client.get(f"{t}/products/{p['id']}", headers=o["owner"])).json()["brand"] == "Mithaas"

    # can't delete while used; merge moves products and keeps the old name as a spelling
    assert (await client.delete(f"{t}/brands/{new['id']}", headers=o["owner"])).status_code == 409
    madhur = (await brands(client, o))["Madhur"]
    merged = await client.post(f"{t}/brands/{new['id']}/merge", json={"into_id": madhur["id"]}, headers=o["owner"])
    assert merged.status_code == 200 and "Mithaas" in merged.json()["aliases"] and "मिठास" in merged.json()["aliases"]
    assert (await client.get(f"{t}/products/{p['id']}", headers=o["owner"])).json()["brand"] == "Madhur"
    assert "Mithaas" not in await brands(client, o)

    # clearing a product's brand
    cleared = await client.put(f"{t}/products/{p['id']}", json={"brand": None}, headers=o["owner"])
    assert cleared.json()["brand"] is None and cleared.json()["brand_id"] is None
    empty = (await client.post(f"{t}/brands", json={"name": "Unused"}, headers=o["owner"])).json()
    assert (await client.delete(f"{t}/brands/{empty['id']}", headers=o["owner"])).status_code == 204


async def test_shop_brands_and_filter(client, o):
    listed = (await client.get(f"{o['t']}/catalog/brands", headers=o["shop"])).json()
    assert {b["name"]: b["product_count"] for b in listed} == {"Madhur": 1, "Munch": 1}
    madhur = next(b for b in listed if b["name"] == "Madhur")
    only = (await client.get(f"{o['t']}/catalog/products", params={"brand_id": madhur["id"]}, headers=o["shop"])).json()
    assert [p["name"] for p in only["items"]] == ["Madhur Sugar 1 kg"]


async def test_brands_tenant_isolation(client, o):
    b = await brands(client, o)
    madhur = b["Madhur"]["id"]
    assert (await client.get(f"{o['t']}/brands", headers=o["owner_b"])).status_code == 404
    assert (await client.put(f"{o['t']}/brands/{madhur}", json={"name": "X"}, headers=o["owner_b"])).status_code == 404
    # B can't attach A's brand to its own product
    res = await client.post(f"/t/{o['b'].id}/brands", json={"name": "Bee"}, headers=o["owner_b"])
    assert res.status_code == 201
    cats = (await client.get(f"/t/{o['b'].id}/categories", headers=o["owner_b"])).json()
    sugar_b = next(c["id"] for c in cats if c["name"].startswith("Sugar"))
    res = await client.post(f"/t/{o['b'].id}/products", json=sugar(sugar_b, brand_id=madhur), headers=o["owner_b"])
    assert res.status_code == 404
    assert (await client.get(f"{o['t']}/brands", headers=o["shop"])).status_code == 403


async def test_excel_brands_match_existing(client, cat):
    t = f"/t/{cat['a'].id}"
    await client.post(f"{t}/brands", json={"name": "Mithas", "aliases": "मिठास"}, headers=cat["owner"])
    rows = [ROW | {"Brand": "मिठास"}, ROW | {"Name *": "Mithas Sugar 5 kg", "SKU": "MIT-5", "Brand": "  mithas ", "Pack weight (kg) * [weight_kg]": 5},
            ROW | {"Name *": "Sweeto Sugar", "SKU": "SW-1", "Brand": "Sweeto"}]
    content = _fill(await _template(client, cat), rows)
    dry = (await _import(client, cat, content, dry_run=True)).json()
    assert dry["new_brands"] == ["Sweeto"]  # the other two are the existing Mithas
    saved = (await _import(client, cat, content, dry_run=False)).json()
    assert saved["saved"] is True
    names = {b["name"]: b["product_count"] for b in (await client.get(f"{t}/brands", headers=cat["owner"])).json()}
    assert names == {"Mithas": 2, "Sweeto": 1}
