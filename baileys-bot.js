require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { put } = require('@vercel/blob');
const Anthropic = require('@anthropic-ai/sdk');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomBytes } = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { handleGroupMessage, getPendingSessions, updateSessionItems, adminConfirm, adminCancel } = require('./groupOrderHandler');

const execFileAsync = promisify(execFile);
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

let sock = null;
let isReady = false;
let groupCache = {};

// ─── Order-taking hiatus ───────────────────────────────────────────────────────
// Set ORDER_TAKING_ENABLED=false in .env to stop parsing incoming group
// messages into orders entirely (no transcription, no OCR, no sessions) while
// keeping everything else running — Baileys connection, group_profiles links,
// and outbound sends via postToGroup()/POST /api/send-message (used for
// scheduled/manual messages from db_revamp) are all unaffected. Manual,
// open-ended re-enable: flip the env var back and restart. See CLAUDE.md.
const ORDER_TAKING_ENABLED = process.env.ORDER_TAKING_ENABLED !== 'false';

// ─── Message dedup ───────────────────────────────────────────────────────────
// Baileys can redeliver the same message via messages.upsert (reconnects,
// multi-device sync), which would otherwise process an order twice. Track
// recently-seen message IDs and skip repeats; entries older than 10 minutes
// are purged so the map doesn't grow unbounded.
const processedMessageIds = new Map(); // msg.key.id -> seenAt
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function alreadyProcessed(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  for (const [id, seenAt] of processedMessageIds) {
    if (now - seenAt > DEDUP_WINDOW_MS) processedMessageIds.delete(id);
  }
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.set(msgId, now);
  return false;
}

// ─── Attachment storage (Vercel Blob) ───────────────────────────────────────

