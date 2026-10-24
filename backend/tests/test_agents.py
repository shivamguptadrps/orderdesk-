"""M4: team (staff/agents), agent shops, ordering on behalf of a shop, signing up shops, settings."""

import pytest

AGENT = "9111111111"
AGENT2 = "9222222222"
STAFF = "9333333333"
NEW_SHOP_OWNER = "9444444444"

NEW_SHOP = {
    "owner_phone": NEW_SHOP_OWNER,
    "shop_name": "Gupta General Store",
    "owner_name": "Suresh Gupta",
    "address": "4 Station Road",
    "city": "Kanpur",
    "pincode": "208002",
}


@pytest.fixture
async def ag(client, o, login):
    """`o` plus an agent (assigned to the shop), a second agent, and staff."""
    t, owner = o["t"], o["owner"]
    agent = (await client.post(f"{t}/members", json={"phone": AGENT, "name": "Ravi Agent", "role": "agent"}, headers=owner)).json()
    agent2 = (await client.post(f"{t}/members", json={"phone": AGENT2, "role": "agent"}, headers=owner)).json()
    staff = (await client.post(f"{t}/members", json={"phone": STAFF, "name": "Office Staff", "role": "staff"}, headers=owner)).json()
    shop_id = (await client.get("/shops/me", headers=o["shop"])).json()["id"]
    res = await client.put(f"{t}/shops/{shop_id}/agent", json={"agent_user_id": agent["user_id"]}, headers=owner)
    assert res.status_code == 200
    return o | {
        "shop_id": shop_id,
        "agent_id": agent["user_id"],
        "agent2_id": agent2["user_id"],
        "agent": await login(AGENT),
        "agent2": await login(AGENT2),
        "staff": await login(STAFF),
    }


