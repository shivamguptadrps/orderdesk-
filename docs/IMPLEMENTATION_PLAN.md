# Implementation Plan

Goal: a working MVP your uncle can use with real shops, built in 9 milestones.
Backend first (so the app has something real to call), then the mobile app, then polish and launch.
Each milestone ends with something you can run and show.

Rough time for one developer working part-time: 10–12 weeks. Estimates are guesses; the tracker shows real progress.

---

## M0 — Workspace setup (1–2 days)

- Install: Python 3.12, Node 20 LTS, Docker Desktop, Android Studio emulator (or a real phone with Expo Go), Git.
- `git init` in this folder, add `.gitignore` for Python, Node, `.env`.
- `deploy/docker-compose.yml` with PostgreSQL 16 for local dev.
- `backend/` skeleton: FastAPI app with `/health` endpoint, settings from `.env`, Alembic configured.
- `mobile/` skeleton: `npx create-expo-app` with TypeScript and Expo Router, one screen calling `/health`.

**Done when:** phone/emulator shows "API OK" from your local backend.

---

## M1 — Accounts, distributors and shops (1 week)

**Tables**

| Table | Key columns |
| --- | --- |
| users | id, phone (unique), name, created_at |
| otp_requests | phone, code_hash, expires_at, attempts |
| tenants (distributors) | id, name, join_code (unique), logo_url, brand_color, status |
| tenant_members | tenant_id, user_id, role (`owner`, `staff`, `agent`) |
| shops | id, owner_user_id, shop_name, owner_name, address, city, pincode, lat, lng, photo_url |
| distributor_shops | tenant_id, shop_id, status (`pending`, `active`, `blocked`), agent_user_id, joined_via_code |

Shops have **no tenant_id**: one shop record, linked to many distributors through `distributor_shops`.
Every other business table carries `tenant_id`.

**API**

- `POST /auth/otp/request` → sends WhatsApp OTP (dev: logs it). Rate limit 3 per 10 min per phone.
- `POST /auth/otp/verify` → returns JWT access token (30 days) + refresh token.
- `GET/PUT /me`, `POST /shops` (create my shop profile), `GET /shops/me`.
- `POST /shops/me/distributors {join_code}` → creates `distributor_shops` row with status `pending`.
- `GET /shops/me/distributors` → list joined distributors with status.
- Distributor side: `GET /t/{tenant}/shops?status=pending`, `POST /t/{tenant}/shops/{id}/approve|block`, assign agent.

**Tenant safety**

- A dependency `get_tenant_context()` reads `{tenant}` from the URL, checks the user is a member (or an active linked shop), and attaches `tenant_id` to the request.
- Every query in tenant modules filters by `tenant_id`. Add a test that tries to read another tenant's data and expects 404.
- PostgreSQL row-level security can be switched on later; filtering in code is enough for MVP.

**Done when:** you can log in with OTP, create a shop, enter your uncle's join code, and approve it from the distributor account (via Swagger UI at `/docs`).

---

## M2 — Catalog: categories, features, products, pack sizes (1.5 weeks)

**Tables**

| Table | Key columns |
| --- | --- |
| categories | tenant_id, parent_id, name, image_url, sort_order |
| attribute_definitions | tenant_id, category_id, key, label, type (`text`,`number`,`select`,`boolean`), unit, options[], required, is_filter |
| products | tenant_id, category_id, name, brand, description, search_aliases, attributes JSONB, images[], status (`active`,`hidden`) |
| product_units | product_id, name (Piece/Box/Carton), pieces_per_unit, price, min_qty, step_qty, is_default, sort_order |
| stock | tenant_id, product_id, qty_pieces |
| stock_ledger | tenant_id, product_id, change_pieces, reason (`opening`,`purchase`,`dispatch`,`adjust`,`return`), ref_order_id, user_id, note, created_at |

**How product features work**

1. Distributor creates categories (FMCG starter template is pre-loaded: Staples › Sugar, Rice, Atta, Oil; Snacks › Chips, Biscuits; Beverages; Personal care; Home care).
2. Each category has attribute definitions. Sugar: Pack weight (number, kg), Grain (select: fine/medium/bold). Sub-categories inherit parent attributes.
3. Product form = common fields + the category's attributes. Values saved in `products.attributes` JSONB, e.g. `{"weight_kg": 1, "grain": "medium"}`.
4. Backend validates attributes against the category's definitions (required, type, allowed options).

**Pack sizes:** stock is always counted in pieces. A unit is just "N pieces at price P". MOQ and step are per unit.

**Hindi / English / Hinglish search**

- Store text as-is (UTF-8). Postgres extension `pg_trgm` with a trigram index on `name || brand || search_aliases`.
- `search_aliases` is a free text field the distributor fills: `cheeni, chini, शक्कर, sugar`. This is what makes Hinglish work without translation.

**API**

- Distributor: CRUD for categories, attribute definitions, products, units; `POST /t/{tenant}/stock/adjust`; `POST /t/{tenant}/products/import` (Excel).
- Shop: `GET /t/{tenant}/catalog/categories`, `GET /t/{tenant}/catalog/products?category=&q=&filters=`, `GET /t/{tenant}/catalog/products/{id}`.
- Images: upload to local disk in dev, Cloudflare R2 / Oracle Object Storage in prod. Resize to 800px and 200px thumbnails on upload.

**Done when:** your uncle's 20 real products exist with pack sizes, photos and stock, and search for "cheeni" finds sugar.

---

## M3 — Cart, orders, approval, dispatch, bill (2 weeks)

**Tables**

