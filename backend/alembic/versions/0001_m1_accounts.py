"""M1: users, OTP, refresh tokens, tenants, members, shops, distributor_shops

Revision ID: 0001
Revises:
Create Date: 2026-10-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _timestamps(updated: bool = True) -> list[sa.Column]:
    cols = [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]
    if updated:
        cols.append(sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    return cols


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("name", sa.String(120), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("phone", name="uq_users_phone"),
    )

    op.create_table(
        "otp_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(updated=False),
        sa.PrimaryKeyConstraint("id", name="pk_otp_requests"),
    )
    op.create_index("ix_otp_requests_phone_created_at", "otp_requests", ["phone", "created_at"])

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(updated=False),
        sa.PrimaryKeyConstraint("id", name="pk_refresh_tokens"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_refresh_tokens_user_id_users", ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("join_code", sa.String(12), nullable=False),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("brand_color", sa.String(7), nullable=True),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_tenants"),
        sa.UniqueConstraint("join_code", name="uq_tenants_join_code"),
        sa.CheckConstraint("status IN ('active', 'suspended')", name="ck_tenants_status"),
    )

    op.create_table(
        "tenant_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_tenant_members"),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name="fk_tenant_members_tenant_id_tenants", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_tenant_members_user_id_users", ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_members_tenant_id_user_id"),
        sa.CheckConstraint("role IN ('owner', 'staff', 'agent')", name="ck_tenant_members_role"),
    )
    op.create_index("ix_tenant_members_user_id", "tenant_members", ["user_id"])

    op.create_table(
        "shops",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("shop_name", sa.String(150), nullable=False),
        sa.Column("owner_name", sa.String(120), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("city", sa.String(80), nullable=False),
        sa.Column("pincode", sa.String(6), nullable=False),
        sa.Column("lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("lng", sa.Numeric(9, 6), nullable=True),
        sa.Column("photo_url", sa.String(500), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_shops"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], name="fk_shops_owner_user_id_users", ondelete="CASCADE"),
        sa.UniqueConstraint("owner_user_id", name="uq_shops_owner_user_id"),
    )

    op.create_table(
        "distributor_shops",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("shop_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("agent_user_id", sa.Uuid(), nullable=True),
        sa.Column("joined_via_code", sa.String(12), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_distributor_shops"),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name="fk_distributor_shops_tenant_id_tenants", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], name="fk_distributor_shops_shop_id_shops", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["agent_user_id"], ["users.id"], name="fk_distributor_shops_agent_user_id_users", ondelete="SET NULL"
        ),
        sa.UniqueConstraint("tenant_id", "shop_id", name="uq_distributor_shops_tenant_id_shop_id"),
        sa.CheckConstraint("status IN ('pending', 'active', 'blocked')", name="ck_distributor_shops_status"),
    )
    op.create_index("ix_distributor_shops_shop_id", "distributor_shops", ["shop_id"])
    op.create_index("ix_distributor_shops_tenant_id_status", "distributor_shops", ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_table("distributor_shops")
    op.drop_table("shops")
    op.drop_table("tenant_members")
    op.drop_table("tenants")
    op.drop_table("refresh_tokens")
    op.drop_table("otp_requests")
    op.drop_table("users")
