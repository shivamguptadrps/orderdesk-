import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.catalog.templates import apply_fmcg_template
from app.modules.tenants.models import Tenant, TenantMember

# No 0/O, 1/I/L, so codes are easy to read out over the phone.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def random_join_code(length: int = 6) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


async def unique_join_code(db: AsyncSession) -> str:
    for _ in range(20):
        code = random_join_code()
        if await db.scalar(select(Tenant.id).where(Tenant.join_code == code)) is None:
            return code
    raise RuntimeError("Could not generate a unique join code")


async def get_or_create_user(db: AsyncSession, phone: str, name: str | None = None) -> User:
    user = await db.scalar(select(User).where(User.phone == phone))
    if user is None:
        user = User(phone=phone, name=name)
        db.add(user)
        await db.flush()
    return user


async def create_tenant(
    db: AsyncSession,
    *,
    name: str,
    owner_phone: str,
    owner_name: str | None = None,
    join_code: str | None = None,
    starter_template: bool = True,
) -> Tenant:
    """Create a distributor, make the given phone its owner, load the FMCG starter categories. Caller commits."""
    owner = await get_or_create_user(db, owner_phone, owner_name)
    tenant = Tenant(name=name, join_code=(join_code or await unique_join_code(db)).upper())
    db.add(tenant)
    await db.flush()
    db.add(TenantMember(tenant_id=tenant.id, user_id=owner.id, role="owner"))
    if starter_template:
        await apply_fmcg_template(db, tenant.id)
    await db.flush()
    return tenant


async def contact_phone(db: AsyncSession, tenant: Tenant) -> str | None:
    """The number shops should call: the distributor's own setting, else the (first) owner's phone."""
    if tenant.contact_phone:
        return tenant.contact_phone
    return await db.scalar(
        select(User.phone)
        .join(TenantMember, TenantMember.user_id == User.id)
        .where(TenantMember.tenant_id == tenant.id, TenantMember.role == "owner")
        .order_by(TenantMember.created_at, User.phone)
        .limit(1)
    )


def clean_contact_phone(raw: str) -> str:
    """A mobile becomes +91XXXXXXXXXX; a landline like 0512-2345678 is kept as digits."""
    from app.core.phone import normalize_phone

    try:
        return normalize_phone(raw)
    except ValueError:
        digits = "".join(ch for ch in raw if ch.isdigit())
        if 8 <= len(digits) <= 13:
            return digits
        raise ValueError("Enter a valid mobile or landline number") from None
