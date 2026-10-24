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
