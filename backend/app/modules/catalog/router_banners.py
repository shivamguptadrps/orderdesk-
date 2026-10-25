"""Offer banners on the shop home screen.

Shops: GET /t/{t}/catalog/banners (active only). Owner/staff: /t/{t}/banners to add, edit, reorder and delete.
A banner is a photo, or just a title + subtitle on a colour (for distributors without designed images).
"""

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.media import BANNER_SIZES, MAX_UPLOAD_BYTES, delete_image, save_image
from app.core.tenancy import STAFF_ROLES, TenantContext, get_tenant_context, require_roles
from app.modules.catalog.models import Banner
from app.modules.catalog.service import get_category_or_404

router = APIRouter(tags=["banners"])
_staff = require_roles(*STAFF_ROLES)
MAX_BANNERS = 20
HEX = r"^#[0-9A-Fa-f]{6}$"


class BannerOut(BaseModel):
    id: uuid.UUID
    title: str | None
    subtitle: str | None
    image_url: str | None
    color: str | None
    link_category_id: uuid.UUID | None
    is_active: bool
    sort_order: int

    model_config = {"from_attributes": True}


class BannerIn(BaseModel):
    title: str | None = Field(default=None, max_length=80, examples=["Diwali offer: 5% off on sugar"])
    subtitle: str | None = Field(default=None, max_length=140)
    color: str | None = Field(default=None, pattern=HEX)
    link_category_id: uuid.UUID | None = None
    is_active: bool = True


class BannerUpdate(BaseModel):
    """Send only what changes. Send null to clear a field."""

    title: str | None = Field(default=None, max_length=80)
    subtitle: str | None = Field(default=None, max_length=140)
    color: str | None = Field(default=None, pattern=HEX)
    link_category_id: uuid.UUID | None = None
    is_active: bool | None = None


class OrderIn(BaseModel):
    ids: list[uuid.UUID] = Field(description="Banner ids in the order to show them")


def _clean(text: str | None) -> str | None:
    return (text or "").strip() or None


async def _get(db: AsyncSession, tenant_id: uuid.UUID, banner_id: uuid.UUID) -> Banner:
    banner = await db.scalar(select(Banner).where(Banner.id == banner_id, Banner.tenant_id == tenant_id))
    if banner is None:
        raise HTTPException(404, "Banner not found")
    return banner


async def _list(db: AsyncSession, tenant_id: uuid.UUID, active_only: bool) -> list[Banner]:
    query = select(Banner).where(Banner.tenant_id == tenant_id)
    if active_only:
        query = query.where(Banner.is_active.is_(True))
    return list(await db.scalars(query.order_by(Banner.sort_order, Banner.created_at)))


