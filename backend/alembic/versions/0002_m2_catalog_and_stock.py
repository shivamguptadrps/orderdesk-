"""M2: categories, attribute definitions, products, pack sizes, stock, stock ledger

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-24 17:46:06.825676
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Trigram matching for Hindi / English / Hinglish product search.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table('categories',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('parent_id', sa.Uuid(), nullable=True),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('image_url', sa.String(length=500), nullable=True),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['categories.id'], name=op.f('fk_categories_parent_id_categories'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_categories_tenant_id_tenants'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_categories'))
    )
    op.create_index('ix_categories_tenant_id_parent_id', 'categories', ['tenant_id', 'parent_id'], unique=False)
    op.create_table('attribute_definitions',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('category_id', sa.Uuid(), nullable=False),
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('unit', sa.String(length=20), nullable=True),
    sa.Column('options', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('required', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('is_filter', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("type IN ('text', 'number', 'select', 'boolean')", name=op.f('ck_attribute_definitions_type')),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_attribute_definitions_category_id_categories'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_attribute_definitions_tenant_id_tenants'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_attribute_definitions')),
    sa.UniqueConstraint('category_id', 'key', name=op.f('uq_attribute_definitions_category_id_key'))
    )
    op.create_index(op.f('ix_attribute_definitions_tenant_id'), 'attribute_definitions', ['tenant_id'], unique=False)
    op.create_table('products',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('category_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('brand', sa.String(length=100), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('search_aliases', sa.Text(), nullable=True),
    sa.Column('sku', sa.String(length=64), nullable=True),
    sa.Column('mrp', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('attributes', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('images', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='active', nullable=False),
    sa.Column('search_text', sa.Text(), sa.Computed("lower(name || ' ' || coalesce(brand, '') || ' ' || coalesce(search_aliases, ''))", persisted=True), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('active', 'hidden')", name=op.f('ck_products_status')),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_products_category_id_categories'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_products_tenant_id_tenants'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_products')),
    sa.UniqueConstraint('tenant_id', 'sku', name=op.f('uq_products_tenant_id_sku'))
    )
    op.create_index('ix_products_search_text_trgm', 'products', ['search_text'], unique=False, postgresql_using='gin', postgresql_ops={'search_text': 'gin_trgm_ops'})
    op.create_index('ix_products_tenant_id_category_id', 'products', ['tenant_id', 'category_id'], unique=False)
    op.create_table('product_units',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=40), nullable=False),
    sa.Column('pieces_per_unit', sa.Integer(), nullable=False),
    sa.Column('price', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('min_qty', sa.Integer(), server_default='1', nullable=False),
    sa.Column('step_qty', sa.Integer(), server_default='1', nullable=False),
    sa.Column('max_qty', sa.Integer(), nullable=True),
    sa.Column('is_default', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('max_qty IS NULL OR max_qty >= min_qty', name=op.f('ck_product_units_max_qty')),
    sa.CheckConstraint('min_qty >= 1 AND step_qty >= 1', name=op.f('ck_product_units_qty_rules')),
    sa.CheckConstraint('pieces_per_unit > 0', name=op.f('ck_product_units_pieces_positive')),
    sa.CheckConstraint('price >= 0', name=op.f('ck_product_units_price_not_negative')),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_product_units_product_id_products'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_product_units_tenant_id_tenants'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_product_units')),
    sa.UniqueConstraint('product_id', 'name', name=op.f('uq_product_units_product_id_name'))
    )
    op.create_index(op.f('ix_product_units_product_id'), 'product_units', ['product_id'], unique=False)
    op.create_index(op.f('ix_product_units_tenant_id'), 'product_units', ['tenant_id'], unique=False)
    op.create_table('stock',
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('qty_pieces', sa.Integer(), server_default='0', nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('qty_pieces >= 0', name=op.f('ck_stock_not_negative')),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_stock_product_id_products'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_stock_tenant_id_tenants'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('product_id', name=op.f('pk_stock'))
    )
    op.create_index(op.f('ix_stock_tenant_id'), 'stock', ['tenant_id'], unique=False)
    op.create_table('stock_ledger',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('change_pieces', sa.Integer(), nullable=False),
    sa.Column('balance_after', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=10), nullable=False),
    sa.Column('ref_order_id', sa.Uuid(), nullable=True),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('note', sa.String(length=300), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("reason IN ('opening', 'purchase', 'dispatch', 'adjust', 'return')", name=op.f('ck_stock_ledger_reason')),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_stock_ledger_product_id_products'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_stock_ledger_tenant_id_tenants'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_stock_ledger_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_stock_ledger'))
    )
    op.create_index('ix_stock_ledger_tenant_id_product_id_created_at', 'stock_ledger', ['tenant_id', 'product_id', 'created_at'], unique=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index('ix_stock_ledger_tenant_id_product_id_created_at', table_name='stock_ledger')
    op.drop_table('stock_ledger')
    op.drop_index(op.f('ix_stock_tenant_id'), table_name='stock')
    op.drop_table('stock')
    op.drop_index(op.f('ix_product_units_tenant_id'), table_name='product_units')
    op.drop_index(op.f('ix_product_units_product_id'), table_name='product_units')
    op.drop_table('product_units')
    op.drop_index('ix_products_tenant_id_category_id', table_name='products')
    op.drop_index('ix_products_search_text_trgm', table_name='products', postgresql_using='gin', postgresql_ops={'search_text': 'gin_trgm_ops'})
    op.drop_table('products')
    op.drop_index(op.f('ix_attribute_definitions_tenant_id'), table_name='attribute_definitions')
    op.drop_table('attribute_definitions')
    op.drop_index('ix_categories_tenant_id_parent_id', table_name='categories')
    op.drop_table('categories')
    # ### end Alembic commands ###
