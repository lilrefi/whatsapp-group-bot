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
npm run migrate-verbatim    # Adds verbatim column to order_items
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `BOT_API_KEY` | Shared secret — must match the value set in db_revamp (Next.js dashboard). All API requests must include `x-api-key: <BOT_API_KEY>` header. |
| `BOT_API_PORT` | Port for the REST API server (default: 3001) |
| `PORT` | Port for any legacy health-check Express app (default: 3000, currently unused) |
| `ANTHROPIC_API_KEY` | Anthropic API key — used by Claude Sonnet 5 to OCR order text from images sent in WhatsApp groups. |
| `ORDER_TAKING_ENABLED` | Set to `false` to stop parsing incoming group messages into orders entirely (no transcription/OCR/sessions) while keeping everything else — Baileys connection, `group_profiles`, outbound `POST /api/send-message` — running normally. Defaults to `true` (enabled) if unset. See "Order-taking hiatus" under Known issues. |

## Deployment

**Production**: a Linux VPS (Onidel Cloud, Ubuntu 26.04 LTS, 1 vCPU / 2GB RAM / 20GB SSD), replacing the previous desktop+ngrok setup as of 2026-08-06. Key facts:

- **Repo split**: day-to-day development still happens on `lilrefi/whatsapp-group-bot` (this repo, `origin` remote) — nothing about that workflow changed. A second repo, `Junjie14321/Db_Bot` (`personal` remote in this local checkout), is the **deploy target** — its `main` branch is what the production VPS actually runs. Pushing to `origin` does **not** touch production; code only reaches the VPS when explicitly pushed to `personal`'s `main` and then pulled on the server (see below — this is a manual step, there is no CI/CD or auto-deploy configured).
  ```bash
  git push personal <branch>:main   # ships code to the deploy repo
  # then, on the VPS:
  cd /opt/Db_Bot && git pull && npm install && systemctl restart db-bot
  ```
- **Process management**: runs as a systemd service, `db-bot` (`/etc/systemd/system/db-bot.service`), `Restart=always`, enabled on boot. Logs: `journalctl -u db-bot -f`. `.env` lives at `/opt/Db_Bot/.env` (not in git, `chmod 600`).
- **HTTPS**: Caddy (`/etc/caddy/Caddyfile`) reverse-proxies `https://155-103-50-173.sslip.io` → `localhost:3001` (the REST API), with an automatic Let's Encrypt cert. `sslip.io` is a free DNS service that resolves a hostname containing an IP to that IP directly — no domain was purchased; this is the URL db_revamp's `BOT_API_URL` points to. If a real domain is bought later, only the `Caddyfile` and db_revamp's env var need to change — nothing else depends on the hostname.
- **Firewall**: `ufw`, default-deny incoming, only `22` (SSH), `80`/`443` (Caddy) allowed. SSH is key-only — `PasswordAuthentication no` is enforced across all `/etc/ssh/sshd_config.d/*.conf` drop-ins (the VPS image shipped with conflicting drop-ins, some set to `yes` — see Known issues).
- **GitHub access from the VPS**: a dedicated read-only deploy key (`~/.ssh/db_bot_deploy` on the VPS, added as a GitHub Deploy Key on `Db_Bot` only, no write access). Outbound port 22 is blocked by the hosting provider's network (common anti-abuse default), so git/SSH to GitHub is configured to go over **port 443** instead (`~/.ssh/config` on the VPS sets `HostName ssh.github.com`, `Port 443` for the `github.com` alias) — this is GitHub's documented workaround for exactly this kind of restriction.
- **WhatsApp session**: freshly linked on the VPS (QR re-scanned, not migrated from the old desktop's `baileys-auth/`). The old desktop is no longer running the bot and can be shut down/repurposed.

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
        { "product_id": 235, "name": "Soya Sauce", "sku": "M512", "qty": 5, "unit": "750ML", "unitPrice": null, "flagged": false, "verbatim": "5 Soya Sauce", "confidence_note": null }
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
- **`verbatim` is now populated on every item, matched or not** (2026-07-31) — the exact parsed segment of the customer's message that produced that item, in any language. db_revamp should render `item.verbatim` directly for the "Client Verbatims" column instead of re-deriving it from the raw message — see Known Issues below.
- `confidence_note` on image-OCR items may now include a mark-confidence detail, e.g. `"from image OCR (mark confidence: low)"` — db_revamp should surface this text somewhere visible (tooltip/badge) so staff can prioritize reviewing low-confidence marks first.

### PATCH /api/pending-orders/:groupId
Body: `{ "items": [...same shape as overrideItems on confirm...] }`
Syncs staff edits (qty steppers, product reassignment, deletions) back into the bot's live session, so the next poll reflects the dashboard's current state instead of the bot re-adding items a staff member already deleted. Returns `{ "success": true }`, or 404 if there's no active session for the group.

**Important — this REPLACES `session.items` wholesale from the payload (2026-08-05):** any field not included per item is treated as "not provided" and falls back to what the bot already had, rather than being wiped:
- `verbatim` — falls back to the existing item's verbatim if omitted or sent as `null` (staff never edit this field, so there's no legitimate reason to null it on purpose).
- `product_id` — falls back to the existing item's `product_id` **only if the key is absent from the payload entirely** (`undefined`). An explicit `product_id: null` is respected as-is (staff unassigning a product via the dropdown is a real, intentional action).
- Match for fallback purposes is by `product_id` where the incoming item has one (survives reordering); otherwise by array index (best-effort, for `product_id: null` / "Not found in catalog" rows).

