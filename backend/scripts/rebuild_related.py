"""Rebuild related products for every distributor now (the API also does this every night).

Run from the backend folder:
    python -m scripts.rebuild_related
"""

import asyncio
import logging

from app.core.db import engine
from app.modules.catalog.related import rebuild_all


async def main() -> None:
    await rebuild_all()
    await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main())
