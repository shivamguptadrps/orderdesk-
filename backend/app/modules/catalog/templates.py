"""Starter category templates loaded for a new distributor. The distributor can edit them freely."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import AttributeDefinition, Category


def _num(key, label, unit, required=False, is_filter=True):
    return {"key": key, "label": label, "type": "number", "unit": unit, "required": required, "is_filter": is_filter}


def _select(key, label, options, required=False, is_filter=True):
    return {"key": key, "label": label, "type": "select", "options": options, "required": required, "is_filter": is_filter}


def _text(key, label, required=False, is_filter=False):
    return {"key": key, "label": label, "type": "text", "required": required, "is_filter": is_filter}


# (name, attributes, children)
FMCG_TEMPLATE = [
    (
        "Staples",
        [],
        [
            ("Sugar", [_num("weight_kg", "Pack weight", "kg", required=True), _select("grain", "Grain", ["Fine", "Medium", "Bold"])], []),
            (
                "Rice",
                [
                    _num("weight_kg", "Pack weight", "kg", required=True),
                    _select("variety", "Variety", ["Basmati", "Sona Masoori", "Kolam", "Parboiled", "Other"]),
                ],
                [],
            ),
            (
                "Atta",
                [
                    _num("weight_kg", "Pack weight", "kg", required=True),
                    _select("atta_type", "Type", ["Whole wheat", "Multigrain", "Maida", "Besan", "Other"]),
                ],
                [],
            ),
            (
                "Oil",
                [
                    _num("volume_l", "Volume", "L", required=True),
                    _select("oil_type", "Oil type", ["Mustard", "Sunflower", "Soybean", "Groundnut", "Rice bran", "Palm", "Other"]),
                    _select("pack_type", "Pack", ["Pouch", "Bottle", "Jar", "Tin"]),
                ],
                [],
            ),
        ],
    ),
    (
        "Snacks",
        [_num("weight_g", "Pack weight", "g"), _text("flavour", "Flavour")],
        [("Chips", [], []), ("Biscuits", [], [])],
    ),
    ("Beverages", [_num("volume_ml", "Volume", "ml"), _text("flavour", "Flavour")], []),
    ("Personal care", [_text("size", "Size", is_filter=False)], []),
    ("Home care", [_text("size", "Size", is_filter=False)], []),
]


async def apply_fmcg_template(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    async def add(nodes, parent_id):
        for order, (name, attrs, children) in enumerate(nodes):
            cat = Category(tenant_id=tenant_id, parent_id=parent_id, name=name, sort_order=order)
            db.add(cat)
            await db.flush()
            for a_order, attr in enumerate(attrs):
                db.add(AttributeDefinition(tenant_id=tenant_id, category_id=cat.id, sort_order=a_order, **attr))
            await add(children, cat.id)

    await add(FMCG_TEMPLATE, None)
    await db.flush()
