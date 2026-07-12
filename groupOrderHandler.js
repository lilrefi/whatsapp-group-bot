const db = require('./database');
const { loadProfile, pickBestMatch } = require('./profileLookup');

// Per-group order sessions
// groupId → { items, pendingDisambiguations, notFound, pendingAttachments, senderPhone, startedAt, timerId }
const groupSessions = new Map();

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
  //
  // For voice/image we skip the ASCII-digit requirement: Chinese orders use
  // numerals like 一/二/十二 that \d won't match, and we already paid for
  // transcription/OCR so it's worth attempting a parse on any non-trivial text.
  const isMediaAttachment = attachment?.type === 'audio' || attachment?.type === 'image';
  const isOrderLike = isMediaAttachment
    ? text.trim().length >= 2
    : /\d/.test(text) && text.replace(/\d/g, '').trim().length >= 2;
  const textToParse = isMediaAttachment ? normalizeChineseNumerals(text) : text;
  const lines = isOrderLike ? parseOrderLines(textToParse) : [];

  if (lines.length === 0) {
    if (attachment && session) {
      session.pendingAttachments.push(attachment);
      groupSessions.set(groupId, session);
    }
    return;
  }

  await processOrderLines(sock, groupId, senderPhone, lines, session, attachment);
}

// ─── Correction / noise detection ────────────────────────────────────────────
// Instead of maintaining a list of correction trigger phrases (which breaks on
// every new phrasing), we check whether the DB-search term looks like a product
// name or just noise.  If zero products match AND every word in the search term
// is short (< 4 chars) or a known non-product filler word, it's a quantity
// correction on the last session item — not a notFound entry.
//
// This is language-agnostic: "3 only", "3 la", "make it 3", "3x instead",
// "change to 4", "改成3个" (after numeral normalisation → "改成3") all resolve
// correctly without adding new trigger words.

const FILLER_WORDS = new Set([
  // correction verbs / phrases (appear after digit stripping)
  'make', 'change', 'update', 'edit', 'amend', 'correction',
  // pronouns / determiners
  'that', 'it', 'those', 'them', 'this',
  // adverbs / discourse markers
  'instead', 'only', 'actually', 'just', 'please', 'pls',
  'ok', 'okay', 'no', 'nope', 'sorry',
  // Malaysian / Singaporean fillers
  'la', 'lah', 'ah', 'eh',
  // prepositions (in correction context)
  'to', 'from', 'for', 'of',
]);

function isNoiseSearchTerm(term) {
  const words = term.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Every word must be either short (< 4 chars) or a known filler
  return words.every(w => w.length < 4 || FILLER_WORDS.has(w));
}

// ─── Chinese numeral normalisation ───────────────────────────────────────────
// Converts CJK quantity+measure expressions to ASCII digits so parseOrderLines
// can extract them.  e.g. "一个葱油" → "1 葱油", "十二箱蘑菇" → "12 蘑菇"

