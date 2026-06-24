const db = require('./database');
const { loadProfile, pickBestMatch } = require('./profileLookup');

// Per-group order sessions
// groupId → { items, pendingDisambiguations, notFound, pendingAttachments, senderPhone, startedAt, timerId }
const groupSessions = new Map();

function bufferMs() {
  return (parseInt(process.env.ORDER_BUFFER_MINUTES) || 10) * 60 * 1000;
}

// ─── Entry point (called by baileys-bot for every group message) ──────────────

async function handleGroupMessage(sock, groupId, senderPhone, text, attachment = null) {
  const groupProfile = await db.getGroupProfile(groupId);
  if (!groupProfile) return; // ignore unlinked groups

  const lower = text.trim().toLowerCase();
  const session = groupSessions.get(groupId);

  // CANCEL — only explicit cancel aborts the order
  if (lower === 'cancel' && session) {
    clearTimer(groupId);
    groupSessions.delete(groupId);
    await sock.sendMessage(groupId, { text: '❌ Order cancelled.' });
    return;
  }

  // Disambiguation reply: pure integer while disambiguation is waiting
  if (session && session.pendingDisambiguations && session.pendingDisambiguations.length > 0 &&
      /^\d+$/.test(lower.trim())) {
    await handleDisambiguationReply(sock, groupId, senderPhone, parseInt(lower.trim(), 10));
    return;
  }

  // Ignore messages that clearly aren't orders — but if an order is already
  // being built, still capture the attachment (e.g. a photo sent without a
  // caption, or a voice note that didn't transcribe into order text) so it
  // ends up linked to the eventual order.
  const isOrderLike = /\d/.test(text) && text.replace(/\d/g, '').trim().length >= 2;
  const lines = isOrderLike ? parseOrderLines(text) : [];

  if (lines.length === 0) {
    if (attachment && session) {
      session.pendingAttachments.push(attachment);
      groupSessions.set(groupId, session);
      // Re-arm the buffer — incoming attachments count as activity, so the
      // order shouldn't auto-place while the customer is still sending media.
      if (session.items.length > 0 && session.pendingDisambiguations.length === 0) {
        clearTimer(groupId);
        startTimer(sock, groupId, senderPhone);
      }
    }
    return;
  }

  await processOrderLines(sock, groupId, senderPhone, lines, session, attachment);
}

// ─── Order line parsing ───────────────────────────────────────────────────────

