"""Test setup: a fresh `orderdesk_test` database built by running the Alembic migrations.

Tables are emptied after every test. Override the URL with TEST_DATABASE_URL if needed.
"""

import asyncio
import os
from pathlib import Path

# Must be set before any `app` import, because settings and the engine are created at import time.
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"
os.environ["OTP_MODE"] = "log"
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
