from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.core.db import Base, engine


async def test_migrations_match_models():
    """Fails if a model changed without a matching Alembic migration."""

    def diff(sync_conn):
        ctx = MigrationContext.configure(sync_conn, opts={"compare_type": True})
        return compare_metadata(ctx, Base.metadata)

    async with engine.connect() as conn:
        changes = await conn.run_sync(diff)
    assert changes == []
