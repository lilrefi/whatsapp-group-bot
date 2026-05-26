# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start with nodemon (auto-reload, ignores baileys-auth/ and customer_profiles/)
npm start            # Production start

# Database setup (run in order on first deploy)
npm run setup-db     # Creates tables + loads 268 products from schema_product.sql
npm run migrate      # Adds customer_groups table + group_id column to orders
npm run migrate-code # Adds group_profiles table (customer code + overview group)
```

## Environment Variables

| Variable | Source |
|---|---|
| `PHONE_NUMBER_ID` | Meta → WhatsApp → Getting Started |
| `WHATSAPP_ACCESS_TOKEN` | Meta System Users token (permanent) |
| `WEBHOOK_VERIFY_TOKEN` | Self-chosen string; must match Meta webhook config |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `WEBHOOK_URL` | Public HTTPS URL (ngrok in dev) |
| `ADMIN_PASSWORD` | Password for the web admin dashboard at `/admin` |

## Architecture

### System overview

Dual-mode WhatsApp ordering bot for a food supplier:

- **Meta Cloud API** — handles all DM (1-to-1) conversations. Customers order via DM with interactive buttons/lists. Meta cannot join WhatsApp groups.
- **Baileys** (`baileys-bot.js`) — unofficial WhatsApp library running on a separate phone number. Sits inside each restaurant's WhatsApp group and posts order notifications there when an order is confirmed.
- **PostgreSQL on Neon** — stores customers, products, orders, group registrations.
- **Web admin dashboard** (`/admin`) — Bootstrap UI for managing all group registrations, group profiles, and viewing orders.

### File map

| File | Role |
|---|---|
| `server.js` | Express server, webhook handler, all message/session logic |
| `whatsapp.js` | Meta Cloud API send helpers (text, button, list, group messages) |
| `database.js` | All DB queries via `pg` pool |
| `orders.js` | Order creation and repeat-order logic |
| `products.js` | Product search and category helpers |
| `baileys-bot.js` | Baileys WhatsApp connection, `postToGroup()`, `getBaileysGroups()` |
| `profileLookup.js` | Loads customer JSON profiles from `customer_profiles/`, picks best product match by purchase history |
| `admin-router.js` | Express router for `/admin` — auth middleware + CRUD API endpoints |
| `public/admin.html` | Bootstrap 5 single-page admin dashboard |
| `run-sql.js` | Helper to run `.sql` files against the DB (used by npm scripts) |
| `nodemon.json` | Ignores `baileys-auth/` and `customer_profiles/` to prevent restart loops |

### Request flow

```
Meta webhook POST /webhook
  → res.sendStatus(200) IMMEDIATELY (prevents Meta retries)
  → handleMessage() async
      → admin commands (/adminregister, /adminlink, /setoverview)
      → session state machine (customerSessions Map)
      → handleFreeTextOrder() (NLP parsing + profile smart matching)
  → db.* queries (database.js)
  → sendTextMessage / sendButtonMessage / sendListMessage (whatsapp.js) for DMs
  → postToGroup() (baileys-bot.js) for group notifications
```

### Group notification flow

When an order is confirmed via DM:
1. `handleButtonConfirm()` or `text_order_confirm` YES handler fires
2. Sends DM receipt to customer via Meta API
3. Calls `postToGroup(session.originatingGroupId, groupMsg)` via Baileys
4. Looks up `group_profiles` — if `overview_group_id` is set, also posts to the boss/overview group

`originatingGroupId` is set on the session during `handleStartCommand()` from `customer_groups` table. **If a customer has no group registered, this will be null and no group notification fires.**

### Session state machine

`customerSessions` is an in-memory `Map<customerId, session>`. Sessions expire after 24 hours. **For production, replace with Redis.**

| `step` | Meaning |
|---|---|
| `main_menu` | Showing main menu buttons |
| `category_select` | Browsing category list |
| `product_select` | Browsing product list in a category |
| `qty_input_text` | Waiting for user to type a quantity |
| `cart_review` | Showing cart with Confirm/Add More/Clear buttons |
| `confirming` | Order being confirmed |
| `group_select` | Multi-group customer choosing which group to order for |
| `text_order_confirm` | Free-text order parsed in group, waiting for YES/CANCEL |
| `disambiguation` | Multiple products matched, waiting for user to pick one |

### Free-text order parsing + smart matching

`handleFreeTextOrder()` fires when no command matched and text contains a digit + ≥3 non-digit chars:

1. `parseOrderLines()` splits on newlines/commas/` and `, extracts quantity and search term per line
2. `searchProductsFuzzy()` does LIKE search, falls back to word-by-word if no full match
3. If 1 result → resolved immediately
4. If multiple results → `pickBestMatch()` checks customer's JSON profile (`customer_profiles/3000_XXX.json`) for purchase history; picks highest `times_ordered` SKU
5. If no profile match → `disambiguation` flow: asks user to pick which product they meant (buttons in DM, numbered list in group)

### Database schema

- `customers` — identified by phone number
- `categories` / `products` — 268 products across 12 categories
- `orders` + `order_items` — status always `'completed'` on creation; `group_id` records originating group
- `customer_groups` — maps `customer_id → group_id`; one customer can have multiple groups
- `group_profiles` — maps `group_id → customer_code + overview_group_id`

### Admin setup flow (per new restaurant)

1. Create WhatsApp group
2. Add Baileys phone number to the group manually in WhatsApp
3. In admin dashboard (`/admin`) → Registrations tab: register each ordering staff member's phone to the group
4. (Optional) Group Profiles tab: link group to a customer profile code for smart matching
5. (Optional) Group Profiles tab: set an overview/boss group to receive copies of all orders

### Admin WhatsApp commands (DM the bot)

These still work as an alternative to the dashboard:
- `/adminregister [phone] [group_id]` — register a customer to a group
- `/adminlink [group_id] [code]` — link group to customer profile JSON
- `/setoverview [group_id] [boss_group_id]` — set overview group

### WhatsApp API limits

- Button messages: max 3 buttons, title max 20 chars
- List messages: max 10 rows total, title max 24 chars, description max 72 chars
- Interactive messages (buttons/lists) **not supported in group chats** — always use `sendGroupMessage` for groups

## Known issues / decisions

- **Baileys auth**: credentials stored in `baileys-auth/` (gitignored). If deleted, must re-scan QR on next start.
- **In-memory sessions**: server restart clears all active sessions. Users mid-order will need to restart. Replace with Redis for production.
- **Meta webhook retries**: fixed by sending `res.sendStatus(200)` before processing. Previously caused phantom messages hours later when the server was restarting.
- **Duplicate button webhooks**: Meta sometimes delivers button taps twice. `handleButtonConfirm` silently returns if session is already gone. `btn_view_cart` also guards against stale replays.
- **`originatingGroupId` null bug**: if a customer orders without being registered to a group, `session.originatingGroupId` is null and no group notification fires. Fix: register them via the admin dashboard.
- **Baileys on Windows terminal**: `printQRInTerminal: true` doesn't render correctly in PowerShell. Uses `qrcode-terminal` package with `qrcode.generate(qr, { small: true })` instead.
