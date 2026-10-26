"""M7: related products, cart suggestions, push notifications, reports - and tenant isolation for each."""

from datetime import datetime

import pytest

from app.modules.catalog.related import IST, feature_match, seconds_until
from app.modules.notifications import service as push
from tests.conftest import sugar
from tests.test_agents import AGENT, ag, agent_order  # noqa: F401  (fixture)
from tests.test_orders import add, placed_order

SHOP_TOKEN = "ExponentPushToken[shop-phone-000000]"
OWNER_TOKEN = "ExponentPushToken[owner-phone-00000]"
AGENT_TOKEN = "ExponentPushToken[agent-phone-00000]"


@pytest.fixture(autouse=True)
def _clear_push_log():
    push.sent_log.clear()
    yield
    push.sent_log.clear()


@pytest.fixture
async def rel(client, o):
    """`o` plus a second sugar (sibling of the first), rice (sibling category), and an out-of-stock sugar."""

    async def create(body):
        res = await client.post(f"{o['t']}/products", json=body, headers=o["owner"])
        assert res.status_code == 201, res.text
        return res.json()

    ids = o["ids"]
    sugar5 = await create(
        sugar(ids["Sugar"], name="Madhur Sugar 5 kg", sku="MAD-SUG-5", attributes={"weight_kg": 5, "grain": "medium"})
    )
    rice = await create(
        sugar(ids["Rice"], name="India Gate Rice 1 kg", brand="India Gate", sku="RICE", search_aliases=None,
              attributes={"weight_kg": 1, "variety": "Basmati"})
    )
    empty = await create(
        sugar(ids["Sugar"], name="Dhampur Sugar 1 kg", brand="Dhampur", sku="DHM", opening_stock_pieces=0)
    )
    return o | {"sugar5": sugar5, "rice": rice, "empty": empty}


def names(cards):
    return [c["name"] for c in cards]


# ---------- related products ----------


def test_feature_match():
    assert feature_match({"weight_kg": 1, "grain": "Medium"}, {"weight_kg": 1, "grain": "medium"}) == 1
    assert feature_match({"weight_kg": 1, "grain": "medium"}, {"weight_kg": 5, "grain": "medium"}) == 0.5
    assert feature_match({}, {}) == 0


async def test_related_before_any_orders_uses_category(client, rel):
    t, s = rel["t"], rel["sugar"]
    res = await client.get(f"{t}/catalog/products/{s['id']}/related", headers=rel["shop"])
    assert res.status_code == 200, res.text
    # same category first, then the sibling category; chips (other branch) and out-of-stock sugar left out
    assert names(res.json()) == ["Madhur Sugar 5 kg", "India Gate Rice 1 kg"]


async def test_bought_together_after_rebuild(client, rel):
    t = rel["t"]
    await placed_order(client, rel)  # sugar bag + chips
    res = await client.post(f"{t}/related/rebuild", headers=rel["owner"])
    assert res.status_code == 200 and res.json()["links"] > 0

    links = (await client.get(f"{t}/products/{rel['sugar']['id']}/related", headers=rel["owner"])).json()
    chips = next(link for link in links if link["name"] == "Munch Chips 52 g")
    assert chips["bought_together"] == 1 and chips["score"] == pytest.approx(0.4)
    sugar5 = next(link for link in links if link["name"] == "Madhur Sugar 5 kg")
    assert sugar5["score"] == pytest.approx(0.25 + 0.15 * 0.5)  # same category, grain matches, weight doesn't

    shown = names((await client.get(f"{t}/catalog/products/{rel['sugar']['id']}/related", headers=rel["shop"])).json())
    # chips: 0.4 + 0.1 (this shop bought them) beats sugar 5 kg (0.325)
    assert shown[0] == "Munch Chips 52 g" and "Madhur Sugar 5 kg" in shown


async def test_hidden_and_out_of_stock_products_are_not_suggested(client, rel):
    t = rel["t"]
    await client.put(f"{t}/products/{rel['sugar5']['id']}", json={"status": "hidden"}, headers=rel["owner"])
    shown = names((await client.get(f"{t}/catalog/products/{rel['sugar']['id']}/related", headers=rel["shop"])).json())
    assert shown == ["India Gate Rice 1 kg"]
    # a hidden product has no related page for shops
    res = await client.get(f"{t}/catalog/products/{rel['sugar5']['id']}/related", headers=rel["shop"])
    assert res.status_code == 404


