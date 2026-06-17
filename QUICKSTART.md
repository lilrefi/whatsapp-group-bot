# Quick Start — Refi WhatsApp Group Order Bot

This is a **pure backend**: a Baileys WhatsApp connection + a REST API.
There is no UI here — the staff dashboard lives in the separate **db_revamp**
(Next.js) project, which talks to this bot's REST API.

For full architecture, file map, and API reference, see [`CLAUDE.md`](./CLAUDE.md).
This doc only covers getting a local instance running and connecting it to
the dashboard via ngrok.

---

## 1. Prerequisites

- **Node.js 18+** and npm
- A **Neon PostgreSQL** database (or any Postgres) — connection string for `DATABASE_URL`
- A WhatsApp account to act as the bot (you'll scan a QR code with it)
- *(Optional)* **Python 3** — only needed if you want voice-note transcription (see [Step 5](#5-optional-voice-note-transcription))
- **ngrok** — only needed if the db_revamp dashboard is hosted elsewhere and needs to reach this bot's API (see [Step 7](#7-expose-the-api-with-ngrok))

---

## 2. Install dependencies

```bash
git clone <repo-url>
cd Refi-whatsapp-group-bot
npm install
```

---

## 3. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Postgres connection string |
| `BOT_API_KEY` | Shared secret — must match the value configured in db_revamp. Every API request needs header `x-api-key: <BOT_API_KEY>` |
| `BOT_API_PORT` | Port for the REST API (default `3001`) |
| `ORDER_BUFFER_MINUTES` | Minutes of inactivity before an unconfirmed order auto-places (default `10`) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token, used to store photo/voice-note attachments |

If `BOT_API_KEY` is left blank, the API runs open (fine for local dev).

---

## 4. Set up the database

Run these once, in order, against the database in `DATABASE_URL`:

```bash
npm run setup-db     # creates tables + loads ~268 products from schema_product.sql
npm run migrate      # adds customer_groups table + group_id column to orders
npm run migrate-code # adds group_profiles table (customer code + overview group)
npm run migrate-zh   # adds name_zh column to products (Chinese keyword search)
npm run migrate-status # adds flagged + confidence_note columns to order_items
npm run migrate-attachments # adds order_attachments table (photo/voice-note/text attachments)
```

---

## 5. (Optional) Voice-note transcription

If the `stt/` folder with a Python venv is present, incoming voice notes are
transcribed automatically via `faster-whisper`. If `stt/transcribe.py` is
missing, the bot just skips transcription and stores the audio attachment
without a transcript — no setup required to get the bot running.

To set it up yourself:

```bash
cd stt
python -m venv venv
# Windows
venv\Scripts\pip install faster-whisper
# macOS/Linux
venv/bin/pip install faster-whisper
cd ..
```

---

## 6. Run the bot

```bash
npm run dev    # nodemon, auto-reloads (ignores baileys-auth/ and customer_profiles/)
# or
npm start      # plain node
```

On first run, a QR code prints in the terminal:

```
📱 Scan this QR code with your Baileys WhatsApp number:
[QR code]
```

Scan it with **WhatsApp → Linked Devices → Link a Device** on the phone you
want the bot to run as. Session credentials are saved to `baileys-auth/`
(gitignored) — on subsequent runs it reconnects automatically without a QR.

If you ever see `🔴 Baileys logged out`, delete the `baileys-auth/` folder
and restart to re-scan.

---

## 7. Link a WhatsApp group

The bot **ignores any group that isn't registered in `group_profiles`** —
this keeps it safe in personal/unrelated groups.

1. Add the bot's WhatsApp account to the restaurant's order group.
2. Find the group's ID — call the API (see below) or check the bot's console
   logs, which print the group ID for every incoming group message.
3. Register the group:

```bash
curl -X POST http://localhost:3001/api/groups \
  -H "Content-Type: application/json" \
  -H "x-api-key: <BOT_API_KEY>" \
  -d '{ "groupId": "120363xxxxxxxxxx@g.us", "customerCode": "002" }'
```

`customerCode` links the group to a customer profile under
`customer_profiles/` (used for smart product matching). It can be left
`null` if you don't have one yet.

---

## 8. Expose the API with ngrok

The db_revamp dashboard (typically deployed on Vercel) needs to reach this
bot's REST API. If you're running the bot locally, use ngrok to create a
public HTTPS tunnel to `BOT_API_PORT` (default `3001`):

```bash
ngrok http 3001
```

ngrok prints a forwarding URL like:

```
Forwarding   https://abcd-1234.ngrok-free.app -> http://localhost:3001
```

In db_revamp's environment config, set the bot API base URL to that ngrok
URL, and make sure every request sends `x-api-key: <BOT_API_KEY>` (same
value as in this project's `.env`).

Quick sanity check:

```bash
curl https://abcd-1234.ngrok-free.app/api/status \
  -H "x-api-key: <BOT_API_KEY>"
# → { "connected": true, "phone": null }
```

**Notes:**
- On the free ngrok plan, the URL changes every time you restart the tunnel
  — update db_revamp's config each time, or use a [reserved domain](https://ngrok.com/docs/http/reserved-domains/)
  (`ngrok http --domain=your-reserved-domain.ngrok-free.app 3001`) for a
  stable URL.
- If the bot is deployed somewhere with a public IP/domain already (e.g. a
  VPS), you don't need ngrok — just point db_revamp at that address directly.

---

## 9. Test the order flow

In the linked WhatsApp group, send a free-text order, e.g.:

```
5 chicken, 3 fish cake
```

The bot parses it silently (no reply in the group) and adds it to an
in-memory pending session. Check it landed:

```bash
curl http://localhost:3001/api/pending-orders -H "x-api-key: <BOT_API_KEY>"
```

You should see the parsed `items`, plus `rawAttachments` containing the
exact text/photo/voice-note the customer sent.

Then confirm or cancel it (as the dashboard would):

```bash
curl -X POST http://localhost:3001/api/confirm-order \
  -H "Content-Type: application/json" -H "x-api-key: <BOT_API_KEY>" \
  -d '{ "groupId": "120363xxxxxxxxxx@g.us" }'
```

This writes the order to the DB and sends a confirmation message to the
WhatsApp group.

---

## Troubleshooting

**Bot doesn't respond / nothing in `/api/pending-orders`**
- Is the group registered in `group_profiles`? (Step 7) — unregistered
  groups are silently ignored by design.
- Check the terminal running `npm run dev` for errors.
- Confirm `npm run dev` is still connected: `GET /api/status` should return
  `"connected": true`.

**`x-api-key` / 401 Unauthorized**
- `BOT_API_KEY` in `.env` must match exactly what db_revamp sends, including
  via the ngrok tunnel.

**QR code won't scan / garbled in terminal**
- Make the terminal window wider, or use a terminal with better Unicode
  support. The bot already uses `qrcode-terminal` for compatibility — see
  Known Issues in `CLAUDE.md`.

**Database errors on startup**
- Make sure all migrations from Step 4 ran successfully against the same
  `DATABASE_URL`.

---

For the full request flow, database schema, and complete REST API
reference, see [`CLAUDE.md`](./CLAUDE.md).
