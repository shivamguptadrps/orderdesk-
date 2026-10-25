# Tracker

## How to use this file

- Each task has an ID (`M1-03`). Refer to it in commit messages: `M1-03 add OTP verify endpoint`.
- Status markers:
  - `[ ]` not started
  - `[~]` in progress
  - `[x]` done (meets the milestone's "Done when" for that part)
  - `[-]` dropped (write why in the Notes column)
- Only one milestone "In progress" at a time.
- At the end of every session: update statuses, add a line to the Session log, write the next step under "Next up".
- Blocked on something? Add it to "Blockers" with the date.

## Overview

| Milestone | Status | Started | Finished |
| --- | --- | --- | --- |
| M0 Workspace setup | Done | 24 Oct 2026 | 24 Oct 2026 |
| M1 Accounts, distributors, shops | Backend done | 24 Oct 2026 | |
| M2 Catalog, features, pack sizes, stock | Done (real products pending) | 24 Oct 2026 | 24 Oct 2026 |
| M3 Cart, orders, approval, dispatch, bill | Done | 24 Oct 2026 | 24 Oct 2026 |
| M4 Agents | Done | 24 Oct 2026 | 24 Oct 2026 |
| M5 Mobile app: shop owner | Built, phone check pending | 24 Oct 2026 | |
| M6 Distributor tools | Built, phone check pending | 24 Oct 2026 | |
| M7 Related products, notifications, polish | Done (push needs `eas init` to reach phones) | 24 Oct 2026 | 25 Oct 2026 |
| M8 Deploy and pilot | In progress: staging server live | 25 Oct 2026 | |

## Next up

1. Phone test of the new shop UI (M7 polish) and distributor tools; fix what feels wrong.
2. Run `npx eas init` in `mobile/` (links the app to an Expo project id) so iPhone/Android can get push tokens; then test notifications.
3. M8: deploy + pilot (EAS build APK needs the same project id).
4. Later: uncle's real account + real products; Meta WhatsApp number for real OTPs.

## Blockers

| Date | Blocker | Owner |
| --- | --- | --- |
| | | |

---

## M0 — Workspace setup

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M0-01 | Workspace folder, README, plan, tracker, decisions | [x] | 24 Oct 2026 |
| M0-02 | Install Python 3.12, Node 20, Docker Desktop, Git, Android emulator or Expo Go | [x] | Python 3.11.4, Node 22.23.4 LTS, Docker Desktop 4.96.3, Git 2.41. Expo Go on phone still to install |
| M0-03 | `git init`, `.gitignore`, first commit | [x] | First commit 11c7097 |
| M0-04 | `deploy/docker-compose.yml` with PostgreSQL 16 | [x] | Postgres 16 running in Docker |
| M0-05 | Backend skeleton: FastAPI `/health`, settings, Alembic | [x] | Runs on laptop; /health shows db ok |
| M0-06 | Mobile skeleton: Expo + TS + Router, calls `/health` | [x] | Verified 24 Oct 2026 on an iPhone with Expo Go: "API OK". iPhone Expo Go needs the laptop logged in too (`npx.cmd expo login --no-browser`) |

## M1 — Accounts, distributors, shops

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M1-01 | Tables: users, otp_requests, tenants, tenant_members, shops, distributor_shops + migration | [x] | Migration 0001 (+ refresh_tokens table). Test checks models match migrations |
| M1-02 | OTP request (dev log mode) with rate limit | [x] | 3 per 10 min per phone; 5 min expiry; 5 wrong tries max |
| M1-03 | OTP verify → JWT access + refresh | [x] | Access JWT 30 days; refresh token 180 days, rotated on use, stored hashed; /auth/logout |
| M1-04 | WhatsApp Cloud API sender behind a feature flag | [~] | Code written (app/core/otp_sender.py), untested: needs Meta number + approved template |
| M1-05 | Shop profile create / read / update | [x] |  |
| M1-06 | Join distributor by code; list my distributors | [x] | Code is case-insensitive; joining twice returns the same link |
| M1-07 | Distributor: list pending shops, approve, block, assign agent | [x] | Owner/staff only; agent must be an agent of the same tenant |
| M1-08 | Tenant context dependency + isolation tests | [x] | app/core/tenancy.py; isolation tests in tests/test_tenant_shops.py |
| M1-09 | Seed script: uncle's distributor account + join code | [x] | python -m scripts.seed_tenant ... (uncle's real account still to create) |

