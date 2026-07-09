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
npm run migrate-zh   # Adds name_zh column to products (legacy, unused — Chinese names live in chinese_name column)
npm run migrate-status      # Adds flagged + confidence_note columns to order_items
npm run migrate-attachments # Adds order_attachments table (photo/voice-note/text attachments)
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `BOT_API_KEY` | Shared secret — must match the value set in db_revamp (Next.js dashboard). All API requests must include `x-api-key: <BOT_API_KEY>` header. |
| `BOT_API_PORT` | Port for the REST API server (default: 3001) |
| `PORT` | Port for any legacy health-check Express app (default: 3000, currently unused) |
| `ANTHROPIC_API_KEY` | Anthropic API key — used by Claude Haiku 4.5 to OCR order text from images sent in WhatsApp groups. |

## Architecture

This project is a **pure backend**: Baileys WhatsApp bot + REST API. There is no frontend here.

The frontend/staff dashboard lives in the **db_revamp** (Next.js) project, which calls this project's REST API.

### Components

- **Baileys** (`baileys-bot.js`) — the only WhatsApp connection. Sits in restaurant WhatsApp groups, receives order messages, sends confirmation messages.
- **Group order handler** (`groupOrderHandler.js`) — core logic: parse free-text orders, smart-match products, manage per-group in-memory sessions, finalize orders to DB.
- **REST API** (`api.js`) — Express server on `BOT_API_PORT`. The db_revamp dashboard calls these endpoints to read pending orders and trigger confirm/cancel.
- **PostgreSQL on Neon** (`database.js`) — stores customers, products, orders, group registrations.

### File map

| File | Role |
|---|---|
| `server.js` | Entry point: starts API server + Baileys connection |
| `api.js` | REST API Express server (all `/api/*` endpoints) |
| `baileys-bot.js` | Baileys WhatsApp connection, message listener, exports admin wrappers |
| `groupOrderHandler.js` | Core order logic: parse, match, sessions, finalize |
| `database.js` | All DB queries via `pg` pool |
| `profileLookup.js` | Loads customer JSON profiles from `customer_profiles/`, picks best product match by purchase history |
| `run-sql.js` | Helper to run `.sql` files against the DB (used by npm scripts) |
| `nodemon.json` | Ignores `baileys-auth/` and `customer_profiles/` to prevent restart loops |

### Request flow

```
Baileys receives group message
  → groupOrderHandler.handleGroupMessage()
      → check group is linked in group_profiles (ignore if not)
      → CANCEL → clear session, reply "❌ Order cancelled."
      → disambiguation reply (pure integer) → handleDisambiguationReply()
      → parseOrderLines() → searchProductsFuzzy() per line
      → pickBestMatch() (uses customer profile JSON if available)
      → ambiguous → askDisambiguation() (numbered list in group)
      → resolved → merge into groupSessions Map (silent — no reply to group)

db_revamp dashboard polls GET /api/pending-orders
  → staff clicks Confirm → POST /api/confirm-order { groupId }
      → adminConfirmGroup() → finalizeOrder() → DB write + group WhatsApp message
  → staff clicks Cancel → POST /api/cancel-order { groupId }
      → adminCancelGroup() → clear session + "❌ Order cancelled by admin." to group
```

## REST API

All endpoints require header: `x-api-key: <BOT_API_KEY>`

If `BOT_API_KEY` is not set in `.env`, the API runs open (dev mode).

### GET /api/status
Returns Baileys connection status.
```json
{ "connected": true, "phone": null }
```

### GET /api/pending-orders
Returns all in-memory pending sessions.
```json
{
  "orders": [
    {
      "groupId": "120363...",
      "customerPhone": "601234567890",
      "customerCode": "002",
      "createdAt": "2026-06-01T10:00:00.000Z",
      "awaitingDisambiguation": false,
      "items": [
        { "product_id": 235, "name": "Soya Sauce", "sku": "M512", "qty": 5, "unit": "750ML", "unitPrice": null, "flagged": false }
      ],
      "notFound": ["葱油"],
      "rawAttachments": [
        { "type": "audio", "url": "https://...", "transcript": "一个葱油", "language": "zh", "text": null, "timestamp": "2026-07-09T..." }
      ]
    }
  ]
}
```
Notes:
- `product_id` and `sku` must be round-tripped back from the dashboard in `overrideItems` on confirm, otherwise the bot falls back to a name-based lookup (ILIKE) to resolve `product_id` at save time.
- `rawAttachments[].language` is the STT-detected language code (`"zh"`, `"en"`, `"yue"`, etc.) — only populated for audio attachments. db_revamp can display this as "Audio (zh)" on the order card.
- Sessions with zero matched items but non-empty `notFound` are still surfaced so staff can see and manually handle unmatched orders.

### POST /api/confirm-order
Body: `{ "groupId": "120363..." }`
Confirms the pending order: saves to DB, sends WhatsApp confirmation to group.
```json
{ "success": true, "orderId": null }
```
Note: `orderId` is currently null — finalizeOrder does not surface the DB ID back through the call chain.

### POST /api/cancel-order
Body: `{ "groupId": "120363..." }`
Cancels the pending order, sends "❌ Order cancelled by admin." to the group.
```json
{ "success": true }
```

### GET /api/groups
Returns all rows from `group_profiles`.
```json
{ "groups": [{ "group_id": "120363...", "customer_code": "002", "overview_group_id": null, ... }] }
```

### POST /api/groups
Body: `{ "groupId": "120363...", "customerCode": "002" }`
Creates or updates a group_profile row.
```json
{ "success": true, "group": { ... } }
```