async def _next_sort(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    count = await db.scalar(select(func.count()).select_from(Banner).where(Banner.tenant_id == tenant_id))
    if count >= MAX_BANNERS:
        raise HTTPException(422, f"You can have up to {MAX_BANNERS} banners. Delete an old one first.")
    return (await db.scalar(select(func.max(Banner.sort_order)).where(Banner.tenant_id == tenant_id)) or 0) + 1


@router.get("/t/{tenant_id}/catalog/banners", response_model=list[BannerOut])
async def shop_banners(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    """Active banners for the home screen, in order."""
    return await _list(db, ctx.tenant_id, active_only=True)


@router.get("/t/{tenant_id}/banners", response_model=list[BannerOut])
async def list_banners(ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    return await _list(db, ctx.tenant_id, active_only=False)


@router.post("/t/{tenant_id}/banners", response_model=BannerOut, status_code=201)
async def create_banner(body: BannerIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """A text banner (title on a colour). Add a photo afterwards with POST .../image if you like."""
    title = _clean(body.title)
    if title is None:
        raise HTTPException(422, "Add a title, or create a photo banner with POST /banners/photo")
    if body.link_category_id:
        await get_category_or_404(db, ctx.tenant_id, body.link_category_id)
    banner = Banner(
        tenant_id=ctx.tenant_id,
        title=title,
        subtitle=_clean(body.subtitle),
        color=body.color,
        link_category_id=body.link_category_id,
        is_active=body.is_active,
        sort_order=await _next_sort(db, ctx.tenant_id),
    )
    db.add(banner)
    await db.commit()
    return banner


@router.post("/t/{tenant_id}/banners/photo", response_model=BannerOut, status_code=201)
async def create_photo_banner(
    file: UploadFile = File(description="Wide photo, best 2:1 (e.g. 1400 x 700). JPG, PNG or WebP, max 8 MB"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """A banner made from a designed image (offer poster, brand ad)."""
    sort = await _next_sort(db, ctx.tenant_id)
    url = save_image(ctx.tenant_id, await file.read(MAX_UPLOAD_BYTES + 1), "banners", BANNER_SIZES)
    banner = Banner(tenant_id=ctx.tenant_id, image_url=url, sort_order=sort)
    db.add(banner)
    await db.commit()
    return banner


@router.put("/t/{tenant_id}/banners/{banner_id}", response_model=BannerOut)
async def update_banner(
    banner_id: uuid.UUID, body: BannerUpdate, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    banner = await _get(db, ctx.tenant_id, banner_id)
    data = body.model_dump(exclude_unset=True)
    if "link_category_id" in data and data["link_category_id"]:
        await get_category_or_404(db, ctx.tenant_id, data["link_category_id"])
    for field in ("title", "subtitle"):
        if field in data:
            data[field] = _clean(data[field])
    if "is_active" in data and data["is_active"] is None:
        del data["is_active"]
    for field, value in data.items():
        setattr(banner, field, value)
    if banner.title is None and banner.image_url is None:
        raise HTTPException(422, "A banner needs a title or a photo")
    await db.commit()
    return banner


@router.post("/t/{tenant_id}/banners/{banner_id}/image", response_model=BannerOut)
async def set_banner_image(
    banner_id: uuid.UUID,
    file: UploadFile = File(description="Wide photo, best 2:1. JPG, PNG or WebP, max 8 MB"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    banner = await _get(db, ctx.tenant_id, banner_id)
    old = banner.image_url
    banner.image_url = save_image(ctx.tenant_id, await file.read(MAX_UPLOAD_BYTES + 1), "banners", BANNER_SIZES)
    await db.commit()
    if old:
        delete_image(ctx.tenant_id, old, "banners")
    return banner


@router.delete("/t/{tenant_id}/banners/{banner_id}/image", response_model=BannerOut)
async def remove_banner_image(banner_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Back to a text banner. Needs a title first."""
    banner = await _get(db, ctx.tenant_id, banner_id)
    if banner.title is None:
        raise HTTPException(422, "Add a title before removing the photo, or delete the banner")
    old, banner.image_url = banner.image_url, None
    await db.commit()
    if old:
        delete_image(ctx.tenant_id, old, "banners")
    return banner


@router.delete("/t/{tenant_id}/banners/{banner_id}", status_code=204)
async def delete_banner(banner_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    banner = await _get(db, ctx.tenant_id, banner_id)
    image = banner.image_url
    await db.delete(banner)
    await db.commit()
    if image:
        delete_image(ctx.tenant_id, image, "banners")


@router.put("/t/{tenant_id}/banners-order", response_model=list[BannerOut])
async def reorder_banners(body: OrderIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Set the display order. Send every banner id once."""
    banners = {b.id: b for b in await _list(db, ctx.tenant_id, active_only=False)}
    if set(body.ids) != set(banners) or len(body.ids) != len(banners):
        raise HTTPException(422, "Send each of your banner ids exactly once")
    for position, banner_id in enumerate(body.ids, start=1):
        banners[banner_id].sort_order = position
    await db.commit()
    return await _list(db, ctx.tenant_id, active_only=False)
