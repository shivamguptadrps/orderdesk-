"""M3: cart, orders, approval, dispatch (stock), delivery, bill, reorder, and tenant isolation."""

import asyncio

import pytest

from tests.conftest import sugar


async def add(client, o, unit_id, qty, headers=None):
    return await client.post(f"{o['t']}/cart/items", json={"unit_id": unit_id, "qty": qty}, headers=headers or o["shop"])


async def place(client, o, headers=None, note=None):
    res = await client.post(f"{o['t']}/orders", json={"note": note}, headers=headers or o["shop"])
    return res


async def placed_order(client, o, lines=None):
    """Fill the cart and place an order. Default: 4 bags of sugar + 12 packets of chips."""
    for unit_id, qty in lines or [(o["bag"], 4), (o["chip_packet"], 12)]:
        res = await add(client, o, unit_id, qty)
        assert res.status_code == 200, res.text
    res = await place(client, o)
    assert res.status_code == 201, res.text
    return res.json()


async def stock_of(client, o, product):
    res = await client.get(f"{o['t']}/products/{product['id']}", headers=o["owner"])
    return res.json()["stock_pieces"]


def line(order, product_name_part):
    return next(i for i in order["items"] if product_name_part in i["product_name"])


# ---------- cart ----------


async def test_cart_add_update_remove(client, o):
    res = await add(client, o, o["bag"], 2)
    cart = res.json()
    assert cart["item_count"] == 1 and cart["total"] == 2580.0 and cart["can_place_order"] is True

    cart = (await add(client, o, o["bag"], 1)).json()  # adds up
    assert cart["items"][0]["qty"] == 3 and cart["total"] == 3870.0

    cart = (await add(client, o, o["chip_packet"], 12)).json()
    chips_line = next(i for i in cart["items"] if i["unit_id"] == o["chip_packet"])
    assert cart["item_count"] == 2 and chips_line["line_total"] == 204.0

    res = await client.put(f"{o['t']}/cart/items/{chips_line['id']}", json={"qty": 18}, headers=o["shop"])
    assert next(i for i in res.json()["items"] if i["id"] == chips_line["id"])["qty"] == 18

    res = await client.put(f"{o['t']}/cart/note", json={"note": "Deliver by Monday"}, headers=o["shop"])
    assert res.json()["note"] == "Deliver by Monday"

    res = await client.delete(f"{o['t']}/cart/items/{chips_line['id']}", headers=o["shop"])
    assert res.json()["item_count"] == 1
    res = await client.delete(f"{o['t']}/cart", headers=o["shop"])
    assert res.json() == {"items": [], "item_count": 0, "total": 0.0, "note": None, "can_place_order": False}


async def test_cart_pack_rules(client, o):
    res = await add(client, o, o["packet"], 1)
    assert res.status_code == 422 and "Minimum order is 2 Packet" in res.json()["detail"]
    res = await add(client, o, o["chip_packet"], 7)
    assert res.status_code == 422 and "multiples of 6" in res.json()["detail"]
    res = await add(client, o, o["chip_packet"], 606)
    assert res.status_code == 422 and "Maximum 600" in res.json()["detail"]


async def test_cart_stock_check_counts_all_pack_sizes(client, o):
    # 300 pieces: 9 bags = 270 pieces, so only 30 single packets fit
    assert (await add(client, o, o["bag"], 9)).status_code == 200
    res = await add(client, o, o["packet"], 31)
    assert res.status_code == 409 and "Only 30 Packet" in res.json()["detail"]
    assert (await add(client, o, o["packet"], 30)).status_code == 200
    res = await add(client, o, o["bag"], 1)
    assert res.status_code == 409


async def test_cart_flags_items_that_became_unavailable(client, o):
    await add(client, o, o["bag"], 2)
    await client.put(f"{o['t']}/products/{o['sugar']['id']}", json={"status": "hidden"}, headers=o["owner"])
    cart = (await client.get(f"{o['t']}/cart", headers=o["shop"])).json()
    assert cart["items"][0]["problem"] == "No longer available" and cart["can_place_order"] is False
    res = await place(client, o)
    assert res.status_code == 409
    assert (await add(client, o, o["packet"], 2)).status_code == 404  # hidden products can't be added