const ZH_NUM_MAP = { '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };

function normalizeChineseNumerals(text) {
  return text
    // X十Y + optional measure → X*10+Y (e.g. 二十一箱 → 21 )
    .replace(/([一二两三四五六七八九])十([一二三四五六七八九])[个只箱包瓶袋盒罐条件块]?/g,
      (_, a, b) => `${ZH_NUM_MAP[a] * 10 + ZH_NUM_MAP[b]} `)
    // X十 + optional measure → X0 (e.g. 三十 → 30 )
    .replace(/([一二两三四五六七八九])十[个只箱包瓶袋盒罐条件块]?/g,
      (_, a) => `${ZH_NUM_MAP[a] * 10} `)
    // 十Y + optional measure → 10+Y (e.g. 十二 → 12 )
    .replace(/十([一二三四五六七八九])[个只箱包瓶袋盒罐条件块]?/g,
      (_, b) => `${10 + ZH_NUM_MAP[b]} `)
    // 十 + optional measure → 10
    .replace(/十[个只箱包瓶袋盒罐条件块]?/g, '10 ')
    // Single digit + measure word → digit (e.g. 一个 → 1 , 三箱 → 3 , 酱青两箱 → 酱青2 )
    // NOTE: bare digits without a measure word (e.g. "葱油一") are left as-is
    // to avoid corrupting product names that contain Chinese numerals (e.g. 七味粉).
    .replace(/([一二两三四五六七八九])[个只箱包瓶袋盒罐条件块]/g,
      (_, a) => `${ZH_NUM_MAP[a]} `);
}

// ─── Order line parsing ───────────────────────────────────────────────────────

function parseOrderLines(text) {
  const NOISE = /\b(i want|please|can i have|give me|order|just)\b/gi;
  const UNITS = /\b(pcs|pieces|unit|units|pack|packs|box|boxes)\b/gi;
  const rawSegments = text.split(/[\n,]|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  // Whisper rarely inserts commas in Chinese speech — a long CJK segment with
  // spaces is almost certainly multiple items. Split further by whitespace.
  const segments = [];
  for (const seg of rawSegments) {
    const cjkCount = (seg.match(/[一-鿿]/g) || []).length;
    if (cjkCount > 3 && seg.includes(' ')) {
      segments.push(...seg.split(/\s+/).filter(Boolean));
    } else {
      segments.push(seg);
    }
  }
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
  const isFromVoice = attachment?.type === 'audio';
  const isFromImage = attachment?.type === 'image';

  const groupProfile = await db.getGroupProfile(groupId);
  const profile = (groupProfile && groupProfile.customer_code)
    ? await loadProfile(groupProfile.customer_code)
    : null;

  const newResolved = [];
  const newAmbiguous = [];
  const newNotFound = [];
  const newCorrections = []; // qty-only updates for the last session item

  for (const line of lines) {
    const results = await searchProductsFuzzy(line.searchTerm);
    if (results.length === 0) {
      // If the search term is pure noise (no product-name-like word), treat this
      // as a quantity correction rather than a missing product.
      if (isNoiseSearchTerm(line.searchTerm)) {
        newCorrections.push({ qty: line.quantity });
      } else {
        newNotFound.push(line.rawSegment);
      }
    } else if (results.length === 1) {
      const lowConf = isFromVoice || isFromImage;
      const sourceNote = isFromVoice ? 'from voice transcription' : isFromImage ? 'from image OCR' : null;
      newResolved.push({ product_id: results[0].id, product: results[0], quantity: line.quantity, flagged: lowConf, confidence_note: sourceNote });
    } else {
      const best = pickBestMatch(results, profile);
      const sourceNote = isFromVoice ? 'from voice transcription' : isFromImage ? 'from image OCR' : null;
      if (best) {
        const lowConf = isFromVoice || isFromImage;
        newResolved.push({ product_id: best.id, product: best, quantity: line.quantity, flagged: lowConf, confidence_note: sourceNote });
      } else {
        const base = `auto-picked (${results.length} candidates, no order history)`;
        const note = sourceNote ? `${base}; ${sourceNote}` : base;
        newResolved.push({ product_id: results[0].id, product: results[0], quantity: line.quantity, flagged: true, confidence_note: note });
      }
    }
  }

  // Re-read from the Map: a concurrent voice-note call may have written a session
  // while we were awaiting DB lookups above. Prefer the live Map value so we
  // merge into it rather than overwriting it with a stale snapshot.
  const liveSession = groupSessions.get(groupId);

  // Early-return if there's nothing to do.
  // Corrections without an active session are also dropped (nothing to correct).
  if (newResolved.length === 0 && newNotFound.length === 0 &&
      (newCorrections.length === 0 || (!liveSession && !existingSession))) return;

  const session = liveSession || existingSession || { items: [], pendingDisambiguations: [], notFound: [], senderPhone, startedAt: Date.now(), pendingAttachments: [] };

  // Apply quantity corrections to the last item in the session
  for (const corr of newCorrections) {
    if (session.items.length > 0) {
      session.items[session.items.length - 1].quantity = corr.qty;
    }
    // If no items yet, silently drop (e.g. "3 only" sent with no active order)
  }

  // Merge resolved items (replace quantity for duplicates)
  for (const item of newResolved) {
    const idx = session.items.findIndex(i => i.product_id === item.product_id);
    if (idx >= 0) {
      session.items[idx].quantity = item.quantity;
    } else {
      session.items.push(item);
    }
  }

  session.notFound = [...new Set([...session.notFound, ...newNotFound])];
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

const ORDER_AUTO_CONFIRM_MS = 48 * 60 * 60 * 1000; // 48 hours

async function showOrderSummary(sock, groupId, session) {
  // Silent — no reply until staff confirms or 48 h timer fires
}

// Called whenever the session settles after processing a message.
// Resets the 48-hour auto-confirm window on every interaction.
async function finishOrderProgress(sock, groupId, senderPhone, session) {
  clearTimer(groupId); // reset window on every interaction

  if (session.pendingDisambiguations.length > 0) {
    await askDisambiguation(sock, groupId, session.pendingDisambiguations[0]);
    return;
  }
  await showOrderSummary(sock, groupId, session);

  // Auto-confirm 48 h after the last order message if staff hasn't acted.
  if (session.items.length > 0) {
    session.timerId = setTimeout(() => {
      finalizeOrder(sock, groupId, senderPhone, 'confirmed');
    }, ORDER_AUTO_CONFIRM_MS);
    groupSessions.set(groupId, session);
  }
}

// ─── Timer cleanup (no-op kept for safety in case old sessions have a timerId) ─

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
  if (!session) {
    return;
  }
  // Allow confirming a session that has no bot-matched items as long as the
  // dashboard is supplying override items (staff manually corrected all-notFound).
  if (session.items.length === 0 && (!overrideItems || overrideItems.length === 0)) {
    groupSessions.delete(groupId);
    return;
  }
  clearTimer(groupId);
  groupSessions.delete(groupId);

  try {
    // ── Resolve customer by group ownership ──
    // Primary: customer_groups table (group_id → customer_id). This is populated
    // by the dashboard when a group is registered to a business.
    // Legacy fallback: group_profiles → customer_code → customers.customer_code.
    // NEVER fall back to sender phone — senderPhone can be a Baileys @lid
    // identifier (e.g. 118914826662020@lid), not a real phone number.
    const gp = await db.getGroupProfile(groupId);
    let customer = await db.getCustomerByGroupId(groupId);

    if (!customer && gp && gp.customer_code) {
      customer = await db.getCustomerByCode(gp.customer_code);
    }

    if (!customer) {
      console.warn(`⚠️  No customer found for group ${groupId} — order will be saved with customer_id = null`);
    }

    // If the dashboard sent edited items, map them to the shape createGroupOrder expects.
    // product_id/sku will be null so history update is skipped for these.
    const itemsToSave = overrideItems
      ? overrideItems.map(i => ({
          product_id: i.product_id || null,
          quantity: i.qty,
          flagged: i.flagged || false,
          confidence_note: i.confidence_note || null,
          product: { name: i.name, unit_size: i.unit || null, sku: null }
        }))
      : session.items;

    const { order } = await db.createGroupOrder(customer?.id || null, groupId, itemsToSave, status, session.pendingAttachments || []);

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
    // Skipped when no customer was resolved, or for override items (no product_id/sku).
    for (const item of session.items) {
      if (!customer || !item.product_id || !item.product) continue;
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

    console.log(`✅ Order #${order.id} [${status}] for group ${groupId} → customer ${customer?.id || 'null'}`);
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
    awaitingDisambiguation: session.pendingDisambiguations.length > 0,
    items: session.items.map(i => ({
      product_id: i.product_id,
      name: i.product.name,
      sku: i.product.sku || null,
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
      language: a.language || null,
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

module.exports = {
  handleGroupMessage,
  getPendingSessions,
  adminConfirm,
  adminCancel
};
