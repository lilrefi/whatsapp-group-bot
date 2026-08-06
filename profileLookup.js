const fs = require('fs');
const path = require('path');
const db = require('./database');

const PROFILES_DIR = path.join(__dirname, 'customer_profiles');

// Query live DB history first; fall back to legacy JSON export if no rows found.
async function loadProfile(customerCode) {
  try {
    const rows = await db.getCustomerOrderHistory(customerCode);
    if (rows.length > 0) {
      return { order_history: rows };
    }
  } catch (err) {
    console.warn(`[profile] DB history lookup failed for ${customerCode}:`, err.message);
  }

  // Legacy fallback: static JSON files exported from PSOFT.
  // customer_code may be "3000/006" or just "006" — extract numeric part.
  const parts = customerCode.toString().split('/');
  const padded = (parts[1] || parts[0]).padStart(3, '0');
  const filepath = path.join(PROFILES_DIR, `3000_${padded}.json`);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

// Given multiple product candidates and a customer profile,
// return the product the customer orders most frequently, or null if none match.
function pickBestMatch(candidates, profile) {
  if (!profile || !profile.order_history) return null;
  const historyMap = new Map(
    profile.order_history.map(item => [item.item_code, item.times_ordered])
  );
  const matches = candidates.filter(p => historyMap.has(p.sku));
  if (matches.length === 0) return null;
  matches.sort((a, b) => (historyMap.get(b.sku) || 0) - (historyMap.get(a.sku) || 0));
  return matches[0];
}

module.exports = { loadProfile, pickBestMatch };
