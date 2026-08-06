require('dotenv').config();
const db = require('./database');
const { connectBaileys } = require('./baileys-bot');
const startApiServer = require('./api');

startApiServer();

connectBaileys().catch(err => console.error('❌ Baileys startup error:', err.message));

function shutdown() {
  db.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
