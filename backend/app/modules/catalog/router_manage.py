"""Distributor (owner/staff) catalog management under /t/{tenant_id}/..."""

import re
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import String, cast, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.media import (
    MAX_UPLOAD_BYTES,
    copy_product_image,
    delete_image,
    delete_product_image,
    save_image,
    save_product_image,
    thumb_url,
)
from app.core.tenancy import STAFF_ROLES, TenantContext, require_roles
from app.modules.catalog import excel, related
from app.modules.catalog.brands import resolve_brand, set_brand
from app.modules.catalog.models import MAX_CATEGORY_DEPTH, AttributeDefinition, Brand, Category, Product, ProductUnit
from app.modules.catalog.queries import (
    apply_search,
    count,
    get_product_or_404,
    manage_sizes,
    product_out,
    unit_out,
)
from app.modules.catalog.schemas import (
    AddSizeIn,
    AttributeIn,
    AttributeOut,
    AttributeUpdate,
    CategoryIn,
    CategoryOut,
    CategoryUpdate,
    EffectiveAttributeOut,
    ProductIn,
    ProductOut,
    ProductPage,
    ProductUpdate,
    SizeGroupIn,
    UnitIn,
    UnitOut,
    UnitUpdate,
)
from app.modules.catalog.service import (
    effective_attributes,
    get_category_or_404,
    load_tree,
    refresh_search_words,
    validate_attributes,
)
from app.modules.inventory.models import Stock
from app.modules.orders.models import OrderItem
from app.modules.inventory.service import change_stock, stock_map

router = APIRouter(tags=["catalog: manage"])


class CategoryOrderIn(BaseModel):
    ids: list[uuid.UUID]
_staff = require_roles(*STAFF_ROLES)


# ---------- categories ----------