### DELETE /api/groups/:groupId
Deletes the group_profile. GroupId must be URL-encoded if it contains special chars.
```json
{ "success": true }
```

## Order flow

Supports text, image (OCR), and voice note input:

1. Staff sends order in restaurant WhatsApp group (text, photo, or voice note)
2. Baileys receives → `groupOrderHandler.handleGroupMessage()` fires
3. Group must be linked in `group_profiles` — unlinked groups are silently ignored
4. Voice notes → transcribed by `stt/transcribe.py` (faster-whisper); images → OCR'd by Claude Haiku 4.5. Detected language stored on attachment.
5. For audio/image: `normalizeChineseNumerals()` converts CJK qty+measure to ASCII before parsing (e.g. `一个葱油` → `1 葱油`, `酱青两箱` → `酱青2`). Long CJK segments without commas are also space-split into individual items.
6. `parseOrderLines()` splits into lines → `searchProductsFuzzy()` per line
7. Smart match: `pickBestMatch()` uses customer profile JSON if available
8. If ambiguous (multiple matches, no history) → auto-picks first candidate, sets `flagged: true`
9. Items from voice or image → always `flagged: true` with `confidence_note` indicating source
10. Session stored silently — bot does not reply. Sessions with zero matched items but unmatched terms in `notFound` are still kept so staff can see them.
11. db_revamp dashboard shows the pending order (flagged items highlighted for staff review)
12. Staff confirms → order saved to DB + WhatsApp confirmation sent to group
13. Staff cancels → session cleared + "❌ Order cancelled by admin." sent

### Item flagging logic

| Source | Match | `flagged` | `confidence_note` |
|---|---|---|---|
| Text | 1 match | `false` | `null` |
| Text | multi, history match | `false` | `null` |
| Text | multi, no history | `true` | `auto-picked (N candidates, no order history)` |
| Voice | any match | `true` | `from voice transcription` |
| Voice | multi, no history | `true` | `auto-picked (N candidates, no order history); from voice transcription` |
| Image OCR | any match | `true` | `from image OCR` |
| Image OCR | multi, no history | `true` | `auto-picked (N candidates, no order history); from image OCR` |

## Session management

`groupSessions` Map in `groupOrderHandler.js` (in-memory, keyed by groupId):
- One active session per group at a time
- New order messages while session is active → items MERGED (quantities replaced for duplicate products)
- Session cleared on confirm / cancel / server restart
- **48-hour auto-confirm**: if staff hasn't acted, the session auto-confirms 48 h after the last order message. Timer resets on each new message or disambiguation reply.

## Database schema

- `customers` — identified by phone number
- `categories` / `products` — 268 products across 12 categories; `chinese_name` column for Chinese keyword search
- `orders` + `order_items` — `group_id` records originating group; `flagged` + `confidence_note` on items
- `customer_groups` — maps `customer_id → group_id`
- `group_profiles` — maps `group_id → customer_code + overview_group_id`

## Known issues / decisions

- **Baileys auth**: credentials stored in `baileys-auth/` (gitignored). If deleted, must re-scan QR on next start.
- **In-memory sessions**: server restart clears all active sessions. Users mid-order will need to restart. Replace with Redis for production.
- **Baileys on Windows terminal**: `printQRInTerminal: true` doesn't render correctly in PowerShell. Uses `qrcode-terminal` package with `qrcode.generate(qr, { small: true })` instead.
- **Unlinked groups ignored**: bot returns early if `group_profiles` has no entry for the group — personal groups are safe.
- **orderId not returned on confirm**: `finalizeOrder()` in groupOrderHandler.js does not bubble the DB order ID back to `adminConfirm`. The confirm API returns `orderId: null` for now.
- **unitPrice always null**: product price is not stored in the in-memory session, only name/qty/unit. The db_revamp should look up prices from its own product catalog if needed.
- **Customer attribution**: orders are linked to the business by querying `customer_groups` (group_id → customer_id). Falls back to `group_profiles → customer_code`. Sender phone is never used — it can be a Baileys `@lid` identifier, not a real phone number.
- **SKU badge in dashboard**: db_revamp must display `item.sku` (not `item.unit`) for the PSOFT item code badge. The bot exposes both fields.
- **New groups not appearing**: `groupCache` is populated at connection time and kept live via `groups.upsert` / `groups.update` events. If a group still doesn't appear after joining, restart the bot to force a full re-fetch.
- **groupCache only in memory**: `GET /api/baileys-groups` reflects what Baileys has seen since last connect. It is not persisted to DB.
- **STT Windows encoding**: `stt/transcribe.py` forces `sys.stdout` to UTF-8 via `io.TextIOWrapper` at startup. Without this, Chinese/CJK transcripts crash on Windows (cp1252 console encoding). `baileys-bot.js` also passes `encoding: 'utf8'` to `execFileAsync`.
- **Chinese numeral parsing**: `normalizeChineseNumerals()` only converts numerals paired with a measure word (个/箱/包/瓶 etc.). Bare numerals without a measure word (e.g. `葱油一`) are left as-is and the quantity defaults to 1. This avoids corrupting product names that contain Chinese numerals (e.g. 七味粉).
- **CJK space-splitting**: `parseOrderLines` splits long CJK segments by spaces (threshold: >3 CJK chars). Whisper rarely inserts commas in Chinese speech — each space-delimited token is treated as a separate order item. English segments are unaffected.
- **STT language not shown in dashboard**: the detected language (`zh`/`en`/`yue`) is now in `rawAttachments[].language` — db_revamp needs to render it (e.g. "Audio (zh)") on the order card.
