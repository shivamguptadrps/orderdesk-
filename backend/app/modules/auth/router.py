import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import get_current_user
from app.core.otp_sender import send_otp
from app.modules.auth.models import OtpRequest, RefreshToken, User
from app.modules.notifications.models import PushToken
from app.modules.platform.router import is_platform_admin
from app.modules.auth.schemas import (
    LogoutIn,
    MembershipOut,
    MeOut,
    MeUpdateIn,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    RefreshIn,
    TokenOut,
    UserOut,
)
from app.modules.orders.models import Cart
from app.modules.shops.models import DistributorShop, Shop
from app.modules.shops.schemas import ShopOut
from app.modules.tenants.models import Tenant, TenantMember

router = APIRouter(tags=["auth"])


def _is_review_phone(phone: str) -> bool:
    s = get_settings()
    return bool(s.review_phone and s.review_code) and phone == s.review_phone


def _otp_hash(phone: str, code: str) -> str:
    return security.hash_secret(f"otp:{phone}:{code}")


async def _issue_tokens(db: AsyncSession, user: User) -> tuple[str, str]:
    refresh = security.new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=security.hash_secret(f"refresh:{refresh}"),
            expires_at=utcnow() + timedelta(days=get_settings().jwt_refresh_days),
        )
    )
    return security.create_access_token(user.id), refresh


@router.post("/auth/otp/request", response_model=OtpRequestOut, status_code=202)
async def request_otp(body: OtpRequestIn, db: AsyncSession = Depends(get_db)):
    s = get_settings()
    window_start = utcnow() - timedelta(minutes=s.otp_rate_limit_window_minutes)
    recent = await db.scalar(
        select(func.count())
        .select_from(OtpRequest)
        .where(OtpRequest.phone == body.phone, OtpRequest.created_at >= window_start)
    )
    review = _is_review_phone(body.phone)
    if recent >= s.otp_rate_limit_count and not review:
        raise HTTPException(429, "Too many OTP requests. Please try again in a few minutes.")

    code = s.review_code if review else security.generate_otp()
    db.add(
        OtpRequest(
            phone=body.phone,
            code_hash=_otp_hash(body.phone, code),
            expires_at=utcnow() + timedelta(minutes=s.otp_ttl_minutes),
        )
    )
    await db.commit()
    if not review:  # the store reviewer's number gets no message; they use the fixed code
        await send_otp(body.phone, code)
    # Test servers (dev, staging) show the code in the app until WhatsApp sending is set up.
    dev_code = code if s.app_env in ("dev", "staging") and s.otp_mode == "log" else None
    return OtpRequestOut(sent=True, expires_in_seconds=s.otp_ttl_minutes * 60, dev_code=dev_code)