async def test_pin_and_unpin(client, rel):
    t, s, chips = rel["t"], rel["sugar"], rel["chips"]
    res = await client.put(f"{t}/products/{s['id']}/related/{chips['id']}", headers=rel["owner"])
    assert res.status_code == 200, res.text
    pinned = next(link for link in res.json() if link["product_id"] == chips["id"])
    assert pinned["pinned"] is True and pinned["score"] == pytest.approx(0.1)
    # both ways
    back = (await client.get(f"{t}/products/{chips['id']}/related", headers=rel["owner"])).json()
    assert any(link["product_id"] == s["id"] and link["pinned"] for link in back)
    # pins survive a full rebuild
    await client.post(f"{t}/related/rebuild", headers=rel["owner"])
    again = (await client.get(f"{t}/products/{s['id']}/related", headers=rel["owner"])).json()
    assert any(link["product_id"] == chips["id"] and link["pinned"] for link in again)

    res = await client.delete(f"{t}/products/{s['id']}/related/{chips['id']}", headers=rel["owner"])
    assert all(link["product_id"] != chips["id"] for link in res.json())
    assert (await client.put(f"{t}/products/{s['id']}/related/{s['id']}", headers=rel["owner"])).status_code == 422


async def test_cart_suggestions(client, rel):
    t = rel["t"]
    # no cart, no history: nothing to suggest
    assert (await client.get(f"{t}/cart/suggestions", headers=rel["shop"])).json() == []

    await placed_order(client, rel)  # sugar bag + chips: they are now 'bought together'
    await client.post(f"{t}/related/rebuild", headers=rel["owner"])
    await add(client, rel, rel["bag"], 1)
    shown = names((await client.get(f"{t}/cart/suggestions", headers=rel["shop"])).json())
    assert shown[0] == "Munch Chips 52 g"
    assert "Madhur Sugar 1 kg" not in shown  # already in the cart
    assert "Madhur Sugar 5 kg" not in shown  # a look-alike of a cart item
    assert "India Gate Rice 1 kg" in shown  # sibling category is fine


async def test_related_is_tenant_isolated(client, rel):
    t, s, other = rel["t"], rel["sugar"], rel["owner_b"]
    for method, path in [
        ("get", f"{t}/catalog/products/{s['id']}/related"),
        ("get", f"{t}/products/{s['id']}/related"),
        ("put", f"{t}/products/{s['id']}/related/{rel['chips']['id']}"),
        ("post", f"{t}/related/rebuild"),
        ("get", f"{t}/cart/suggestions"),
        ("get", f"{t}/reports"),
    ]:
        res = await getattr(client, method)(path, headers=other)
        assert res.status_code == 404, (path, res.status_code)
    # another tenant's product id inside my tenant: 404
    b_cats = (await client.get(f"/t/{rel['b'].id}/categories", headers=other)).json()
    b_sugar = next(c["id"] for c in b_cats if c["name"].startswith("Sugar"))
    res = await client.post(f"/t/{rel['b'].id}/products", json=sugar(b_sugar), headers=other)
    b_product = res.json()["id"]
    assert (await client.put(f"{t}/products/{s['id']}/related/{b_product}", headers=rel["owner"])).status_code == 404
    # shops can't manage links
    assert (await client.post(f"{t}/related/rebuild", headers=rel["shop"])).status_code == 403


async def test_agent_ranks_for_own_shop_only(client, ag):  # noqa: F811
    t, s = ag["t"], ag["sugar"]
    ok = await client.get(f"{t}/catalog/products/{s['id']}/related", params={"shop_id": ag["shop_id"]}, headers=ag["agent"])
    assert ok.status_code == 200
    res = await client.get(f"{t}/catalog/products/{s['id']}/related", params={"shop_id": ag["shop_id"]}, headers=ag["agent2"])
    assert res.status_code == 404  # not their shop


def test_nightly_schedule():
    at_1am = datetime(2026, 10, 24, 1, 0, tzinfo=IST)
    assert seconds_until(2, at_1am) == 90 * 60  # runs 02:30
    at_3am = datetime(2026, 10, 24, 3, 0, tzinfo=IST)
    assert seconds_until(2, at_3am) == 23.5 * 3600


# ---------- push notifications ----------


