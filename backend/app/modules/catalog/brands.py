"""Brands per distributor: one clean name (+ other spellings) instead of free text on every product.

Products keep a plain `brand` text (old apps and search use it), always equal to their brand's name.
Typed brand names are matched ignoring case and spacing, and against each brand's other spellings
("पंसारी", "pansari group" -> Pansari), so the same brand isn't created twice.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.tenancy import STAFF_ROLES, TenantContext, get_tenant_context, require_roles
from app.modules.catalog.models import Brand, Product, ProductUnit
from app.modules.catalog.service import refresh_search_words

router = APIRouter(tags=["catalog: brands"])
_staff = require_roles(*STAFF_ROLES)


def brand_key(text: str) -> str:
    """'  PANSARI   Group ' -> 'pansari group'."""
    return " ".join((text or "").lower().split())


def alias_list(raw: str | None) -> list[str]:
    return [a.strip() for a in (raw or "").replace("\n", ",").split(",") if a.strip()]


async def brand_lookup(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Brand]:
    """Every name and other spelling (normalised) -> its brand."""
    lookup: dict[str, Brand] = {}
    for b in await db.scalars(select(Brand).where(Brand.tenant_id == tenant_id)):
        lookup[b.name_key] = b
        for a in alias_list(b.aliases):
            lookup.setdefault(brand_key(a), b)
    return lookup


async def resolve_brand(db: AsyncSession, tenant_id: uuid.UUID, text: str | None, lookup: dict | None = None) -> Brand | None:
    """The brand for a typed name, created if it's new. Empty text -> None."""
    key = brand_key(text or "")
    if not key:
        return None
    lookup = lookup if lookup is not None else await brand_lookup(db, tenant_id)
    if key in lookup:
        return lookup[key]
    brand = Brand(tenant_id=tenant_id, name=" ".join(text.split())[:100], name_key=key[:100])
    db.add(brand)
    await db.flush()
    lookup[key] = brand
    return brand


def set_brand(product: Product, brand: Brand | None) -> None:
    product.brand_id = brand.id if brand else None
    product.brand = brand.name if brand else None


async def expand_brand_words(db: AsyncSession, tenant_id: uuid.UUID, q: str) -> str:
    """Search help: a brand's other spelling in the query is swapped for its name ("पंसारी पोहा" -> "pansari पोहा")."""
    lookup = await brand_lookup(db, tenant_id)
    out = f" {q} "
    for alias in sorted(lookup, key=len, reverse=True):
        brand = lookup[alias]
        if alias != brand.name_key and f" {alias} " in out:
            out = out.replace(f" {alias} ", f" {brand.name_key} ")
    return out.strip()


# ---------- API ----------


class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=100, examples=["Pansari"])
    aliases: str | None = Field(default=None, max_length=1000, examples=["पंसारी, pansari group"])


class BrandUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    aliases: str | None = Field(default=None, max_length=1000)


class BrandOut(BaseModel):
    id: uuid.UUID
    name: str
    aliases: str | None
    product_count: int = 0


class MergeIn(BaseModel):
    into_id: uuid.UUID


async def _get(db: AsyncSession, tenant_id: uuid.UUID, brand_id: uuid.UUID) -> Brand:
    brand = await db.scalar(select(Brand).where(Brand.id == brand_id, Brand.tenant_id == tenant_id))
    if brand is None:
        raise HTTPException(404, "Brand not found")
    return brand


async def _check_free(db: AsyncSession, tenant_id: uuid.UUID, names: list[str], skip: uuid.UUID | None = None) -> None:
    lookup = await brand_lookup(db, tenant_id)
    for n in names:
        other = lookup.get(brand_key(n))
        if other is not None and other.id != skip:
            raise HTTPException(409, f"“{n}” is already used by the brand {other.name}")


async def _out(db: AsyncSession, brands: list[Brand]) -> list[BrandOut]:
    counts = dict(
        (await db.execute(
            select(Product.brand_id, func.count()).where(Product.brand_id.in_([b.id for b in brands])).group_by(Product.brand_id)
        )).all()
    ) if brands else {}
    return [BrandOut(id=b.id, name=b.name, aliases=b.aliases, product_count=counts.get(b.id, 0)) for b in brands]


