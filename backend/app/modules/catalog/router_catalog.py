"""What a shop (or agent) sees: /t/{tenant_id}/catalog/... Only active products with a pack size."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.media import thumb_url
from app.core.tenancy import TenantContext, get_tenant_context, resolve_shop
from app.modules.catalog import related
from app.modules.catalog.models import Product, ProductUnit
from app.modules.catalog.queries import (
    apply_attribute_filters,
    apply_search,
    catalog_cards,
    catalog_unit_out,
    collapse_variants,
    count,
    get_product_or_404,
    parse_filters,
    shop_sizes,
)
from app.modules.catalog.schemas import (
    CatalogCard,
    CatalogDetail,
    CatalogPage,
    CategoryFiltersOut,
    CategoryNode,
    FeatureOut,
    FilterOut,
)
from app.modules.catalog.service import effective_attributes, get_category_or_404, load_tree
from app.modules.inventory.models import Stock
from app.modules.inventory.service import stock_map

router = APIRouter(tags=["catalog: shop"])


def _visible(tenant_id: uuid.UUID):
    """Products a shop may see."""
    return select(Product).where(
        Product.tenant_id == tenant_id,
        Product.status == "active",
        exists().where(ProductUnit.product_id == Product.id),
    )


@router.get("/t/{tenant_id}/catalog/categories", response_model=list[CategoryNode])
async def catalog_categories(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    tree = await load_tree(db, ctx.tenant_id)

    def build(parent_id) -> list[CategoryNode]:
        return [
            CategoryNode(id=c.id, name=c.name, image_url=c.image_url, children=build(c.id))
            for c in tree.children.get(parent_id, [])
        ]

    return build(None)


@router.get("/t/{tenant_id}/catalog/categories/{category_id}/filters", response_model=CategoryFiltersOut)
async def catalog_filters(
    category_id: uuid.UUID, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)
):
    """Brands and feature filters to show on a category screen, with values that actually exist."""
    await get_category_or_404(db, ctx.tenant_id, category_id)
    tree = await load_tree(db, ctx.tenant_id)
    base = _visible(ctx.tenant_id).where(Product.category_id.in_(tree.subtree(category_id))).subquery()

    brands = (
        await db.scalars(select(base.c.brand).where(base.c.brand.is_not(None)).distinct().order_by(base.c.brand))
    ).all()

    filters = []
    for d in await effective_attributes(db, ctx.tenant_id, category_id, tree):
        if not d.is_filter:
            continue
        if d.type == "select":
            values = list(d.options)
        elif d.type == "boolean":
            values = [True, False]
        else:
            raw = (
                await db.scalars(
                    select(func.distinct(base.c.attributes[d.key])).where(base.c.attributes.has_key(d.key))
                )
            ).all()
            values = sorted(raw, key=lambda v: (not isinstance(v, (int, float)), v if isinstance(v, (int, float)) else str(v)))
        if values:
            filters.append(FilterOut(key=d.key, label=d.label, type=d.type, unit=d.unit, values=values))
    return CategoryFiltersOut(brands=list(brands), filters=filters)


@router.get("/t/{tenant_id}/catalog/products", response_model=CatalogPage)
async def catalog_products(
    category_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100, description="Search in Hindi, English or Hinglish"),
    brand: str | None = None,
    filters: str | None = Query(default=None, description='JSON, e.g. {"grain": "Medium", "weight_kg": [1, 5]}'),
    in_stock_only: bool = False,
    group_variants: bool = Query(default=False, description="One card per product with sizes (newer apps); old apps get every size"),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db),
):
    query = _visible(ctx.tenant_id)
    if category_id:
        tree = await load_tree(db, ctx.tenant_id)
        if category_id not in tree.by_id:
            raise HTTPException(404, "Category not found")
        query = query.where(Product.category_id.in_(tree.subtree(category_id)))
    if brand:
        query = query.where(func.lower(Product.brand) == brand.strip().lower())
    query = apply_attribute_filters(query, parse_filters(filters))
    if in_stock_only:
        query = query.where(exists().where(Stock.product_id == Product.id, Stock.qty_pieces > 0))
    query = await apply_search(db, query, q)
    if group_variants:
        query = collapse_variants(query)

    total = await count(db, query)
    products = (await db.scalars(query.limit(limit).offset(offset))).all()
    return CatalogPage(items=await catalog_cards(db, products, count_variants=group_variants), total=total)


@router.get("/t/{tenant_id}/catalog/products/{product_id}", response_model=CatalogDetail)
async def catalog_product(
    product_id: uuid.UUID, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)
):
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    if product.status != "active" or not product.units:
        raise HTTPException(404, "Product not found")
    tree = await load_tree(db, ctx.tenant_id)
    defs = await effective_attributes(db, ctx.tenant_id, product.category_id, tree)
    features = [
        FeatureOut(key=d.key, label=d.label, value=product.attributes[d.key], unit=d.unit)
        for d in defs
        if d.key in product.attributes
    ]
    pieces = (await stock_map(db, [product.id])).get(product.id, 0)
    return CatalogDetail(
        id=product.id,
        name=product.name,
        brand=product.brand,
        description=product.description,
        category_id=product.category_id,
        category_path=tree.path_names(product.category_id),
        mrp=product.mrp,
        images=product.images,
        thumbnails=[thumb_url(u) for u in product.images],
        features=features,
        units=[catalog_unit_out(u, pieces) for u in product.units],
        in_stock=pieces > 0,
        variant_label=product.variant_label,
        variants=await shop_sizes(db, product),
    )


@router.get("/t/{tenant_id}/catalog/products/{product_id}/related", response_model=list[CatalogCard])
async def catalog_related(
    product_id: uuid.UUID,
    shop_id: uuid.UUID | None = Query(default=None, description="Agents/staff: rank for this shop"),
    limit: int = Query(default=8, ge=1, le=20),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db),
):
    """'Customers also buy': in-stock products related to this one, best first."""
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    if product.status != "active" or not product.units:
        raise HTTPException(404, "Product not found")
    shop = await resolve_shop(db, ctx, shop_id, required=False)
    products = await related.related_products(db, ctx.tenant_id, product_id, shop, limit)
    return await catalog_cards(db, products)