async def test_cart_flags_stock_that_ran_out(client, o):
    await add(client, o, o["bag"], 5)
    await client.post(f"{o['t']}/stock/adjust", json={"product_id": o["sugar"]["id"], "set_to": 60}, headers=o["owner"])
    cart = (await client.get(f"{o['t']}/cart", headers=o["shop"])).json()
    assert cart["items"][0]["problem"] == "Only 2 Bag available"
    assert (await place(client, o)).status_code == 409


async def test_staff_and_agents_must_say_which_shop(client, o, login, add_member):
    assert (await client.get(f"{o['t']}/cart", headers=o["owner"])).status_code == 422
    await add_member(o["a"], "9111111111", "agent")
    agent = await login("9111111111")
    assert (await client.get(f"{o['t']}/cart", headers=agent)).status_code == 422


# ---------- placing orders ----------


async def test_place_order_snapshots_and_empties_cart(client, o):
    await client.put(f"{o['t']}/cart/note", json={"note": "Call before coming"}, headers=o["shop"])
    order = await placed_order(client, o)
    assert order["order_no"] == 1 and order["status"] == "pending" and order["source"] == "shop"
    assert order["items_total"] == 4 * 1290 + 12 * 17
    assert order["note"] == "Call before coming"
    assert order["shop_name"] == "Sharma Kirana Store" and "Kanpur - 208001" in order["shop_address"]
    sug = line(order, "Sugar")
    assert (sug["unit_name"], sug["pieces_per_unit"], sug["rate"], sug["qty_ordered"]) == ("Bag", 30, 1290.0, 4)
    assert [(e["from_status"], e["to_status"]) for e in order["events"]] == [(None, "pending")]

    cart = (await client.get(f"{o['t']}/cart", headers=o["shop"])).json()
    assert cart["items"] == [] and cart["note"] is None

    # stock is NOT touched by placing or approving
    assert await stock_of(client, o, o["sugar"]) == 300

    # later price changes don't change the order
    await client.put(f"/t/{o['a'].id}/units/{o['bag']}", json={"price": 1500}, headers=o["owner"])
    again = (await client.get(f"{o['t']}/orders/{order['id']}", headers=o["shop"])).json()
    assert line(again, "Sugar")["rate"] == 1290.0 and again["items_total"] == order["items_total"]

    second = await placed_order(client, o, [(o["packet"], 2)])
    assert second["order_no"] == 2 and second["items_total"] == 90.0


async def test_empty_cart_cannot_be_ordered(client, o):
    res = await place(client, o)
    assert res.status_code == 400


async def test_double_tap_creates_one_order(client, o):
    await add(client, o, o["bag"], 2)
    results = await asyncio.gather(place(client, o), place(client, o))
    assert sorted(r.status_code for r in results) == [201, 400]
    listed = (await client.get(f"{o['t']}/orders", headers=o["owner"])).json()
    assert listed["total"] == 1


async def test_order_numbers_are_per_distributor(client, o, make_shop):
    await placed_order(client, o)
    b = o["b"]
    headers, shop = await make_shop("9123456789")
    await client.post("/shops/me/distributors", json={"join_code": "VERMA8"}, headers=headers)
    await client.post(f"/t/{b.id}/shops/{shop['id']}/approve", headers=o["owner_b"])
    cats = {c["name"].split(" / ")[0]: c["id"] for c in (await client.get(f"/t/{b.id}/categories", headers=o["owner_b"])).json()}
    p = (await client.post(f"/t/{b.id}/products", json=sugar(cats["Sugar"]), headers=o["owner_b"])).json()
    await client.post(f"/t/{b.id}/cart/items", json={"unit_id": p["units"][1]["id"], "qty": 1}, headers=headers)
    res = await client.post(f"/t/{b.id}/orders", json={}, headers=headers)
    assert res.json()["order_no"] == 1


