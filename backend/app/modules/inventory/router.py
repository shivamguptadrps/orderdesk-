import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.tenancy import STAFF_ROLES, TenantContext, require_roles
from app.modules.catalog.models import ProductUnit
from app.modules.catalog.queries import get_product_or_404
from app.modules.inventory.models import StockLedger
from app.modules.inventory.service import change_stock, stock_map

router = APIRouter(tags=["stock"])
_staff = require_roles(*STAFF_ROLES)


class StockAdjustIn(BaseModel):
    """Either `change` (add or remove) or `set_to` (after a physical count).

    `change` is in pieces, or in the given pack size if `unit_id` is set (e.g. +10 cartons).
    """

    product_id: uuid.UUID
    change: int | None = None
    unit_id: uuid.UUID | None = None
    set_to: int | None = Field(default=None, ge=0)
    reason: Literal["opening", "purchase", "adjust", "return"] = "adjust"
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _one_mode(self):
        if (self.change is None) == (self.set_to is None):
            raise ValueError("Send either 'change' or 'set_to'")
        if self.change == 0:
            raise ValueError("'change' cannot be 0")
        if self.set_to is not None and self.unit_id is not None:
            raise ValueError("'unit_id' only works with 'change'")
        return self


class StockAdjustOut(BaseModel):
    product_id: uuid.UUID
    change_pieces: int
    stock_pieces: int


class LedgerOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    change_pieces: int
    balance_after: int
    reason: str
    ref_order_id: uuid.UUID | None
    user_id: uuid.UUID | None
    note: str | None
    created_at: datetime


@router.post("/t/{tenant_id}/stock/adjust", response_model=StockAdjustOut)
async def adjust_stock(body: StockAdjustIn, ctx: TenantContext = Depends(_staff), db: AsyncSession = Depends(get_db)):
    product = await get_product_or_404(db, ctx.tenant_id, body.product_id)
    if body.set_to is not None:
        current = (await stock_map(db, [product.id])).get(product.id, 0)
        change = body.set_to - current
        if change == 0:
            return StockAdjustOut(product_id=product.id, change_pieces=0, stock_pieces=current)
    else:
        change = body.change
        if body.unit_id is not None:
            unit = await db.scalar(
                select(ProductUnit).where(
                    ProductUnit.id == body.unit_id,
                    ProductUnit.product_id == product.id,
                    ProductUnit.tenant_id == ctx.tenant_id,
                )
            )
            if unit is None:
                raise HTTPException(404, "Pack size not found for this product")
            change *= unit.pieces_per_unit
    entry = await change_stock(
        db, tenant_id=ctx.tenant_id, product_id=product.id, change_pieces=change,
        reason=body.reason, user_id=ctx.user.id, note=body.note,
    )
    await db.commit()
    return StockAdjustOut(product_id=product.id, change_pieces=change, stock_pieces=entry.balance_after)


@router.get("/t/{tenant_id}/stock/ledger", response_model=list[LedgerOut])
async def stock_ledger(
    product_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: TenantContext = Depends(_staff),
    db: AsyncSession = Depends(get_db),
):
    """Stock movements, newest first."""
    query = select(StockLedger).where(StockLedger.tenant_id == ctx.tenant_id)
    if product_id:
        query = query.where(StockLedger.product_id == product_id)
    rows = await db.scalars(
        query.order_by(StockLedger.created_at.desc(), StockLedger.id).limit(limit).offset(offset)
    )
    return [LedgerOut.model_validate(r, from_attributes=True) for r in rows]