async def agent_order(client, ag, headers=None, shop_id=None, qty=2):
    headers, shop_id = headers or ag["agent"], shop_id or ag["shop_id"]
    res = await client.post(f"{ag['t']}/cart/items", params={"shop_id": shop_id}, json={"unit_id": ag["bag"], "qty": qty}, headers=headers)
    assert res.status_code == 200, res.text
    res = await client.post(f"{ag['t']}/orders", params={"shop_id": shop_id}, json={"note": "Visited today"}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ---------- team ----------


async def test_team_list_and_roles(client, ag, login):
    t = ag["t"]
    members = (await client.get(f"{t}/members", headers=ag["owner"])).json()
    assert {(m["phone"], m["role"]) for m in members} == {
        ("+919000000001", "owner"), ("+919111111111", "agent"), ("+919222222222", "agent"), ("+919333333333", "staff"),
    }
    ravi = next(m for m in members if m["phone"] == "+919111111111")
    assert ravi["name"] == "Ravi Agent" and ravi["assigned_shops"] == 1
    agents = (await client.get(f"{t}/members", params={"role": "agent"}, headers=ag["staff"])).json()
    assert len(agents) == 2

    me = (await client.get("/me", headers=ag["agent"])).json()
    assert me["memberships"] == [{"tenant_id": str(ag["a"].id), "tenant_name": "Gupta Traders", "role": "agent"}]

    res = await client.post(f"{t}/members", json={"phone": AGENT, "role": "staff"}, headers=ag["owner"])
    assert res.status_code == 409 and "already agent" in res.json()["detail"]
    assert (await client.post(f"{t}/members", json={"phone": "123", "role": "agent"}, headers=ag["owner"])).status_code == 422
    assert (await client.post(f"{t}/members", json={"phone": "9555555555", "role": "owner"}, headers=ag["owner"])).status_code == 422


async def test_staff_permissions(client, ag):
    t = ag["t"]
    res = await client.post(f"{t}/members", json={"phone": "9555555555", "role": "agent"}, headers=ag["staff"])
    assert res.status_code == 201
    assert (await client.post(f"{t}/members", json={"phone": "9666666666", "role": "staff"}, headers=ag["staff"])).status_code == 403
    owner_id = next(m["user_id"] for m in (await client.get(f"{t}/members", headers=ag["owner"])).json() if m["role"] == "owner")
    staff_id = next(m["user_id"] for m in (await client.get(f"{t}/members", headers=ag["owner"])).json() if m["role"] == "staff")
    assert (await client.delete(f"{t}/members/{owner_id}", headers=ag["owner"])).status_code == 400
    assert (await client.delete(f"{t}/members/{staff_id}", headers=ag["staff"])).status_code == 403
    assert (await client.get(f"{t}/members", headers=ag["agent"])).status_code == 403
    assert (await client.get(f"{t}/members", headers=ag["shop"])).status_code == 403


async def test_removing_agent_unassigns_shops_and_clears_their_carts(client, ag):
    t = ag["t"]
    await client.post(f"{t}/cart/items", params={"shop_id": ag["shop_id"]}, json={"unit_id": ag["bag"], "qty": 1}, headers=ag["agent"])
    await client.post(f"{t}/cart/items", json={"unit_id": ag["bag"], "qty": 2}, headers=ag["shop"])  # shop's own cart
    placed = await agent_order(client, ag)

    assert (await client.delete(f"{t}/members/{ag['agent_id']}", headers=ag["owner"])).status_code == 204
    shops = (await client.get(f"{t}/shops", headers=ag["owner"])).json()
    assert shops[0]["agent_user_id"] is None
    assert (await client.get(f"{t}/agent/shops", headers=ag["agent"])).status_code == 404  # no longer a member
    # the shop's own cart is untouched; the order the agent placed stays, still showing who placed it
    assert (await client.get(f"{t}/cart", headers=ag["shop"])).json()["items"][0]["qty"] == 2
    order = (await client.get(f"{t}/orders/{placed['id']}", headers=ag["owner"])).json()
    assert order["placed_by_name"] == "Ravi Agent"


# ---------- agent's shops ----------


async def test_agent_sees_only_assigned_shops(client, ag):
    t = ag["t"]
    mine = (await client.get(f"{t}/agent/shops", headers=ag["agent"])).json()
    assert [(s["shop_name"], s["agent_name"], s["last_order_at"]) for s in mine] == [("Sharma Kirana Store", "Ravi Agent", None)]
    assert (await client.get(f"{t}/agent/shops", headers=ag["agent2"])).json() == []

    await agent_order(client, ag)
    mine = (await client.get(f"{t}/agent/shops", headers=ag["agent"])).json()
    assert mine[0]["last_order_at"] is not None

    by_agent = (await client.get(f"{t}/shops", params={"agent_user_id": ag["agent_id"]}, headers=ag["owner"])).json()
    assert len(by_agent) == 1
    assert (await client.get(f"{t}/shops", headers=ag["agent"])).status_code == 403  # the full shop list is for staff


# ---------- ordering on behalf of a shop ----------


async def test_agent_orders_for_assigned_shop(client, ag):
    order = await agent_order(client, ag)
    assert order["source"] == "agent" and order["placed_by_name"] == "Ravi Agent"
    assert order["shop_name"] == "Sharma Kirana Store" and order["status"] == "pending"

    # the shop sees it as its own order
    mine = (await client.get("/shops/me/orders", headers=ag["shop"])).json()
    assert [(x["order_no"], x["source"], x["placed_by_name"]) for x in mine["items"]] == [(1, "agent", "Ravi Agent")]
    assert (await client.get(f"{ag['t']}/orders/{order['id']}", headers=ag["shop"])).status_code == 200

    # and the distributor approves it like any other
    res = await client.post(f"{ag['t']}/orders/{order['id']}/approve", json={}, headers=ag["owner"])
    assert res.json()["status"] == "approved"


async def test_agent_and_shop_carts_are_separate(client, ag):
    t = ag["t"]
    await client.post(f"{t}/cart/items", json={"unit_id": ag["bag"], "qty": 3}, headers=ag["shop"])
    agent_cart = (await client.get(f"{t}/cart", params={"shop_id": ag["shop_id"]}, headers=ag["agent"])).json()
    assert agent_cart["items"] == []
    await agent_order(client, ag, qty=1)
    assert (await client.get(f"{t}/cart", headers=ag["shop"])).json()["items"][0]["qty"] == 3


async def test_agent_cannot_order_for_other_shops(client, ag, make_shop):
    t = ag["t"]
    body = {"unit_id": ag["bag"], "qty": 1}
    # no shop chosen
    assert (await client.post(f"{t}/cart/items", json=body, headers=ag["agent"])).status_code == 422
    # assigned to someone else
    assert (await client.post(f"{t}/cart/items", params={"shop_id": ag["shop_id"]}, json=body, headers=ag["agent2"])).status_code == 404
    # pending shop, even if assigned
    headers, shop = await make_shop("9777777777")
    await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    await client.put(f"{t}/shops/{shop['id']}/agent", json={"agent_user_id": ag["agent_id"]}, headers=ag["owner"])
    assert (await client.post(f"{t}/cart/items", params={"shop_id": shop["id"]}, json=body, headers=ag["agent"])).status_code == 404
    # blocked shop
    await client.post(f"{t}/shops/{ag['shop_id']}/block", headers=ag["owner"])
    assert (await client.post(f"{t}/cart/items", params={"shop_id": ag["shop_id"]}, json=body, headers=ag["agent"])).status_code == 404
    # a shop can't use shop_id to order as another shop
    assert (await client.get(f"{t}/cart", params={"shop_id": shop["id"]}, headers=ag["shop"])).status_code == 404


async def test_staff_can_order_for_any_active_shop(client, ag):
    order = await agent_order(client, ag, headers=ag["staff"])
    assert order["source"] == "admin" and order["placed_by_name"] == "Office Staff"


async def test_agent_order_visibility(client, ag, make_shop):
    t = ag["t"]
    by_agent = await agent_order(client, ag)
    await client.post(f"{t}/cart/items", json={"unit_id": ag["bag"], "qty": 1}, headers=ag["shop"])
    by_shop = (await client.post(f"{t}/orders", json={}, headers=ag["shop"])).json()

    # second shop, assigned to agent2, places an order
    headers, shop2 = await make_shop("9777777777")
    await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    await client.post(f"{t}/shops/{shop2['id']}/approve", headers=ag["owner"])
    await client.put(f"{t}/shops/{shop2['id']}/agent", json={"agent_user_id": ag["agent2_id"]}, headers=ag["owner"])
    await client.post(f"{t}/cart/items", json={"unit_id": ag["bag"], "qty": 1}, headers=headers)
    other = (await client.post(f"{t}/orders", json={}, headers=headers)).json()

    seen = {x["id"] for x in (await client.get(f"{t}/orders", headers=ag["agent"])).json()["items"]}
    assert seen == {by_agent["id"], by_shop["id"]}
    assert (await client.get(f"{t}/orders/{other['id']}", headers=ag["agent"])).status_code == 404
    assert (await client.get(f"{t}/orders/{other['id']}/bill.pdf", headers=ag["agent"])).status_code == 404
    assert (await client.get(f"{t}/orders/{by_shop['id']}/bill.pdf", headers=ag["agent"])).status_code == 200

    # after the shop is taken away from the agent, it still sees only what it placed itself
    await client.put(f"{t}/shops/{ag['shop_id']}/agent", json={"agent_user_id": None}, headers=ag["owner"])
    seen = {x["id"] for x in (await client.get(f"{t}/orders", headers=ag["agent"])).json()["items"]}
    assert seen == {by_agent["id"]}


async def test_agent_cancel_and_actions(client, ag):
    t = ag["t"]
    mine = await agent_order(client, ag)
    await client.post(f"{t}/cart/items", json={"unit_id": ag["bag"], "qty": 1}, headers=ag["shop"])
    shops_own = (await client.post(f"{t}/orders", json={}, headers=ag["shop"])).json()

    assert (await client.post(f"{t}/orders/{shops_own['id']}/cancel", json={}, headers=ag["agent"])).status_code == 404
    assert (await client.post(f"{t}/orders/{mine['id']}/approve", json={}, headers=ag["agent"])).status_code == 403
    assert (await client.post(f"{t}/orders/{mine['id']}/dispatch", json={}, headers=ag["agent"])).status_code == 403
    res = await client.post(f"{t}/orders/{mine['id']}/cancel", json={"note": "Shop changed mind"}, headers=ag["agent"])
    assert res.json()["status"] == "cancelled"


async def test_agent_reorder(client, ag):
    t = ag["t"]
    order = await agent_order(client, ag, qty=3)
    res = await client.post(f"{t}/orders/{order['id']}/reorder", params={"shop_id": ag["shop_id"]}, headers=ag["agent"])
    assert res.status_code == 200 and res.json()["cart"]["items"][0]["qty"] == 3
    # the shop's own cart is not affected
    assert (await client.get(f"{t}/cart", headers=ag["shop"])).json()["items"] == []


# ---------- signing up shops ----------


async def test_agent_signs_up_new_shop(client, ag, login):
    t = ag["t"]
    res = await client.post(f"{t}/agent/shops", json=NEW_SHOP, headers=ag["agent"])
    assert res.status_code == 201, res.text
    link = res.json()
    assert link["status"] == "pending" and link["agent_name"] == "Ravi Agent" and link["added_by_agent"] is True
    assert link["owner_phone"] == "+919444444444"

    # can't order until the distributor approves
    body = {"unit_id": ag["bag"], "qty": 1}
    assert (await client.post(f"{t}/cart/items", params={"shop_id": link["shop_id"]}, json=body, headers=ag["agent"])).status_code == 404
    pending = (await client.get(f"{t}/shops", params={"status": "pending"}, headers=ag["owner"])).json()
    assert [s["shop_name"] for s in pending] == ["Gupta General Store"]
    await client.post(f"{t}/shops/{link['shop_id']}/approve", headers=ag["owner"])
    assert (await client.post(f"{t}/cart/items", params={"shop_id": link["shop_id"]}, json=body, headers=ag["agent"])).status_code == 200

    # the shop owner logs in later and finds everything ready
    owner_headers = await login(NEW_SHOP_OWNER)
    me = (await client.get("/me", headers=owner_headers)).json()
    assert me["shop"]["shop_name"] == "Gupta General Store"
    dists = (await client.get("/shops/me/distributors", headers=owner_headers)).json()
    assert [(d["name"], d["status"]) for d in dists] == [("Gupta Traders", "active")]

    again = await client.post(f"{t}/agent/shops", json=NEW_SHOP, headers=ag["agent"])
    assert again.status_code == 409


async def test_signing_up_existing_shop_keeps_its_profile(client, ag, make_shop):
    t = ag["t"]
    await make_shop("9444444444", shop_name="Original Name")
    res = await client.post(f"{t}/agent/shops", json=NEW_SHOP, headers=ag["agent"])
    assert res.status_code == 201 and res.json()["shop_name"] == "Original Name"


async def test_auto_approve_and_staff_sign_up(client, ag):
    t = ag["t"]
    res = await client.put(f"{t}/settings", json={"agent_shops_auto_approve": True}, headers=ag["owner"])
    assert res.json()["agent_shops_auto_approve"] is True
    link = (await client.post(f"{t}/agent/shops", json=NEW_SHOP, headers=ag["agent"])).json()
    assert link["status"] == "active"

    staff_link = (await client.post(f"{t}/agent/shops", json=NEW_SHOP | {"owner_phone": "9888888888"}, headers=ag["staff"])).json()
    assert staff_link["status"] == "active" and staff_link["agent_user_id"] is None

    assert (await client.post(f"{t}/agent/shops", json=NEW_SHOP | {"owner_phone": "9888888887"}, headers=ag["shop"])).status_code == 403


# ---------- settings ----------


async def test_settings(client, ag):
    t = ag["t"]
    res = await client.put(f"{t}/settings", json={"name": " Gupta Traders Pvt ", "brand_color": "#1F6FEB"}, headers=ag["owner"])
    assert res.status_code == 200
    assert res.json()["name"] == "Gupta Traders Pvt" and res.json()["brand_color"] == "#1F6FEB"
    assert (await client.put(f"{t}/settings", json={"brand_color": "blue"}, headers=ag["owner"])).status_code == 422
    assert (await client.put(f"{t}/settings", json={"name": "X"}, headers=ag["staff"])).status_code == 403
    seen_by_agent = (await client.get(t, headers=ag["agent"])).json()
    assert seen_by_agent["my_role"] == "agent" and seen_by_agent["join_code"] is None
    assert seen_by_agent["agent_shops_auto_approve"] is None


# ---------- isolation ----------


async def test_agents_are_scoped_to_their_distributor(client, ag):
    a, b, owner_b = ag["a"], ag["b"], ag["owner_b"]
    # A's agent has no access to B
    assert (await client.get(f"/t/{b.id}/agent/shops", headers=ag["agent"])).status_code == 404
    assert (await client.get(f"/t/{b.id}/catalog/products", headers=ag["agent"])).status_code == 404
    # B can't manage or see A's team
    assert (await client.get(f"/t/{a.id}/members", headers=owner_b)).status_code == 404
    assert (await client.delete(f"/t/{a.id}/members/{ag['agent_id']}", headers=owner_b)).status_code == 404
    assert (await client.delete(f"/t/{b.id}/members/{ag['agent_id']}", headers=owner_b)).status_code == 404
    # B can't order for A's shop through B
    body = {"unit_id": ag["bag"], "qty": 1}
    assert (await client.post(f"/t/{b.id}/cart/items", params={"shop_id": ag["shop_id"]}, json=body, headers=owner_b)).status_code == 404
    # B can't assign its own agent to A's shop, or A's agent to its shops
    res = await client.put(f"/t/{b.id}/shops/{ag['shop_id']}/agent", json={"agent_user_id": ag["agent_id"]}, headers=owner_b)
    assert res.status_code == 404
    # A's agent is still a member of A only
    members = (await client.get(f"/t/{a.id}/members", headers=ag["owner"])).json()
    assert any(m["user_id"] == ag["agent_id"] for m in members)
    assert (await client.get(f"/t/{b.id}/members", headers=owner_b)).json()[0]["role"] == "owner"