## M2 — Catalog, features, pack sizes, stock

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M2-01 | Tables: categories, attribute_definitions, products, product_units, stock, stock_ledger | [x] | Migration 0002 (+ pg_trgm). Products also have sku, mrp; pack sizes have max_qty (D17) |
| M2-02 | FMCG starter template (categories + attributes) loaded for a new tenant | [x] | app/modules/catalog/templates.py; loaded by create_tenant |
| M2-03 | Category and attribute CRUD (with inheritance from parent) | [x] | Max 3 levels; feature keys unique along parent/child line; deleting a feature strips it from products |
| M2-04 | Product CRUD with attribute validation | [x] | Values checked for type/required/options; select options case-insensitive |
| M2-05 | Pack sizes (units) with MOQ and step | [x] | Exactly one default pack size kept automatically |
| M2-06 | Image upload + thumbnails | [x] | Local disk under backend/uploads, served at /media; 800px + 200px JPEG; EXIF rotation fixed; max 10 photos |
| M2-07 | Stock adjust endpoint writing the ledger | [x] | change (pieces or pack size) or set_to; row lock; can't go below 0; concurrency test |
| M2-08 | Shop catalog endpoints: categories, list with filters, detail | [x] | Category tree, filters endpoint, list with q/category/brand/filters/in_stock_only, detail |
| M2-09 | Search with pg_trgm over name, brand, aliases (Hindi/English/Hinglish) | [x] | Exact (every word) first; fuzzy (word_similarity >= 0.4) only when nothing matches exactly |
| M2-10 | Excel import per category (template download + upload) | [x] | Template per category with dropdowns; dry run; all-or-nothing; SKU updates existing product |
| M2-11 | Enter 20 real products from uncle's catalog | [~] | 20 DUMMY products with generated photos (scripts/seed_demo_catalog.py). Uncle's real products still to enter |

## M3 — Cart, orders, approval, dispatch, bill

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M3-01 | Tables: carts, cart_items, orders, order_items, order_events | [x] | Migration 0003; per-tenant order counter on tenants; cart per (tenant, shop, user) so agents get their own in M4 |
| M3-02 | Cart per shop per distributor: add / update / remove with MOQ + step checks | [x] | Cart row locked on every change; min/step/max and stock (summed across pack sizes) checked |
| M3-03 | Place order from cart (copy name, unit, rate) | [x] | Re-validates at placement; copies name, pack, rate, shop name/address; double tap -> one order |
| M3-04 | Shop: my orders across distributors, cancel while pending | [x] | /shops/me/orders across distributors (works even if blocked); cancel while pending |
| M3-05 | Distributor: order queue, edit approved qty, approve, reject | [x] | Approve with qty edits (0 removes line), reject with reason, staff cancel pending/approved |
| M3-06 | Dispatch: locked stock deduction + ledger + short-stock response | [x] | Stock rows locked in fixed order; all-or-nothing; 409 lists short lines with qty_possible. Concurrency tests verified by removing the locks (they fail) |
| M3-07 | Mark delivered | [x] |  |
| M3-08 | Simple bill PDF (no tax) | [x] | fpdf2 + Noto fonts (Hindi shaped correctly), Indian number format, 'Not a tax invoice' |
| M3-09 | Reorder from a past order | [x] | Today's prices; hidden/deleted products skipped and listed |

## M4 — Agents

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M4-01 | Distributor adds / removes agent by phone | [x] | Generalised to team management: /members (staff + agents), owner/staff permissions; removal unassigns shops |
| M4-02 | Agent: my assigned shops | [x] | /agent/shops with agent name and last order date; staff can filter /shops by agent |
| M4-03 | Agent places order for a shop (source = agent) | [x] | Same cart/order endpoints with ?shop_id=; assigned active shops only; source=agent. Staff can do the same (source=admin) |
| M4-04 | Agent onboards a new shop | [x] | POST /agent/shops; pending unless owner enables auto-approve (PUT /settings); existing shop profiles linked unchanged |

## M5 — Mobile app: shop owner

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M5-01 | API client, auth store, SecureStore token | [x] | src/lib/api.ts (token, single-flight refresh, readable errors), auth + session stores in SecureStore, React Query |
| M5-02 | Login + OTP screens | [x] | Phone + OTP; dev builds show the code on screen (backend returns it only with APP_ENV=dev + OTP_MODE=log) |
| M5-03 | Shop profile screen | [x] | Create on first login, edit from Profile |
| M5-04 | Add distributor by code + QR scan + pending state | [x] | Code entry + QR scan (expo-camera); pending / blocked messages |
| M5-05 | Distributor switcher with branding | [x] | Header switcher + 'Ordering from' modal; brand colour on the name. Logos not shown yet |
| M5-06 | Home: categories, search, product grid | [x] | Category + sub-category chips, debounced search (Hindi/Hinglish), 2-column grid with photos, out-of-stock badge |
| M5-07 | Product page: features table, pack sizes, qty stepper | [x] | Photo gallery, pack size cards (price per piece, min/step), stepper that respects min/step/max, features table |
| M5-08 | Cart and place order | [x] | Line problems in red, qty edit, remove, note, total, place order -> order screen |
| M5-09 | My orders, status timeline, bill PDF share, reorder | [x] | List with status filter (all distributors), timeline, item changes, bill PDF share (WhatsApp), reorder, cancel |
| M5-10 | Agent mode: shop picker, order on behalf | [x] | Agent mode: choose distributor + shop, separate cart per shop, orders for my shops, sign up a shop |