function parseOrderLines(text) {
  const NOISE = /\b(i want|please|can i have|give me|order|just)\b/gi;
  const UNITS = /\b(pcs|pieces|unit|units|pack|packs|box|boxes)\b/gi;
  const segments = text.split(/[\n,]|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const segment of segments) {
    const cleaned = segment
      .replace(NOISE, ' ')
      .replace(/\bx\s*(\d+)\b/gi, ' $1 ')
      .replace(/(\d+)\s*x\b/gi, ' $1 ')
      .trim();
    const numMatch = cleaned.match(/\b(\d+)\b/);
    const quantity = numMatch ? parseInt(numMatch[1], 10) : 1;
    const searchTerm = cleaned
      .replace(/\b\d+\b/, '')
      .replace(UNITS, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (searchTerm.length >= 2) {
      results.push({ rawSegment: segment, quantity, searchTerm });
    }
  }
  return results;
}

async function searchProductsFuzzy(searchTerm) {
  let results = await db.searchProducts(searchTerm);
  if (results.length > 0) return results;
  const words = searchTerm.split(' ').filter(w => w.length >= 3);
  for (const word of words) {
    results = await db.searchProducts(word);
    if (results.length > 0) return results;
  }
  return [];
}

// ─── Core matching logic ──────────────────────────────────────────────────────

async function processOrderLines(sock, groupId, senderPhone, lines, existingSession, attachment) {
  const groupProfile = await db.getGroupProfile(groupId);
  const profile = (groupProfile && groupProfile.customer_code)
    ? loadProfile(groupProfile.customer_code)
    : null;

  const newResolved = [];
  const newAmbiguous = [];
  const newNotFound = [];

  for (const line of lines) {
    const results = await searchProductsFuzzy(line.searchTerm);
    if (results.length === 0) {
      newNotFound.push(line.rawSegment);
    } else if (results.length === 1) {
      newResolved.push({ product_id: results[0].id, product: results[0], quantity: line.quantity, flagged: false });
    } else {
      const best = pickBestMatch(results, profile);
      if (best) {
        newResolved.push({ product_id: best.id, product: best, quantity: line.quantity, flagged: false });
      } else {
        // No history match — auto-pick the first candidate and flag so the
        // dashboard can highlight it for staff review.
        newResolved.push({ product_id: results[0].id, product: results[0], quantity: line.quantity, flagged: true, confidence_note: `auto-picked (${results.length} candidates, no order history)` });
      }
    }
  }

  // Re-read from the Map: a concurrent voice-note call may have written a session
  // while we were awaiting DB lookups above. Prefer the live Map value so we
  // merge into it rather than overwriting it with a stale snapshot.
  const liveSession = groupSessions.get(groupId);

  if (newResolved.length === 0 && newAmbiguous.length === 0 && !liveSession && !existingSession) return;

  const session = liveSession || existingSession || { items: [], pendingDisambiguations: [], notFound: [], senderPhone, pendingAttachments: [] };

  // Merge resolved items (replace quantity for duplicates)
  for (const item of newResolved) {
    const idx = session.items.findIndex(i => i.product_id === item.product_id);
    if (idx >= 0) {
      session.items[idx].quantity = item.quantity;
    } else {
      session.items.push(item);
    }
  }

  session.notFound = [...session.notFound, ...newNotFound];
  session.pendingDisambiguations = [...session.pendingDisambiguations, ...newAmbiguous];
  if (attachment) session.pendingAttachments.push(attachment);

  clearTimer(groupId);
  groupSessions.set(groupId, session);

  await finishOrderProgress(sock, groupId, senderPhone, session);
}

// ─── Disambiguation ───────────────────────────────────────────────────────────

async function askDisambiguation(sock, groupId, pending) {
  let msg = `❓ Which *"${pending.rawSegment}"* did you mean?\n\n`;
  pending.candidates.forEach((p, i) => {
    msg += `${i + 1}. ${p.name}${p.unit_size ? ` (${p.unit_size})` : ''}\n`;
  });
  msg += `\nReply with a number (1–${pending.candidates.length}), or *0* to skip`;
  await sock.sendMessage(groupId, { text: msg });
}

async function handleDisambiguationReply(sock, groupId, senderPhone, num) {
  const session = groupSessions.get(groupId);
  if (!session || !session.pendingDisambiguations.length) return;

  const pending = session.pendingDisambiguations[0];
  if (num === 0) {
    session.pendingDisambiguations.shift();
    groupSessions.set(groupId, session);
    await sock.sendMessage(groupId, { text: `⏭️ Skipped "${pending.rawSegment}".` });
    await finishOrderProgress(sock, groupId, senderPhone, session);
    return;
  }
  if (num < 1 || num > pending.candidates.length) {
    await sock.sendMessage(groupId, { text: `❌ Please reply with a number between 1 and ${pending.candidates.length} (or 0 to skip)` });
    return;
  }

  const chosen = pending.candidates[num - 1];
  const existing = session.items.findIndex(i => i.product_id === chosen.id);
  if (existing >= 0) {
    session.items[existing].quantity += pending.quantity;
  } else {
    session.items.push({ product_id: chosen.id, product: chosen, quantity: pending.quantity, flagged: false });
  }
  session.pendingDisambiguations.shift();
  groupSessions.set(groupId, session);

  await finishOrderProgress(sock, groupId, senderPhone, session);
}

// ─── Summary display ──────────────────────────────────────────────────────────

async function showOrderSummary(sock, groupId, session) {
  // Silent — no reply until staff confirms
}

// Reached whenever the session settles into a stable state after processing a
// message: either ask the next disambiguation question, or — once there's
// nothing left to ask — (re)arm the buffer timer so the order auto-places
// after ORDER_BUFFER_MINUTES of inactivity.
async function finishOrderProgress(sock, groupId, senderPhone, session) {
  if (session.pendingDisambiguations.length > 0) {
    await askDisambiguation(sock, groupId, session.pendingDisambiguations[0]);
    return;
  }
  await showOrderSummary(sock, groupId, session);
  if (session.items.length > 0) {
    clearTimer(groupId);
    startTimer(sock, groupId, senderPhone);
  }
}

// ─── Buffer timer ─────────────────────────────────────────────────────────────

function startTimer(sock, groupId, senderPhone) {
  const session = groupSessions.get(groupId);
  if (!session) return;
  session.startedAt = Date.now();
  session.timerId = setTimeout(
    () => finalizeOrder(sock, groupId, senderPhone, 'auto_placed'),
    bufferMs()
  );
  groupSessions.set(groupId, session);
}

function clearTimer(groupId) {
  const session = groupSessions.get(groupId);
  if (session && session.timerId) {
    clearTimeout(session.timerId);
    session.timerId = null;
  }
}

// ─── Finalize (write to DB + notify group) ────────────────────────────────────

async function finalizeOrder(sock, groupId, senderPhone, status, overrideItems, overrideSummary) {
  const session = groupSessions.get(groupId);
  if (!session || session.items.length === 0) {
    groupSessions.delete(groupId);
    return;
  }
  clearTimer(groupId);
  groupSessions.delete(groupId);

  try {
    // ── Resolve customer by RESTAURANT (group_id → customer_code) ──
    // This ensures orders from the same group always link to the same
    // restaurant customer, regardless of which person sent the message.
    const gp = await db.getGroupProfile(groupId);
    let customer = null;

    if (gp && gp.customer_code) {
      customer = await db.getCustomerByCode(gp.customer_code);
    }

    // Fallback: find or create by sender phone
    if (!customer) {
      customer = await db.getCustomerByPhone(senderPhone);
      if (!customer) customer = await db.createCustomer(senderPhone);
    }

    // If the dashboard sent edited items, map them to the shape createGroupOrder expects.
    // product_id/sku will be null so history update is skipped for these.
    const itemsToSave = overrideItems
      ? overrideItems.map(i => ({
          product_id: null,
          quantity: i.qty,
          flagged: i.flagged || false,
          confidence_note: i.confidence_note || null,
          product: { name: i.name, unit_size: i.unit || null, sku: null }
        }))
      : session.items;

    const { order } = await db.createGroupOrder(customer.id, groupId, itemsToSave, status, session.pendingAttachments || []);

    let msg;
    if (overrideSummary) {
      msg = overrideSummary;
    } else {
      const label = status === 'confirmed' ? '✅ Order confirmed by staff!' : '✅ Order placed!';
      msg = `${label}\n\n*Items:*\n`;
      session.items.forEach((item, i) => {
        msg += `${i + 1}. ${item.product.name}${item.product.unit_size ? ` (${item.product.unit_size})` : ''} ×${item.quantity}\n`;
      });
    }

    await sock.sendMessage(groupId, { text: msg });

    if (gp && gp.overview_group_id) {
      await sock.sendMessage(gp.overview_group_id, { text: msg });
    }

    // ── Update customer order history ──
    // Increment times_ordered + total_qty for each matched product.
    // Skipped for override items (no product_id/sku available from dashboard).
    for (const item of session.items) {
      if (!item.product_id || !item.product) continue;
      const sku = item.product.sku;
      if (!sku) continue;
      try {
        await db.upsertOrderHistory(
          customer.id,
          sku,
          item.product.name,
          item.product.unit_size || null,
          item.quantity
        );
      } catch (histErr) {
        console.warn(`⚠️  History upsert failed for SKU ${sku}:`, histErr.message);
      }
    }

    console.log(`✅ Order #${order.id} [${status}] for group ${groupId} → customer ${customer.id}`);
  } catch (err) {
    console.error('❌ Error finalizing order:', err.message);
    await sock.sendMessage(groupId, { text: '❌ Error saving order. Please contact admin.' });
  }
}

// ─── Admin API helpers ────────────────────────────────────────────────────────

function getPendingSessions() {
  return Array.from(groupSessions.entries()).map(([groupId, session]) => ({
    groupId,
    senderPhone: session.senderPhone,
    startedAt: session.startedAt || null,
    bufferMs: bufferMs(),
    awaitingDisambiguation: session.pendingDisambiguations.length > 0,
    items: session.items.map(i => ({
      product_id: i.product_id,
      name: i.product.name,
      unit_size: i.product.unit_size || null,
      quantity: i.quantity,
      flagged: i.flagged
    })),
    notFound: session.notFound,
    rawAttachments: (session.pendingAttachments || []).map(a => ({
      type: a.type,
      url: a.url || null,
      text: a.text || null,
      transcript: a.transcript || null,
      timestamp: a.timestamp ? a.timestamp.toISOString() : null,
    }))
  }));
}

async function adminConfirm(sock, groupId, overrideItems, summary) {
  const session = groupSessions.get(groupId);
  if (!session) return { success: false, error: 'No active order for this group' };
  await finalizeOrder(sock, groupId, session.senderPhone || 'admin', 'confirmed', overrideItems, summary);
  return { success: true };
}

async function adminCancel(sock, groupId) {
  const session = groupSessions.get(groupId);
  if (!session) return { success: false, error: 'No active order for this group' };
  clearTimer(groupId);
  groupSessions.delete(groupId);
  if (sock) await sock.sendMessage(groupId, { text: '❌ Order cancelled by admin.' });
  return { success: true };
}

function adminUpdateItems(groupId, items) {
  const session = groupSessions.get(groupId);
  if (!session) return { success: false, error: 'No active order for this group' };
  session.items = items.map(i => ({
    product_id: i.product_id,
    product: { name: i.name, unit_size: i.unit_size || null },
    quantity: i.quantity,
    flagged: i.flagged || false
  }));
  groupSessions.set(groupId, session);
  return { success: true };
}

module.exports = {
  handleGroupMessage,
  getPendingSessions,
  adminConfirm,
  adminCancel,
  adminUpdateItems
};