@router.get("/t/{tenant_id}/brands", response_model=list[BrandOut])
async def list_brands(ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    brands = (await db.scalars(select(Brand).where(Brand.tenant_id == ctx.tenant_id).order_by(Brand.name_key))).all()
    return await _out(db, list(brands))


@router.post("/t/{tenant_id}/brands", response_model=BrandOut, status_code=201)
async def create_brand(body: BrandIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    aliases = alias_list(body.aliases)
    await _check_free(db, ctx.tenant_id, [body.name, *aliases])
    brand = Brand(tenant_id=ctx.tenant_id, name=" ".join(body.name.split()), name_key=brand_key(body.name), aliases=", ".join(aliases) or None)
    db.add(brand)
    await db.commit()
    return (await _out(db, [brand]))[0]


@router.put("/t/{tenant_id}/brands/{brand_id}", response_model=BrandOut)
async def update_brand(brand_id: uuid.UUID, body: BrandUpdate, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Rename (all its products follow) or change its other spellings."""
    brand = await _get(db, ctx.tenant_id, brand_id)
    data = body.model_dump(exclude_unset=True)
    names = ([data["name"]] if data.get("name") else []) + alias_list(data.get("aliases"))
    await _check_free(db, ctx.tenant_id, names, skip=brand.id)
    if data.get("name"):
        brand.name, brand.name_key = " ".join(data["name"].split()), brand_key(data["name"])
        await db.execute(update(Product).where(Product.brand_id == brand.id).values(brand=brand.name))
    if "aliases" in data:
        brand.aliases = ", ".join(alias_list(data["aliases"])) or None
    await db.flush()
    await refresh_search_words(db, ctx.tenant_id)
    await db.commit()
    return (await _out(db, [brand]))[0]


@router.post("/t/{tenant_id}/brands/{brand_id}/merge", response_model=BrandOut)
async def merge_brand(brand_id: uuid.UUID, body: MergeIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Two brands that are really one: move the products, keep the old name as another spelling."""
    source = await _get(db, ctx.tenant_id, brand_id)
    target = await _get(db, ctx.tenant_id, body.into_id)
    if source.id == target.id:
        raise HTTPException(422, "Pick a different brand")
    await db.execute(update(Product).where(Product.brand_id == source.id).values(brand_id=target.id, brand=target.name))
    target.aliases = ", ".join(dict.fromkeys([*alias_list(target.aliases), source.name, *alias_list(source.aliases)])) or None
    await db.delete(source)
    await db.flush()
    await refresh_search_words(db, ctx.tenant_id)
    await db.commit()
    return (await _out(db, [target]))[0]


@router.delete("/t/{tenant_id}/brands/{brand_id}", status_code=204)
async def delete_brand(brand_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    brand = await _get(db, ctx.tenant_id, brand_id)
    if await db.scalar(select(exists().where(Product.brand_id == brand.id))):
        raise HTTPException(409, "Products still use this brand. Merge it into another brand instead.")
    await db.delete(brand)
    await db.commit()


class ShopBrandOut(BaseModel):
    id: uuid.UUID
    name: str
    product_count: int


@router.get("/t/{tenant_id}/catalog/brands", response_model=list[ShopBrandOut])
async def catalog_brands(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    """Brands with something a shop can order, most products first (for "Shop by brand")."""
    rows = await db.execute(
        select(Brand.id, Brand.name, func.count(Product.id))
        .join(Product, Product.brand_id == Brand.id)
        .where(
            Brand.tenant_id == ctx.tenant_id,
            Product.status == "active",
            exists().where(ProductUnit.product_id == Product.id),
        )
        .group_by(Brand.id, Brand.name)
        .order_by(func.count(Product.id).desc(), Brand.name)
    )
    return [ShopBrandOut(id=i, name=n, product_count=c) for i, n, c in rows]