@router.post("/auth/otp/verify", response_model=TokenOut)
async def verify_otp(body: OtpVerifyIn, db: AsyncSession = Depends(get_db)):
    invalid = HTTPException(400, "Wrong or expired code")
    otp = await db.scalar(
        select(OtpRequest)
        .where(OtpRequest.phone == body.phone, OtpRequest.consumed_at.is_(None))
        .order_by(OtpRequest.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if otp is None or otp.expires_at <= utcnow():
        raise invalid
    if otp.attempts >= get_settings().otp_max_attempts:
        raise HTTPException(429, "Too many wrong attempts. Please request a new code.")
    if not security.secrets_match(otp.code_hash, _otp_hash(body.phone, body.code)):
        otp.attempts += 1
        await db.commit()
        raise invalid

    otp.consumed_at = utcnow()
    user = await db.scalar(select(User).where(User.phone == body.phone))
    is_new = user is None
    if is_new:
        user = User(phone=body.phone)
        db.add(user)
        await db.flush()
    access, refresh = await _issue_tokens(db, user)
    await db.commit()
    return TokenOut(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user), is_new_user=is_new)


@router.post("/auth/refresh", response_model=TokenOut)
async def refresh_tokens(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Swap a refresh token for a new access + refresh pair. The old refresh token stops working."""
    token = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == security.hash_secret(f"refresh:{body.refresh_token}"))
        .with_for_update()
    )
    if token is None or token.revoked_at is not None or token.expires_at <= utcnow():
        raise HTTPException(401, "Session expired. Please log in again.")
    token.revoked_at = utcnow()
    user = await db.get(User, token.user_id)
    if user.deleted_at is not None:
        await db.commit()
        raise HTTPException(401, "Session expired. Please log in again.")
    access, refresh = await _issue_tokens(db, user)
    await db.commit()
    return TokenOut(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/auth/logout", status_code=204)
async def logout(body: LogoutIn, db: AsyncSession = Depends(get_db)):
    """End this session. Also stops push notifications to this phone when its push token is sent."""
    token = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_secret(f"refresh:{body.refresh_token}"))
    )
    if token is None:
        return
    if token.revoked_at is None:
        token.revoked_at = utcnow()
    if body.push_token:
        await db.execute(
            delete(PushToken).where(PushToken.token == body.push_token, PushToken.user_id == token.user_id)
        )
    await db.commit()


async def _me(db: AsyncSession, user: User) -> MeOut:
    shop = await db.scalar(select(Shop).where(Shop.owner_user_id == user.id))
    rows = await db.execute(
        select(TenantMember.tenant_id, Tenant.name, TenantMember.role)
        .join(Tenant, Tenant.id == TenantMember.tenant_id)
        .where(TenantMember.user_id == user.id, Tenant.status == "active")
        .order_by(Tenant.name)
    )
    return MeOut(
        id=user.id,
        phone=user.phone,
        name=user.name,
        shop=ShopOut.model_validate(shop) if shop else None,
        memberships=[MembershipOut(tenant_id=t, tenant_name=n, role=r) for t, n, r in rows],
        is_platform_admin=is_platform_admin(user),
    )


@router.get("/me", response_model=MeOut)
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Who am I: profile, my shop (if any) and distributors where I am owner/staff/agent."""
    return await _me(db, user)


@router.put("/me", response_model=MeOut)
async def update_me(body: MeUpdateIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.name = body.name.strip()
    await db.commit()
    return await _me(db, user)


@router.delete("/me", status_code=204)
async def delete_my_account(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Delete my account (Play Store rule). Logs out everywhere, removes my team roles, my shop's
    links to distributors, carts and notification tokens, and wipes my name, phone and shop details.
    Past orders stay with the distributors as business records (with the shop name copied on the bill).
    The only owner of a distributor can't delete themselves here (the business would be left without one)."""
    owned = (
        await db.execute(
            select(Tenant.id, Tenant.name)
            .join(TenantMember, TenantMember.tenant_id == Tenant.id)
            .where(TenantMember.user_id == user.id, TenantMember.role == "owner")
        )
    ).all()
    for tenant_id, name in owned:
        others = await db.scalar(
            select(func.count())
            .select_from(TenantMember)
            .where(TenantMember.tenant_id == tenant_id, TenantMember.role == "owner", TenantMember.user_id != user.id)
        )
        if not others:
            raise HTTPException(
                409, f"You are the only owner of {name}. Contact OrderDesk support to close the distributor account first."
            )

    now = utcnow()
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
    await db.execute(delete(PushToken).where(PushToken.user_id == user.id))
    await db.execute(delete(TenantMember).where(TenantMember.user_id == user.id))
    await db.execute(delete(Cart).where(Cart.user_id == user.id))
    await db.execute(update(DistributorShop).where(DistributorShop.agent_user_id == user.id).values(agent_user_id=None))
    shop = await db.scalar(select(Shop).where(Shop.owner_user_id == user.id))
    if shop is not None:
        await db.execute(delete(Cart).where(Cart.shop_id == shop.id))
        await db.execute(delete(DistributorShop).where(DistributorShop.shop_id == shop.id))
        shop.shop_name, shop.owner_name, shop.address, shop.city = "Deleted shop", "", "", ""
        shop.pincode, shop.lat, shop.lng, shop.photo_url = "000000", None, None, None
    user.phone = f"deleted-{secrets.token_hex(4)}"
    user.name = None
    user.deleted_at = now
    await db.commit()
