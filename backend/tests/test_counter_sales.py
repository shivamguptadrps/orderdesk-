"""Counter sales: the distributor sells to a walk-in customer. No shop, no approval, stock goes down at once."""

from tests.test_agents import ag  # noqa: F401  (fixture)
from tests.test_orders import stock_of


async def sell(client, o, items, headers=None, **extra):
    body = {"items": items, "paid": True} | extra
    return await client.post(f"{o['t']}/counter-sales", json=body, headers=headers or o["owner"])


async def test_counter_sale_deducts_stock_and_keeps_rates(client, o):
    before_sugar, before_chips = await stock_of(client, o, o["sugar"]), await stock_of(client, o, o["chips"])
    res = await sell(
        client, o,
        [
            {"unit_id": o["bag"], "qty": 2, "rate": 1250},  # discounted at the counter
            {"unit_id": o["chip_packet"], "qty": 5},  # list price
            {"unit_id": o["chip_packet"], "qty": 1},  # same pack again: merged
        ],
        paid=False, customer_name="  ", customer_phone="98111 22233", note="Cash later",
    )
    assert res.status_code == 201, res.text
    sale = res.json()
    assert (sale["source"], sale["status"], sale["shop_id"], sale["payment_status"]) == ("counter", "delivered", None, "unpaid")
    assert sale["shop_name"] == "Walk-in customer" and sale["shop_phone"] == "98111 22233"
    assert [(i["product_name"], i["qty"], i["rate"]) for i in sale["items"]] == [
        ("Madhur Sugar 1 kg", 2, 1250.0),
        ("Munch Chips 52 g", 6, 17.0),
    ]
    assert sale["items_total"] == 2 * 1250 + 6 * 17
    assert await stock_of(client, o, o["sugar"]) == before_sugar - 60
    assert await stock_of(client, o, o["chips"]) == before_chips - 6

    listed = (await client.get(f"{o['t']}/orders", headers=o["owner"])).json()["items"]
    assert [x["source"] for x in listed] == ["counter"]
    bill = await client.get(f"{o['t']}/orders/{sale['id']}/bill.pdf", headers=o["owner"])
    assert bill.status_code == 200 and bill.content[:4] == b"%PDF"
    ledger = (await client.get(f"{o['t']}/stock/ledger", params={"product_id": o["sugar"]["id"]}, headers=o["owner"])).json()
    assert any(f"Counter sale #{sale['order_no']}" == (e.get("note") or "") for e in (ledger["items"] if isinstance(ledger, dict) else ledger))

    paid = await client.put(f"{o['t']}/orders/{sale['id']}/payment", json={"payment_status": "paid"}, headers=o["owner"])
    assert paid.status_code == 200 and paid.json()["payment_status"] == "paid"
    assert paid.json()["events"][-1]["note"] == "Marked paid"


async def test_counter_sale_blocked_when_stock_is_short(client, o):
    await client.post(f"{o['t']}/stock/adjust", json={"product_id": o["sugar"]["id"], "set_to": 40}, headers=o["owner"])
    res = await sell(client, o, [{"unit_id": o["bag"], "qty": 2}])
    assert res.status_code == 409
    short = res.json()["detail"]["short"]
    assert short[0]["qty_possible"] == 1 and short[0]["pieces_available"] == 40
    assert await stock_of(client, o, o["sugar"]) == 40  # nothing changed
    assert (await client.get(f"{o['t']}/orders", headers=o["owner"])).json()["total"] == 0


async def test_counter_sale_is_for_owner_and_staff_only(client, ag):  # noqa: F811
    item = [{"unit_id": ag["bag"], "qty": 1}]
    assert (await sell(client, ag, item, headers=ag["staff"])).status_code == 201
    assert (await sell(client, ag, item, headers=ag["agent"])).status_code == 403
    assert (await sell(client, ag, item, headers=ag["shop"])).status_code == 403
    # shops never see counter sales
    assert (await client.get("/shops/me/orders", headers=ag["shop"])).json()["total"] == 0
    assert (await client.get(f"{ag['t']}/orders", headers=ag["agent"])).json()["total"] == 0


async def test_counter_sale_tenant_isolation(client, o):
    item = [{"unit_id": o["bag"], "qty": 1}]
    assert (await sell(client, o, item, headers=o["owner_b"])).status_code == 404
    # tenant B can't sell tenant A's packs from its own counter
    res = await client.post(f"/t/{o['b'].id}/counter-sales", json={"items": item, "paid": True}, headers=o["owner_b"])
    assert res.status_code == 404
    sale = (await sell(client, o, item)).json()
    res = await client.put(f"{o['t']}/orders/{sale['id']}/payment", json={"payment_status": "unpaid"}, headers=o["owner_b"])
    assert res.status_code == 404


async def test_reports_count_counter_sales_without_a_shop(client, o):
    await sell(client, o, [{"unit_id": o["bag"], "qty": 1}])
    report = (await client.get(f"{o['t']}/reports", headers=o["owner"])).json()
    assert report["by_source"].get("counter") == 1
    assert all(s["shop_id"] for s in report["top_shops"])
