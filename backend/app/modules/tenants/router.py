import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.tenancy import STAFF_ROLES, TenantContext, get_tenant_context

router = APIRouter(tags=["tenants"])


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    logo_url: str | None
    brand_color: str | None
    my_role: str  # owner, staff, agent or shop
    join_code: str | None  # only shown to owner/staff


@router.get("/t/{tenant_id}", response_model=TenantOut)
async def get_tenant(ctx: TenantContext = Depends(get_tenant_context)):
    t = ctx.tenant
    return TenantOut(
        id=t.id,
        name=t.name,
        logo_url=t.logo_url,
        brand_color=t.brand_color,
        my_role=ctx.role,
        join_code=t.join_code if ctx.role in STAFF_ROLES else None,
    )
