require('dotenv').config();
const db = require('./database');
const { connectBaileys } = require('./baileys-bot');
const startApiServer = require('./api');

startApiServer();

connectBaileys().catch(err => console.error('❌ Baileys startup error:', err.message));

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});
