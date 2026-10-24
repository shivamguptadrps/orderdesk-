"""Imports every model so Base.metadata is complete (used by Alembic and tests)."""

from app.modules.auth.models import OtpRequest, RefreshToken, User  # noqa: F401
from app.modules.catalog.models import AttributeDefinition, Category, Product, ProductUnit  # noqa: F401
from app.modules.inventory.models import Stock, StockLedger  # noqa: F401
from app.modules.shops.models import DistributorShop, Shop  # noqa: F401
from app.modules.tenants.models import Tenant, TenantMember  # noqa: F401