# ---------- approval ----------


async def test_approve_with_edits(client, o):
    order = await placed_order(client, o)
    sug, chips = line(order, "Sugar"), line(order, "Chips")
    res = await client.post(
        f"{o['t']}/orders/{order['id']}/approve",
        json={"items": [{"item_id": sug["id"], "qty": 3}, {"item_id": chips["id"], "qty": 0}], "note": "Chips later"},
        headers=o["owner"],
    )
    assert res.status_code == 200, res.text
    approved = res.json()
    assert approved["status"] == "approved"
    assert line(approved, "Sugar")["qty"] == 3 and line(approved, "Chips")["qty"] == 0
    assert approved["items_total"] == 3870.0 and approved["item_count"] == 1
    note = approved["events"][-1]["note"]
    assert "Bag): 4 → 3" in note and "Packet) removed" in note and "Chips later" in note
    assert approved["events"][-1]["by_name"] == "+919000000001"

    again = await client.post(f"{o['t']}/orders/{order['id']}/approve", json={}, headers=o["owner"])
    assert again.status_code == 409


async def test_approve_rules(client, o):
    order = await placed_order(client, o)
    url = f"{o['t']}/orders/{order['id']}/approve"
    zero = [{"item_id": i["id"], "qty": 0} for i in order["items"]]
    assert (await client.post(url, json={"items": zero}, headers=o["owner"])).status_code == 422
    bad = {"items": [{"item_id": o["sugar"]["id"], "qty": 1}]}
    assert (await client.post(url, json=bad, headers=o["owner"])).status_code == 422
    assert (await client.post(url, json={}, headers=o["shop"])).status_code == 403  # shops can't approve


async def test_reject_needs_reason(client, o):
    order = await placed_order(client, o)
    url = f"{o['t']}/orders/{order['id']}/reject"
    assert (await client.post(url, json={"reason": ""}, headers=o["owner"])).status_code == 422
    res = await client.post(url, json={"reason": "Shop has dues"}, headers=o["owner"])
    assert res.json()["status"] == "rejected" and res.json()["events"][-1]["note"] == "Shop has dues"
    assert (await client.post(f"{o['t']}/orders/{order['id']}/approve", json={}, headers=o["owner"])).status_code == 409


async def test_cancel_rules(client, o):
    first = await placed_order(client, o)
    res = await client.post(f"{o['t']}/orders/{first['id']}/cancel", json={"note": "Ordered by mistake"}, headers=o["shop"])
    assert res.json()["status"] == "cancelled"

    second = await placed_order(client, o)
    await client.post(f"{o['t']}/orders/{second['id']}/approve", json={}, headers=o["owner"])
    assert (await client.post(f"{o['t']}/orders/{second['id']}/cancel", json={}, headers=o["shop"])).status_code == 409
    res = await client.post(f"{o['t']}/orders/{second['id']}/cancel", json={"note": "Truck issue"}, headers=o["owner"])
    assert res.json()["status"] == "cancelled"
    assert await stock_of(client, o, o["sugar"]) == 300  # cancelling never touches stock


# ---------- dispatch: the stock moment ----------


async def _approve(client, o, order):
    res = await client.post(f"{o['t']}/orders/{order['id']}/approve", json={}, headers=o["owner"])
    assert res.status_code == 200, res.text
    return res.json()


