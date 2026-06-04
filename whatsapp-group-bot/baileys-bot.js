require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { handleGroupMessage, getPendingSessions, adminConfirm, adminCancel, adminUpdateItems } = require('./groupOrderHandler');

const execFileAsync = promisify(execFile);

let sock = null;
let isReady = false;
let groupCache = {};

// ─── Voice-to-Text (Faster Whisper)

/**
 * Transcribe an audio buffer using Faster Whisper.
 *
 * The Python script is called via child_process. The script path is always
 * stt/transcribe.py relative to the project root. A venv python is preferred
 * (matches your project's setup); falls back to the system python3.
 *
 * @param {Buffer} audioBuffer - raw audio bytes from Baileys
 * @param {string} [ext='ogg'] - file extension (ogg for voice notes)
 * @returns {Promise<string|null>} transcript text, or null on failure
 */
async function transcribeAudio(audioBuffer, ext = 'ogg') {
  const scriptPath = path.join(__dirname, 'stt', 'transcribe.py');

  if (!fs.existsSync(scriptPath)) {
    console.warn('[STT] transcribe.py not found at', scriptPath, '— skipping transcription');
    return null;
  }

  // Write audio buffer to a temp file so Python can read it
  const tmpFile = path.join(os.tmpdir(), `wa_audio_${Date.now()}.${ext}`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
  } catch (err) {
    console.error('[STT] Could not write temp file:', err.message);
    return null;
  }

  try {
    // Prefer venv python (matches your project); fall back to system python3
    const venvPython = '/Users/mac/Document/M2F/Whtsapp Bot/venv/bin/python3';
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';

    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, tmpFile], {
      timeout: 120000, // 2 min — large-v3 on CPU can take a moment
    });

    if (stderr) console.log('[STT] stderr:', stderr.trim());

    const transcript = stdout.trim();
    return transcript || null;
  } catch (err) {
    console.error('[STT] Transcription failed:', err.message);
    return null;
  } finally {
    // Always clean up the temp file
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

      // ── Audio / voice note handling ──────────────────────────────────────
      // Intercept audioMessage and pttMessage (voice notes) BEFORE the text
      // path. Download the audio, transcribe it with Faster Whisper, then
      // inject the transcript as the message text into the existing pipeline.
      const audioMsg = msg.message?.audioMessage || msg.message?.pttMessage;
      if (audioMsg) {
        if (!isGroup) {
          // Private chats: log but don't process through order pipeline
          console.log(`🎤 Audio message in private chat from ${senderPhone} — skipping (order pipeline is group-only)`);
          continue;
        }

        console.log(`🎤 Audio/voice note from ${senderPhone} in group ${remoteJid} — transcribing...`);

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

        const transcript = await transcribeAudio(buffer, 'ogg');

        if (!transcript) {
          console.log('[STT] No transcript produced — skipping message');
          continue;
        }

        console.log(`[STT] Transcript: "${transcript}"`);

        // Feed the transcript through the existing order pipeline
        handleGroupMessage(sock, remoteJid, senderPhone, transcript)
          .catch(e => console.error('❌ handleGroupMessage error (from STT):', e.message));

        continue; // done — skip the text extraction below
      }

      // ── Text message handling (unchanged from original) ──────────────────
      if (!isGroup) continue; // order pipeline is group-only

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;

      console.log(`📩 Group msg | ${remoteJid} | ${senderPhone} | ${text.substring(0, 80)}`);
      handleGroupMessage(sock, remoteJid, senderPhone, text)
        .catch(e => console.error('❌ handleGroupMessage error:', e.message));
    }
  });
}

// ─── Public helpers (unchanged API) ──────────────────────────────────────────

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

async function adminConfirmGroup(groupId) {
  if (!sock || !isReady) return { success: false, error: 'Baileys not connected' };
  return adminConfirm(sock, groupId);
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
  adminCancelGroup,
  adminUpdateItems
};