@router.get("/t/{tenant_id}/categories", response_model=list[CategoryOut])
async def list_categories(ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """All categories (flat list, parent_id links them) with each one's own features."""
    tree = await load_tree(db, ctx.tenant_id)
    attrs = (
        await db.scalars(
            select(AttributeDefinition)
            .where(AttributeDefinition.tenant_id == ctx.tenant_id)
            .order_by(AttributeDefinition.sort_order, AttributeDefinition.label)
        )
    ).all()
    by_cat: dict[uuid.UUID, list[AttributeOut]] = {}
    for a in attrs:
        by_cat.setdefault(a.category_id, []).append(AttributeOut.model_validate(a))
    counts = dict(
        (await db.execute(
            select(Product.category_id, func.count()).where(Product.tenant_id == ctx.tenant_id).group_by(Product.category_id)
        )).all()
    )
    ordered = []

    def walk(parent_id):
        for c in tree.children.get(parent_id, []):
            ordered.append(c)
            walk(c.id)

    walk(None)
    return [
        CategoryOut(
            id=c.id, parent_id=c.parent_id, name=c.name, image_url=c.image_url, sort_order=c.sort_order,
            aliases=c.aliases, attributes=by_cat.get(c.id, []), product_count=counts.get(c.id, 0),
        )
        for c in ordered
    ]


async def _check_sibling_name(db, tenant_id, parent_id, name, exclude_id=None):
    query = select(Category.id).where(
        Category.tenant_id == tenant_id,
        Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id,
        func.lower(Category.name) == name.strip().lower(),
    )
    if exclude_id:
        query = query.where(Category.id != exclude_id)
    if await db.scalar(query) is not None:
        raise HTTPException(409, f"A category named '{name.strip()}' already exists here")


@router.post("/t/{tenant_id}/categories", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    if body.parent_id is not None:
        await get_category_or_404(db, ctx.tenant_id, body.parent_id)
        tree = await load_tree(db, ctx.tenant_id)
        if tree.depth(body.parent_id) >= MAX_CATEGORY_DEPTH:
            raise HTTPException(400, f"Categories can be at most {MAX_CATEGORY_DEPTH} levels deep")
    await _check_sibling_name(db, ctx.tenant_id, body.parent_id, body.name)
    cat = Category(tenant_id=ctx.tenant_id, **body.model_dump() | {"name": body.name.strip()})
    db.add(cat)
    await db.commit()
    return CategoryOut.model_validate(cat)


@router.put("/t/{tenant_id}/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: uuid.UUID, body: CategoryUpdate, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    cat = await get_category_or_404(db, ctx.tenant_id, category_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        await _check_sibling_name(db, ctx.tenant_id, cat.parent_id, data["name"], exclude_id=cat.id)
        data["name"] = data["name"].strip()
    for field, value in data.items():
        if value is not None or field in ("image_url", "aliases"):
            setattr(cat, field, value.strip() or None if field == "aliases" and value else value)
    await refresh_search_words(db, ctx.tenant_id)
    await db.commit()
    return CategoryOut.model_validate(cat)


@router.delete("/t/{tenant_id}/categories/{category_id}", status_code=204)
async def delete_category(category_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Only empty categories can be deleted (no sub-categories, no products)."""
    cat = await get_category_or_404(db, ctx.tenant_id, category_id)
    if await db.scalar(select(Category.id).where(Category.parent_id == cat.id).limit(1)):
        raise HTTPException(409, "Delete or move its sub-categories first")
    if await db.scalar(select(Product.id).where(Product.category_id == cat.id).limit(1)):
        raise HTTPException(409, "This category still has products")
    await db.delete(cat)
    await db.commit()


@router.post("/t/{tenant_id}/categories/{category_id}/image", response_model=CategoryOut)
async def set_category_image(
    category_id: uuid.UUID,
    file: UploadFile = File(description="Square photo works best. JPG, PNG or WebP, max 8 MB"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Photo for the category tile shops see on their home screen (instead of an icon)."""
    cat = await get_category_or_404(db, ctx.tenant_id, category_id)
    old = cat.image_url
    cat.image_url = save_image(ctx.tenant_id, await file.read(MAX_UPLOAD_BYTES + 1), "categories")
    await db.commit()
    if old:
        delete_image(ctx.tenant_id, old, "categories")
    return CategoryOut.model_validate(cat)


@router.delete("/t/{tenant_id}/categories/{category_id}/image", response_model=CategoryOut)
async def remove_category_image(category_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    cat = await get_category_or_404(db, ctx.tenant_id, category_id)
    old, cat.image_url = cat.image_url, None
    await db.commit()
    if old:
        delete_image(ctx.tenant_id, old, "categories")
    return CategoryOut.model_validate(cat)


@router.put("/t/{tenant_id}/categories-order", response_model=list[CategoryOut])
async def reorder_categories(body: CategoryOrderIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Set the order of categories that share a parent (send all of them, in the new order)."""
    cats = list(await db.scalars(select(Category).where(Category.tenant_id == ctx.tenant_id, Category.id.in_(body.ids))))
    if len(cats) != len(set(body.ids)) or len({c.parent_id for c in cats}) > 1:
        raise HTTPException(422, "Send categories of one parent, each once")
    by_id = {c.id: c for c in cats}
    for position, cid in enumerate(body.ids, start=1):
        by_id[cid].sort_order = position
    await db.commit()
    return await list_categories(ctx, db)


# ---------- attributes (features) ----------


@router.get("/t/{tenant_id}/categories/{category_id}/attributes", response_model=list[EffectiveAttributeOut])
async def category_attributes(category_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Every feature a product in this category has, including ones inherited from parent categories.

    Use this to build the product form.
    """
    await get_category_or_404(db, ctx.tenant_id, category_id)
    defs = await effective_attributes(db, ctx.tenant_id, category_id)
    return [
        EffectiveAttributeOut(**AttributeOut.model_validate(d).model_dump(), inherited=d.category_id != category_id)
        for d in defs
    ]


@router.post("/t/{tenant_id}/categories/{category_id}/attributes", response_model=AttributeOut, status_code=201)
async def create_attribute(
    category_id: uuid.UUID, body: AttributeIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    await get_category_or_404(db, ctx.tenant_id, category_id)
    tree = await load_tree(db, ctx.tenant_id)
    # A key must be unique along the whole line: parents (inherited) and children (would clash).
    related = set(tree.ancestors(category_id)) | set(tree.subtree(category_id))
    clash = await db.scalar(
        select(AttributeDefinition.id).where(
            AttributeDefinition.tenant_id == ctx.tenant_id,
            AttributeDefinition.category_id.in_(related),
            AttributeDefinition.key == body.key,
        )
    )
    if clash:
        raise HTTPException(409, f"Feature '{body.key}' already exists in this category or a related one")
    attr = AttributeDefinition(tenant_id=ctx.tenant_id, category_id=category_id, **body.model_dump())
    db.add(attr)
    await db.commit()
    return attr


async def _get_attribute(db, tenant_id, attribute_id) -> AttributeDefinition:
    attr = await db.scalar(
        select(AttributeDefinition).where(
            AttributeDefinition.id == attribute_id, AttributeDefinition.tenant_id == tenant_id
        )
    )
    if attr is None:
        raise HTTPException(404, "Feature not found")
    return attr


@router.put("/t/{tenant_id}/attributes/{attribute_id}", response_model=AttributeOut)
async def update_attribute(
    attribute_id: uuid.UUID, body: AttributeUpdate, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    attr = await _get_attribute(db, ctx.tenant_id, attribute_id)
    data = body.model_dump(exclude_unset=True)
    if "options" in data and data["options"] is not None:
        if attr.type != "select":
            raise HTTPException(422, "Only 'select' features have options")
        if not data["options"]:
            raise HTTPException(422, "A 'select' feature needs at least one option")
    for field, value in data.items():
        if value is not None or field == "unit":
            setattr(attr, field, value)
    await db.commit()
    return attr


@router.delete("/t/{tenant_id}/attributes/{attribute_id}", status_code=204)
async def delete_attribute(attribute_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Deletes the feature and removes its value from products in that category and below."""
    attr = await _get_attribute(db, ctx.tenant_id, attribute_id)
    tree = await load_tree(db, ctx.tenant_id)
    await db.execute(
        update(Product)
        .where(Product.tenant_id == ctx.tenant_id, Product.category_id.in_(tree.subtree(attr.category_id)))
        .values(attributes=Product.attributes.op("-")(cast(attr.key, String)))
    )
    await db.delete(attr)
    await db.commit()


# ---------- products ----------


def _ensure_one_default(units: list[ProductUnit], preferred: ProductUnit | None = None) -> None:
    if not units:
        return
    chosen = preferred if preferred is not None and preferred.is_default else None
    chosen = chosen or next((u for u in units if u.is_default), None) or units[0]
    for u in units:
        u.is_default = u is chosen


def _default_pack_pieces():
    """Pieces in the product's default pack (1 if it has none)."""
    return func.coalesce(
        select(ProductUnit.pieces_per_unit)
        .where(ProductUnit.product_id == Product.id, ProductUnit.is_default.is_(True))
        .limit(1)
        .scalar_subquery(),
        1,
    )


async def _brand_for(db: AsyncSession, tenant_id: uuid.UUID, brand_id: uuid.UUID | None, text: str | None):
    """The picked brand (must be ours), else the typed name matched to a brand or added as a new one."""
    if brand_id:
        brand = await db.scalar(select(Brand).where(Brand.id == brand_id, Brand.tenant_id == tenant_id))
        if brand is None:
            raise HTTPException(404, "Brand not found")
        return brand
    return await resolve_brand(db, tenant_id, text)


def _sku_conflict() -> HTTPException:
    return HTTPException(409, "Another product already uses this SKU")


@router.get("/t/{tenant_id}/products", response_model=ProductPage)
async def list_products(
    q: str | None = None,
    category_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, pattern="^(active|hidden)$"),
    low_stock: bool = Query(default=False, description="Only active products with less than 2 of their main pack"),
    sort: str = Query(default="name", pattern="^(name|stock)$", description="name, or stock (lowest first)"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """All products including hidden ones, with stock. Category includes its sub-categories."""
    query = select(Product).where(Product.tenant_id == ctx.tenant_id)
    if category_id:
        tree = await load_tree(db, ctx.tenant_id)
        query = query.where(Product.category_id.in_(tree.subtree(category_id)))
    if status:
        query = query.where(Product.status == status)
    if low_stock or sort == "stock":
        query = query.outerjoin(Stock, Stock.product_id == Product.id)
    if low_stock:
        query = query.where(Product.status == "active", func.coalesce(Stock.qty_pieces, 0) < 2 * _default_pack_pieces())
    query = await apply_search(db, query, q, ctx.tenant_id)
    if sort == "stock":
        query = query.order_by(None).order_by(func.coalesce(Stock.qty_pieces, 0), Product.name)
    total = await count(db, query)
    products = (await db.scalars(query.limit(limit).offset(offset))).all()
    stock = await stock_map(db, [p.id for p in products])
    return ProductPage(items=[product_out(p, stock.get(p.id, 0)) for p in products], total=total)


@router.post("/t/{tenant_id}/products", response_model=ProductOut, status_code=201)
async def create_product(body: ProductIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    await get_category_or_404(db, ctx.tenant_id, body.category_id)
    attrs = validate_attributes(await effective_attributes(db, ctx.tenant_id, body.category_id), body.attributes)
    data = body.model_dump(exclude={"units", "attributes", "opening_stock_pieces", "brand_id", "brand"})
    data["sku"] = (data["sku"] or "").strip() or None
    data["variant_label"] = (data["variant_label"] or "").strip() or None
    product = Product(tenant_id=ctx.tenant_id, attributes=attrs, **data)
    set_brand(product, await _brand_for(db, ctx.tenant_id, body.brand_id, body.brand))
    product.units = [ProductUnit(tenant_id=ctx.tenant_id, **u.model_dump()) for u in body.units]
    _ensure_one_default(product.units)
    db.add(product)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _sku_conflict() from None
    db.add(Stock(product_id=product.id, tenant_id=ctx.tenant_id, qty_pieces=0))
    await db.flush()
    if body.opening_stock_pieces:
        await change_stock(
            db, tenant_id=ctx.tenant_id, product_id=product.id, change_pieces=body.opening_stock_pieces,
            reason="opening", user_id=ctx.user.id, note="Opening stock",
        )
    await refresh_search_words(db, ctx.tenant_id)
    await db.commit()
    return product_out(product, body.opening_stock_pieces)


@router.get("/t/{tenant_id}/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    return await _product_with_sizes(db, product)


async def _product_with_sizes(db: AsyncSession, product: Product) -> ProductOut:
    stock = await stock_map(db, [product.id])
    out = product_out(product, stock.get(product.id, 0))
    out.sizes = await manage_sizes(db, product)
    return out


@router.put("/t/{tenant_id}/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: uuid.UUID, body: ProductUpdate, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    data = body.model_dump(exclude_unset=True)
    nullable = {"brand", "description", "search_aliases", "sku", "mrp", "variant_label"}
    data = {k: v for k, v in data.items() if v is not None or k in nullable}

    category_id = data.get("category_id", product.category_id)
    if "category_id" in data:
        await get_category_or_404(db, ctx.tenant_id, category_id)
    if "category_id" in data or "attributes" in data:
        values = data.get("attributes", product.attributes)
        data["attributes"] = validate_attributes(await effective_attributes(db, ctx.tenant_id, category_id), values)
    if "sku" in data:
        data["sku"] = (data["sku"] or "").strip() or None
    if "variant_label" in data:
        data["variant_label"] = (data["variant_label"] or "").strip() or None
    if "brand_id" in body.model_fields_set or "brand" in body.model_fields_set:
        set_brand(product, await _brand_for(db, ctx.tenant_id, body.brand_id, body.brand))
    data.pop("brand", None)
    data.pop("brand_id", None)

    for field, value in data.items():
        setattr(product, field, value)
    try:
        await refresh_search_words(db, ctx.tenant_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _sku_conflict() from None
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    stock = await stock_map(db, [product.id])
    return product_out(product, stock.get(product.id, 0))


@router.delete("/t/{tenant_id}/products/{product_id}", status_code=204)
async def delete_product(product_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Deletes a product entered by mistake. To stop selling it, set status to 'hidden' instead."""
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    if await db.scalar(select(OrderItem.id).where(OrderItem.product_id == product.id).limit(1)):
        raise HTTPException(409, "This product is in past orders, so it can't be deleted. Set its status to 'hidden' instead.")
    images, group = list(product.images), product.variant_group_id
    await db.delete(product)
    await db.flush()
    await _dissolve_if_alone(db, ctx.tenant_id, group)
    await db.commit()
    for url in images:
        delete_product_image(ctx.tenant_id, url)
    return Response(status_code=204)


# ---------- sizes (variants): Rice 1 kg / 5 kg as one product for shops ----------


async def _dissolve_if_alone(db: AsyncSession, tenant_id: uuid.UUID, group_id: uuid.UUID | None) -> None:
    """A group with a single product left is no group: clear it so the product looks normal again."""
    if group_id is None:
        return
    members = (
        await db.scalars(select(Product).where(Product.tenant_id == tenant_id, Product.variant_group_id == group_id))
    ).all()
    if len(members) == 1:
        members[0].variant_group_id = None


@router.post("/t/{tenant_id}/products/{product_id}/sizes", response_model=ProductOut, status_code=201)
async def add_size(
    product_id: uuid.UUID, body: AddSizeIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Make another size of this product (e.g. 5 kg next to 1 kg). Category, brand, description, search words,
    features and photos are copied; name, label, packs, prices and stock are the new size's own."""
    source = await get_product_or_404(db, ctx.tenant_id, product_id)
    if source.variant_group_id is None:
        source.variant_group_id = uuid.uuid4()
    if body.source_label is not None and body.source_label.strip():
        source.variant_label = body.source_label.strip()
    attrs = validate_attributes(
        await effective_attributes(db, ctx.tenant_id, source.category_id), {**source.attributes, **(body.attributes or {})}
    )
    images = [u for u in (copy_product_image(ctx.tenant_id, url) for url in source.images) if u] if body.copy_photos else []
    product = Product(
        tenant_id=ctx.tenant_id,
        category_id=source.category_id,
        name=body.name.strip(),
        brand=source.brand,
        brand_id=source.brand_id,
        description=source.description,
        search_aliases=source.search_aliases,
        sku=(body.sku or "").strip() or None,
        mrp=body.mrp,
        attributes=attrs,
        images=images,
        status="active",
        variant_group_id=source.variant_group_id,
        variant_label=body.variant_label.strip(),
    )
    product.units = [ProductUnit(tenant_id=ctx.tenant_id, **u.model_dump()) for u in body.units]
    _ensure_one_default(product.units)
    db.add(product)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        for url in images:
            if url not in source.images:
                delete_product_image(ctx.tenant_id, url)
        raise _sku_conflict() from None
    db.add(Stock(product_id=product.id, tenant_id=ctx.tenant_id, qty_pieces=0))
    await db.flush()
    if body.opening_stock_pieces:
        await change_stock(
            db, tenant_id=ctx.tenant_id, product_id=product.id, change_pieces=body.opening_stock_pieces,
            reason="opening", user_id=ctx.user.id, note="Opening stock",
        )
    await refresh_search_words(db, ctx.tenant_id)
    await db.commit()
    product = await get_product_or_404(db, ctx.tenant_id, product.id)
    return await _product_with_sizes(db, product)


@router.put("/t/{tenant_id}/products/{product_id}/size-group", response_model=ProductOut)
async def set_size_group(
    product_id: uuid.UUID, body: SizeGroupIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Link an existing product as a size of another (join_product_id), or take it out of its group (null).
    Useful when 1 kg and 5 kg were already added as separate products."""
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    old_group = product.variant_group_id
    if body.join_product_id is None:
        product.variant_group_id = None
    else:
        if body.join_product_id == product.id:
            raise HTTPException(422, "Pick a different product")
        other = await get_product_or_404(db, ctx.tenant_id, body.join_product_id)
        if other.variant_group_id is None:
            other.variant_group_id = uuid.uuid4()
        product.variant_group_id = other.variant_group_id
    await db.flush()
    if old_group != product.variant_group_id:
        await _dissolve_if_alone(db, ctx.tenant_id, old_group)
    await db.commit()
    product = await get_product_or_404(db, ctx.tenant_id, product.id)
    return await _product_with_sizes(db, product)


# ---------- photos ----------

MAX_IMAGES = 10


@router.post("/t/{tenant_id}/products/{product_id}/images", response_model=ProductOut, status_code=201)
async def upload_product_image(
    product_id: uuid.UUID,
    file: UploadFile = File(description="JPG, PNG or WebP, max 8 MB"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Add a photo to the product (saved as 800px + 200px thumbnail). The first photo is the main one."""
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    if len(product.images) >= MAX_IMAGES:
        raise HTTPException(409, f"A product can have at most {MAX_IMAGES} photos")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    url = save_product_image(ctx.tenant_id, data)
    product.images = [*product.images, url]
    await db.commit()
    stock = await stock_map(db, [product.id])
    return product_out(product, stock.get(product.id, 0))


@router.delete("/t/{tenant_id}/products/{product_id}/images/{index}", response_model=ProductOut)
async def delete_product_image_at(
    product_id: uuid.UUID, index: int, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Remove the photo at this position (0 = main photo)."""
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    if not 0 <= index < len(product.images):
        raise HTTPException(404, "Photo not found")
    url = product.images[index]
    product.images = [u for i, u in enumerate(product.images) if i != index]
    await db.commit()
    delete_product_image(ctx.tenant_id, url)
    stock = await stock_map(db, [product.id])
    return product_out(product, stock.get(product.id, 0))


# ---------- pack sizes ----------


async def _get_unit(db, tenant_id, unit_id) -> ProductUnit:
    unit = await db.scalar(select(ProductUnit).where(ProductUnit.id == unit_id, ProductUnit.tenant_id == tenant_id))
    if unit is None:
        raise HTTPException(404, "Pack size not found")
    return unit


def _unit_name_conflict() -> HTTPException:
    return HTTPException(409, "This product already has a pack size with that name")


@router.post("/t/{tenant_id}/products/{product_id}/units", response_model=UnitOut, status_code=201)
async def add_unit(
    product_id: uuid.UUID, body: UnitIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    product = await get_product_or_404(db, ctx.tenant_id, product_id)
    unit = ProductUnit(tenant_id=ctx.tenant_id, product_id=product.id, **body.model_dump())
    product.units.append(unit)
    _ensure_one_default(product.units, preferred=unit)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _unit_name_conflict() from None
    return unit_out(unit)


@router.put("/t/{tenant_id}/units/{unit_id}", response_model=UnitOut)
async def update_unit(
    unit_id: uuid.UUID, body: UnitUpdate, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    unit = await _get_unit(db, ctx.tenant_id, unit_id)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is not None or field == "max_qty":
            setattr(unit, field, value)
    if unit.max_qty is not None and unit.max_qty < unit.min_qty:
        raise HTTPException(422, "max_qty cannot be less than min_qty")
    product = await get_product_or_404(db, ctx.tenant_id, unit.product_id)
    if data.get("is_default") is True:
        _ensure_one_default(product.units, preferred=unit)
    elif data.get("is_default") is False:
        # Some other pack size must take over as default; a product's only pack size stays default.
        others = [u for u in product.units if u is not unit]
        if not others:
            unit.is_default = True
        elif not any(u.is_default for u in others):
            others[0].is_default = True
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _unit_name_conflict() from None
    return unit_out(unit)


@router.delete("/t/{tenant_id}/units/{unit_id}", status_code=204)
async def delete_unit(unit_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    unit = await _get_unit(db, ctx.tenant_id, unit_id)
    product = await get_product_or_404(db, ctx.tenant_id, unit.product_id)
    if len(product.units) <= 1:
        raise HTTPException(409, "A product needs at least one pack size")
    product.units.remove(unit)
    _ensure_one_default(product.units)
    await db.commit()


# ---------- Excel import ----------


class ImportRowError(BaseModel):
    row: int
    message: str


class ImportOut(BaseModel):
    dry_run: bool
    created: int
    updated: int
    errors: list[ImportRowError]
    saved: bool
    new_brands: list[str] = []  # brand names in the sheet that don't exist yet (added when saved)


@router.get("/t/{tenant_id}/product-import/template")
async def download_import_template(
    category_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Excel sheet for one category, with that category's feature columns and dropdowns."""
    await get_category_or_404(db, ctx.tenant_id, category_id)
    tree = await load_tree(db, ctx.tenant_id)
    path = tree.path_names(category_id)
    defs = await effective_attributes(db, ctx.tenant_id, category_id, tree)
    content = excel.build_template(path, defs)
    # Headers must be plain ASCII: use the English part of "Rice / चावल" and give the full name as filename*.
    readable = "products-" + "-".join(p.split(" / ")[0] for p in path)
    ascii_name = re.sub(r"[^a-z0-9]+", "_", readable.lower()).strip("_") + ".xlsx"

    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(readable + '.xlsx')}"},
    )


@router.post("/t/{tenant_id}/product-import", response_model=ImportOut)
async def import_products(
    category_id: uuid.UUID,
    dry_run: bool = True,
    file: UploadFile = File(description="The filled-in .xlsx template"),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Check (dry_run=true, the default) or save products from the Excel template.

    Nothing is saved if any row has a problem; the response lists every problem with its row number.
    """
    await get_category_or_404(db, ctx.tenant_id, category_id)
    defs = await effective_attributes(db, ctx.tenant_id, category_id)
    data = await file.read(excel.MAX_FILE_BYTES + 1)
    result = await excel.import_products(
        db, tenant_id=ctx.tenant_id, category_id=category_id, defs=defs, data=data,
        user_id=ctx.user.id, dry_run=dry_run,
    )
    return ImportOut(
        dry_run=dry_run,
        created=result.created,
        updated=result.updated,
        errors=[ImportRowError(**e) for e in result.errors],
        saved=not dry_run and not result.errors,
        new_brands=result.new_brands,
    )


# ---------- related products ----------


class RelatedOut(BaseModel):
    product_id: uuid.UUID
    name: str
    brand: str | None
    image: str | None
    status: str
    score: float
    bought_together: int  # orders that had both (last 180 days)
    pinned: bool


class RebuildOut(BaseModel):
    links: int


@router.get("/t/{tenant_id}/products/{product_id}/related", response_model=list[RelatedOut])
async def list_related(product_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """What shops see under this product, with why: score, orders together, pinned."""
    await get_product_or_404(db, ctx.tenant_id, product_id)
    links = (await related.links_for(db, ctx.tenant_id, {product_id})).get(product_id, [])
    products = {
        p.id: p
        for p in await db.scalars(
            select(Product).where(Product.tenant_id == ctx.tenant_id, Product.id.in_([x.related_id for x in links]))
        )
    }
    return [
        RelatedOut(
            product_id=p.id,
            name=p.name,
            brand=p.brand,
            image=thumb_url(p.images[0]) if p.images else None,
            status=p.status,
            score=link.score,
            bought_together=link.bought_together,
            pinned=link.pinned,
        )
        for link in links
        if (p := products.get(link.related_id))
    ]


async def _pin(db: AsyncSession, ctx: TenantContext, product_id: uuid.UUID, other_id: uuid.UUID, pinned: bool):
    if product_id == other_id:
        raise HTTPException(422, "A product can't be linked to itself")
    await get_product_or_404(db, ctx.tenant_id, product_id)
    await get_product_or_404(db, ctx.tenant_id, other_id)
    await related.set_pin(db, ctx.tenant_id, product_id, other_id, pinned)
    await db.commit()
    return await list_related(product_id, ctx, db)


@router.put("/t/{tenant_id}/products/{product_id}/related/{other_id}", response_model=list[RelatedOut])
async def pin_related(
    product_id: uuid.UUID, other_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Link two products by hand (both ways), e.g. tea with sugar. Pinned links are always shown."""
    return await _pin(db, ctx, product_id, other_id, True)


@router.delete("/t/{tenant_id}/products/{product_id}/related/{other_id}", response_model=list[RelatedOut])
async def unpin_related(
    product_id: uuid.UUID, other_id: uuid.UUID, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)
):
    """Remove a hand-made link (both ways). Automatic links come back if the data supports them."""
    return await _pin(db, ctx, product_id, other_id, False)


@router.post("/t/{tenant_id}/related/rebuild", response_model=RebuildOut)
async def rebuild_related(ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    """Recompute related products now (it also runs every night)."""
    links = await related.rebuild(db, ctx.tenant_id)
    await db.commit()
    return RebuildOut(links=links)
