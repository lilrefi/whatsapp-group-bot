require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const { handleGroupMessage, getPendingSessions, adminConfirm, adminCancel, adminUpdateItems } = require('./groupOrderHandler');

let sock = null;
let isReady = false;
let groupCache = {};

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

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      const groupId = msg.key.remoteJid;
      const isGroup = groupId && groupId.endsWith('@g.us');

      if (!msg.message || msg.key.fromMe) continue;
      if (!isGroup) continue;

      const senderPhone = (msg.key.participant || '').replace('@s.whatsapp.net', '');
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;

      console.log(`📩 Group msg | ${groupId} | ${senderPhone} | ${text.substring(0, 80)}`);
      handleGroupMessage(sock, groupId, senderPhone, text)
        .catch(e => console.error('❌ handleGroupMessage error:', e.message));
    }
  });
}

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

// Admin wrappers — these need access to sock so they live here
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
