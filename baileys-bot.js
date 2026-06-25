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
const { handleGroupMessage, getPendingSessions, adminConfirm, adminCancel } = require('./groupOrderHandler');

const execFileAsync = promisify(execFile);
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

let sock = null;
let isReady = false;
let groupCache = {};

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
  // WhatsApp occasionally sends 'image/jpg' which the API doesn't accept
  const normalizedType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  if (!OCR_SUPPORTED_TYPES.includes(normalizedType)) {
    console.warn(`[OCR] Unsupported type ${mimeType} — skipping`);
    return null;
  }
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: normalizedType, data: imageBuffer.toString('base64') }
          },
          {
            type: 'text',
            text: 'Extract any food or product order text from this image. Return only the order items exactly as written, nothing else. If no order is visible, return nothing.'
          }
        ]
      }]
    });
    const text = response.content[0]?.text?.trim();
    console.log(`[OCR] Extracted: "${text?.substring(0, 80) || '(empty)'}"`);
    return text || null;
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
    });
    if (stderr) console.log('[STT] stderr:', stderr.trim());
    const lines = stdout.split('\n');
    const detectedLang = lines[0].trim();
    const transcript = lines.slice(1).join('\n').trim();
    console.log(`[STT] Detected language: ${detectedLang}`);
    return transcript || null;
  } catch (err) {
    console.error('[STT] Transcription failed:', err.message);
    return null;
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

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!msg.message || msg.key.fromMe) continue;

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

        const [transcript, audioUrl] = await Promise.all([
          transcribeAudio(buffer, 'ogg'),
          uploadAttachmentToBlob(buffer, remoteJid, 'ogg', 'audio/ogg'),
        ]);

        const audioAttachment = { type: 'audio', url: audioUrl, text: null, transcript, timestamp: messageTimestamp };

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

        const [imageUrl, ocrText] = await Promise.all([
          uploadAttachmentToBlob(imgBuffer, remoteJid, ext, contentType),
          ocrImage(imgBuffer, contentType),
        ]);

        // OCR result is the primary order text; caption is the fallback
        const orderText = ocrText || caption;
        const imageAttachment = { type: 'image', url: imageUrl, text: caption || null, transcript: ocrText || null, timestamp: messageTimestamp };

        console.log(`📷 Image uploaded${caption ? ` | caption: ${caption.substring(0, 80)}` : ' | no caption'}${ocrText ? ` | OCR: ${ocrText.substring(0, 80)}` : ''}`);

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
  adminConfirmGroup,
  adminCancelGroup
};