async def register(client, headers, token, platform="ios"):
    res = await client.post("/me/push-tokens", json={"token": token, "platform": platform}, headers=headers)
    assert res.status_code == 204, res.text


def sent_to(token):
    return [(m["title"], m["body"]) for m in push.sent_log if m["to"] == token]


async def test_push_token_rules(client, o, login):
    res = await client.post("/me/push-tokens", json={"token": "not-a-token", "platform": "ios"}, headers=o["shop"])
    assert res.status_code == 422
    await register(client, o["shop"], SHOP_TOKEN)
    await register(client, o["shop"], SHOP_TOKEN)  # same phone again: fine
    # the phone is handed to the owner: the token moves to them
    await register(client, o["owner"], SHOP_TOKEN)
    await placed_order(client, o)
    assert sent_to(SHOP_TOKEN) == [("New order #1", "Sharma Kirana Store · ₹5,364.00 · 2 items")]


async def test_order_notifications(client, o):
    t = o["t"]
    await register(client, o["shop"], SHOP_TOKEN)
    await register(client, o["owner"], OWNER_TOKEN)

    order = await placed_order(client, o)
    assert sent_to(OWNER_TOKEN) == [("New order #1", "Sharma Kirana Store · ₹5,364.00 · 2 items")]
    assert sent_to(SHOP_TOKEN) == []  # not told about their own action
    ring = next(m for m in push.sent_log if m["to"] == OWNER_TOKEN)
    assert (ring["channelId"], ring["sound"]) == ("new_orders", "order_ring.wav")  # a new order rings

    await client.post(f"{t}/orders/{order['id']}/approve", json={"items": []}, headers=o["owner"])
    await client.post(f"{t}/orders/{order['id']}/dispatch", json={"items": []}, headers=o["owner"])
    await client.post(f"{t}/orders/{order['id']}/deliver", json={}, headers=o["owner"])
    assert [title for title, _ in sent_to(SHOP_TOKEN)] == [
        "Order #1 approved",
        "Order #1 is on the way",
        "Order #1 delivered",
    ]
    assert sent_to(SHOP_TOKEN)[0][1] == "Gupta Traders approved your order · ₹5,364.00"
    assert len(sent_to(OWNER_TOKEN)) == 1
    data = next(m["data"] for m in push.sent_log if m["to"] == SHOP_TOKEN)
    assert data == {"type": "order", "tenant_id": str(o["a"].id), "order_id": order["id"], "for": "shop"}
    assert all(m["channelId"] == "default" for m in push.sent_log if m["to"] == SHOP_TOKEN)  # updates don't ring


async def test_reject_and_cancel_notifications(client, o):
    t = o["t"]
    await register(client, o["shop"], SHOP_TOKEN)
    await register(client, o["owner"], OWNER_TOKEN)
    first = await placed_order(client, o)
    await client.post(f"{t}/orders/{first['id']}/reject", json={"reason": "Shop closed on Sunday"}, headers=o["owner"])
    assert ("Order #1 rejected", "Gupta Traders: Shop closed on Sunday") in sent_to(SHOP_TOKEN)

    second = await placed_order(client, o)
    await client.post(f"{t}/orders/{second['id']}/cancel", json={"note": "Ordered by mistake"}, headers=o["shop"])
    assert ("Order #2 cancelled", "Sharma Kirana Store cancelled the order: Ordered by mistake") in sent_to(OWNER_TOKEN)


async def test_agent_order_notifications(client, ag):  # noqa: F811
    t = ag["t"]
    await register(client, ag["shop"], SHOP_TOKEN)
    await register(client, ag["agent"], AGENT_TOKEN)
    await register(client, ag["owner"], OWNER_TOKEN)
    order = await agent_order(client, ag)
    assert [title for title, _ in sent_to(OWNER_TOKEN)] == ["New order #1"]
    assert sent_to(AGENT_TOKEN) == []

    await client.post(f"{t}/orders/{order['id']}/approve", json={"items": []}, headers=ag["staff"])
    assert sent_to(SHOP_TOKEN)[0][0] == "Order #1 approved"
    assert sent_to(AGENT_TOKEN) == [("Order #1 approved", "Sharma Kirana Store: Gupta Traders approved your order · ₹2,580.00")]
    agent_data = next(m["data"] for m in push.sent_log if m["to"] == AGENT_TOKEN)
    assert agent_data["for"] == "agent" and agent_data["shop_id"] == ag["shop_id"]