This means **db_revamp does not need to round-trip `verbatim` on every PATCH call** — but if a field is genuinely being cleared intentionally (e.g. unassigning a product), send it explicitly rather than omitting it, since omission now means "leave unchanged," not "clear."

### POST /api/confirm-order
Body: `{ "groupId": "120363...", "overrideItems": [...], "summary": "..." }`
Confirms the pending order: saves to DB, sends WhatsApp confirmation to group.
```json
{ "success": true, "orderId": null }
```
Note: `orderId` is currently null — finalizeOrder does not surface the DB ID back through the call chain.

**`summary` is optional and changes whether a WhatsApp message is sent (2026-07-31):**
- `summary` provided → that exact text is sent to the group (+ overview group if linked).
- `summary` omitted/null → **no WhatsApp message is sent at all.** This supports a two-step dashboard flow: staff clicks "Send to Group" (dashboard calls `POST /api/send-message` directly with the summary text), then clicks "Confirm" (dashboard calls `confirm-order` with no `summary` — the message was already sent, so the bot only saves to DB).
- This only applies to admin-confirms via this endpoint. The 48-hour auto-confirm timer (no staff action) always sends its own auto-generated summary regardless, since nothing else has messaged the group in that case.

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
4. Voice notes → transcribed by `stt/transcribe.py` (faster-whisper); images → OCR'd by Claude Sonnet 5, which also self-rates a "high"/"medium"/"low" confidence per marked item (see Item flagging logic below). Detected language stored on attachment.
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

`searchProductsFuzzy()` returns a **product match confidence** independent of source: `'high'` for an exact full-string substring hit, `'medium'` for a fuzzy word-scored match (single keyword or multi-word scoring — always a best-effort guess), `null` for no match. A `'medium'` product match is flagged for review **regardless of source** (2026-07-31) — a shaky fuzzy match on plain text is just as much a guess as one from voice/image, so it gets the same review prompt instead of silently looking "Matched".

| Source | Product match confidence | Match | `flagged` | `confidence_note` |
|---|---|---|---|---|
| Text | high | 1 match | `false` | `null` |
| Text | high | multi, history match | `false` | `null` |
| Text | high | multi, no history | `true` | `auto-picked (N candidates, no order history)` |
| Text | **medium** | any | `true` | `product match uncertain — please verify` |
| Voice | any | any match | `true` | `from voice transcription` (+ `; product match uncertain — please verify` if medium) |
| Voice | any | multi, no history | `true` | `auto-picked (N candidates, no order history); from voice transcription` |
| Image OCR | any | any match | `true` | `from image OCR (mark confidence: <high\|medium\|low>)` (+ `; product match uncertain — please verify` if medium) |
| Image OCR | any | multi, no history | `true` | `auto-picked (N candidates, no order history); from image OCR (mark confidence: <level>)` |
| Image OCR | **SKU match** | direct (bypasses fuzzy) | `true` | `from image OCR (SKU: <code>; mark confidence: <level>)` |

