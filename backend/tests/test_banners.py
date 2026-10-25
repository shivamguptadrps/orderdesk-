"""Home screen banners: text and photo banners, order, active flag, links, and tenant isolation."""

from pathlib import Path

from PIL import Image

from app.core.media import media_root
from tests.test_catalog_media_import import _png


def _files(url: str) -> list[Path]:
    big = media_root() / url.removeprefix("/media/")
    return [big, big.with_name(big.name.replace("_800", "_200"))]


async def test_text_and_photo_banners(client, cat):
    t, owner = f"/t/{cat['a'].id}", cat["owner"]
    res = await client.post(
        f"{t}/banners",
        json={"title": " Diwali offer ", "subtitle": "5% off on sugar", "color": "#B76E00", "link_category_id": cat["ids"]["Sugar"]},
        headers=owner,
    )
    assert res.status_code == 201, res.text
    text = res.json()
    assert text["title"] == "Diwali offer" and text["image_url"] is None and text["sort_order"] == 1

    res = await client.post(f"{t}/banners/photo", files={"file": ("b.png", _png(2800, 1400), "image/png")}, headers=owner)
    assert res.status_code == 201, res.text
    photo = res.json()
    assert photo["title"] is None and photo["sort_order"] == 2
    big, small = _files(photo["image_url"])
    assert Image.open(big).width == 1400 and Image.open(small).width == 500

    # shops see active ones, in order
    shown = (await client.get(f"{t}/catalog/banners", headers=cat["shop"])).json()
    assert [b["id"] for b in shown] == [text["id"], photo["id"]]

    await client.put(f"{t}/banners/{text['id']}", json={"is_active": False}, headers=owner)
    shown = (await client.get(f"{t}/catalog/banners", headers=cat["shop"])).json()
    assert [b["id"] for b in shown] == [photo["id"]]
    assert len((await client.get(f"{t}/banners", headers=owner)).json()) == 2

    # reorder
    res = await client.put(f"{t}/banners-order", json={"ids": [photo["id"], text["id"]]}, headers=owner)
    assert [b["id"] for b in res.json()] == [photo["id"], text["id"]]
    assert (await client.put(f"{t}/banners-order", json={"ids": [photo["id"]]}, headers=owner)).status_code == 422

    # a photo-only banner can't lose its photo; a titled one can
    assert (await client.delete(f"{t}/banners/{photo['id']}/image", headers=owner)).status_code == 422
    res = await client.post(f"{t}/banners/{text['id']}/image", files={"file": ("c.png", _png(), "image/png")}, headers=owner)
    added = res.json()["image_url"]
    res = await client.delete(f"{t}/banners/{text['id']}/image", headers=owner)
    assert res.json()["image_url"] is None and not any(p.exists() for p in _files(added))

    # deleting removes the files
    assert (await client.delete(f"{t}/banners/{photo['id']}", headers=owner)).status_code == 204
    assert not any(p.exists() for p in _files(photo["image_url"]))


async def test_banner_rules(client, cat):
    t, owner = f"/t/{cat['a'].id}", cat["owner"]
    assert (await client.post(f"{t}/banners", json={"title": "  "}, headers=owner)).status_code == 422
    assert (await client.post(f"{t}/banners", json={"title": "x", "color": "red"}, headers=owner)).status_code == 422
    b = (await client.post(f"{t}/banners", json={"title": "Offer"}, headers=owner)).json()
    assert (await client.put(f"{t}/banners/{b['id']}", json={"title": None}, headers=owner)).status_code == 422
    # linking to another distributor's category is refused
    b_cats = (await client.get(f"/t/{cat['b'].id}/categories", headers=cat["owner_b"])).json()
    res = await client.put(f"{t}/banners/{b['id']}", json={"link_category_id": b_cats[0]["id"]}, headers=owner)
    assert res.status_code == 404
    # shops can't manage banners
    assert (await client.post(f"{t}/banners", json={"title": "x"}, headers=cat["shop"])).status_code == 403
    assert (await client.get(f"{t}/banners", headers=cat["shop"])).status_code == 403


async def test_banners_are_tenant_isolated(client, cat):
    t, owner, other = f"/t/{cat['a'].id}", cat["owner"], cat["owner_b"]
    b = (await client.post(f"{t}/banners", json={"title": "Offer"}, headers=owner)).json()
    for method, path in [
        ("get", f"{t}/catalog/banners"),
        ("get", f"{t}/banners"),
        ("post", f"{t}/banners"),
        ("put", f"{t}/banners/{b['id']}"),
        ("delete", f"{t}/banners/{b['id']}"),
    ]:
        kwargs = {"json": {"title": "x"}} if method in ("post", "put") else {}
        res = await getattr(client, method)(path, headers=other, **kwargs)
        assert res.status_code == 404, (path, res.status_code)
    # B's own URL with A's banner id
    res = await client.put(f"/t/{cat['b'].id}/banners/{b['id']}", json={"title": "x"}, headers=other)
    assert res.status_code == 404