async def test_dispatch_deducts_stock_and_writes_ledger(client, o):
    order = await placed_order(client, o)
    url = f"{o['t']}/orders/{order['id']}/dispatch"
    assert (await client.post(url, json={}, headers=o["owner"])).status_code == 409  # not approved yet
    await _approve(client, o, order)

    sug = line(order, "Sugar")
    res = await client.post(url, json={"items": [{"item_id": sug["id"], "qty": 3}]}, headers=o["owner"])
    assert res.status_code == 200, res.text
    done = res.json()
    assert done["status"] == "dispatched"
    assert line(done, "Sugar")["qty_dispatched"] == 3 and line(done, "Chips")["qty_dispatched"] == 12
    assert done["items_total"] == 3 * 1290 + 12 * 17
    assert "4 → 3" in done["events"][-1]["note"]

    assert await stock_of(client, o, o["sugar"]) == 300 - 90
    assert await stock_of(client, o, o["chips"]) == 1000 - 12
    ledger = (await client.get(f"{o['t']}/stock/ledger", params={"product_id": o["sugar"]["id"]}, headers=o["owner"])).json()
    assert (ledger[0]["reason"], ledger[0]["change_pieces"], ledger[0]["ref_order_id"]) == ("dispatch", -90, order["id"])
    assert ledger[0]["note"] == "Order #1"

    assert (await client.post(url, json={}, headers=o["owner"])).status_code == 409  # no double dispatch
    assert await stock_of(client, o, o["sugar"]) == 210


async def test_dispatch_cannot_exceed_approved(client, o):
    order = await placed_order(client, o)
    await _approve(client, o, order)
    sug = line(order, "Sugar")
    res = await client.post(
        f"{o['t']}/orders/{order['id']}/dispatch", json={"items": [{"item_id": sug["id"], "qty": 5}]}, headers=o["owner"]
    )
    assert res.status_code == 422


async def test_dispatch_short_stock_changes_nothing(client, o):
    order = await placed_order(client, o)  # 4 bags = 120 pieces
    await _approve(client, o, order)
    await client.post(f"{o['t']}/stock/adjust", json={"product_id": o["sugar"]["id"], "set_to": 70}, headers=o["owner"])

    url = f"{o['t']}/orders/{order['id']}/dispatch"
    res = await client.post(url, json={}, headers=o["owner"])
    assert res.status_code == 409
    short = res.json()["detail"]["short"]
    assert len(short) == 1
    assert short[0] | {"item_id": None} == {
        "item_id": None, "product_name": "Madhur Sugar 1 kg", "unit_name": "Bag",
        "qty_wanted": 4, "qty_possible": 2, "pieces_needed": 120, "pieces_available": 70,
    }
    # nothing changed: stock, chips stock, status
    assert await stock_of(client, o, o["sugar"]) == 70
    assert await stock_of(client, o, o["chips"]) == 1000
    assert (await client.get(f"{o['t']}/orders/{order['id']}", headers=o["owner"])).json()["status"] == "approved"

    res = await client.post(url, json={"items": [{"item_id": short[0]["item_id"], "qty": 2}]}, headers=o["owner"])
    assert res.status_code == 200
    assert await stock_of(client, o, o["sugar"]) == 10


