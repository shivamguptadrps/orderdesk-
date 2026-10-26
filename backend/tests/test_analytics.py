"""Richer reports: channels, payments, categories, busy hours, every agent, quiet shops, and one agent's report."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.core.db import SessionLocal
from app.modules.orders.models import Order
from tests.test_agents import ag, agent_order  # noqa: F401  (fixture)


async def dispatch(client, ag, order):  # noqa: F811
    t = ag["t"]
    await client.post(f"{t}/orders/{order['id']}/approve", json={"items": []}, headers=ag["owner"])
    res = await client.post(f"{t}/orders/{order['id']}/dispatch", json={"items": []}, headers=ag["owner"])
    assert res.status_code == 200, res.text


async def move_back(order_id, days):
    async with SessionLocal() as db:
        when = datetime.now(timezone.utc) - timedelta(days=days)
        await db.execute(update(Order).where(Order.id == order_id).values(created_at=when))
        await db.commit()


async def test_report_analytics(client, ag):  # noqa: F811
    t = ag["t"]
    order = await agent_order(client, ag)  # Ravi: 2 bags = 2580
    await dispatch(client, ag, order)  # goods out, not paid
    sale = await client.post(f"{t}/counter-sales", json={"items": [{"unit_id": ag["bag"], "qty": 1}], "paid": True}, headers=ag["owner"])
    assert sale.status_code == 201

    r = (await client.get(f"{t}/reports", params={"days": 7}, headers=ag["staff"])).json()
    assert r["value"] == 2580 + 1290 and r["prev_value"] == 0 and r["prev_orders"] == 0
    assert [(c["source"], c["orders"], c["value"]) for c in r["channels"]] == [("agent", 1, 2580.0), ("counter", 1, 1290.0)]
    assert r["payments"] == {"paid_value": 1290.0, "unpaid_value": 2580.0, "unpaid_orders": 1}
    assert [(c["name"], c["value"]) for c in r["top_categories"]] == [("Ration / राशन", 3870.0)]
    assert sum(h["orders"] for h in r["by_hour"]) == 2 and all(0 <= h["hour"] <= 23 for h in r["by_hour"])

    agents = {a["name"]: a for a in r["agents"]}
    ravi = agents["Ravi Agent"]
    assert (ravi["orders"], ravi["value"], ravi["shops_ordered"], ravi["assigned_shops"]) == (1, 2580.0, 1, 1)
    assert ravi["share"] == round(100 * 2580 / 3870, 1) and ravi["last_order_at"]
    idle = next(a for a in r["agents"] if a["user_id"] == ag["agent2_id"])
    assert (idle["orders"], idle["value"], idle["assigned_shops"], idle["last_order_at"]) == (0, 0.0, 0, None)
    assert r["agents"][0]["name"] == "Ravi Agent"  # best seller first
    assert r["quiet_shops"] == [] and r["quiet_shops_total"] == 0


async def test_quiet_shops_and_previous_period(client, ag):  # noqa: F811
    t = ag["t"]
    old = await agent_order(client, ag)
    await move_back(old["id"], 10)  # ordered 10 days ago, nothing since

    week = (await client.get(f"{t}/reports", params={"days": 7}, headers=ag["owner"])).json()
    assert week["orders"] == 0 and week["prev_orders"] == 1 and week["prev_value"] == 2580.0
    assert [(s["name"], s["agent_name"]) for s in week["quiet_shops"]] == [("Sharma Kirana Store", "Ravi Agent")]
    assert week["quiet_shops_total"] == 1
    month = (await client.get(f"{t}/reports", params={"days": 30}, headers=ag["owner"])).json()
    assert month["quiet_shops"] == [] and month["orders"] == 1

    one = (await client.get(f"{t}/reports/agents/{ag['agent_id']}", params={"days": 7}, headers=ag["owner"])).json()
    assert one["agent"]["orders"] == 0 and one["agent"]["last_order_at"]
    assert [(s["name"], s["last_order_at"] is not None) for s in one["idle_shops"]] == [("Sharma Kirana Store", True)]


async def test_agent_report(client, ag):  # noqa: F811
    t = ag["t"]
    await agent_order(client, ag, qty=3)
    res = await client.get(f"{t}/reports/agents/{ag['agent_id']}", params={"days": 30}, headers=ag["staff"])
    assert res.status_code == 200, res.text
    one = res.json()
    assert (one["agent"]["name"], one["agent"]["orders"], one["agent"]["value"]) == ("Ravi Agent", 1, 3870.0)
    assert len(one["by_day"]) == 30 and one["by_day"][-1]["value"] == 3870.0
    assert [(s["name"], s["orders"]) for s in one["top_shops"]] == [("Sharma Kirana Store", 1)]
    assert [p["name"] for p in one["top_products"]] == ["Madhur Sugar 1 kg"]
    assert one["idle_shops"] == []  # their only shop ordered

    # someone who isn't an agent here, other tenants, shops and agents themselves can't see it
    assert (await client.get(f"{t}/reports/agents/{ag['agent_id']}", params={"days": 9}, headers=ag["owner"])).status_code == 422
    staff_id = (await client.get("/me", headers=ag["staff"])).json()["id"]
    assert (await client.get(f"{t}/reports/agents/{staff_id}", headers=ag["owner"])).status_code == 404
    assert (await client.get(f"{t}/reports/agents/{ag['agent_id']}", headers=ag["owner_b"])).status_code == 404
    assert (await client.get(f"{t}/reports/agents/{ag['agent_id']}", headers=ag["agent"])).status_code == 403
    assert (await client.get(f"{t}/reports/agents/{ag['agent_id']}", headers=ag["shop"])).status_code == 403
