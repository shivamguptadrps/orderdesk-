# B2B Order App (working name: OrderDesk)

One Android app where shop owners add distributors by code and order from them,
and a distributor (first one: an FMCG distributor) manages products, stock and orders.
Built as multi-tenant SaaS from day one so more distributors can join later.

## Documents

| File | What it is |
| --- | --- |
| `docs/IMPLEMENTATION_PLAN.md` | What we build, in what order, and how each part works |
| `docs/TRACKER.md` | Task checklist. Update it as work moves. This is the source of truth for progress |
| `docs/DECISIONS.md` | Product decisions already taken, so we don't re-debate them |

Full product spec (shared doc): see the "B2B Order Management SaaS — Product Spec" link in the Claude chat.

## Folder layout

```
b2b-order-app/
├── docs/            plan, tracker, decisions
├── backend/         FastAPI + PostgreSQL API (Python)
├── mobile/          Expo React Native app (shop owner + agent + distributor mode)
├── admin-web/       React web panel for the distributor (later milestone)
└── deploy/          docker-compose, server setup scripts
```

## Tech stack

- Mobile: React Native (Expo), TypeScript, Expo Router, React Query, Zustand
- Backend: FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2, PostgreSQL 16
- Background jobs: none in MVP (added when WhatsApp alerts arrive)
- OTP: WhatsApp Cloud API (Meta direct). Dev mode prints OTP in the server log
- Hosting: Oracle Cloud Always Free (Mumbai/Hyderabad), Docker Compose

## Quick start (filled in as milestones complete)

Run these in PowerShell from the `b2b-order-app` folder.

```
# 1. database (Docker Desktop must be running)
cd deploy
docker compose up -d
cd ..

# 2. backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
pytest
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Create a distributor to test with (prints its join code):

```
python -m scripts.seed_tenant --name "Demo Distributor" --owner-phone 9000000001 --join-code DEMO01
```

Load 20 dummy products with photos into it (safe to run again):

```
python -m scripts.seed_demo_catalog --join-code DEMO01
```

In dev, OTP codes are printed in the uvicorn console (`DEV OTP for +91...`).

Open http://localhost:8000/health → should show `"db": "ok"`.
API docs: http://localhost:8000/docs

If PowerShell refuses to run `Activate.ps1`, run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

```
# 3. mobile
cd mobile
npm install
copy .env.example .env.local     # then set your laptop's Wi-Fi IP in it (ipconfig)
npx expo start
```

Install **Expo Go** from the Play Store, keep the phone on the same Wi-Fi, and scan the QR code.
For the phone to reach the laptop, run the backend with `--host 0.0.0.0` and allow ports 8000 and 8081
through Windows Firewall for the local network (one-time, admin PowerShell):

```
New-NetFirewallRule -DisplayName "OrderDesk dev (8000, 8081) - local network only" -Direction Inbound -Protocol TCP -LocalPort 8000,8081 -RemoteAddress LocalSubnet -Action Allow
```
