"""Category tree helpers and product feature (attribute) validation."""

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import AttributeDefinition, Category


@dataclass
class CategoryTree:
    by_id: dict[uuid.UUID, Category]
    children: dict[uuid.UUID | None, list[Category]]

    def ancestors(self, category_id: uuid.UUID) -> list[uuid.UUID]:
        """Ids from the root down to and including category_id."""
        chain = []
        current = self.by_id.get(category_id)
        while current is not None:
            chain.append(current.id)
            current = self.by_id.get(current.parent_id) if current.parent_id else None
        return list(reversed(chain))

    def subtree(self, category_id: uuid.UUID) -> list[uuid.UUID]:
        """category_id plus all its descendants."""
        result, stack = [], [category_id]
        while stack:
            cid = stack.pop()
            result.append(cid)
            stack.extend(c.id for c in self.children.get(cid, []))
        return result

    def depth(self, category_id: uuid.UUID) -> int:
        return len(self.ancestors(category_id))

    def path_names(self, category_id: uuid.UUID) -> list[str]:
        return [self.by_id[c].name for c in self.ancestors(category_id)]


async def load_tree(db: AsyncSession, tenant_id: uuid.UUID) -> CategoryTree:
    cats = (
        await db.scalars(
            select(Category).where(Category.tenant_id == tenant_id).order_by(Category.sort_order, Category.name)
        )
    ).all()
    children: dict[uuid.UUID | None, list[Category]] = {}
    for c in cats:
        children.setdefault(c.parent_id, []).append(c)
    return CategoryTree(by_id={c.id: c for c in cats}, children=children)


async def get_category_or_404(db: AsyncSession, tenant_id: uuid.UUID, category_id: uuid.UUID) -> Category:
    cat = await db.scalar(select(Category).where(Category.id == category_id, Category.tenant_id == tenant_id))
    if cat is None:
        raise HTTPException(404, "Category not found")
    return cat


async def effective_attributes(
    db: AsyncSession, tenant_id: uuid.UUID, category_id: uuid.UUID, tree: CategoryTree | None = None
) -> list[AttributeDefinition]:
    """Attributes a product in this category has: inherited from ancestors first, then its own."""
    tree = tree or await load_tree(db, tenant_id)
    chain = tree.ancestors(category_id)
    defs = (
        await db.scalars(
            select(AttributeDefinition).where(
                AttributeDefinition.tenant_id == tenant_id, AttributeDefinition.category_id.in_(chain)
            )
        )
    ).all()
    level = {cid: i for i, cid in enumerate(chain)}
    return sorted(defs, key=lambda d: (level[d.category_id], d.sort_order, d.label))


_TRUE = {"true", "yes", "y", "1", "haan", "ha"}
_FALSE = {"false", "no", "n", "0", "nahi"}


def _clean_value(d: AttributeDefinition, value: Any) -> tuple[Any, str | None]:
    if d.type == "number":
        if isinstance(value, bool):
            return None, f"{d.label} must be a number"
        if isinstance(value, str):
            try:
                value = float(value.strip())
            except ValueError:
                return None, f"{d.label} must be a number"
        if not isinstance(value, (int, float)):
            return None, f"{d.label} must be a number"
        return (int(value) if float(value).is_integer() else float(value)), None
    if d.type == "boolean":
        if isinstance(value, bool):
            return value, None
        if isinstance(value, str) and value.strip().lower() in _TRUE | _FALSE:
            return value.strip().lower() in _TRUE, None
        return None, f"{d.label} must be yes or no"
    if d.type == "select":
        text = str(value).strip().lower()
        for option in d.options:
            if option.lower() == text:
                return option, None
        return None, f"{d.label} must be one of: {', '.join(d.options)}"
    # text
    text = str(value).strip()
    if len(text) > 200:
        return None, f"{d.label} is too long (max 200 characters)"
    return text, None


def validate_attributes(defs: list[AttributeDefinition], values: dict[str, Any]) -> dict[str, Any]:
    """Check product feature values against the category's definitions. Raises 422 listing every problem."""
    by_key = {d.key: d for d in defs}
    errors = [f"'{k}' is not a feature of this category" for k in values if k not in by_key]
    clean: dict[str, Any] = {}
    for d in defs:
        value = values.get(d.key)
        if value is None or (isinstance(value, str) and not value.strip()):
            if d.required:
                errors.append(f"{d.label} is required")
            continue
        cleaned, error = _clean_value(d, value)
        if error:
            errors.append(error)
        else:
            clean[d.key] = cleaned
    if errors:
        raise HTTPException(422, "; ".join(errors))
    return clean


_SEARCH_WORDS_SQL = text("""
WITH RECURSIVE chain AS (
    SELECT id AS leaf, parent_id, name, aliases FROM categories WHERE tenant_id = :tenant
    UNION ALL
    SELECT chain.leaf, c.parent_id, c.name, c.aliases FROM chain JOIN categories c ON c.id = chain.parent_id
),
words AS (
    SELECT leaf, string_agg(name || ' ' || coalesce(aliases, ''), ' ') AS w FROM chain GROUP BY leaf
),
wanted AS (
    SELECT p.id, nullif(trim(coalesce(words.w, '') || ' ' || coalesce(b.aliases, '')), '') AS v
    FROM products p
    LEFT JOIN words ON words.leaf = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.tenant_id = :tenant
)
UPDATE products p SET search_extra = wanted.v
FROM wanted WHERE p.id = wanted.id AND p.search_extra IS DISTINCT FROM wanted.v
""")


async def refresh_search_words(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Copy each product's category names (with their other names) and brand spellings into its
    search words, so "chawal" or "चीनी" finds products whose own name doesn't say it.
    Cheap: only rows that changed are written. Call after changing products, categories or brands."""
    await db.execute(_SEARCH_WORDS_SQL, {"tenant": tenant_id})
