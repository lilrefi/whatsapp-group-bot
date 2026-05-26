const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('./database');
const { isBaileysReady, getBaileysGroups } = require('./baileys-bot');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function auth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next(); // no password set → open
  if (req.headers['x-admin-token'] === password) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

router.post('/login', express.json(), (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ token: password });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// ── Registrations ─────────────────────────────────────────────────────────────

router.get('/api/registrations', auth, async (req, res) => {
  try {
    res.json(await db.getRegistrations());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/registrations', auth, express.json(), async (req, res) => {
  try {
    const { phone, group_id } = req.body;
    if (!phone || !group_id) return res.status(400).json({ error: 'phone and group_id required' });
    let customer = await db.getCustomerByPhone(phone);
    if (!customer) customer = await db.createCustomer(phone);
    await db.saveCustomerGroup(customer.id, group_id, null);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/registrations/:customerId/:groupId', auth, async (req, res) => {
  try {
    await db.deregisterCustomer(req.params.customerId, decodeURIComponent(req.params.groupId));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Group Profiles ────────────────────────────────────────────────────────────

router.get('/api/group-profiles', auth, async (req, res) => {
  try {
    res.json(await db.getAllGroupProfiles());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/group-profiles', auth, express.json(), async (req, res) => {
  try {
    const { group_id, customer_code, overview_group_id } = req.body;
    if (!group_id) return res.status(400).json({ error: 'group_id required' });
    await db.upsertGroupProfile(group_id, customer_code || null, overview_group_id || null);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/group-profiles/:groupId', auth, async (req, res) => {
  try {
    await db.deleteGroupProfile(decodeURIComponent(req.params.groupId));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

router.get('/api/orders', auth, async (req, res) => {
  try {
    res.json(await db.getRecentOrders(50));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Baileys Groups ────────────────────────────────────────────────────────────

router.get('/api/baileys-groups', auth, (req, res) => {
  res.json({ ready: isBaileysReady(), groups: getBaileysGroups() });
});

module.exports = router;
