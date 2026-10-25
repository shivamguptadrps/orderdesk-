# Decisions (MVP)

Taken on 24 Oct 2026. Change only by adding a new dated line, never by silent edit.

| # | Area | Decision |
| --- | --- | --- |
| D1 | First customer | FMCG distributor (family business) |
| D2 | Platform | Android only. English UI. Hindi UI later |
| D3 | App model | One shared app. Shop adds a distributor by join code (or QR / invite link) and switches between them |
| D4 | Visibility | A shop sees only items and prices of distributors it has joined. No public directory |
| D5 | Prices | One price per pack size per distributor. No price groups, schemes or GST in MVP |
| D6 | Payment | No payment in app; settled offline. Keep a `payment_status` field so payments can be added later |
| D7 | Stock | Single stock number per product. No godowns/warehouses. Deducted only at dispatch |
| D8 | Bill | Simple bill: items, qty, rate, line total, grand total. No GST, no tax fields. Share as PDF / WhatsApp |
| D9 | Integrations | None (no Tally, no accounting export) |
| D10 | Catalog | Distributor adds own products (app form + Excel import) |
| D11 | Product text | Name/description accept Hindi, English or Hinglish. Search must match all three |
| D12 | Login | Mobile number + WhatsApp OTP |
| D13 | Agents | Distributor's field agents place orders for shops; order is tagged with the agent |
| D14 | Approval | Every order waits for distributor approval; distributor can edit quantities before approving |
| D15 | Hosting | Oracle Cloud Always Free to start; access by IP during testing, free DuckDNS subdomain + HTTPS before real shops use it |
| D16 | Product features | Category defines its attribute template (sugar: weight, grain; mobile: RAM, storage). Stored as JSONB on product |
| D17 | Product fields | 24 Oct 2026: added optional `sku` (unique per distributor, for Excel re-import and photo matching), optional `mrp` (display only, not tax), and optional `max_qty` per pack size |
| D18 | Orders | 24 Oct 2026: a shop can cancel only while pending; staff can cancel pending or approved orders. A product that appears in any order can't be deleted, only hidden. The bill is titled "Order bill - Not a tax invoice" |
| D19 | Agents | 24 Oct 2026: agents order only for shops assigned to them and active; they see orders they placed plus orders of their assigned shops; they can cancel only their own pending orders. Shops added by an agent wait for approval unless the owner turns on auto-approve. Staff may also order for any active shop (source = admin) |
| D20 | Related products | 25 Oct 2026: links are rebuilt nightly (02:30 IST) inside the API process and stored in `product_relations` (top 12 per product + pinned). The +0.1 "this shop bought it before" part is added when a shop asks, never stored. Only in-stock products are suggested. In the cart, look-alikes from the same category are skipped unless bought together or pinned. Pins work both ways |
| D21 | Notifications | 25 Oct 2026: Expo push service (one token per phone; a phone belongs to the last user who logged in; logout removes it). Staff get: new order, shop cancelled, shop wants to join. Shop (and the agent who placed it) get: approved, rejected, dispatched, delivered, cancelled by distributor, shop approved. Sent after the response; a failed push never fails the action |
| D22 | Shop UI | 25 Oct 2026: shopping-app patterns: ADD button on every product card turning into − qty + (pack min/step rules), floating cart bar, % OFF vs MRP, "Best value" pack, Buy again row, bill summary in cart, order progress tracker. The app also runs in a web browser for dev screenshots only (localStorage instead of SecureStore on web) |
| D23 | Banners | 25 Oct 2026: each distributor can show up to 20 home-screen banners: a designed photo (2:1, saved at 1400px) or a title + subtitle on a chosen colour. A banner can open a category. Order and on/off are set by owner/staff. The distributor's brand colour and logo style the shop home header |
| D24 | Ordering | 25 Oct 2026: placing an order always goes through a review screen (address, items, total). The app sends the total the buyer saw; if prices or quantities changed meanwhile the server refuses (409) and the buyer reviews again. Quantities can be typed, within the pack's min/step/max |
| D25 | Shop location | 25 Oct 2026: shops can save a GPS pin ("Use my current location", ideally while at the shop; agents can do it during sign-up). Optional. Each order keeps a copy of the pin; the distributor gets "Open in Maps" on orders and shops |
| D26 | Agents | 25 Oct 2026: agents see only shops assigned to them by default (beats, accountability, privacy). Owner can switch on "Agents can order for all shops" (every active shop). Owner/staff assign shops one by one (Shops screen) or in bulk per agent (Team); a shop has at most one agent |
| D27 | Platform admin | 25 Oct 2026: distributors are added from the app by the OrderDesk operator, not only by script. Two locks: the phone must be in PLATFORM_ADMIN_PHONES and the request must carry X-Admin-Key = PLATFORM_ADMIN_KEY (>= 24 chars, server .env only). Others get 404. Suspending a distributor hides it from its team and shops; nothing is deleted |
| D28 | Categories & features | 25 Oct 2026: owner/staff manage categories and their product features from the app (More > Categories). Up to 3 levels; a sub-category inherits its parents' features (edited only where they are defined). A feature's type can't change after creating; deleting one removes that value from products. A category can be deleted only when it has no products and no sub-categories. Category photo (square) replaces the icon on the shop home |
