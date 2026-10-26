import asyncio
import contextlib
import html
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import models as _models  # noqa: F401  (registers all tables)
from app.core.config import get_settings
from app.core.db import get_db
from app.core.media import media_root
from app.modules.auth.router import router as auth_router
from app.modules.catalog import related
from app.modules.catalog.router_banners import router as banners_router
from app.modules.catalog.router_catalog import router as catalog_router
from app.modules.catalog.router_manage import router as catalog_manage_router
from app.modules.inventory.router import router as inventory_router
from app.modules.notifications.router import router as notifications_router
from app.modules.orders.router import router as orders_router
from app.modules.platform.router import router as platform_router
from app.modules.reports.router import router as reports_router
from app.modules.catalog.brands import router as brands_router
from app.modules.shops.router import router as shops_router
from app.modules.tenants.router import router as tenants_router

settings = get_settings()

# Refuse to run on a server with unsafe dev settings.
# "staging" = a real server used for testing: login codes are shown in the app (no WhatsApp yet),
# so it must only hold test data. "prod" = real shops: codes go by WhatsApp only.
if settings.app_env in ("prod", "staging"):
    if settings.jwt_secret in ("", "change-me") or len(settings.jwt_secret) < 32:
        raise RuntimeError("Set a long random JWT_SECRET on a server")
if settings.app_env == "prod" and settings.otp_mode == "log":
    raise RuntimeError("OTP_MODE=log prints codes to the log; use 'whatsapp' in production")



@asynccontextmanager
async def lifespan(_: FastAPI):
    """Background jobs that live as long as the API process (one API container in production)."""
    job = None
    if settings.related_job_enabled and settings.app_env != "test":
        job = asyncio.create_task(related.nightly_loop(settings.related_job_hour_ist))
    yield
    if job:
        job.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await job


app = FastAPI(title="OrderDesk API", version="0.1.0", lifespan=lifespan)

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
app.include_router(banners_router)
app.include_router(inventory_router)
app.include_router(orders_router)
app.include_router(notifications_router)
app.include_router(reports_router)
app.include_router(brands_router)
app.include_router(platform_router)
class _MediaFiles(StaticFiles):
    """Photos get a new random name whenever they change, so phones and browsers can keep them for a year."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app.mount(settings.media_url_prefix, _MediaFiles(directory=media_root()), name="media")


IMPORT_PAGE = Path(__file__).parent / "assets" / "import.html"


@app.get("/import", include_in_schema=False, response_class=HTMLResponse)
async def import_page() -> HTMLResponse:
    """Excel import page for distributors (open on a computer)."""
    return HTMLResponse(IMPORT_PAGE.read_text(encoding="utf-8"))


def _page(name: str) -> HTMLResponse:
    """A page from app/assets with the support contact filled in."""
    email = settings.support_email.strip()
    support = f'<a href="mailto:{html.escape(email)}">{html.escape(email)}</a>' if email else "the contact email on our Play Store page"
    return HTMLResponse((Path(__file__).parent / "assets" / name).read_text(encoding="utf-8").replace("{{SUPPORT}}", support))


@app.get("/privacy", include_in_schema=False, response_class=HTMLResponse)
async def privacy_page() -> HTMLResponse:
    """Privacy policy (linked from the Play Store listing)."""
    return _page("privacy.html")


@app.get("/delete-account", include_in_schema=False, response_class=HTMLResponse)
async def delete_account_page() -> HTMLResponse:
    """Account deletion without the app (Play Store rule)."""
    return _page("delete-account.html")


def _web_root() -> Path | None:
    if not settings.web_dir:
        return None
    root = Path(settings.web_dir).resolve()
    return root if (root / "index.html").is_file() else None


@app.get("/", include_in_schema=False)
async def root(request: Request):
    """A browser opening the site goes to the web app; anything else gets a small API summary."""
    if _web_root() and "text/html" in request.headers.get("accept", ""):
        return RedirectResponse("/app/", status_code=302)
    return {"app": "OrderDesk API", "health": "/health", "docs": "/docs", "excel_import": "/import", "web_app": "/app/"}


@app.get("/app", include_in_schema=False)
@app.get("/app/{path:path}", include_in_schema=False)
async def web_app(path: str = ""):
    """The web version of the app (for distributors on a laptop). Unknown paths get index.html,
    so links like /app/manage/shops work when opened directly."""
    root = _web_root()
    if root is None:
        return HTMLResponse("Web app is not installed on this server.", status_code=404)
    target = (root / path).resolve()
    if path and target.is_file() and target.is_relative_to(root):
        # Built files have a content hash in their name, so they can be cached for a long time.
        long_cache = "/_expo/" in f"/{path}" or path.startswith("assets/")
        return FileResponse(target, headers={"Cache-Control": "public, max-age=31536000, immutable" if long_cache else "no-cache"})
    return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/health", tags=["health"])
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    """Used by the mobile app to show 'API OK'. Also checks the database."""
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok", "db": "ok" if db_ok else "down", "env": settings.app_env}
