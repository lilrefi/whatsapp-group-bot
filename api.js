const express = require('express');
const db = require('./database');
const {
  isBaileysReady,
  getBaileysGroups,
  getPendingSessions,
  adminConfirmGroup,
  adminCancelGroup,
  postToGroup
} = require('./baileys-bot');

const API_PORT = parseInt(process.env.BOT_API_PORT) || 3001;
const API_KEY = process.env.BOT_API_KEY;

function auth(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] === API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function startApiServer() {
  const app = express();
  app.use(express.json());

  // GET /api/status
  app.get('/api/status', auth, (req, res) => {
    res.json({ connected: isBaileysReady(), phone: null });
  });

  // GET /api/baileys-groups — all WA groups the bot account is currently in
  app.get('/api/baileys-groups', auth, (req, res) => {
    res.json({
      connected: isBaileysReady(),
      groups: getBaileysGroups()
    });
  });

  // GET /api/pending-orders
  app.get('/api/pending-orders', auth, async (req, res) => {
    try {
      const sessions = getPendingSessions();
      const orders = await Promise.all(sessions.map(async (s) => {
        const gp = await db.getGroupProfile(s.groupId);
        return {
          groupId: s.groupId,
          customerPhone: s.senderPhone,
          customerCode: gp?.customer_code || null,
          createdAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
          awaitingDisambiguation: s.awaitingDisambiguation,
          items: s.items.map(i => ({
            product_id: i.product_id || null,
            name: i.name,
            qty: i.quantity,
            unit: i.unit_size || null,
            unitPrice: null,
            flagged: i.flagged
          })),
          notFound: s.notFound,
          rawAttachments: s.rawAttachments || []
        };
      }));
      res.json({ orders });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/confirm-order
  app.post('/api/confirm-order', auth, async (req, res) => {
    try {
      const { groupId, overrideItems, summary } = req.body;
      if (!groupId) return res.status(400).json({ success: false, error: 'groupId required' });
      const result = await adminConfirmGroup(groupId, overrideItems, summary);
      if (!result.success) return res.status(400).json(result);
      res.json({ success: true, orderId: null });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/send-message
  app.post('/api/send-message', auth, async (req, res) => {
    try {
      const { groupId, message } = req.body;
      if (!groupId || !message) return res.status(400).json({ success: false, error: 'groupId and message required' });
      const sent = await postToGroup(groupId, message);
      if (!sent) return res.status(503).json({ success: false, error: 'Baileys not ready or send failed' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/cancel-order
  app.post('/api/cancel-order', auth, async (req, res) => {
    try {
      const { groupId } = req.body;
      if (!groupId) return res.status(400).json({ success: false, error: 'groupId required' });
      const result = await adminCancelGroup(groupId);
      if (!result.success) return res.status(400).json(result);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/groups
  app.get('/api/groups', auth, async (req, res) => {
    try {
      const groups = await db.getAllGroupProfiles();
      res.json({ groups });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/groups
  app.post('/api/groups', auth, async (req, res) => {
    try {
      const { groupId, customerCode } = req.body;
      if (!groupId) return res.status(400).json({ error: 'groupId required' });
      await db.upsertGroupProfile(groupId, customerCode || null, null);
      const group = await db.getGroupProfile(groupId);
      res.json({ success: true, group });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/groups/:groupId
  app.delete('/api/groups/:groupId', auth, async (req, res) => {
    try {
      await db.deleteGroupProfile(decodeURIComponent(req.params.groupId));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(API_PORT, () => {
    console.log(`🔌 API server running on port ${API_PORT}`);
  });
}

module.exports = startApiServer;
