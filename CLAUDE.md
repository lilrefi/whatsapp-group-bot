# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start with nodemon (auto-reload)
npm start            # Production start

# Database setup (run in order on first deploy)
npm run setup-db     # Creates tables + loads 268 products from schema_product.sql
npm run migrate      # Adds customer_groups table + group_id column to orders
npm run migrate-code # Adds group_profiles table (customer code + overview group)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Source |
|---|---|
| `PHONE_NUMBER_ID` | Meta → WhatsApp → Getting Started |
| `WHATSAPP_ACCESS_TOKEN` | Meta dashboard (temp 24h) or System Users (permanent) |
| `WEBHOOK_VERIFY_TOKEN` | Self-chosen random string; must match Meta webhook config |
| `DATABASE_URL` | PostgreSQL connection string |
| `WEBHOOK_URL` | Public HTTPS URL for this server |

## Architecture

The bot bridges WhatsApp (via Meta Cloud API) and a PostgreSQL database. All HTTP logic lives in `server.js`; message sending is in `whatsapp.js`; DB queries in `database.js`; order logic in `orders.js`; product helpers in `products.js`.

### Request flow

```
Meta webhook POST /webhook
  → handleMessage() in server.js
      → command routing (switch on text prefix)
      → OR session state machine (customerSessions Map)
      → OR handleFreeTextOrder() (NLP order parsing)
  → db.* queries (database.js)
  → sendTextMessage / sendGroupMessage / sendButtonMessage / sendListMessage (whatsapp.js)
```

### Dual-mode: group vs. private (DM)

Every handler accepts `(customerPhone, chatId, ..., isGroup)`. Group chats only support plain text — interactive buttons/lists are DM-only. When a DM order is confirmed, `server.js` posts a summary to the `originatingGroupId` stored in the session.

### Session state machine

`customerSessions` is an in-memory `Map<customerId, session>`. Session `step` values drive the button/list UI flow:

- `main_menu` → `category_select` → `product_select` → `qty_input_text` → `cart_review` → `confirming`
- `group_select` (multi-group customers only)
- `text_order_confirm` (free-text order awaiting YES/CANCEL in group)

Sessions expire after 24 hours via a 1-hour `setInterval`. **For production, replace with Redis.**

### Free-text order parsing

`handleFreeTextOrder()` fires when no command is matched and the text contains a digit + ≥3 non-digit chars. It calls `parseOrderLines()` to split on newlines/commas/` and `, strips noise words and unit labels, then fuzzy-searches products via `searchProductsFuzzy()` (LIKE on full term, then word-by-word fallback).

### Database schema

- `customers` — identified by phone number
- `categories` / `products` — 268 products across 12 categories (loaded from `schema_product.sql`)
- `orders` + `order_items` — orders immediately set to `'completed'` on creation; `group_id` records which group the order came from
- `customer_groups` — maps customers to WhatsApp group IDs (added via `migration_groups.sql`)

### WhatsApp API limits to keep in mind

- Button messages: max 3 buttons, title max 20 chars (`sendButtonMessage`)
- List messages: max 10 rows total across all sections, title max 24 chars, description max 72 chars (`sendListMessage`)
- Interactive messages (buttons/lists) are **not supported in group chats** — always use `sendGroupMessage` for groups
