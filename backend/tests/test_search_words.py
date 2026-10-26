"""Search understands category names, their Hindi/Hinglish other names, brand spellings and the description."""

from tests.conftest import sugar


async def names(client, o, q):
    res = await client.get(f"{o['t']}/catalog/products", params={"q": q}, headers=o["shop"])
    assert res.status_code == 200, res.text
    return sorted(p["name"] for p in res.json()["items"])


async def test_category_and_brand_words_find_products(client, o):
    rice = await client.post(
        f"{o['t']}/products",
        json=sugar(o["ids"]["Rice"], name="Mahotsav Diamond 5 kg", brand="Pansari", sku="MD5", search_aliases=None,
                   description="Long grain, aged one year", attributes={"weight_kg": 5, "variety": "Basmati"}),
        headers=o["owner"],
    )
    assert rice.status_code == 201, rice.text
    # the product name says neither "rice" nor "chawal"; the category's other names do
    for q in ("chawal", "चावल", "rice", "basmati"):
        assert await names(client, o, q) == ["Mahotsav Diamond 5 kg"], q
    assert await names(client, o, "चीनी") == ["Madhur Sugar 1 kg"]  # Sugar / चीनी
    assert await names(client, o, "aged") == ["Mahotsav Diamond 5 kg"]  # description

    # other names added later reach existing products
    cats = (await client.get(f"{o['t']}/categories", headers=o["owner"])).json()
    rice_cat = next(c for c in cats if c["id"] == o["ids"]["Rice"])
    assert "chawal" in rice_cat["aliases"]
    res = await client.put(f"{o['t']}/categories/{rice_cat['id']}", json={"aliases": rice_cat["aliases"] + ", dhaan"}, headers=o["owner"])
    assert res.status_code == 200 and res.json()["aliases"].endswith("dhaan")
    assert await names(client, o, "dhaan") == ["Mahotsav Diamond 5 kg"]
    brands = {b["name"]: b for b in (await client.get(f"{o['t']}/brands", headers=o["owner"])).json()}
    await client.put(f"{o['t']}/brands/{brands['Pansari']['id']}", json={"aliases": "पंसारी"}, headers=o["owner"])
    assert await names(client, o, "पंसारी") == ["Mahotsav Diamond 5 kg"]


async def test_template_download_with_hindi_category_names(client, o):
    res = await client.get(f"{o['t']}/product-import/template", params={"category_id": o["ids"]["Rice"]}, headers=o["owner"])
    assert res.status_code == 200
    cd = res.headers["content-disposition"]
    assert 'filename="products_ration_rice.xlsx"' in cd and "filename*=UTF-8''" in cd
