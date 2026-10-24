# Project context for Claude

Read this first, then `docs/DECISIONS.md`, `docs/IMPLEMENTATION_PLAN.md` and `docs/TRACKER.md`.

## What we are building

A multi-tenant B2B ordering SaaS ("OrderDesk", working name). The developer (Shivam) is building it
first for his uncle, an FMCG distributor in India; other distributors will be onboarded later.

- **One shared Android app** for everyone. A shop owner signs in with mobile number + WhatsApp OTP,
  creates a shop profile once, then adds distributors by **join code** (or QR / invite link) and
  switches between them. A shop sees only the products and prices of distributors it joined.
- **Distributor** (tenant) manages categories, products, pack sizes, stock, shops, agents and orders.
  For the MVP the distributor uses the same mobile app (distributor mode); a web admin comes later.
- **Agents** (distributor's field staff) place orders on behalf of shops; orders are tagged with the agent.
- Every order waits for distributor approval. Distributor can edit quantities before approving.
- **Stock is deducted only at dispatch**, inside one DB transaction with row locks, written to a stock ledger.

## Hard MVP constraints (do not add these unless the user asks)

- Android only, English UI. Product name/description accept Hindi, English or Hinglish; search must match all
  three (pg_trgm over name + brand + `search_aliases`).
- No payments in app (settled offline). Keep `payment_status` on orders for later.
- No GST, no tax fields, no Tally/accounting integration. Bill = items, qty, rate, line total, grand total.
- No godowns/warehouses: one stock number per product.
- No price groups or schemes: one price per pack size per distributor.

## Product features model

- Categories form a tree (category › sub-category). Each category has `attribute_definitions`
  (key, label, type text/number/select/boolean, unit, options, required, is_filter); sub-categories inherit.
- Product attribute values live in `products.attributes` (JSONB) and are validated against the category.
  Example: Sugar `{"weight_kg": 1, "grain": "medium"}`; Mobile `{"ram_gb": 6, "storage_gb": 128}`.
- Pack sizes (`product_units`): name, pieces_per_unit, price, min_qty, step_qty, is_default.
  Stock is always counted in pieces.
- FMCG starter category template is pre-loaded for a new distributor.

## Tech stack

- Backend: FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, Pydantic v2, PostgreSQL 16, pytest.
- Mobile: Expo (React Native) + TypeScript + Expo Router, React Query, Zustand, SecureStore.
- OTP: WhatsApp Cloud API (Meta direct, no reseller). `OTP_MODE=log` prints the code in dev.
- Hosting later: Oracle Cloud Always Free (Mumbai/Hyderabad), Docker Compose, Caddy, DuckDNS for HTTPS.

## Tenancy rules

- `shops` and `users` are platform-level. `distributor_shops` links a shop to a tenant (status, agent).
- Every other business table has `tenant_id`; every tenant query filters by it.
- Routes for tenant data live under `/t/{tenant_id}/...` and go through a tenant-context dependency
  that checks membership. Every new endpoint gets a test proving another tenant gets 404.

## How to work in this repo

- Follow milestones in `docs/IMPLEMENTATION_PLAN.md` in order; one milestone at a time.
- Before starting, read `docs/TRACKER.md` "Next up". After finishing work, update task statuses,
  "Next up" and add a Session log line.
- Database changes only via Alembic migrations. Run `pytest` before saying a task is done.
- Never commit `.env` or secrets.
- Developer machine: Windows, PowerShell. Project lives under OneDrive Desktop; if installs are slow,
  suggest moving it out of OneDrive.

## Status at handoff (24 Oct 2026)

- Done: spec, clickable prototype, workspace docs, backend skeleton (`/health`, settings, Alembic, one test).
- Verified on laptop: Docker Desktop 4.96 + Postgres 16 container, backend runs, `pytest` passes.
- M1 backend done (auth, shops, join by code, distributor approval, tenant isolation). Code layout:
  `app/modules/<area>/{models,schemas,router}.py`, shared code in `app/core/`, all models registered in `app/models.py`.
- Tests use a separate `orderdesk_test` DB rebuilt from migrations each run; `tests/test_migrations.py` fails if models
  and migrations drift.
- Windows note: PowerShell 5.1 `Set-Content -Encoding utf8` adds a BOM that breaks `alembic.ini`/`.env`; edit those with
  the editor or Python.
- Next: see `docs/TRACKER.md` "Next up" (git commit, Node 22 LTS, M0-06 mobile).