| Table | Key columns |
| --- | --- |
| carts | tenant_id, shop_id, updated_at (one per shop per distributor) |
| cart_items | cart_id, product_id, unit_id, qty |
| orders | tenant_id, order_no (per-tenant sequence), shop_id, placed_by_user_id, source (`shop`,`agent`,`admin`), status, note, items_total, payment_status (`unpaid` default, unused in MVP) |
| order_items | order_id, product_id, unit_id, product_name, unit_name, pieces_per_unit, qty_ordered, qty_approved, qty_dispatched, rate, line_total |
| order_events | order_id, from_status, to_status, user_id, note, created_at |

Product name, unit and rate are **copied** into `order_items` so old bills never change when prices change.

**Order statuses:** `pending` → `approved` → `dispatched` → `delivered`; or `rejected` / `cancelled`.

**Rules**

- Add to cart validates MOQ, step, and that qty ≤ available stock (soft check).
- Place order: creates order from cart, empties cart. Shop can cancel while `pending`.
- Approve: distributor may edit `qty_approved` per line or remove lines; shop gets notified.
- **Dispatch (the stock moment):** in one DB transaction, lock each `stock` row (`SELECT ... FOR UPDATE`), check enough pieces, subtract `qty_dispatched × pieces_per_unit`, write `stock_ledger` rows. If short, the API returns which lines are short so the distributor can reduce them.
- Delivered: simple status change.

**Simple bill**

- `GET /t/{tenant}/orders/{id}/bill.pdf`: distributor name, shop name, order no, date, table of item / qty / rate / amount, grand total. No tax.
- Generated with WeasyPrint (HTML template → PDF). Share button in app opens WhatsApp with the PDF.

**Done when:** a shop places an order, your uncle edits a quantity, approves, dispatches, stock drops correctly, and the bill PDF opens on the phone.

---

## M4 — Agents (1 week)

- Distributor adds an agent by phone number (`tenant_members.role = agent`).
- Agent logs in with the same app; the app shows "Agent mode" for that distributor.
- `GET /t/{tenant}/agent/shops`: shops assigned to this agent.
- Agent picks a shop and uses the same cart/order flow; order gets `source=agent`, `placed_by_user_id=agent`. Shop sees it in their orders.
- Agent can onboard a new shop: creates shop + `distributor_shops` link (pending, or auto-active if the distributor allows).
- Later (not MVP): beat plans, GPS check-in, targets, offline mode.

**Done when:** an agent places an order for a shop and it appears for both the shop and the distributor, tagged with the agent's name.

---

## M5 — Mobile app: shop owner (2 weeks)

Screens (match the prototype on the design canvas):

1. Login: phone → WhatsApp OTP.
2. Create shop profile (first login only).
3. Add distributor: enter code / scan QR. Pending screen until approved.
4. Distributor switcher in the header ("Ordering from: …"), with logo and colour.
5. Home: categories, search, product grid.
6. Product page: images, features table, pack-size selector, qty stepper with MOQ/step, related products.
7. Cart (per distributor): lines, edit qty, remove, note, total, Place order.
8. Order placed confirmation.
9. My orders: all distributors, filter by distributor, status timeline, bill PDF, Reorder.
10. Profile: shop details, linked distributors, logout.

Tech notes: React Query for server data with cache; Zustand for selected distributor; token in Expo SecureStore; images via `expo-image` with caching.

**Done when:** you can do the full order flow on a real Android phone against the dev server.

---

## M6 — Distributor tools (1.5 weeks)

Distributor mode in the **same mobile app** for the MVP (your uncle uses his phone); a web admin comes later.

- Orders queue: pending first, approve / edit qty / reject, dispatch, mark delivered.
- Products: add/edit with category features, pack sizes, photos from camera, stock adjust.
- Shops: pending requests, approve, assign agent, block.
- Agents: add/remove.
- Settings: join code + QR to share, logo, brand colour.
- Excel import is easier on a computer: add a minimal web page for upload only (`admin-web/` or a FastAPI-served page).

**Done when:** your uncle can run the business day from his phone without Swagger.

---

## M7 — Related products, notifications, polish (1 week)

- **Related products:** nightly job (simple cron in the backend container) fills `product_relations` with score = 0.4 × bought-together + 0.25 × same sub-category + 0.15 × attribute match + 0.1 × this shop bought before + 0.1 × manually pinned. Until orders exist, category + manual links carry it.
- **Notifications:** Expo push for order placed / approved / dispatched. WhatsApp utility templates optional.
- Empty states, loading skeletons, error messages, pull-to-refresh.
- Basic reports for the distributor: today's orders, top products, low stock list.

---

## M8 — Deploy and pilot (1 week)

- Oracle Cloud Always Free VM (Ampere, Mumbai or Hyderabad home region). Docker Compose: `api`, `db`, `caddy` (HTTPS).
- Free DuckDNS subdomain → Caddy gets an HTTPS certificate automatically.
- Nightly `pg_dump` backup to Object Storage; keep 14 days.
- Sentry free tier for crash and error reports (backend and app).
- Build APK with EAS Build; share directly with 5–10 pilot shops before publishing on Play Store.
- Play Store: internal testing track → production.

**Done when:** your uncle and 10 real shops order through the app for one week.

---

## After MVP (not now)

Hindi UI · web admin · agent offline mode, beats and GPS visits · online payments and dues · GST invoice · price groups and schemes · second distributor onboarding · branded app add-on · billing for SaaS plans.

---

## Working rules

- One milestone at a time; finish its "Done when" before starting the next.
- Every API change gets a test (`pytest`) for the happy path and the tenant-isolation case.
- Database changes only through Alembic migrations.
- Never commit `.env`, keys or real customer data.
- Update `docs/TRACKER.md` at the end of every work session.