**SKU-first matching for catalog-style images (2026-07-31)**: when the sheet has an item-code column (e.g. "Item No"), `ocrImage()` also extracts that code per marked row. `processOrderLines()` tries an exact SKU lookup (`db.getProductBySku()`, whitespace/case-insensitive) *before* falling back to fuzzy name matching — a SKU is a unique identifier, so there's no ambiguity to resolve. Falls through to the normal fuzzy path if there's no SKU, or the printed code isn't in this catalog's `sku` column (confirmed to happen: a customer's printed sheet used `BA-CMN` for Cumin, this catalog stores that product as `BA15` — a data mismatch, not a bug). Text/voice/plain-list orders have no SKU column to read and are unaffected.

Note: "mark confidence" (OCR's self-rated confidence that a handwritten tick/quantity is genuine) and "product match confidence" (whether the catalog search itself is a reliable hit) are two independent dimensions — an item can have a high mark confidence but a medium/uncertain product match, or vice versa. Both surface in `confidence_note`.

## Session management

`groupSessions` Map in `groupOrderHandler.js` (in-memory, keyed by groupId):
- One active session per group at a time
- New order messages while session is active → items MERGED (quantities replaced for duplicate products)
- Session cleared on confirm / cancel / server restart
- **48-hour auto-confirm**: if staff hasn't acted, the session auto-confirms 48 h after the last order message. Timer resets on each new message or disambiguation reply.

## Database schema

- `customers` — identified by phone number
- `categories` / `products` — 268 products across 12 categories; `chinese_name` column for Chinese keyword search
- `orders` + `order_items` — `group_id` records originating group; `flagged` + `confidence_note` + `verbatim` on items
- `customer_groups` — maps `customer_id → group_id`
- `group_profiles` — maps `group_id → customer_code + overview_group_id`

## Known issues / decisions

- **Baileys auth**: credentials stored in `baileys-auth/` (gitignored). If deleted, must re-scan QR on next start.
- **Baileys logout is expected occasionally in production**: WhatsApp can invalidate the session server-side (protocol updates, inactivity, device-limit conflicts). Distinguish a true logout (`DisconnectReason.loggedOut`, requires deleting `baileys-auth/` and re-scanning QR) from a normal reconnect (network drop, auto-recovers). After bumping the `@whiskeysockets/baileys` version, always delete `baileys-auth/` and re-scan — auth credential format can change between versions.
- **KIV: forwarded voice notes reported as "not working" by a tester (2026-07-30)**: not reproduced. One test forward worked end-to-end; the transcript had duplicated phrases but the user confirmed the source audio itself was genuinely duplicated (not a Whisper repetition hallucination). If this recurs, capture the console log from the exact failing attempt — check whether `🎤 Voice note from...` even prints (if not, the message likely arrived wrapped in `ephemeralMessage`/`viewOnceMessage` rather than a bare `audioMessage`) and note what chat the forward originated from.
- **In-memory sessions**: server restart clears all active sessions. Users mid-order will need to restart. Replace with Redis for production.
- **Baileys on Windows terminal**: `printQRInTerminal: true` doesn't render correctly in PowerShell. Uses `qrcode-terminal` package with `qrcode.generate(qr, { small: true })` instead.
- **Unlinked groups ignored**: bot returns early if `group_profiles` has no entry for the group — personal groups are safe.
- **orderId not returned on confirm**: `finalizeOrder()` in groupOrderHandler.js does not bubble the DB order ID back to `adminConfirm`. The confirm API returns `orderId: null` for now.
- **unitPrice always null**: product price is not stored in the in-memory session, only name/qty/unit. The db_revamp should look up prices from its own product catalog if needed.
- **Customer attribution**: orders are linked to the business by querying `customer_groups` (group_id → customer_id). Falls back to `group_profiles → customer_code`. Sender phone is never used — it can be a Baileys `@lid` identifier, not a real phone number.
- **SKU badge in dashboard**: db_revamp must display `item.sku` (not `item.unit`) for the PSOFT item code badge. The bot exposes both fields.
- **New groups not appearing**: `groupCache` is populated at connection time and kept live via `groups.upsert` / `groups.update` events. If a group still doesn't appear after joining, restart the bot to force a full re-fetch.
- **Order-taking hiatus (active 2026-08-06, open-ended)**: `ORDER_TAKING_ENABLED=false` on production. Order-taking (text/audio/image → parsed order sessions) is fully disabled — every incoming group message is skipped before any download/transcription/OCR happens, so it's zero-cost, not just silently dropped later. Not affected: `group_profiles`, `GET /api/groups`, `POST /api/send-message` (Messaging Hub / scheduled messages in db_revamp keep working normally — confirmed independent, see `postToGroup()` in `baileys-bot.js`, which this flag never touches). `GET /api/pending-orders` will return an empty `orders` array for the duration. Reason: PSOFT (the customer's legacy order-entry system) needs to become obsolete before order-taking resumes; re-enable is manual (flip the env var, restart `db-bot`), not on a timer. Whisper/STT setup was deliberately skipped on the production VPS for the same reason — no order-taking means no voice transcription needed right now; add it back when re-enabling.
- **Ubuntu cloud image shipped with conflicting `sshd_config.d/*.conf` drop-ins (found 2026-08-06)**: fresh Onidel VPS had `PasswordAuthentication yes` in `50-cloud-init.conf` silently winning over `no` in `60-cloudimg-settings.conf` and `90-cloud-init-override.conf` — sshd uses first-match-wins per keyword across globbed `Include` files (alphabetical order), so the file that sorts first isn't necessarily the "override" one despite the filename. Within minutes of the VPS being reachable, internet bots were already brute-forcing root password login (expected for any fresh public IP on port 22, not specific to this provider). Fixed by explicitly setting `PasswordAuthentication no` in all three files and verifying with `sshd -T | grep passwordauthentication` (dumps the actual *effective* merged config — far more reliable than grepping files by hand when multiple drop-ins can conflict). **Diagnostic technique worth remembering**: when a public key is confirmed present, correctly permissioned, and content-matches, but auth still fails, run a one-off debug instance (`sshd -d -p <spare-port>`) rather than digging through logs — it prints the exact reason for a single connection attempt in the foreground, in this case revealing the real cause was a passphrase-protected local private key silently failing under `ssh -o BatchMode=yes` (server-side config was correct the whole time; `Postponed publickey` followed immediately by `Connection closed ... [preauth]` beats grepping for a `Failed publickey` line that won't exist at default log verbosity).
- **`updateSessionItems()` was silently wiping `verbatim` and `product_id` on every dashboard PATCH (fixed 2026-08-05)**: `PATCH /api/pending-orders/:groupId` (used to sync staff edits back into the live session) fully replaced `session.items` from whatever the dashboard sent. Since the dashboard's PATCH payload is built around what staff are actually editing (qty, product match) and doesn't necessarily include every field, any omitted field was overwritten with `null` — even though the bot had originally parsed it correctly. Found by inspecting live `GET /api/pending-orders` data directly: a Chinese audio order and an English text order both showed `verbatim: null` *and* `product_id: null` on every single item, including confidently-matched ones — a pattern that only makes sense if a PATCH had already round-tripped incomplete data through the session, not a parsing failure. Fixed: `updateSessionItems()` now falls back to the previous session item's value when a field is missing, matched by `product_id` where available or array index otherwise (see the PATCH endpoint docs above for the `verbatim` vs `product_id` distinction — the latter allows an explicit `null` since staff can legitimately unassign a product). **Note**: this only protects sessions going forward from the fix's deploy — already-corrupted in-memory sessions can't be recovered (the real values are gone, and a restart to load the fix clears sessions anyway, per the in-memory-sessions limitation above).
- **KIV: Chinese quantity hijacked by a mistranscribed measure word (found 2026-08-05, not yet fixed)**: `normalizeChineseNumerals()` only recognizes a fixed set of measure-word characters (`个只箱包瓶袋盒罐条件块`) when converting a CJK numeral to ASCII (e.g. `一瓶` → `1`). Whisper occasionally mis-transcribes a measure word as a near-homophone that isn't in that set — observed in production: `一瓶` (yī píng, "one bottle") transcribed as `一瓢` (yī piáo, "one ladle/scoop"). Since `瓢` isn't recognized, `一` is never converted, and the quantity regex (`\b(\d+)\b`) falls through to the next bare number in the segment — in the observed case, `500` from a trailing `500克` (500g, a package-size descriptor, not a quantity), producing quantity `500` instead of the intended `1`. Same underlying failure mode as the OCR quantity-hijack bug (2026-07-31 fix, see above) — a non-quantity number wins because the real quantity signal was missed — just triggered by an STT transcription error instead of a product-description number. No general fix exists (STT mis-transcriptions of measure words aren't fully predictable), though widening the recognized measure-word set to include known near-homophone slips (starting with 瓢/瓶) would reduce frequency. Longer-term, this is really an argument for LLM-based semantic parsing of free-text/voice orders (package-size vs. order-quantity is a meaning distinction, not a pattern-matching one) rather than continuing to patch the regex/character-class approach — deferred as a future consideration, not scoped for implementation.
- **groupCache only in memory**: `GET /api/baileys-groups` reflects what Baileys has seen since last connect. It is not persisted to DB.
- **STT Windows encoding**: `stt/transcribe.py` forces `sys.stdout` to UTF-8 via `io.TextIOWrapper` at startup. Without this, Chinese/CJK transcripts crash on Windows (cp1252 console encoding). `baileys-bot.js` also passes `encoding: 'utf8'` to `execFileAsync`.
- **Chinese numeral parsing**: `normalizeChineseNumerals()` only converts numerals paired with a measure word (个/箱/包/瓶 etc.). Bare numerals without a measure word (e.g. `葱油一`) are left as-is and the quantity defaults to 1. This avoids corrupting product names that contain Chinese numerals (e.g. 七味粉).
- **CJK space-splitting**: `parseOrderLines` splits long CJK segments by spaces (threshold: >3 CJK chars). Whisper rarely inserts commas in Chinese speech — each space-delimited token is treated as a separate order item. English segments are unaffected.
- **STT language not shown in dashboard**: the detected language (`zh`/`en`/`yue`) is now in `rawAttachments[].language` — db_revamp needs to render it (e.g. "Audio (zh)") on the order card.
- **Chinese search terms need measure-word/punctuation stripping (fixed 2026-07-31)**: `parseOrderLines()` was leaving Chinese measure words (包/桶/箱 etc.) and full-width punctuation (，。、) glued to the search term after digit stripping, so items like `红加晒1桶，` searched as `红加晒桶，` — 0 DB results even when the product existed. Fixed by adding `ZH_MEASURE_AND_PUNCT` stripping (mirrors the existing English `UNITS` stripping) and splitting on full-width commas up front. Catalog aliasing gaps remain separately (e.g. `大碌面` vs the DB's `吉隆坡大条面` — different character, not fixed by this).
- **Duplicate message processing — added dedup (2026-07-31)**: `messages.upsert` had no idempotency check; a redelivered WhatsApp message (reconnects, multi-device sync) could be processed twice, producing duplicate order items (unmatched items never merge, so duplicates stack up as extra rows). `baileys-bot.js` now tracks recently-seen `msg.key.id` values in a 10-minute bounded map and skips repeats.
- **OCR treating price-list photos as orders — fixed twice (2026-07-31)**: first fix made the OCR prompt reject any catalog/price-list-style image outright — but for at least one customer, a pre-printed catalog sheet *is* their normal ordering method: they tick/write a quantity next to items they want on their own supplier reference sheet, then photo it. The correct fix (now in place): the prompt recognizes this pattern and extracts **only** rows with a visible handwritten mark (tick/checkmark/circle/number), ignoring unmarked rows — instead of extracting every row, or rejecting the image outright.
- **OCR model: Sonnet 5, not Opus or Haiku (2026-07-31)**: tested all three on real marked-catalog photos. Haiku is unreliable for this specific task (missed ~9/20 marks on one test image including a wrong quantity — 2 vs actual 5). Opus was most accurate but ~3x Sonnet's cost with no clear precision advantage (occasionally flagged unmarked rows as marked). Sonnet 5 matched Opus closely at roughly a third of the cost. Do not downgrade to Haiku for image OCR.
- **`verbatim` for matched items — bot fix done, db_revamp change still needed (2026-07-31)**: previously the bot only populated `verbatim` for *unmatched* ("Not found in catalog") items; matched items got `null`. db_revamp's own client-side heuristic filled the gap by guess-splitting the raw customer message — this worked by coincidence for one English customer whose messages happened to use `* [qty] item` bullet markers, but collapsed into showing the entire raw message on every row for Chinese comma-separated text. Bot-side fix: `verbatim` is now `line.rawSegment` (the exact per-item parsed slice) on every item regardless of match status or language. **db_revamp still needs to switch to reading `item.verbatim` directly instead of its own guess-extraction** for this to actually show correctly on screen.
- **`api.js` re-maps session items through its own field whitelist — easy to silently drop new fields (found + fixed 2026-07-31)**: `GET /api/pending-orders` does not return `getPendingSessions()`'s item objects directly — it rebuilds each item as `{ product_id, name, sku, qty, unit, unitPrice, flagged }`. The `verbatim` fix above was correctly added to `groupOrderHandler.js` but `api.js`'s whitelist wasn't updated at the same time, so `verbatim`/`confidence_note` were computed correctly but silently dropped before ever reaching db_revamp — no amount of restarting the bot fixed it, because the bug was the missing fields in the response shape, not stale code. Now includes both. **Any new field added to session items in `groupOrderHandler.js` must also be added to this whitelist in `api.js`, or it will never reach the dashboard.**
- **`isNoiseSearchTerm()` silently dropped short Chinese product names (fixed 2026-07-31)**: the noise-vs-correction heuristic classified a zero-match search term as noise if every word was under 4 characters — reasonable for English filler ("la"/"to"/"ah") but wrong for Chinese, where 2-4 characters is a normal, complete product name (`腐皮`, `大碌面`, `生抽`). A short Chinese term that didn't match any product (either a genuine catalog gap or an unresolved alias) was misclassified as a quantity correction on the *previous* item — and if it was the first item in a brand-new session (no previous item to correct), it was silently dropped with no trace at all, not even a "Not found in catalog" row. Fixed by giving CJK terms their own check: only noise if the whole term is a single character or an exact match against a small `CJK_FILLER_WORDS` set (`改成`/`换成`/etc. — actual Chinese correction phrases), never by character-count alone. Symptom before the fix: a 7-item Chinese order silently became 5 items with no error or flagged row for the missing two.
- **`order_items.verbatim` — DB column didn't exist at all (fixed 2026-07-31)**: db_revamp's confirmed-order page reads `verbatim` straight from the DB (`order_items.verbatim`), not from the bot's REST API. But the column had never been created — `createGroupOrder()` in `database.js` didn't insert it, and `finalizeOrder()`'s `itemsToSave` mapping (built from the dashboard's `overrideItems` on confirm) didn't even carry the field through in memory, so it was never "dropped at the DB write" — there was nothing to write. Fixed: added `migration_verbatim.sql` (`npm run migrate-verbatim` — **must be run once against the DB**, this doesn't happen automatically on deploy), `createGroupOrder()` now inserts `item.verbatim`, and `finalizeOrder()`'s override-items mapping now carries `verbatim` through from the dashboard's `overrideItems` payload.
- **OCR JSON response truncated on busy marked-catalog orders (fixed 2026-07-31)**: `ocrImage()`'s `max_tokens: 1500` was too tight once Sonnet's thinking + a long item-array both count against the same budget — a large order's JSON got cut off mid-string, and `JSON.parse` failing meant the *entire* order (however many items were actually read correctly) was silently dropped, logged only as `[OCR] Failed to parse JSON response`. Fixed two ways: raised `max_tokens` to 4096 for headroom, and added a recovery path — if the full array fails to parse, salvage every complete `{...}` object before the cutoff (via regex + per-object `JSON.parse`) instead of discarding the whole response. A truncated last item silently dropped is an acceptable tradeoff over losing the entire order; watch for `[OCR] Response was truncated` in logs as a signal the image had more items than the model could finish describing — if this recurs often, raise `max_tokens` further.
- **OCR quantity hijacked by a number embedded in the product's own description (fixed 2026-07-31)**: `ocrImage()` built each order-line segment as `"<name> <quantity>"` (quantity trailing). `parseOrderLines()`'s quantity regex (`\b(\d+)\b`) takes the *first* standalone bounded number in the segment — so a product description containing its own bare number (e.g. `FL13(TUB) Dark Yellow Colour 258 450g/tub`, where `258` is part of the catalog spec, not a quantity) hijacked the match: `"Dark Yellow Colour 258 450g/tub 1"` parsed as quantity `258`, not the real trailing `1`. It also mangled the search term (missing `258`, stray trailing `1`), which is why that item additionally failed to match the catalog. Fixed by building the segment as `"<quantity> <name>"` instead — quantity first guarantees it's always the leftmost, correctly-bound number, regardless of what numbers appear later in the product's own description. Verified against the exact failing case: `"1 Dark Yellow Colour 258 450g/tub"` now parses as quantity `1`, search term `"Dark Yellow Colour 258 450g/tub"`.
- **`searchProductsFuzzy()` multi-word scoring could silently pick the wrong product (fixed 2026-07-31)**: two generic/structural words that both happen to appear in an unrelated product's name could sum to the same ≥2-word score as the one word that actually distinguishes the product, and silently win with no ambiguity flag at all (since it looked like a single confident match, not a multi-candidate auto-pick). Found via: `"Baba'S Cumin PWD 1"` incorrectly matched `"Baba'S Meat Curry Pwd"`, because `"Baba'S"` (3 products) + `"PWD"` (3 products, an abbreviation for "powder" appearing across this whole product line) scored 2 together — while `"Cumin"`, the actual distinguishing word, matched a *different* product (`"Baba Cumin Powder"`, no apostrophe — a separate catalog naming inconsistency) and was never counted for the wrong candidate at all. A fixed document-frequency threshold ("exclude words matching too many products") was tried and rejected — it broke other legitimate matches (`Chilli`/`Curry`/`Fish`/`Meat` are themselves common category words in this catalog, matching dozens of products, yet are the correct distinguishing signal when paired with a brand prefix). The actual fix: added `GENERIC_SCORE_WORDS` (`pwd`, `powder`) — generic product-*form* words specific to this catalog, excluded from scoring entirely, same idea as the existing English `UNITS` list but for catalog vocabulary rather than order-quantity units. Verified against 9 real product-name test cases (Chilli/Meat Curry/Fish Curry/Turmeric all still match correctly; Cumin/Coriander now correctly return no match rather than a wrong one, since their catalog names lack the apostrophe-S that would be needed to combine with "Baba'S" — a separate, still-open alias gap).
- **Product-match confidence is now a first-class, source-independent signal (2026-07-31)**: `searchProductsFuzzy()` returns `{ results, matchConfidence }` (`'high'` = exact substring hit, `'medium'` = fuzzy word-scored guess, `null` = no match) instead of a bare array. Any `'medium'` match now sets `flagged: true` and appends `"product match uncertain — please verify"` to `confidence_note`, **for every source — text included**, not just voice/image. Previously a fuzzy-matched *text* order (like the Cumin bug above) would have looked exactly like a normal confident match, with zero review signal — the exact same underlying bug is silent and unflagged on text but flagged on voice/image purely because of the source-based flagging rule, which was the wrong axis to flag on. Mark-confidence (OCR's own self-rated tick-reading confidence) and product-match confidence are independent and can combine in `confidence_note`, e.g. `"from image OCR (mark confidence: high); product match uncertain — please verify"`.
- **RESOLVED — "0 items / ALL RESOLVED" for image orders was a db_revamp design decision, not a bug (2026-08-01)**: after multiple rounds of ruling out the bot (`GET /api/pending-orders` was independently verified to return complete, correct data — 18 real items — for the exact session the dashboard showed as empty), the root cause turned out to be intentional old code in db_revamp: image-only orders (attachment type `image`, no text/audio) were deliberately started with an **empty item table**, discarding all bot-parsed items and forcing staff to manually re-enter everything by reading the photo themselves. This was a safeguard from when OCR was unreliable (pre-Sonnet-5, pre-SKU-matching) — once the bot's OCR became accurate, that old rule became the thing actively breaking image orders rather than protecting them. Fixed on the db_revamp side (separate repo, commit `e9c4325`): removed the image-order empty-table restriction across ~6 call sites (initial load, polling for follow-up items, draft-loading, unresolved-count calculation, notFound-row visibility, `Is it correct?` column visibility) so image orders now behave the same as text/voice orders — bot items show up with confirm/reject controls, same as everywhere else. **Lesson for future debugging**: when the bot's API is independently verified correct and the dashboard still shows wrong data, check for source-type-specific special-casing in the frontend (e.g. `if (attachment.type === 'image') { ... skip/filter/empty ... }`) before assuming a fetch/render bug — sometimes the "bug" is a stale intentional design decision that outlived its original justification.