## M6 — Distributor tools

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M6-01 | Orders queue with approve / edit / reject / dispatch / deliver | [x] | Queue (waiting oldest first), approve with qty edits, reject with reason, dispatch with short-stock auto-reduce, deliver, cancel, call shop, bill |
| M6-02 | Product add / edit with category features and camera photos | [x] | Create/edit with category features, pack sizes, on-sale switch, photos from camera/gallery, delete |
| M6-03 | Stock adjust screen + low stock list | [x] | Stock received / counted / removed, by pack size; history; low stock = under 2 of the main pack |
| M6-04 | Shops: approve requests, assign agent | [x] | Waiting/active/blocked lists, approve, decline/block/unblock, assign agent, call |
| M6-05 | Agents management | [x] | Team: add/remove agents and staff (staff only by owner) |
| M6-06 | Join code + QR share, logo, colour | [x] | Join code + QR (share as text or image), new code, name, brand colour, logo, agent auto-approve |
| M6-07 | Excel upload page (web) | [x] | Served by the backend at /import: OTP login, pick category, download template, check, save |

## M7 — Related products, notifications, polish

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M7-01 | product_relations table + nightly scoring job | [x] | `catalog/related.py`; nightly 02:30 IST in the API process, `scripts/rebuild_related.py`, `POST /t/{t}/related/rebuild`; pins both ways |
| M7-02 | Related products on product page and cart | [x] | "Customers also buy" on product page, "You may also need" in cart, "Buy again" on home; editor shows links + pin/unpin |
| M7-03 | Expo push: placed / approved / dispatched | [~] | Backend + app done (also rejected/delivered/cancelled, shop join/approved); tap opens the order. Phones get tokens only after `eas init` adds the project id |
| M7-04 | Empty, loading and error states across app | [x] | Skeleton loaders, pull-to-refresh; plus shop UI redesign (ADD/stepper cards, cart bar, MRP % off, bill summary, order tracker), checked with phone-size screenshots |
| M7-05 | Distributor mini reports: today's orders, top products, low stock | [x] | Reports screen: today/7/30/90 days, sales per day chart, status counts, top products/shops/agents |

## M8 — Deploy and pilot

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| M8-01 | Oracle Cloud Always Free VM (home region Mumbai/Hyderabad) | [x] | Using the existing server 140.245.242.194 (Ubuntu 20.04, 4 CPU, 15 GB) shared with kamkarao.com |
| M8-02 | Docker Compose prod: api, db, caddy | [x] | `deploy/server/`: own db + api; kamkarao's Caddy proxies to `orderdesk-api`. APP_ENV=staging (codes shown in app) until WhatsApp |
| M8-03 | DuckDNS subdomain + HTTPS | [x] | https://orderdesk.kamkarao.com (GoDaddy A record, Let's Encrypt via Caddy) |
| M8-04 | Nightly DB backup, 14-day retention | [x] | root cron 02:30 IST -> ~/orderdesk-backups (db + photos). Copy off-server now and then |
| M8-05 | Sentry for backend and app | [ ] | |
| M8-06 | EAS build APK, install on pilot phones | [~] | EAS project linked; `preview` profile = APK for the server. Firebase (FCM) set up 25 Oct; push works from the next APK |
| M8-07 | Pilot: uncle + 10 shops for one week; collect feedback | [ ] | |
| M8-08 | Play Store internal testing → production | [ ] | |

---

## Session log

