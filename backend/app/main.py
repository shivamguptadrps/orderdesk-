from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import models as _models  # noqa: F401  (registers all tables)
from app.core.config import get_settings
from app.core.db import get_db
from app.core.media import media_root
from app.modules.auth.router import router as auth_router
from app.modules.catalog.router_catalog import router as catalog_router
from app.modules.catalog.router_manage import router as catalog_manage_router
from app.modules.inventory.router import router as inventory_router
from app.modules.shops.router import router as shops_router
from app.modules.tenants.router import router as tenants_router

settings = get_settings()

# Refuse to run in production with unsafe dev settings.
if settings.app_env == "prod":
    if settings.jwt_secret in ("", "change-me") or len(settings.jwt_secret) < 32:
        raise RuntimeError("Set a long random JWT_SECRET for production")
    if settings.otp_mode == "log":
        raise RuntimeError("OTP_MODE=log prints codes to the log; use 'whatsapp' in production")

app = FastAPI(title="OrderDesk API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_env == "dev" else [],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(shops_router)
app.include_router(tenants_router)
app.include_router(catalog_manage_router)
app.include_router(catalog_router)
app.include_router(inventory_router)
app.mount(settings.media_url_prefix, StaticFiles(directory=media_root()), name="media")


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"app": "OrderDesk API", "health": "/health", "docs": "/docs"}


@app.get("/health", tags=["health"])
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    """Used by the mobile app to show 'API OK'. Also checks the database."""
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok", "db": "ok" if db_ok else "down", "env": settings.app_env}
