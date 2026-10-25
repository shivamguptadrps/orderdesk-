# Publishing OrderDesk on Google Play

Everything needed for the Play Console, in the order you'll meet it. Images are in `docs/play-store/`.

## Status

| Item | State |
| --- | --- |
| Developer account | Registered; identity verification pending (applied 25 Oct 2026) |
| Account deletion (in app + web page) | Done: Profile / More › *Delete my account*; https://orderdesk.kamkarao.com/delete-account |
| Privacy policy | Done: https://orderdesk.kamkarao.com/privacy |
| Reviewer login (fixed code, no WhatsApp) | Done in code; set `REVIEW_PHONE` / `REVIEW_CODE` on the server |
| App icon, feature graphic, 8 screenshots | Done (`docs/play-store/`) |
| Store build (.aab, version numbers count up by themselves) | Done: `eas build -p android --profile production` |
| Unused Android permissions removed | Done (microphone, overlay, fingerprint, old storage) |
| **WhatsApp OTP live** | **To do** (needs Meta setup, see below). The server must stop showing the code on screen before public release |
| Closed test, 12 testers for 14 days | After verification |

## 1. Before the first upload

1. Server `.env` (on the server, never in git):
   - `SUPPORT_EMAIL=` the contact email (shown on the privacy and deletion pages)
   - `REVIEW_PHONE=+91XXXXXXXXXX` and `REVIEW_CODE=XXXXXX` (any 6 digits; the reviewer uses these)
2. WhatsApp OTP (below), then `APP_ENV=prod` and `OTP_MODE=whatsapp`. With those set, the app no longer shows the code.
3. Build: `cd mobile && npx eas-cli build -p android --profile production` → gives an `.aab`.

## 2. WhatsApp OTP (Meta, direct)

1. business.facebook.com → create/choose the business → **WhatsApp Manager**, add a phone number that is *not* already on WhatsApp (a new SIM is easiest).
2. Business verification (documents of the distributor business) – can take a few days.
3. Message template: category **Authentication**, name e.g. `orderdesk_login`, language English, with the **copy code** button.
4. System user with a permanent token (WhatsApp permissions).
5. Server `.env`: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE=orderdesk_login`, `WHATSAPP_TEMPLATE_LANGUAGE=en`, then `OTP_MODE=whatsapp`.

Cost: authentication messages are charged per message by Meta (small amount in India).

## 3. Store listing

**App name** (30 max): `OrderDesk: Distributor Orders`

**Short description** (80 max):
`Order from your distributors, track every order, and run sales in one app.`

**Full description:**

```
OrderDesk connects shops with the distributors they buy from.

FOR SHOPS
• Add your distributor with their join code or QR
• Browse their products with photos, pack sizes, MRP and your price
• Search in English, Hindi or Hinglish ("cheeni", "चीनी", "sugar")
• Add to cart, review and place the order in a few taps
• Track it: waiting, approved, on the way, delivered
• Call the distributor right from the order to confirm it fast
• Order again from past orders; share the bill as PDF

FOR DISTRIBUTORS
• Your own catalogue: categories, features, sizes (1 kg / 5 kg), pack sizes and prices
• New orders ring on your phone; approve, edit quantities, dispatch
• Stock is updated automatically on dispatch
• Counter sale for walk-in customers, with paid / not paid
• Field agents order for the shops assigned to them
• Reports: sales by day, top products and categories, agent performance, shops that stopped ordering, money to collect
• Banners, logo and brand colour for your shops' home screen
• Excel import for many products at once

Payments are settled outside the app. OrderDesk does not show ads.
```

**Category:** Business. **Tags:** Business, Productivity.
**Contact email:** the support email. **Website:** https://orderdesk.kamkarao.com/app
**Privacy policy:** https://orderdesk.kamkarao.com/privacy

**Graphics:** `icon-512.png`, `feature-graphic-1024x500.png`, phone screenshots `screenshots/1..8` (1080×1920).

## 4. App content (Policy) forms

**App access:** *All or some functionality is restricted* → add instructions:
```
Sign in with mobile number <REVIEW_PHONE without +91> and code <REVIEW_CODE>.
This test account is a shop that has joined the demo distributor, and is also staff of it:
use Profile › Switch to see distributor mode (orders, products, reports).
```

**Ads:** No ads.

**Content rating:** Category *Utility, Productivity, Communication or Other*. Answer No to violence, sexuality, language, drugs, gambling. Users can interact/chat? *No* (no chat between users). Shares the user's location with other users? *Yes* – a shop's saved map pin is visible to the distributor it orders from. This adds an "interactive elements: shares location" note; it does not raise the age rating.

**Target audience:** 18 and over. Not designed for children.

**News app:** No. **Government app:** No. **Financial features:** None (no payments in app). **Health:** No.

**Data safety** (data is encrypted in transit: Yes; users can request deletion: Yes, link the delete page):

| Data type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| Personal info › Name | Yes | No* | Yes | App functionality, Account management |
| Personal info › Phone number | Yes | No* | No | Account management, App functionality |
| Personal info › Address | Yes | No* | No (for shops) | App functionality |
| Location › Precise location | Yes | No* | Yes | App functionality (shop map pin, only when the user taps the button) |
| Financial info › Purchase history | Yes | No* | No | App functionality, Analytics (reports for the distributor) |
| Photos | Yes (distributors' product photos) | No | Yes | App functionality |
| Device or other IDs | Yes (push notification token) | No | No | App functionality |

\* Shown to the distributor the shop chose to order from, which is part of the service the user asked for. Google counts data sent to service providers (Meta for the code, Firebase/Expo for notifications, our host) as not "shared".

Data is not sold. No data is used for ads or tracking.

## 5. Testing track (personal developer accounts)

1. Play Console › Testing › **Closed testing** › create track, upload the `.aab`.
2. Testers: add an email list of at least **12** people (Gmail accounts they use on Android); share the opt-in link.
3. They install from the Play Store link and use it; keep at least 12 opted in for **14 days**.
4. Then Production › *Apply for production* (answer the short questions about the test).

## 6. Each new release

```
cd mobile
npx eas-cli build -p android --profile production   # version number goes up by itself
npx eas-cli submit -p android --profile production  # needs a Play service-account key; or upload the .aab by hand
```