async def test_logout_stops_notifications(client, o, login):
    await register(client, o["owner"], OWNER_TOKEN)
    res = await client.post("/auth/otp/request", json={"phone": "9000000001"})
    tokens = (await client.post("/auth/otp/verify", json={"phone": "9000000001", "code": "123456"})).json()
    res = await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"], "push_token": OWNER_TOKEN})
    assert res.status_code == 204
    await placed_order(client, o)
    assert sent_to(OWNER_TOKEN) == []


async def test_remove_push_token(client, o):
    await register(client, o["owner"], OWNER_TOKEN)
    # someone else can't remove my token
    await client.post("/me/push-tokens/remove", json={"token": OWNER_TOKEN}, headers=o["shop"])
    await placed_order(client, o)
    assert len(sent_to(OWNER_TOKEN)) == 1
    await client.post("/me/push-tokens/remove", json={"token": OWNER_TOKEN}, headers=o["owner"])
    await placed_order(client, o)
    assert len(sent_to(OWNER_TOKEN)) == 1


async def test_shop_join_and_approval_notifications(client, make_tenant, login, make_shop):
    tenant = await make_tenant("Verma Agencies", owner_phone="9000000009", join_code="VERMA1")
    owner = await login("9000000009")
    shop_headers, shop = await make_shop("9876500000", shop_name="Ram Stores")
    await register(client, owner, OWNER_TOKEN)
    await register(client, shop_headers, SHOP_TOKEN)

    await client.post("/shops/me/distributors", json={"join_code": "VERMA1"}, headers=shop_headers)
    assert sent_to(OWNER_TOKEN) == [("New shop wants to join", "Ram Stores, Kanpur · tap to approve")]
    await client.post(f"/t/{tenant.id}/shops/{shop['id']}/approve", headers=owner)
    assert sent_to(SHOP_TOKEN) == [("You can order from Verma Agencies", "Verma Agencies approved Ram Stores. Start ordering.")]
    # approving again (already active) doesn't notify twice
    await client.post(f"/t/{tenant.id}/shops/{shop['id']}/approve", headers=owner)
    assert len(sent_to(SHOP_TOKEN)) == 1


# ---------- reports ----------


async def test_reports(client, rel):
    t = rel["t"]
    first = await placed_order(client, rel)  # 4 bags sugar (5160) + 12 chips (204)
    await client.post(f"{t}/orders/{first['id']}/approve", json={"items": []}, headers=rel["owner"])
    second = await placed_order(client, rel, lines=[(rel["chip_packet"], 6)])
    await client.post(f"{t}/orders/{second['id']}/reject", json={"reason": "No"}, headers=rel["owner"])

    res = await client.get(f"{t}/reports", params={"days": 7}, headers=rel["owner"])
    assert res.status_code == 200, res.text
    r = res.json()
    assert r["orders"] == 1 and r["value"] == 5364.0 and r["average_order"] == 5364.0
    assert r["status_counts"] == {"approved": 1, "rejected": 1}
    assert r["by_source"] == {"shop": 1}
    assert len(r["by_day"]) == 7 and r["by_day"][-1]["orders"] == 1 and r["by_day"][-1]["value"] == 5364.0
    assert [(p["name"], p["pieces"], p["value"]) for p in r["top_products"]] == [
        ("Madhur Sugar 1 kg", 120, 5160.0),
        ("Munch Chips 52 g", 12, 204.0),
    ]
    assert [(s["name"], s["orders"]) for s in r["top_shops"]] == [("Sharma Kirana Store", 1)]
    assert r["shops_ordering"] == 1 and r["new_shops"] == 1

    today = (await client.get(f"{t}/reports", params={"days": 1}, headers=rel["owner"])).json()
    assert today["orders"] == 1 and len(today["by_day"]) == 1
    assert (await client.get(f"{t}/reports", params={"days": 5}, headers=rel["owner"])).status_code == 422
    assert (await client.get(f"{t}/reports", headers=rel["shop"])).status_code == 403


async def test_reports_count_agents(client, ag):  # noqa: F811
    await agent_order(client, ag)
    r = (await client.get(f"{ag['t']}/reports", headers=ag["staff"])).json()
    assert r["by_source"] == {"agent": 1}
    assert [(a["name"], a["orders"], a["value"]) for a in r["top_agents"]] == [("Ravi Agent", 1, 2580.0)]
