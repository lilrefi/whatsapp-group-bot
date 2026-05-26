require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');

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

      // Print all groups so admin can find the group ID
      sock.groupFetchAllParticipating().then(groups => {
        groupCache = groups;
        const ids = Object.keys(groups);
        console.log(`\n📋 Groups this number is in (${ids.length}):`);
        ids.forEach(id => console.log(`  ${groups[id].subject} → ${id}`));
        console.log('');
      }).catch(e => console.log('⚠️  Could not list groups:', e.message));
    }
  });

  // Log incoming group messages so admin can see group IDs
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const chatId = msg.key.remoteJid;
      if (chatId.endsWith('@g.us')) {
        const sender = msg.key.participant || '';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        console.log(`📩 Baileys group msg | group: ${chatId} | from: ${sender} | text: ${text}`);
      }
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
    console.log(`✅ Baileys: posted order to group ${groupId}`);
    return true;
  } catch (error) {
    console.error('❌ Baileys error posting to group:', error.message);
    return false;
  }
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

module.exports = { connectBaileys, postToGroup, isBaileysReady, getBaileysGroups };