async def test_two_dispatches_cannot_oversell(client, o):
    first = await placed_order(client, o, [(o["bag"], 6)])  # needs 180 pieces
    second = await placed_order(client, o, [(o["bag"], 4)])  # needs 120 pieces
    # 200 in stock: either order fits alone, both together don't
    await client.post(f"{o['t']}/stock/adjust", json={"product_id": o["sugar"]["id"], "set_to": 200}, headers=o["owner"])
    for order in (first, second):
        await _approve(client, o, order)
    results = await asyncio.gather(
        *[client.post(f"{o['t']}/orders/{x['id']}/dispatch", json={}, headers=o["owner"]) for x in (first, second)]
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    remaining = await stock_of(client, o, o["sugar"])
    assert remaining in (200 - 180, 200 - 120) and remaining >= 0


async def test_deliver_only_after_dispatch(client, o):
    order = await placed_order(client, o)
    url = f"{o['t']}/orders/{order['id']}/deliver"
    assert (await client.post(url, json={}, headers=o["owner"])).status_code == 409
    await _approve(client, o, order)
    await client.post(f"{o['t']}/orders/{order['id']}/dispatch", json={}, headers=o["owner"])
    res = await client.post(url, json={"note": "Received by Raj"}, headers=o["owner"])
    assert res.json()["status"] == "delivered"
    assert [e["to_status"] for e in res.json()["events"]] == ["pending", "approved", "dispatched", "delivered"]
    assert (await client.post(f"{o['t']}/orders/{order['id']}/cancel", json={}, headers=o["owner"])).status_code == 409


# ---------- viewing, bill, reorder ----------


async def test_lists_and_filters(client, o, make_shop):
    first = await placed_order(client, o)
    await placed_order(client, o, [(o["packet"], 2)])
    await _approve(client, o, first)

    staff = (await client.get(f"{o['t']}/orders", headers=o["owner"])).json()
    assert staff["total"] == 2 and [x["order_no"] for x in staff["items"]] == [2, 1]
    pending = (await client.get(f"{o['t']}/orders", params={"status": "pending"}, headers=o["owner"])).json()
    assert [x["order_no"] for x in pending["items"]] == [2]
    assert (await client.get(f"{o['t']}/orders", params={"status": "nope"}, headers=o["owner"])).status_code == 422

    mine = (await client.get("/shops/me/orders", headers=o["shop"])).json()
    assert mine["total"] == 2 and mine["items"][0]["distributor_name"] == "Gupta Traders"
    assert mine["items"][0]["placed_by_name"] == "+919876543210"
    assert (await client.get("/shops/me/orders", params={"tenant_id": str(o["b"].id)}, headers=o["shop"])).json()["total"] == 0

    # another shop of the same distributor sees none of these
    headers, shop = await make_shop("9123456789")
    await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=headers)
    await client.post(f"{o['t']}/shops/{shop['id']}/approve", headers=o["owner"])
    assert (await client.get(f"{o['t']}/orders", headers=headers)).json()["total"] == 0
    assert (await client.get(f"{o['t']}/orders/{first['id']}", headers=headers)).status_code == 404
    assert (await client.get(f"/shops/me/orders/{first['id']}", headers=headers)).status_code == 404
    assert (await client.post(f"{o['t']}/orders/{first['id']}/cancel", json={}, headers=headers)).status_code == 404
    assert (await client.post(f"{o['t']}/orders/{first['id']}/reorder", headers=headers)).status_code == 404


async def test_blocked_shop_keeps_its_history(client, o):
    order = await placed_order(client, o)
    shop_id = order["shop_id"]
    await client.post(f"{o['t']}/shops/{shop_id}/block", headers=o["owner"])
    assert (await client.get(f"{o['t']}/orders", headers=o["shop"])).status_code == 404
    assert (await client.get("/shops/me/orders", headers=o["shop"])).json()["total"] == 1
    assert (await client.get(f"/shops/me/orders/{order['id']}/bill.pdf", headers=o["shop"])).status_code == 200


async def test_bill_pdf(client, o):
    order = await placed_order(client, o)
    for url, headers in [
        (f"{o['t']}/orders/{order['id']}/bill.pdf", o["owner"]),
        (f"{o['t']}/orders/{order['id']}/bill.pdf", o["shop"]),
        (f"/shops/me/orders/{order['id']}/bill.pdf", o["shop"]),
    ]:
        res = await client.get(url, headers=headers)
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/pdf"
        assert res.content.startswith(b"%PDF") and len(res.content) > 5000
        assert 'filename="order-1.pdf"' in res.headers["content-disposition"]


async def test_reorder(client, o):
    order = await placed_order(client, o)
    await client.put(f"/t/{o['a'].id}/units/{o['bag']}", json={"price": 1300}, headers=o["owner"])
    await client.put(f"{o['t']}/products/{o['chips']['id']}", json={"status": "hidden"}, headers=o["owner"])
    await add(client, o, o["bag"], 1)  # already one bag in the cart

    res = await client.post(f"{o['t']}/orders/{order['id']}/reorder", headers=o["shop"])
    body = res.json()
    assert body["added"] == 1 and body["skipped"] == ["Munch Chips 52 g"]
    assert body["cart"]["items"][0]["qty"] == 5 and body["cart"]["items"][0]["price"] == 1300.0


