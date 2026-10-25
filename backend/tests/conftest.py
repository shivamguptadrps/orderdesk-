"""Test setup: a fresh `orderdesk_test` database built by running the Alembic migrations.

Tables are emptied after every test. Override the URL with TEST_DATABASE_URL if needed.
"""

import asyncio
import os
import tempfile
from pathlib import Path

# Must be set before any `app` import, because settings and the engine are created at import time.
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"
os.environ["OTP_MODE"] = "log"
os.environ["PUSH_MODE"] = "log"
os.environ["RELATED_JOB_ENABLED"] = "false"
# Laptop .env may turn these on; tests start from a known state.
os.environ["WEB_DIR"] = ""
os.environ["PLATFORM_ADMIN_PHONES"] = ""
os.environ["PLATFORM_ADMIN_KEY"] = ""
os.environ["MEDIA_DIR"] = tempfile.mkdtemp(prefix="orderdesk-media-")
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://orderdesk:orderdesk_dev@localhost:5432/orderdesk_test"
)

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import make_url, text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.core import security  # noqa: E402
from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.tenants.models import Tenant, TenantMember  # noqa: E402
from app.modules.tenants.service import create_tenant, get_or_create_user  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent
TEST_OTP = "123456"


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    url = make_url(os.environ["DATABASE_URL"])

    async def recreate() -> None:
        admin = create_async_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
            await conn.execute(text(f'CREATE DATABASE "{url.database}"'))
        await admin.dispose()

    asyncio.run(recreate())
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
async def _clean_tables():
    yield
    names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {names} CASCADE"))


@pytest.fixture(autouse=True)
def _fixed_otp(monkeypatch):
    monkeypatch.setattr(security, "generate_otp", lambda: TEST_OTP)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def login(client):
    """`headers = await login("9876543210")` -> auth headers for that phone."""

    async def _login(phone: str) -> dict:
        res = await client.post("/auth/otp/request", json={"phone": phone})
        assert res.status_code == 202, res.text
        res = await client.post("/auth/otp/verify", json={"phone": phone, "code": TEST_OTP})
        assert res.status_code == 200, res.text
        return {"Authorization": f"Bearer {res.json()['access_token']}"}

    return _login


@pytest.fixture
def make_tenant():
    """`tenant = await make_tenant("Gupta Traders", owner_phone="9000000001")`"""

    async def _make(name: str, owner_phone: str, join_code: str | None = None) -> Tenant:
        from app.core.phone import normalize_phone

        async with SessionLocal() as db:
            tenant = await create_tenant(db, name=name, owner_phone=normalize_phone(owner_phone), join_code=join_code)
            await db.commit()
            return tenant

    return _make


@pytest.fixture
def add_member():
    async def _add(tenant: Tenant, phone: str, role: str):
        from app.core.phone import normalize_phone

        async with SessionLocal() as db:
            user = await get_or_create_user(db, normalize_phone(phone))
            db.add(TenantMember(tenant_id=tenant.id, user_id=user.id, role=role))
            await db.commit()
            return user

    return _add


SHOP = {
    "shop_name": "Sharma Kirana Store",
    "owner_name": "Raj Sharma",
    "address": "12 Main Bazaar",
    "city": "Kanpur",
    "pincode": "208001",
}


@pytest.fixture
def make_shop(client, login):
    """Log in as `phone`, create a shop profile; returns (headers, shop_json)."""

    async def _make(phone: str, **overrides):
        headers = await login(phone)
        res = await client.post("/shops", json={**SHOP, **overrides}, headers=headers)
        assert res.status_code == 201, res.text
        return headers, res.json()

    return _make


# ---------- catalog fixtures (M2) ----------

CAT_OWNER_A = "9000000001"
CAT_OWNER_B = "9000000002"
CAT_SHOP = "9876543210"


@pytest.fixture
async def cat(client, login, make_tenant, make_shop):
    """Tenant A (FMCG template) with an approved shop, tenant B. Returns handy values."""
    a = await make_tenant("Gupta Traders", owner_phone=CAT_OWNER_A, join_code="GUPTA7")
    b = await make_tenant("Verma Agencies", owner_phone=CAT_OWNER_B, join_code="VERMA8")
    owner = await login(CAT_OWNER_A)
    shop_headers, shop = await make_shop(CAT_SHOP)
    await client.post("/shops/me/distributors", json={"join_code": "GUPTA7"}, headers=shop_headers)
    await client.post(f"/t/{a.id}/shops/{shop['id']}/approve", headers=owner)
    cats = (await client.get(f"/t/{a.id}/categories", headers=owner)).json()
    ids = {c["name"]: c["id"] for c in cats}
    return {"a": a, "b": b, "owner": owner, "owner_b": await login(CAT_OWNER_B), "shop": shop_headers, "ids": ids}


def sugar(category_id, **over):
    body = {
        "category_id": category_id,
        "name": "Madhur Sugar 1 kg",
        "brand": "Madhur",
        "search_aliases": "cheeni, chini, शक्कर",
        "sku": "MAD-SUG-1",
        "mrp": 50,
        "attributes": {"weight_kg": 1, "grain": "medium"},
        "units": [
            {"name": "Packet", "pieces_per_unit": 1, "price": 45, "min_qty": 2},
            {"name": "Bag", "pieces_per_unit": 30, "price": 1290, "is_default": True},
        ],
        "opening_stock_pieces": 300,
    }
    return body | over


# ---------- order fixtures (M3) ----------


@pytest.fixture
async def o(client, cat):
    """`cat` (tenant A + approved shop) plus two products and handy URL helpers."""
    a = cat["a"]

    async def create(body):
        res = await client.post(f"/t/{a.id}/products", json=body, headers=cat["owner"])
        assert res.status_code == 201, res.text
        return res.json()

    sug = await create(sugar(cat["ids"]["Sugar"]))  # Packet: 1 pc, min 2, ₹45 · Bag: 30 pcs, ₹1290 · stock 300
    chips = await create(
        sugar(
            cat["ids"]["Chips"], name="Munch Chips 52 g", brand="Munch", sku="CHIP", search_aliases=None,
            attributes={"weight_g": 52},
            units=[{"name": "Packet", "pieces_per_unit": 1, "price": 17, "step_qty": 6, "max_qty": 600}],
            opening_stock_pieces=1000,
        )
    )
    unit = lambda p, name: next(u["id"] for u in p["units"] if u["name"] == name)  # noqa: E731
    return cat | {
        "t": f"/t/{a.id}",
        "sugar": sug,
        "chips": chips,
        "packet": unit(sug, "Packet"),
        "bag": unit(sug, "Bag"),
        "chip_packet": unit(chips, "Packet"),
    }
