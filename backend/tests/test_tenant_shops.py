"""Distributor-side shop management, including tenant isolation."""

import pytest

OWNER_A = "9000000001"
OWNER_B = "9000000002"
SHOP_PHONE = "9876543210"


@pytest.fixture
async def setup(client, login, make_tenant, make_shop):
    """Tenant A with a pending shop, tenant B with nothing. Returns a dict of handy values."""
    tenant_a = await make_tenant("Gupta Traders", owner_phone=OWNER_A, join_code="GUPTA7")
    tenant_b = await make_tenant("Verma Agencies", owner_phone=OWNER_B, join_code="VERMA8")
    shop_headers, shop = await make_shop(SHOP_PHONE)
    res = await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=shop_headers)
    assert res.status_code == 201
    return {
        "a": tenant_a,
        "b": tenant_b,
        "owner_a": await login(OWNER_A),
        "owner_b": await login(OWNER_B),
        "shop_headers": shop_headers,
        "shop_id": shop["id"],
    }


async def test_owner_sees_and_approves_pending_shop(client, setup):
    a, owner = setup["a"], setup["owner_a"]
    pending = (await client.get(f"/t/{a.id}/shops?status=pending", headers=owner)).json()
    assert len(pending) == 1
    assert pending[0]["owner_phone"] == "+919876543210"
    assert pending[0]["status"] == "pending"

    res = await client.post(f"/t/{a.id}/shops/{setup['shop_id']}/approve", headers=owner)
    assert res.status_code == 200
    assert res.json()["status"] == "active"

    assert (await client.get(f"/t/{a.id}/shops?status=pending", headers=owner)).json() == []
    mine = (await client.get("/shops/me/distributors", headers=setup["shop_headers"])).json()
    assert mine[0]["status"] == "active"


async def test_invalid_status_filter(client, setup):
    res = await client.get(f"/t/{setup['a'].id}/shops?status=weird", headers=setup["owner_a"])
    assert res.status_code == 422


async def test_shop_gets_tenant_access_only_after_approval(client, setup):
    a, shop_headers = setup["a"], setup["shop_headers"]
    assert (await client.get(f"/t/{a.id}", headers=shop_headers)).status_code == 404

    await client.post(f"/t/{a.id}/shops/{setup['shop_id']}/approve", headers=setup["owner_a"])
    res = await client.get(f"/t/{a.id}", headers=shop_headers)
    assert res.status_code == 200
    assert res.json()["my_role"] == "shop"
    assert res.json()["join_code"] is None  # only owner/staff see the code

    # a shop cannot use distributor admin endpoints
    assert (await client.get(f"/t/{a.id}/shops", headers=shop_headers)).status_code == 403


async def test_blocked_shop_loses_access(client, setup):
    a, owner = setup["a"], setup["owner_a"]
    await client.post(f"/t/{a.id}/shops/{setup['shop_id']}/approve", headers=owner)
    res = await client.post(f"/t/{a.id}/shops/{setup['shop_id']}/block", headers=owner)
    assert res.json()["status"] == "blocked"
    assert (await client.get(f"/t/{a.id}", headers=setup["shop_headers"])).status_code == 404


async def test_owner_sees_join_code(client, setup):
    res = await client.get(f"/t/{setup['a'].id}", headers=setup["owner_a"])
    assert res.json()["join_code"] == "GUPTA7"
    assert res.json()["my_role"] == "owner"


# ---------- tenant isolation: tenant B must never touch tenant A ----------


async def test_other_tenant_owner_gets_404(client, setup):
    a, shop_id, owner_b = setup["a"], setup["shop_id"], setup["owner_b"]
    assert (await client.get(f"/t/{a.id}", headers=owner_b)).status_code == 404
    assert (await client.get(f"/t/{a.id}/shops", headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{a.id}/shops/{shop_id}/approve", headers=owner_b)).status_code == 404
    assert (await client.post(f"/t/{a.id}/shops/{shop_id}/block", headers=owner_b)).status_code == 404
    res = await client.put(f"/t/{a.id}/shops/{shop_id}/agent", json={"agent_user_id": None}, headers=owner_b)
    assert res.status_code == 404


async def test_other_tenant_cannot_reach_shop_through_own_tenant(client, setup):
    """B's owner uses B's URL with A's shop id: the shop is not linked to B, so 404."""
    b, shop_id, owner_b = setup["b"], setup["shop_id"], setup["owner_b"]
    assert (await client.get(f"/t/{b.id}/shops", headers=owner_b)).json() == []
    assert (await client.post(f"/t/{b.id}/shops/{shop_id}/approve", headers=owner_b)).status_code == 404


async def test_unknown_tenant_404(client, setup):
    res = await client.get("/t/00000000-0000-0000-0000-000000000000/shops", headers=setup["owner_a"])
    assert res.status_code == 404


# ---------- agents ----------


async def test_assign_agent(client, setup, add_member):
    a, owner, shop_id = setup["a"], setup["owner_a"], setup["shop_id"]
    agent = await add_member(a, "9111111111", "agent")
    staff = await add_member(a, "9222222222", "staff")

    res = await client.put(f"/t/{a.id}/shops/{shop_id}/agent", json={"agent_user_id": str(staff.id)}, headers=owner)
    assert res.status_code == 400

    res = await client.put(f"/t/{a.id}/shops/{shop_id}/agent", json={"agent_user_id": str(agent.id)}, headers=owner)
    assert res.status_code == 200
    assert res.json()["agent_user_id"] == str(agent.id)

    res = await client.put(f"/t/{a.id}/shops/{shop_id}/agent", json={"agent_user_id": None}, headers=owner)
    assert res.json()["agent_user_id"] is None


async def test_agent_of_other_tenant_cannot_be_assigned(client, setup, add_member):
    a, b, owner, shop_id = setup["a"], setup["b"], setup["owner_a"], setup["shop_id"]
    agent_b = await add_member(b, "9333333333", "agent")
    res = await client.put(f"/t/{a.id}/shops/{shop_id}/agent", json={"agent_user_id": str(agent_b.id)}, headers=owner)
    assert res.status_code == 400


async def test_staff_can_manage_but_agent_cannot(client, login, setup, add_member):
    a, shop_id = setup["a"], setup["shop_id"]
    await add_member(a, "9222222222", "staff")
    await add_member(a, "9111111111", "agent")
    staff_headers = await login("9222222222")
    agent_headers = await login("9111111111")

    assert (await client.post(f"/t/{a.id}/shops/{shop_id}/approve", headers=staff_headers)).status_code == 200
    assert (await client.get(f"/t/{a.id}/shops", headers=agent_headers)).status_code == 403
