import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import Stock, StockLedger


async def stock_map(db: AsyncSession, product_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not product_ids:
        return {}
    rows = await db.execute(select(Stock.product_id, Stock.qty_pieces).where(Stock.product_id.in_(product_ids)))
    return {pid: qty for pid, qty in rows}


async def change_stock(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    product_id: uuid.UUID,
    change_pieces: int,
    reason: str,
    user_id: uuid.UUID | None,
    note: str | None = None,
    ref_order_id: uuid.UUID | None = None,
) -> StockLedger:
    """Change stock and write a ledger row. Locks the stock row so two changes can't race.

    Caller commits. Raises 409 if stock would go below zero.
    """
    stock = await db.scalar(
        select(Stock).where(Stock.product_id == product_id, Stock.tenant_id == tenant_id).with_for_update()
    )
    if stock is None:
        raise HTTPException(404, "Product not found")
    new_qty = stock.qty_pieces + change_pieces
    if new_qty < 0:
        raise HTTPException(409, f"Not enough stock: {stock.qty_pieces} pieces available")
    stock.qty_pieces = new_qty
    entry = StockLedger(
        tenant_id=tenant_id,
        product_id=product_id,
        change_pieces=change_pieces,
        balance_after=new_qty,
        reason=reason,
        user_id=user_id,
        note=note,
        ref_order_id=ref_order_id,
    )
    db.add(entry)
    await db.flush()
    return entry
