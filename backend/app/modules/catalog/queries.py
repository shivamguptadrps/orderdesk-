"""Shared product queries: loading, search, filters, and output shaping."""

import json
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import Product, ProductUnit
from app.modules.catalog.schemas import CatalogUnitOut, ProductOut, UnitOut

# word_similarity() score above which a fuzzy match counts (0..1). Catches typos like "chini" for "cheeni".
SEARCH_SIMILARITY = 0.4


async def get_product_or_404(db: AsyncSession, tenant_id: uuid.UUID, product_id: uuid.UUID) -> Product:
    product = await db.scalar(
        select(Product)
        .where(Product.id == product_id, Product.tenant_id == tenant_id)
        .execution_options(populate_existing=True)
    )
    if product is None:
        raise HTTPException(404, "Product not found")
    return product


def price_per_piece(unit: ProductUnit) -> Decimal:
    return (unit.price / unit.pieces_per_unit).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def unit_out(unit: ProductUnit) -> UnitOut:
    return UnitOut(
        id=unit.id,
        name=unit.name,
        pieces_per_unit=unit.pieces_per_unit,
        price=unit.price,
        price_per_piece=price_per_piece(unit),
        min_qty=unit.min_qty,
        step_qty=unit.step_qty,
        max_qty=unit.max_qty,
        is_default=unit.is_default,
        sort_order=unit.sort_order,
    )


def catalog_unit_out(unit: ProductUnit, stock_pieces: int) -> CatalogUnitOut:
    return CatalogUnitOut(
        **unit_out(unit).model_dump(),
        in_stock=stock_pieces >= unit.pieces_per_unit * unit.min_qty,
    )


def default_unit(product: Product) -> ProductUnit | None:
    if not product.units:
        return None
    return next((u for u in product.units if u.is_default), product.units[0])


def product_out(product: Product, stock_pieces: int) -> ProductOut:
    return ProductOut(
        id=product.id,
        category_id=product.category_id,
        name=product.name,
        brand=product.brand,
        description=product.description,
        search_aliases=product.search_aliases,
        sku=product.sku,
        mrp=product.mrp,
        attributes=product.attributes,
        images=product.images,
        status=product.status,
        units=[unit_out(u) for u in product.units],
        stock_pieces=stock_pieces,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def apply_search(query: Select, q: str | None) -> Select:
    """Match name, brand and aliases in any script: exact substring, or a close fuzzy match.

    Hinglish works because distributors put spellings like 'cheeni, chini, शक्कर' in search_aliases.
    """
    q = (q or "").strip().lower()
    if not q:
        return query.order_by(Product.name)
    similarity = func.word_similarity(q, Product.search_text)
    return query.where(
        or_(Product.search_text.like(f"%{_escape_like(q)}%", escape="\\"), similarity >= SEARCH_SIMILARITY)
    ).order_by(similarity.desc(), Product.name)


def parse_filters(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(422, 'filters must be JSON, e.g. {"grain": "Medium"}') from None
    if not isinstance(data, dict):
        raise HTTPException(422, 'filters must be a JSON object, e.g. {"grain": "Medium"}')
    return data


def _candidates(value: Any) -> list[Any]:
    """A filter value from a URL may be '1' meaning the number 1, or 'true' meaning a boolean."""
    out = [value]
    if isinstance(value, str):
        text = value.strip()
        if text.lower() in ("true", "false"):
            out.append(text.lower() == "true")
        try:
            number = float(text)
            out.append(int(number) if number.is_integer() else number)
        except ValueError:
            pass
    return out


def apply_attribute_filters(query: Select, filters: dict[str, Any]) -> Select:
    for key, value in filters.items():
        values = value if isinstance(value, list) else [value]  # a list means "any of these"
        conditions = [
            Product.attributes.contains({key: candidate}) for v in values for candidate in _candidates(v)
        ]
        # select options are matched case-insensitively
        texts = [str(v).lower() for v in values if isinstance(v, str)]
        if texts:
            conditions.append(func.lower(Product.attributes[key].astext).in_(texts))
        query = query.where(or_(*conditions))
    return query


async def count(db: AsyncSession, query: Select) -> int:
    return await db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