async def test_product_in_orders_cannot_be_deleted(client, o):
    await placed_order(client, o)
    res = await client.delete(f"{o['t']}/products/{o['sugar']['id']}", headers=o["owner"])
    assert res.status_code == 409 and "hidden" in res.json()["detail"]


# ---------- tenant isolation ----------


async def test_other_distributor_cannot_touch_orders(client, o):
    order = await placed_order(client, o)
    a, b, owner_b = o["a"], o["b"], o["owner_b"]
    oid = order["id"]
    for path in [f"/t/{a.id}/orders", f"/t/{a.id}/orders/{oid}", f"/t/{a.id}/orders/{oid}/bill.pdf"]:
        assert (await client.get(path, headers=owner_b)).status_code == 404, path
    for action in ["approve", "dispatch", "deliver", "cancel"]:
        assert (await client.post(f"/t/{a.id}/orders/{oid}/{action}", json={}, headers=owner_b)).status_code == 404
        assert (await client.post(f"/t/{b.id}/orders/{oid}/{action}", json={}, headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{b.id}/orders/{oid}/reject", json={"reason": "x"}, headers=owner_b)).status_code == 404
    assert (await client.get(f"/t/{b.id}/orders/{oid}", headers=owner_b)).status_code == 404
    assert (await client.get(f"/t/{b.id}/orders/{oid}/bill.pdf", headers=owner_b)).status_code == 404
    assert (await client.get(f"/t/{b.id}/orders", headers=owner_b)).json()["total"] == 0
    assert (await client.get(f"/shops/me/orders/{oid}", headers=owner_b)).status_code == 404  # B owner has no shop

    # A shop can't put B's products in A's cart
    cats = {c["name"].split(" / ")[0]: c["id"] for c in (await client.get(f"/t/{b.id}/categories", headers=owner_b)).json()}
    pb = (await client.post(f"/t/{b.id}/products", json=sugar(cats["Sugar"]), headers=owner_b)).json()
    res = await client.post(f"/t/{a.id}/cart/items", json={"unit_id": pb["units"][0]["id"], "qty": 2}, headers=o["shop"])
    assert res.status_code == 404

    # A's order is untouched
    again = (await client.get(f"/t/{a.id}/orders/{oid}", headers=o["owner"])).json()
    assert again["status"] == "pending" and len(again["events"]) == 1


# ---------- confirm step and shop location ----------


async def test_place_order_with_confirmed_total(client, o):
    await add(client, o, o["bag"], 2)  # 2 x 1290 = 2580
    # buyer saw a different total (price changed meanwhile): refused, cart kept
    res = await client.post(f"{o['t']}/orders", json={"expected_total": 2000}, headers=o["shop"])
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "total_changed" and res.json()["detail"]["total"] == 2580.0
    assert (await client.get(f"{o['t']}/cart", headers=o["shop"])).json()["item_count"] == 1
    res = await client.post(f"{o['t']}/orders", json={"expected_total": 2580}, headers=o["shop"])
    assert res.status_code == 201, res.text


async def test_order_keeps_shop_map_pin(client, o):
    res = await client.put("/shops/me", json={"lat": 26.449923, "lng": 80.331871}, headers=o["shop"])
    assert res.status_code == 200, res.text
    order = await placed_order(client, o)
    assert order["shop_lat"] == 26.449923 and order["shop_lng"] == 80.331871
    shops = (await client.get(f"{o['t']}/shops", headers=o["owner"])).json()
    assert shops[0]["lat"] == 26.449923
    # moving the pin later doesn't change old orders
    await client.put("/shops/me", json={"lat": 25.0, "lng": 80.0}, headers=o["shop"])
    again = (await client.get(f"{o['t']}/orders/{order['id']}", headers=o["owner"])).json()
    assert again["shop_lat"] == 26.449923


async def test_cart_lines_carry_mrp_for_savings(client, o):
    cart = (await add(client, o, o["bag"], 2)).json()
    line = cart["items"][0]
    assert line["mrp"] == 50.0  # per piece; a bag of 30 at 1290 vs MRP 1500 saves 210 a bag