| Date | What was done | Next step |
| --- | --- | --- |
| 25 Oct 2026 | Call to confirm: distributor contact number (`tenants.contact_phone`, migration 0009; empty = owner's phone; mobile or landline) set in Business profile; shops see a "Call <distributor> · number" button on the order-placed screen and on pending orders. Additive API fields only (old apps unaffected). 156 tests | APK, then product variants |
| 25 Oct 2026 | New-order ring: Android channel `new_orders` (bell sound `order_ring.wav`, max importance, long buzz, lock screen); server sends new orders to it, other updates stay on `default`. Firebase project `orderdesk-4b789`: FCM V1 key uploaded to EAS, google-services.json kept out of git (EAS file variable GOOGLE_SERVICES_JSON; profiles set `environment`). Installed expo-asset (doctor 20/20) | Build APK when asked, test a real order ringing |
| 25 Oct 2026 | Categories & features screen (More > Categories): category tree with reorder, add/rename/delete, category photo (shows on shop home), product count; per-category features (choice list / number / text / yes-no, unit, filter, required), inherited ones shown read-only. Backend: category photo upload, categories-order, product_count. 154 tests; tsc/lint clean. No APK built (on request) | Phone test after next APK |
| 24 Oct 2026 | Spec, prototype, workspace, plan and tracker created | M0-02: install tools |
| 24 Oct 2026 | Backend skeleton, docker-compose, .gitignore, CLAUDE.md handoff written | Verify backend on laptop, then M0-06 mobile |
| 24 Oct 2026 | Docker updated and working; Postgres up. M1 backend built: OTP login, refresh tokens, /me, shop profile, join by code, distributor approve/block/assign agent, tenant isolation. 31 tests pass; full flow checked on live server | Git commit, Node 22, M0-06 mobile |
| 24 Oct 2026 | Node 22 installed. Expo SDK 58 mobile app created with an API health screen; all checks pass. Firewall change needs the user's OK | Phone test, then M2 |
| 24 Oct 2026 | M2 catalog backend: categories + inherited features, FMCG template, products, pack sizes, stock + ledger, shop catalog with search and filters. 56 tests pass; live search check OK | Images, Excel import, real products |
| 24 Oct 2026 | M2 done: photo upload + thumbnails, Excel template/import, 20 dummy products with photos, stricter search. 68 tests pass; live check over Wi-Fi OK | M3 |
| 24 Oct 2026 | M3 done: cart, orders, approval with edits, dispatch with locked stock deduction, delivery, bill PDF, reorder. 95 tests pass; full flow checked live over Wi-Fi | M4 agents |
| 24 Oct 2026 | Phone shows API OK (iPhone, Expo Go). Added start-dev.cmd. M0 closed | M4 agents |
| 24 Oct 2026 | M4 done: team management, agent shops, ordering for a shop (agent/admin), shop sign-up by agent with optional auto-approve, settings. 111 tests pass; live agent flow checked. Plan updated with status and as-built notes | M5 screens |
| 24 Oct 2026 | M5 app built: login, shop setup, distributors (code/QR), catalog + search, product page, cart, orders, bill share, reorder/cancel, profile, agent mode. tsc + lint + expo-doctor clean, iOS bundle builds | Phone test, then M6 |
| 25 Oct 2026 | Distributor screens redesigned (brand header dashboard, quick actions, orders/products/more). Platform admin in the app (Profile/More > Platform admin): add, list, suspend distributors; needs phone in PLATFORM_ADMIN_PHONES + PLATFORM_ADMIN_KEY (server .env). Deployed. 150 tests | New APK |
| 25 Oct 2026 | Server: OrderDesk deployed next to kamkarao.com on 140.245.242.194 (separate db, shared Caddy), laptop data copied, HTTPS at orderdesk.kamkarao.com, nightly backups. Fixed: api first resolved kamkarao's `db` (now `orderdesk-db`) | WhatsApp OTP, FCM, pilot |
| 25 Oct 2026 | Agent shop assignment: Shops screen opens on Active with No-agent filter, search and an Assign box per shop; Team > agent > tick shops (bulk, moves from other agents); owner setting "Agents can order for all shops". Category page: main categories always in the rail. 146 tests | Phone test, new APK |
| 25 Oct 2026 | Product page redesign (full photo, pack cards, quantity picker with typing + quick picks), tap-to-type qty everywhere, order review screen before placing (server refuses if the total changed), shop GPS location (sign-up, agent sign-up, profile) saved on each order with Open in Maps for the distributor. Click-through test placed an order with qty 5. 144 tests | Phone test |
| 25 Oct 2026 | Storefront redesign: brand-colour header with logo + search, distributor banners (photo or text, link to category, order, on/off; More > Home banners), Shop by category grid, Top deals, category page with sub-category rail, new product cards. Sample banners: `scripts/seed_demo_banners.py`. 142 tests | Phone test |
| 25 Oct 2026 | Fix: a person who is staff/agent and also owns a shop got "shop_id is required" when ordering for their own shop. Own shop is now the default. 139 tests | Phone test |
| 25 Oct 2026 | M7 done: related products (nightly + pins), push notifications (needs eas init on phones), reports, skeletons; shop UI redesigned to shopping-app patterns and verified with screenshots. 137 backend tests; tsc/lint/doctor clean. Fixed: Expo on Node 21 crashed (now Node 22 via nvm) | Phone test, eas init, M8 |
| 24 Oct 2026 | M6 built: distributor mode in the app (dashboard, queue, product editor with photos/stock, low stock, shops, team, settings/QR) + /import web page. 119 backend tests; tsc/lint/doctor clean. Fixed: old backend workers kept serving stale code (start-dev.cmd now stops them) | Phone test M6, then M7 |
