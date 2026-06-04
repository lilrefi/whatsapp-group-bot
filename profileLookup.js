const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, 'customer_profiles');

function loadProfile(customerCode) {
  const padded = customerCode.toString().padStart(3, '0');
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
