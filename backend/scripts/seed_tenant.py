"""Create a distributor (tenant) with an owner account.

Run from the backend folder:
    python -m scripts.seed_tenant --name "Gupta Traders" --owner-phone 9876543210 --owner-name "Ramesh Gupta"
Optional: --join-code GUPTA7 (otherwise a random 6-character code is made).
"""

import argparse
import asyncio

from app.core.db import SessionLocal, engine
from app.core.phone import normalize_phone
from app.modules.tenants.service import create_tenant


async def main(args: argparse.Namespace) -> None:
    async with SessionLocal() as db:
        tenant = await create_tenant(
            db,
            name=args.name,
            owner_phone=normalize_phone(args.owner_phone),
            owner_name=args.owner_name,
            join_code=args.join_code,
        )
        await db.commit()
    await engine.dispose()
    print(f"Created distributor '{tenant.name}'")
    print(f"  tenant_id: {tenant.id}")
    print(f"  join code: {tenant.join_code}")
    print(f"  owner:     {normalize_phone(args.owner_phone)} (log in with this number)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", required=True)
    parser.add_argument("--owner-phone", required=True)
    parser.add_argument("--owner-name")
    parser.add_argument("--join-code")
    asyncio.run(main(parser.parse_args()))