async function uploadAttachmentToBlob(buffer, groupId, ext, contentType) {
  try {
    const pathname = `orders/${groupId}/${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
    const { url } = await put(pathname, buffer, { access: 'public', contentType });
    return url;
  } catch (err) {
    console.error('❌ Blob upload failed:', err.message);
    return null;
  }
}

// ─── Image OCR (Claude Haiku) ────────────────────────────────────────────────

const OCR_SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function ocrImage(imageBuffer, mimeType) {
  if (!anthropic) return null; // ANTHROPIC_API_KEY not set — skip gracefully
  // WhatsApp occasionally sends 'image/jpg' which the API doesn't accept
  const normalizedType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  if (!OCR_SUPPORTED_TYPES.includes(normalizedType)) {
    console.warn(`[OCR] Unsupported type ${mimeType} — skipping`);
    return null;
  }
  try {
    const response = await anthropic.messages.create({
      // Sonnet, not Opus: tested near-identical accuracy to Opus on marked-catalog
      // order sheets (~15-19 of ~20 marks correctly read) at roughly a third of
      // the cost, with fewer false-positive marks than Opus in side-by-side
      // testing. Haiku is unreliable for this (missed ~9/20 marks on one test
      // image, including a wrong quantity) — do not downgrade to Haiku.
      model: 'claude-sonnet-5',
      // 1500 was too tight for busy marked-catalog orders (many items): thinking
      // + a long JSON array together hit the cap mid-string, truncating the
      // response and losing the whole order to a JSON parse failure. Raised
      // with headroom; see the truncated-response recovery below as a backstop.
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: normalizedType, data: imageBuffer.toString('base64') }
          },
          {
            type: 'text',
            text: 'Extract a customer\'s order from this image. It may be a plain handwritten/typed list, OR a pre-printed product catalog/price sheet where the customer has marked which items they want by writing a tick, checkmark, circle, or a number in the blank space next to that row\'s Qty column.\n\n' +
              'If it is a pre-printed catalog/price-sheet style image (rows with item codes and descriptions, e.g. "AA417 Assam Paste/Tamarind 1kg/pkt"): ONLY extract rows that have a visible handwritten mark next to them. Ignore every row with no mark — do not extract the full list. For each marked row, use the handwritten number if one is written, otherwise 1 for a plain tick/checkmark/circle with no number.\n\n' +
              'Some handwritten orders use a two-line-per-item format: a product name on its own line, followed immediately by a separate line containing only a quantity and unit (e.g. "1LITER/支", "600G/斤") with no product name of its own. Treat a quantity-only line like this as belonging to the product name line directly above it — merge them into a single order item (name from the first line, quantity/unit from the second), not two separate items.\n\n' +
              'Also rate your confidence that each mark is genuinely there and correctly read, as "high", "medium", or "low". Use "medium" or "low" when a mark is faint, ambiguous, or could be a stray pen mark or print artifact rather than a deliberate mark.\n\n' +
              'If the sheet has an item-code column (often labeled "Item No", "S/N", "Code", or similar — e.g. "AA417", "BA-CMN"), also record that exact code as "sku" for each marked row. Copy it exactly as printed, including hyphens/parentheses. Omit "sku" (or use null) if there is no such code column, or for a plain handwritten/typed list.\n\n' +
              'Respond with ONLY a JSON array, no other text, in this exact shape: [{"name": "<item description>", "sku": "<item code or null>", "quantity": <number>, "confidence": "high"|"medium"|"low"}]. If it is a plain handwritten/typed list rather than a catalog, extract it the same way with confidence "high" for each clearly-written item and sku null. If no order or marks are visible anywhere, respond with [].'
          }
        ]
      }]
    });
    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!raw) return null;

    // The model may wrap the JSON in a code fence despite instructions — strip it.
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      // Response was cut off mid-array (hit max_tokens on a large order) — salvage
      // whichever complete {...} objects came before the cutoff rather than
      // dropping the entire order. A truncated last item is better than none.
      const recovered = [];
      for (const m of jsonText.match(/\{[^{}]*\}/g) || []) {
        try { recovered.push(JSON.parse(m)); } catch (_) { /* skip the broken tail object */ }
      }
      if (recovered.length === 0) {
        console.error('[OCR] Failed to parse JSON response:', err.message, '| raw:', raw.substring(0, 200));
        return null;
      }
      console.warn(`[OCR] Response was truncated (likely hit max_tokens) — recovered ${recovered.length} item(s) before the cutoff`);
      parsed = recovered;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.log('[OCR] No order items found');
      return null;
    }

    const items = parsed
      .filter(i => i && typeof i.name === 'string' && i.name.trim())
      .map(i => {
        const quantity = Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1;
        const name = i.name.trim();
        return {
          name,
          quantity,
          sku: typeof i.sku === 'string' && i.sku.trim() ? i.sku.trim() : null,
          confidence: ['high', 'medium', 'low'].includes(i.confidence) ? i.confidence : 'medium',
          // Quantity FIRST, not last: parseOrderLines() takes the first bare
          // number it finds as the quantity. A trailing "<name> <qty>" segment
          // gets its quantity hijacked by any standalone number already inside
          // the product's own description (e.g. "Dark Yellow Colour 258
          // 450g/tub 1" -> parsed qty 258, not 1). Leading quantity guarantees
          // it's always the first, correctly-bound number in the segment.
          segment: `${quantity} ${name}`,
        };
      });
    if (items.length === 0) return null;

    const text = items.map(i => i.segment).join(', ');
    console.log(`[OCR] Extracted ${items.length} item(s): "${text.substring(0, 120)}"`);
    return { text, items };
  } catch (err) {
    console.error('[OCR] Failed:', err.message);
    return null;
  }
}

// ─── Voice-to-Text (Faster Whisper) ─────────────────────────────────────────

async function transcribeAudio(audioBuffer, ext = 'ogg') {
  const scriptPath = path.join(__dirname, 'stt', 'transcribe.py');

  if (!fs.existsSync(scriptPath)) {
    console.warn('[STT] transcribe.py not found at', scriptPath, '— skipping transcription');
    return null;
  }

  const tmpFile = path.join(os.tmpdir(), `wa_audio_${Date.now()}.${ext}`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
  } catch (err) {
    console.error('[STT] Could not write temp file:', err.message);
    return null;
  }

  // Prefer a local project venv; fall back to system python
  const isWin = process.platform === 'win32';
  const localVenv = isWin
    ? path.join(__dirname, 'stt', 'venv', 'Scripts', 'python.exe')
    : path.join(__dirname, 'stt', 'venv', 'bin', 'python3');
  const fallback = isWin ? 'python' : 'python3';
  const pythonBin = fs.existsSync(localVenv) ? localVenv : fallback;

  try {
    // transcribe.py handles all language detection and retries internally.
    // stdout line 1 = final detected language, line 2+ = transcript.
    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, tmpFile], {
      timeout: 180000, // extra headroom for zh/en retries within the same process
      encoding: 'utf8',
    });
    if (stderr) console.log('[STT] stderr:', stderr.trim());
    const lines = stdout.split('\n');
    const detectedLang = lines[0].trim();
    const transcript = lines.slice(1).join('\n').trim();
    console.log(`[STT] Detected language: ${detectedLang}`);
    return { transcript: transcript || null, language: detectedLang || null };
  } catch (err) {
    console.error('[STT] Transcription failed:', err.message);
    return { transcript: null, language: null };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ─── Baileys connection ───────────────────────────────────────────────────────

async function connectBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, 'baileys-auth')
  );

  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Refi Order Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan this QR code with your Baileys WhatsApp number:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n');
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : null;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      console.log(`⚠️  Baileys disconnected (code ${code}) — reconnecting: ${shouldReconnect}`);
      isReady = false;

      if (shouldReconnect) {
        setTimeout(connectBaileys, 3000);
      } else {
        console.log('🔴 Baileys logged out. Delete baileys-auth/ folder and restart to re-scan QR.');
      }
    } else if (connection === 'open') {
      console.log('✅ Baileys WhatsApp connected and ready!');
      isReady = true;

      sock.groupFetchAllParticipating().then(groups => {
        groupCache = groups;
        const ids = Object.keys(groups);
        console.log(`\n📋 Groups this number is in (${ids.length}):`);
        ids.forEach(id => console.log(`  ${groups[id].subject} → ${id}`));
        console.log('');
      }).catch(e => console.log('⚠️  Could not list groups:', e.message));
    }
  });

  sock.ev.on('groups.upsert', (newGroups) => {
    for (const g of newGroups) {
      groupCache[g.id] = g;
      console.log(`📋 New group joined: ${g.subject} → ${g.id}`);
    }
  });

  sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
      if (groupCache[update.id]) {
        groupCache[update.id] = { ...groupCache[update.id], ...update };
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!msg.message || msg.key.fromMe) continue;
      if (alreadyProcessed(msg.key.id)) {
        console.log(`⏭️  Skipping duplicate message ${msg.key.id}`);
        continue;
      }
      if (!ORDER_TAKING_ENABLED) continue; // order-taking on hiatus — see ORDER_TAKING_ENABLED above

      const senderPhone = (msg.key.participant || '').replace('@s.whatsapp.net', '');
      const messageTimestamp = msg.messageTimestamp
        ? new Date(Number(msg.messageTimestamp) * 1000)
        : new Date();

      // ── Audio / voice note handling ──────────────────────────────────────
      const audioMsg = msg.message?.audioMessage || msg.message?.pttMessage;
      if (audioMsg) {
        if (!isGroup) {
          console.log(`🎤 Audio in private chat from ${senderPhone} — skipping (group-only)`);
          continue;
        }

        console.log(`🎤 Voice note from ${senderPhone} in group ${remoteJid} — transcribing...`);

        let buffer;
        try {
          buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
              logger: { info: () => {}, warn: () => {}, error: console.error },
              reuploadRequest: sock.updateMediaMessage,
            }
          );
        } catch (err) {
          console.error('❌ Audio download failed:', err.message);
          continue;
        }

        const [sttResult, audioUrl] = await Promise.all([
          transcribeAudio(buffer, 'ogg'),
          uploadAttachmentToBlob(buffer, remoteJid, 'ogg', 'audio/ogg'),
        ]);

        const { transcript, language: detectedLang } = sttResult;
        const audioAttachment = { type: 'audio', url: audioUrl, text: null, transcript, language: detectedLang, timestamp: messageTimestamp };

        if (!transcript) {
          console.log('[STT] No transcript produced — passing along audio attachment only');
          handleGroupMessage(sock, remoteJid, senderPhone, '', audioAttachment)
            .catch(e => console.error('❌ handleGroupMessage error (from STT):', e.message));
          continue;
        }

        console.log(`[STT] Transcript: "${transcript}"`);

        handleGroupMessage(sock, remoteJid, senderPhone, transcript, audioAttachment)
          .catch(e => console.error('❌ handleGroupMessage error (from STT):', e.message));

        continue;
      }

      // ── Image handling ───────────────────────────────────────────────────
      const imageMsg = msg.message?.imageMessage;
      if (imageMsg) {
        if (!isGroup) {
          console.log(`📷 Image in private chat from ${senderPhone} — skipping (group-only)`);
          continue;
        }

        console.log(`📷 Image from ${senderPhone} in group ${remoteJid} — uploading...`);

        let imgBuffer;
        try {
          imgBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
              logger: { info: () => {}, warn: () => {}, error: console.error },
              reuploadRequest: sock.updateMediaMessage,
            }
          );
        } catch (err) {
          console.error('❌ Image download failed:', err.message);
          continue;
        }

        const contentType = imageMsg.mimetype || 'image/jpeg';
        const ext = contentType.split('/')[1] || 'jpg';
        const caption = (imageMsg.caption || '').trim();

        const [imageUrl, ocrResult] = await Promise.all([
          uploadAttachmentToBlob(imgBuffer, remoteJid, ext, contentType),
          ocrImage(imgBuffer, contentType),
        ]);

        // OCR result is the primary order text; caption is the fallback
        const orderText = ocrResult?.text || caption;
        const imageAttachment = {
          type: 'image',
          url: imageUrl,
          text: caption || null,
          transcript: ocrResult?.text || null,
          ocrItems: ocrResult?.items || null,
          timestamp: messageTimestamp,
        };

        console.log(`📷 Image uploaded${caption ? ` | caption: ${caption.substring(0, 80)}` : ' | no caption'}${ocrResult?.text ? ` | OCR: ${ocrResult.text.substring(0, 80)}` : ''}`);

        handleGroupMessage(sock, remoteJid, senderPhone, orderText, imageAttachment)
          .catch(e => console.error('❌ handleGroupMessage error (from image):', e.message));

        continue;
      }

      // ── Text message handling ────────────────────────────────────────────
      if (!isGroup) continue;

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;

      console.log(`📩 Group msg | ${remoteJid} | ${senderPhone} | ${text.substring(0, 80)}`);
      const textAttachment = { type: 'text', url: null, text, transcript: null, timestamp: messageTimestamp };
      handleGroupMessage(sock, remoteJid, senderPhone, text, textAttachment)
        .catch(e => console.error('❌ handleGroupMessage error:', e.message));
    }
  });
}

// ─── Public helpers ───────────────────────────────────────────────────────────

async function postToGroup(groupId, message) {
  if (!sock || !isReady) {
    console.warn(`⚠️  Baileys not ready — cannot post to group ${groupId}`);
    return false;
  }
  try {
    await sock.sendMessage(groupId, { text: message });
    console.log(`✅ Baileys: posted to group ${groupId}`);
    return true;
  } catch (error) {
    console.error('❌ Baileys error posting to group:', error.message);
    return false;
  }
}

async function adminConfirmGroup(groupId, overrideItems, summary) {
  if (!sock || !isReady) return { success: false, error: 'Baileys not connected' };
  return adminConfirm(sock, groupId, overrideItems, summary);
}

async function adminCancelGroup(groupId) {
  if (!sock || !isReady) return { success: false, error: 'Baileys not connected' };
  return adminCancel(sock, groupId);
}

function isBaileysReady() {
  return isReady;
}

function getBaileysGroups() {
  return Object.entries(groupCache).map(([id, g]) => ({
    id,
    name: g.subject || id,
    participants: g.participants?.length || 0
  }));
}

module.exports = {
  connectBaileys,
  postToGroup,
  isBaileysReady,
  getBaileysGroups,
  getPendingSessions,
  updateSessionItems,
  adminConfirmGroup,
  adminCancelGroup
};
