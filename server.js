require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const db = require('./database');
const { sendTextMessage, sendGroupMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { handleProductSearch, getProductCategories, formatProductList } = require('./products');
const { handleRepeatOrder, confirmOrder, createNewOrder, formatOrderSummary } = require('./orders');
const { loadProfile, pickBestMatch } = require('./profileLookup');
const { connectBaileys, postToGroup } = require('./baileys-bot');
const adminRouter = require('./admin-router');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/admin', adminRouter);

// In-memory session storage (use Redis for production)
const customerSessions = new Map();

// Health check
app.get('/', (req, res) => {
  res.send('WhatsApp Group Bot Server is running');
});

// Webhook verification (Meta requires this)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully!');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Webhook endpoint to receive messages
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry[0];
      const changes = entry.changes[0];
      const value = changes.value;
      
      // Acknowledge Meta immediately to prevent retries
      res.sendStatus(200);

      if (value.messages && value.messages[0]) {
        const message = value.messages[0];
        const from = message.from;
        const messageType = message.type;

        const isGroup = value.messages[0].from.includes('@g.us') ||
                       (value.messages[0].context && value.messages[0].context.from.includes('@g.us'));
        const chatId = isGroup ? message.from : from;

        console.log(`📩 Received ${messageType} from ${from} in ${isGroup ? 'GROUP' : 'PRIVATE'} chat`);

        if (messageType === 'text') {
          const text = message.text.body;
          handleMessage(from, chatId, text, isGroup).catch(e => console.error('❌ handleMessage error:', e));
        } else if (messageType === 'interactive') {
          const interactiveType = message.interactive?.type;
          db.getCustomerByPhone(from).then(async customer => {
            if (!customer) customer = await db.createCustomer(from);
            await db.updateCustomerActivity(customer.id);
            if (interactiveType === 'button_reply') {
              await handleButtonReply(from, message.interactive.button_reply.id, customer);
            } else if (interactiveType === 'list_reply') {
              await handleListReply(from, message.interactive.list_reply.id, customer);
            }
          }).catch(e => console.error('❌ interactive handler error:', e));
        }
      }
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.sendStatus(500);
  }
});

/**
 * Main message handler - works for both group and private chat
 */
async function handleMessage(customerPhone, chatId, text, isGroup) {
  try {
    const command = text.toLowerCase().trim();
    
    // Get or create customer
    let customer = await db.getCustomerByPhone(customerPhone);
    if (!customer) {
      customer = await db.createCustomer(customerPhone);
      console.log(`✅ New customer created: ${customerPhone}`);
    }
    
    // Update last active
    await db.updateCustomerActivity(customer.id);
    
    // Route commands
    if (command === '/start' || command === '/menu' || command === 'hi' || command === 'hello') {
      await handleStartCommand(customerPhone, chatId, customer, isGroup);
    }
    else if (command.startsWith('/register ')) {
      const groupId = text.trim().split(' ')[1];
      await handleRegisterCommand(customerPhone, customer, groupId);
    }
    else if (command === '/debug') {
      await handleDebugCommand(customerPhone, chatId, isGroup);
    }
    else if (command.startsWith('/search ') || command.startsWith('search ')) {
      const searchTerm = command.replace(/^\/(search |search )/i, '');
      await handleSearchCommand(customerPhone, chatId, searchTerm, isGroup);
    }
    else if (command === '/catalog' || command === '/browse') {
      await handleCatalogCommand(customerPhone, chatId, isGroup);
    }
    else if (command === '/repeat' || command === 'repeat order') {
      await handleRepeatCommand(customerPhone, chatId, customer, isGroup);
    }
    else if (command === '/confirm' || command === 'confirm order') {
      await handleConfirmCommand(customerPhone, chatId, customer, isGroup);
    }
    else if (command.startsWith('/add ')) {
      await handleAddCommand(customerPhone, chatId, command, customer, isGroup);
    }
    else if (command === '/cart' || command === 'show cart') {
      await handleCartCommand(customerPhone, chatId, customer, isGroup);
    }
    else if (command === '/clear' || command === 'clear cart') {
      await handleClearCartCommand(customerPhone, chatId, customer, isGroup);
    }
    else if (command === '/help' || command === 'help') {
      await handleHelpCommand(customerPhone, chatId, isGroup);
    }
    else if (command.startsWith('/adminregister ')) {
      // Admin-only: /adminregister [customer_phone] [group_id]
      const parts = text.trim().split(' ');
      await handleAdminRegisterCommand(customerPhone, parts[1], parts[2]);
    }
    else if (command.startsWith('/adminlink ')) {
      // Admin-only: /adminlink [group_id] [code]  e.g. /adminlink 120363xxxx@g.us 002
      const parts = text.trim().split(' ');
      await handleAdminLinkCommand(customerPhone, parts[1], parts[2]);
    }
    else if (command.startsWith('/setoverview ')) {
      // Admin-only: /setoverview [restaurant_group_id] [boss_group_id]
      const parts = text.trim().split(' ');
      await handleSetOverviewCommand(customerPhone, parts[1], parts[2]);
    }
    else {
      const session = customerSessions.get(customer.id);

      // qty_input_text: parse typed quantity during button flow
      if (!isGroup && session && session.step === 'qty_input_text') {
        const qty = parseInt(text.trim());
        if (isNaN(qty) || qty < 1) {
          await sendTextMessage(customerPhone, '❌ Please enter a valid number (e.g. 3):');
        } else {
          await addToCartAndReview(customerPhone, customer, qty);
        }

      // disambiguation: waiting for user to pick which product they meant
      } else if (session && session.step === 'disambiguation') {
        await handleDisambiguationReply(customerPhone, chatId, customer, text, isGroup);

      // text_order_confirm: waiting for YES/CANCEL after free-text parse in group
      } else if (session && session.step === 'text_order_confirm') {
        const reply = command.trim().toLowerCase();
        if (reply === 'yes' || reply === 'y') {
          const order = await confirmOrder(customer.id, session.items, session.originatingGroupId);
          const confirmedGroupId = session.originatingGroupId;
          customerSessions.delete(customer.id);
          if (order.success) {
            let summary = `✅ *Order #${order.order.id} confirmed!*\n\n*Items:*\n`;
            order.items.forEach((item, i) => { summary += `${i + 1}. ${item.product_name} x${item.quantity}\n`; });
            if (isGroup) await sendGroupMessage(chatId, summary);
            else await sendTextMessage(customerPhone, summary);
            if (confirmedGroupId) {
              await postToGroup(confirmedGroupId, summary);
              const gp = await db.getGroupProfile(confirmedGroupId);
              if (gp && gp.overview_group_id) await postToGroup(gp.overview_group_id, summary);
            }
          } else {
            const errMsg = `❌ Could not place order: ${order.message}`;
            if (isGroup) await sendGroupMessage(chatId, errMsg);
            else await sendTextMessage(customerPhone, errMsg);
          }
        } else if (reply === 'cancel' || reply === 'no') {
          customerSessions.delete(customer.id);
          const cancelMsg = '❌ Order cancelled.';
          if (isGroup) await sendGroupMessage(chatId, cancelMsg);
          else await sendTextMessage(customerPhone, cancelMsg);
        }
        // any other message while waiting → ignore silently

      // Try free-text order parsing
      } else {
        const handled = await handleFreeTextOrder(customerPhone, chatId, customer, text, isGroup);
        if (!handled) {
          await handleSearchCommand(customerPhone, chatId, text, isGroup);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
    const errorMsg = 'Sorry, something went wrong. Please try again or type /help for commands.';
    
    if (isGroup) {
      await sendGroupMessage(chatId, errorMsg);
    } else {
      await sendTextMessage(customerPhone, errorMsg);
    }
  }
}

/**
 * /start or /menu command
 */
async function handleStartCommand(customerPhone, chatId, customer, isGroup) {
  const hasOrders = await db.customerHasOrders(customer.id);

  if (isGroup) {
    // Group chats don't support interactive messages — send a text nudge only
    const msg = `👋 Hi! DM me directly to place an order with interactive buttons.\n\nOr use text commands here:\n/catalog /search /add /confirm /help`;
    await sendGroupMessage(chatId, msg);
    return;
  }

  // DM flow: resolve which group to post orders to
  const groups = await db.getCustomerGroups(customer.id);

  if (groups.length === 0) {
    await sendTextMessage(customerPhone,
      `👋 Hi! Your restaurant group hasn't been set up yet.\n\nAsk your admin to DM me:\n/register YOUR_GROUP_ID\n\nThen try again!`);
    return;
  }

  let originatingGroupId;

  if (groups.length === 1) {
    originatingGroupId = groups[0].group_id;
  } else {
    // Multiple groups — ask which one this order is for
    const sections = [{
      title: 'Your Groups',
      rows: groups.map(g => ({
        id: `grp_${g.group_id}`,
        title: g.group_name || g.group_id,
        description: 'Tap to order for this group'
      }))
    }];
    await sendListMessage(customerPhone, 'Which group is this order for?', 'Select Group', sections);
    customerSessions.set(customer.id, { type: 'new_order', items: [], timestamp: Date.now(), step: 'group_select' });
    return;
  }

  // Set up session and show main menu
  const session = { type: 'new_order', items: [], timestamp: Date.now(), step: 'main_menu', originatingGroupId };
  customerSessions.set(customer.id, session);
  await showMainMenu(customerPhone, hasOrders);
}

/**
 * /search command - US-1.3
 */
async function handleSearchCommand(customerPhone, chatId, searchTerm, isGroup) {
  const results = await handleProductSearch(searchTerm);
  
  if (results.length === 0) {
    const msg = `❌ No products found for "${searchTerm}"\n\nTry:\n• /catalog - Browse all\n• Different keyword`;
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  let message = `🔍 *Found ${results.length} products for "${searchTerm}":*\n\n`;
  message += formatProductList(results);
  message += `\n💡 To order: /add [product_id] [quantity]`;
  message += `\nExample: /add 1 2`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
}

/**
 * /catalog command - US-1.1
 */
async function handleCatalogCommand(customerPhone, chatId, isGroup) {
  const categories = await getProductCategories();
  
  if (categories.length === 0) {
    const msg = '❌ Catalog is currently unavailable. Please contact us directly.';
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  let message = `📦 *Product Catalog*\n\n`;
  
  for (const category of categories) {
    message += `*${category.name}* (${category.product_count} items)\n`;
    
    // Get products in this category
    const products = await db.getProductsByCategory(category.id);
    products.forEach(p => {
      message += `  ${p.id}. ${p.name} - ${p.unit_size}\n`;
    });
    message += `\n`;
  }
  
  message += `💡 To order: /add [id] [qty]\n`;
  message += `Example: /add 5 2`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
}

/**
 * /repeat command - US-2
 */
async function handleRepeatCommand(customerPhone, chatId, customer, isGroup) {
  const result = await handleRepeatOrder(customer.id);
  
  if (!result) {
    const msg = `❌ You haven't placed any orders yet.\n\nType /catalog to browse products.`;
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  const { availableItems, unavailableItems } = result;
  
  if (availableItems.length === 0) {
    const msg = '❌ None of the items from your last order are currently available.';
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  // Store in session for confirmation
  customerSessions.set(customer.id, {
    type: 'repeat_order',
    items: availableItems,
    timestamp: Date.now()
  });
  
  let message = `📋 *Your Last Order:*\n\n`;
  availableItems.forEach((item, i) => {
    message += `${i + 1}. ${item.product.name} x${item.quantity} (${item.product.unit_size})\n`;
  });
  
  if (unavailableItems.length > 0) {
    message += `\n⚠️ ${unavailableItems.length} item(s) no longer available\n`;
  }
  
  message += `\n✅ Type */confirm* to place this order`;
  message += `\n❌ Type */clear* to cancel`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
}

/**
 * /add command - US-3.1
 */
async function handleAddCommand(customerPhone, chatId, command, customer, isGroup) {
  // Parse: /add 5 2 (product_id quantity)
  const parts = command.split(' ').filter(p => p);
  
  if (parts.length < 3) {
    const msg = '❌ Usage: /add [product_id] [quantity]\nExample: /add 5 2';
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  const productId = parseInt(parts[1]);
  const quantity = parseInt(parts[2]);
  
  if (isNaN(productId) || isNaN(quantity) || quantity < 1) {
    const msg = '❌ Invalid product ID or quantity';
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  // Get product
  const product = await db.getProductById(productId);
  
  if (!product) {
    const msg = `❌ Product #${productId} not found`;
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  // Get or create cart session
  let session = customerSessions.get(customer.id) || { type: 'new_order', items: [] };
  
  // Add or update item in cart
  const existingIndex = session.items.findIndex(i => i.product_id === productId);
  
  if (existingIndex >= 0) {
    session.items[existingIndex].quantity += quantity;
  } else {
    session.items.push({
      product_id: productId,
      product: product,
      quantity: quantity
    });
  }
  
  customerSessions.set(customer.id, session);
  
  let message = `✅ Added: ${product.name} x${quantity}\n\n`;
  message += `📋 *Your Cart:*\n`;
  session.items.forEach((item, i) => {
    message += `${i + 1}. ${item.product.name} x${item.quantity}\n`;
  });
  message += `\n✅ Type */confirm* to place order`;
  message += `\n🛒 Type */cart* to view cart`;
  message += `\n❌ Type */clear* to clear cart`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
}

/**
 * /cart command
 */
async function handleCartCommand(customerPhone, chatId, customer, isGroup) {
  const session = customerSessions.get(customer.id);
  
  if (!session || session.items.length === 0) {
    const msg = '🛒 Your cart is empty.\n\nType /catalog to browse products.';
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  let message = `🛒 *Your Cart:*\n\n`;
  session.items.forEach((item, i) => {
    message += `${i + 1}. ${item.product.name} x${item.quantity} (${item.product.unit_size})\n`;
  });
  message += `\n✅ Type */confirm* to place order`;
  message += `\n❌ Type */clear* to clear cart`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
}

/**
 * /confirm command - US-3.1, US-3.2
 */
async function handleConfirmCommand(customerPhone, chatId, customer, isGroup) {
  const session = customerSessions.get(customer.id);
  
  if (!session || session.items.length === 0) {
    const msg = '❌ No pending order. Add items first with /add or /repeat';
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  // Create order
  const order = await confirmOrder(customer.id, session.items);
  
  if (!order.success) {
    const msg = `❌ Failed to create order: ${order.message}`;
    
    if (isGroup) {
      await sendGroupMessage(chatId, msg);
    } else {
      await sendTextMessage(customerPhone, msg);
    }
    return;
  }
  
  // Clear session
  customerSessions.delete(customer.id);
  
  // Send confirmation
  let message = `✅ *Order Confirmed!*\n\n`;
  message += `📦 Order #${order.order.id}\n`;
  message += `📅 ${new Date().toLocaleDateString()}\n\n`;
  message += `*Items:*\n`;
  
  order.items.forEach((item, i) => {
    message += `${i + 1}. ${item.product_name} x${item.quantity}\n`;
  });
  
  message += `\n✅ We will confirm your order and delivery schedule shortly.\n`;
  message += `\nThank you for your order! 🙏`;

  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }

  // Post to originating group + overview group via Baileys
  const confirmGroupId = isGroup ? chatId : session.originatingGroupId;
  if (confirmGroupId) {
    await postToGroup(confirmGroupId, message);
    const gp = await db.getGroupProfile(confirmGroupId);
    if (gp && gp.overview_group_id) {
      await postToGroup(gp.overview_group_id, message);
    }
  }
}

/**
 * /clear command
 */
async function handleClearCartCommand(customerPhone, chatId, customer, isGroup) {
  customerSessions.delete(customer.id);
  
  const msg = '🗑️ Cart cleared.';
  
  if (isGroup) {
    await sendGroupMessage(chatId, msg);
  } else {
    await sendTextMessage(customerPhone, msg);
  }
}

/**
 * /help command
 */
async function handleHelpCommand(customerPhone, chatId, isGroup) {
  let message = `📚 *Available Commands:*\n\n`;
  message += `🔍 *Browse & Search:*\n`;
  message += `/catalog - View all products\n`;
  message += `/search [keyword] - Search products\n`;
  message += `  Example: /search noodle\n\n`;
  
  message += `🛒 *Ordering:*\n`;
  message += `/add [id] [qty] - Add to cart\n`;
  message += `  Example: /add 5 2\n`;
  message += `/cart - View your cart\n`;
  message += `/repeat - Repeat last order\n`;
  message += `/confirm - Confirm & place order\n`;
  message += `/clear - Clear your cart\n\n`;
  
  message += `💡 *Tips:*\n`;
  message += `• Just type a product name to search\n`;
  message += `• Commands work in group and private chat`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
}

// ─── /register command ───────────────────────────────────────────────────────

async function handleRegisterCommand(customerPhone, customer, groupId) {
  if (!groupId) {
    await sendTextMessage(customerPhone, '❌ Usage: /register YOUR_GROUP_ID\nExample: /register 120363xxxx@g.us');
    return;
  }
  await db.saveCustomerGroup(customer.id, groupId, null);
  await sendTextMessage(customerPhone,
    `✅ Group registered successfully!\n\nGroup ID: ${groupId}\n\nYour staff can now DM me to place orders — they'll be posted to this group.`);
  console.log(`✅ Group registered: ${groupId} for customer ${customerPhone}`);
}

// ─── /debug command ───────────────────────────────────────────────────────────

async function handleDebugCommand(customerPhone, chatId, isGroup) {
  const msg = `🔧 *Debug Info*\n\nYour phone: ${customerPhone}\nChat ID: ${chatId}\nIs group: ${isGroup}\n\nTo register a group:\n/register [group_id]`;
  if (isGroup) {
    await sendGroupMessage(chatId, msg);
  } else {
    await sendTextMessage(customerPhone, msg);
  }
}

// ─── Button-flow UI helpers ───────────────────────────────────────────────────

async function showMainMenu(customerPhone, hasOrders) {
  const buttons = [
    { id: 'btn_catalog', title: 'Browse Catalog' }
  ];
  if (hasOrders) buttons.push({ id: 'btn_repeat', title: 'Repeat Last Order' });
  buttons.push({ id: 'btn_help', title: 'Help' });

  await sendButtonMessage(
    customerPhone,
    '👋 Welcome! What would you like to do?',
    buttons
  );
}

async function showCategoryMenu(customerPhone, page = 0) {
  const categories = await db.getProductCategories();

  // WhatsApp hard limit: 10 rows total across all sections.
  // Reserve 1 for "Back to Menu" always; reserve 1 more for "More →" when needed.
  const PAGE_SIZE = 8;
  const start = page * PAGE_SIZE;
  const hasNext = start + PAGE_SIZE < categories.length;
  const slice = categories.slice(start, start + PAGE_SIZE);

  const rows = slice.map(c => ({
    id: `cat_${c.id}`,
    title: c.name.substring(0, 24),
    description: `${c.product_count} item${c.product_count !== 1 ? 's' : ''}`
  }));

  if (hasNext) {
    rows.push({ id: `cat_next_${page + 1}`, title: 'More categories →', description: 'View more categories' });
  }
  rows.push({ id: 'btn_back_main', title: 'Back to Menu', description: 'Return to main menu' });

  const sectionTitle = page > 0 ? `Categories (page ${page + 1})` : 'Categories';
  await sendListMessage(customerPhone, '📦 Select a category to browse:', 'View Categories', [
    { title: sectionTitle, rows }
  ]);
}

async function showProductMenu(customerPhone, session, page = 0) {
  const products = await db.getProductsByCategory(session.categoryId);

  const PAGE_SIZE = 8;
  const start = page * PAGE_SIZE;
  const hasNext = start + PAGE_SIZE < products.length;
  const slice = products.slice(start, start + PAGE_SIZE);

  const rows = slice.map(p => ({
    id: `prod_${p.id}`,
    title: p.name.substring(0, 24),
    description: p.unit_size || ''
  }));

  if (hasNext) {
    rows.push({ id: `prod_next_${page + 1}`, title: 'More products →', description: 'View more products' });
  }
  rows.push({ id: 'btn_back_cats', title: 'Back to Categories', description: 'Choose a different category' });

  const sectionTitle = page > 0 ? `Products (page ${page + 1})` : 'Products';
  await sendListMessage(customerPhone, '🔍 Select a product:', 'View Products', [
    { title: sectionTitle, rows }
  ]);
}

async function showQtyOptions(customerPhone, session) {
  const product = await db.getProductById(session.pendingProductId);
  if (!product) {
    await sendTextMessage(customerPhone, '❌ Product not found. Please try again.');
    return;
  }

  const bodyText = `*${product.name}*\n${product.unit_size ? `Unit: ${product.unit_size}\n` : ''}\nHow many would you like?`;

  await sendButtonMessage(customerPhone, bodyText, [
    { id: 'qty_1', title: '1 unit' },
    { id: 'qty_5', title: '5 units' },
    { id: 'qty_other', title: 'Type quantity' }
  ]);
}

async function showCartReview(customerPhone, session) {
  if (!session.items || session.items.length === 0) {
    await sendButtonMessage(customerPhone, '🛒 Your cart is empty.', [
      { id: 'btn_catalog', title: 'Browse Catalog' },
      { id: 'btn_help', title: 'Help' }
    ]);
    return;
  }

  let bodyText = '🛒 *Your Cart:*\n\n';
  session.items.forEach((item, i) => {
    bodyText += `${i + 1}. ${item.product.name} x${item.quantity}`;
    if (item.product.unit_size) bodyText += ` (${item.product.unit_size})`;
    bodyText += '\n';
  });
  bodyText += '\nReady to confirm?';

  await sendButtonMessage(customerPhone, bodyText, [
    { id: 'btn_confirm', title: 'Confirm Order' },
    { id: 'btn_add_more', title: 'Add More Items' },
    { id: 'btn_clear', title: 'Clear Cart' }
  ]);
}

async function addToCartAndReview(customerPhone, customer, quantity) {
  const session = customerSessions.get(customer.id);
  if (!session || !session.pendingProductId) {
    await sendTextMessage(customerPhone, '❌ Something went wrong. Please type /start to begin again.');
    return;
  }

  const product = await db.getProductById(session.pendingProductId);
  if (!product) {
    await sendTextMessage(customerPhone, '❌ Product no longer available.');
    return;
  }

  const existingIndex = session.items.findIndex(i => i.product_id === session.pendingProductId);
  if (existingIndex >= 0) {
    session.items[existingIndex].quantity += quantity;
  } else {
    session.items.push({ product_id: product.id, product, quantity });
  }

  session.step = 'product_select';
  session.pendingProductId = null;
  customerSessions.set(customer.id, session);

  const totalItems = session.items.reduce((sum, i) => sum + i.quantity, 0);
  const cartSummary = session.items.map(i => `• ${i.product.name} x${i.quantity}`).join('\n');

  await sendButtonMessage(customerPhone,
    `✅ *${product.name} x${quantity}* added!\n\n🛒 Cart (${totalItems} item${totalItems !== 1 ? 's' : ''}):\n${cartSummary}\n\nWhat next?`,
    [
      { id: 'btn_same_cat', title: 'Add from here' },
      { id: 'btn_add_more', title: 'Browse categories' },
      { id: 'btn_view_cart', title: 'View cart' }
    ]
  );
}

async function handleButtonConfirm(customerPhone, customer, session) {
  if (!session || session.items.length === 0) {
    return; // duplicate webhook tap — order already processed, stay silent
  }

  const order = await confirmOrder(customer.id, session.items, session.originatingGroupId);

  if (!order.success) {
    await sendTextMessage(customerPhone, `❌ Could not place order: ${order.message}`);
    await showCartReview(customerPhone, session);
    return;
  }

  customerSessions.delete(customer.id);

  // DM receipt to customer
  let receipt = `✅ *Order Confirmed!*\n\n📦 Order #${order.order.id}\n📅 ${new Date().toLocaleDateString()}\n\n*Items:*\n`;
  order.items.forEach((item, i) => {
    receipt += `${i + 1}. ${item.product_name} x${item.quantity}\n`;
  });
  receipt += `\nThank you! We'll be in touch shortly. 🙏`;
  await sendTextMessage(customerPhone, receipt);

  // Post order summary to the originating group (and overview group if configured) via Baileys
  if (session.originatingGroupId) {
    let groupMsg = `🛒 *New Order Received*\n\n`;
    groupMsg += `📦 Order #${order.order.id}\n`;
    groupMsg += `📅 ${new Date().toLocaleDateString()}\n\n`;
    groupMsg += `*Items:*\n`;
    order.items.forEach((item, i) => {
      groupMsg += `${i + 1}. ${item.product_name} x${item.quantity}\n`;
    });
    groupMsg += `\n✅ Order placed successfully.`;

    console.log(`📤 Posting order #${order.order.id} to group: ${session.originatingGroupId}`);
    const posted = await postToGroup(session.originatingGroupId, groupMsg);
    if (!posted) console.warn(`⚠️  Failed to post order #${order.order.id} to group ${session.originatingGroupId}`);

    const gp = await db.getGroupProfile(session.originatingGroupId);
    if (gp && gp.overview_group_id) {
      await postToGroup(gp.overview_group_id, groupMsg);
    }
  } else {
    console.warn(`⚠️  Order #${order.order.id} confirmed but no originatingGroupId in session for customer ${customerPhone} — register them with /adminregister`);
  }
}

// ─── Button & list reply routers ─────────────────────────────────────────────

async function handleButtonReply(customerPhone, buttonId, customer) {
  if (buttonId.startsWith('dis_')) {
    await handleDisambiguationChoice(customerPhone, customer, parseInt(buttonId.replace('dis_', '')));
    return;
  }

  const session = customerSessions.get(customer.id) || { type: 'new_order', items: [], timestamp: Date.now(), step: 'main_menu' };
  const hasOrders = await db.customerHasOrders(customer.id);

  switch (buttonId) {
    case 'btn_catalog':
      session.step = 'category_select';
      customerSessions.set(customer.id, session);
      await showCategoryMenu(customerPhone);
      break;

    case 'btn_repeat': {
      const result = await handleRepeatOrder(customer.id);
      if (!result || result.availableItems.length === 0) {
        await sendTextMessage(customerPhone, '❌ No previous order found.');
        await showMainMenu(customerPhone, false);
        return;
      }
      session.items = result.availableItems;
      session.step = 'cart_review';
      customerSessions.set(customer.id, session);
      if (result.unavailableItems.length > 0) {
        await sendTextMessage(customerPhone, `⚠️ ${result.unavailableItems.length} item(s) from your last order are no longer available and were skipped.`);
      }
      await showCartReview(customerPhone, session);
      break;
    }

    case 'btn_help':
      await handleHelpCommand(customerPhone, customerPhone, false);
      await showMainMenu(customerPhone, hasOrders);
      break;

    case 'btn_confirm':
      session.step = 'confirming';
      customerSessions.set(customer.id, session);
      await handleButtonConfirm(customerPhone, customer, session);
      break;

    case 'btn_same_cat':
      session.step = 'product_select';
      customerSessions.set(customer.id, session);
      await showProductMenu(customerPhone, session);
      break;

    case 'btn_view_cart':
      if (!customerSessions.get(customer.id)) break; // stale tap — ignore
      session.step = 'cart_review';
      customerSessions.set(customer.id, session);
      await showCartReview(customerPhone, session);
      break;

    case 'btn_add_more':
      session.step = 'category_select';
      customerSessions.set(customer.id, session);
      await showCategoryMenu(customerPhone);
      break;

    case 'btn_clear':
      customerSessions.delete(customer.id);
      await sendTextMessage(customerPhone, '🗑️ Cart cleared.');
      await showMainMenu(customerPhone, hasOrders);
      break;

    case 'btn_back_main':
      session.step = 'main_menu';
      customerSessions.set(customer.id, session);
      await showMainMenu(customerPhone, hasOrders);
      break;

    case 'btn_back_cats':
      session.step = 'category_select';
      customerSessions.set(customer.id, session);
      await showCategoryMenu(customerPhone);
      break;

    case 'qty_1':
      await addToCartAndReview(customerPhone, customer, 1);
      break;

    case 'qty_5':
      await addToCartAndReview(customerPhone, customer, 5);
      break;

    case 'qty_other':
      session.step = 'qty_input_text';
      customerSessions.set(customer.id, session);
      await sendTextMessage(customerPhone, '✏️ Please type the quantity (e.g. 3):');
      break;

    default:
      console.log(`⚠️ Unknown button ID: ${buttonId}`);
      await showMainMenu(customerPhone, hasOrders);
  }
}

async function handleListReply(customerPhone, rowId, customer) {
  const session = customerSessions.get(customer.id) || { type: 'new_order', items: [], timestamp: Date.now() };
  const hasOrders = await db.customerHasOrders(customer.id);

  if (rowId.startsWith('cat_next_')) {
    const page = parseInt(rowId.replace('cat_next_', ''));
    await showCategoryMenu(customerPhone, page);

  } else if (rowId.startsWith('prod_next_')) {
    const page = parseInt(rowId.replace('prod_next_', ''));
    await showProductMenu(customerPhone, session, page);

  } else if (rowId.startsWith('cat_')) {
    const categoryId = parseInt(rowId.replace('cat_', ''));
    session.categoryId = categoryId;
    session.step = 'product_select';
    customerSessions.set(customer.id, session);
    await showProductMenu(customerPhone, session);

  } else if (rowId.startsWith('prod_')) {
    const productId = parseInt(rowId.replace('prod_', ''));
    const product = await db.getProductById(productId);
    session.pendingProductId = productId;
    session.step = 'qty_input_text';
    customerSessions.set(customer.id, session);
    const productLabel = product ? `*${product.name}*${product.unit_size ? ` (${product.unit_size})` : ''}` : 'this product';
    await sendTextMessage(customerPhone, `${productLabel}\n\nHow many would you like? Type a number:`);

  } else if (rowId.startsWith('grp_')) {
    const groupId = rowId.replace('grp_', '');
    session.originatingGroupId = groupId;
    session.step = 'main_menu';
    customerSessions.set(customer.id, session);
    await showMainMenu(customerPhone, hasOrders);

  } else if (rowId === 'btn_back_main') {
    session.step = 'main_menu';
    customerSessions.set(customer.id, session);
    await showMainMenu(customerPhone, hasOrders);

  } else if (rowId === 'btn_back_cats') {
    session.step = 'category_select';
    customerSessions.set(customer.id, session);
    await showCategoryMenu(customerPhone);

  } else if (rowId.startsWith('dis_')) {
    await handleDisambiguationChoice(customerPhone, customer, parseInt(rowId.replace('dis_', '')));

  } else {
    console.log(`⚠️ Unknown list row ID: ${rowId}`);
    await showMainMenu(customerPhone, hasOrders);
  }
}

// ─── Admin: link customer phone to profile JSON ───────────────────────────────

async function handleAdminRegisterCommand(adminPhone, customerPhone, groupId) {
  if (!customerPhone || !groupId) {
    await sendTextMessage(adminPhone, '❌ Usage: /adminregister [customer_phone] [group_id]\nExample: /adminregister 60123456789 120363xxxx@g.us');
    return;
  }
  let customer = await db.getCustomerByPhone(customerPhone);
  if (!customer) {
    customer = await db.createCustomer(customerPhone);
    console.log(`✅ Created new customer for ${customerPhone}`);
  }
  await db.saveCustomerGroup(customer.id, groupId, null);
  await sendTextMessage(adminPhone,
    `✅ Registered!\n\n📱 Customer: ${customerPhone}\n👥 Group: ${groupId}\n\nOrders from this customer will now post to that group.`);
}

async function handleAdminLinkCommand(adminPhone, groupId, code) {
  if (!groupId || !code) {
    await sendTextMessage(adminPhone, '❌ Usage: /adminlink [group_id] [code]\nExample: /adminlink 120363xxxx@g.us 002');
    return;
  }
  const padded = code.padStart(3, '0');
  const profile = loadProfile(padded);
  if (!profile) {
    await sendTextMessage(adminPhone, `❌ No profile found for code ${padded} (looked for 3000_${padded}.json)`);
    return;
  }
  await db.upsertGroupProfile(groupId, padded, null);
  await sendTextMessage(adminPhone,
    `✅ Group linked!\n\n📋 Profile: ${profile.customer_name} (${code})\n🆔 Group: ${groupId}\n\nOrders from this group will now use purchase history for smart matching.\n\nTo add a boss overview group:\n/setoverview ${groupId} [boss_group_id]`);
}

async function handleSetOverviewCommand(adminPhone, groupId, overviewGroupId) {
  if (!groupId || !overviewGroupId) {
    await sendTextMessage(adminPhone, '❌ Usage: /setoverview [restaurant_group_id] [boss_group_id]\nExample: /setoverview 120363xxxx@g.us 120363yyyy@g.us');
    return;
  }
  await db.upsertGroupProfile(groupId, null, overviewGroupId);
  await sendTextMessage(adminPhone,
    `✅ Overview group set!\n\nOrders from ${groupId} will also be posted to ${overviewGroupId}.`);
}

// ─── Disambiguation helpers ───────────────────────────────────────────────────

async function askDisambiguation(customerPhone, chatId, pending, isGroup) {
  const { rawSegment, candidates } = pending;

  if (isGroup) {
    let msg = `❓ Which "${rawSegment}" did you mean?\n\n`;
    candidates.forEach((p, i) => {
      msg += `${i + 1}. ${p.name}${p.unit_size ? ` (${p.unit_size})` : ''}\n`;
    });
    msg += `\nReply with a number (1-${candidates.length})`;
    await sendGroupMessage(chatId, msg);
  } else {
    const bodyText = `❓ Which "${rawSegment}" did you mean?`;
    if (candidates.length <= 3) {
      await sendButtonMessage(customerPhone, bodyText,
        candidates.map((p, i) => ({ id: `dis_${i}`, title: p.name.substring(0, 20) }))
      );
    } else {
      const rows = candidates.slice(0, 10).map((p, i) => ({
        id: `dis_${i}`,
        title: p.name.substring(0, 24),
        description: p.unit_size || ''
      }));
      await sendListMessage(customerPhone, bodyText, 'Choose product', [{ title: 'Matching products', rows }]);
    }
  }
}

// Called when user replies with a number in group chat during disambiguation
async function handleDisambiguationReply(customerPhone, chatId, customer, text, isGroup) {
  const session = customerSessions.get(customer.id);
  if (!session || !session.pendingDisambiguations || session.pendingDisambiguations.length === 0) return;

  const pending = session.pendingDisambiguations[0];
  const num = parseInt(text.trim());

  if (isNaN(num) || num < 1 || num > pending.candidates.length) {
    const msg = `❌ Please reply with a number between 1 and ${pending.candidates.length}`;
    if (isGroup) await sendGroupMessage(chatId, msg);
    else await sendTextMessage(customerPhone, msg);
    return;
  }

  const chosen = pending.candidates[num - 1];
  session.items.push({ product_id: chosen.id, product: chosen, quantity: pending.quantity });
  session.pendingDisambiguations.shift();

  if (session.pendingDisambiguations.length > 0) {
    customerSessions.set(customer.id, session);
    await askDisambiguation(customerPhone, chatId, session.pendingDisambiguations[0], isGroup);
    return;
  }

  customerSessions.set(customer.id, session);
  await proceedAfterDisambiguation(customerPhone, chatId, customer, session, isGroup);
}

// Called when DM user taps a button/list option during disambiguation
async function handleDisambiguationChoice(customerPhone, customer, index) {
  const session = customerSessions.get(customer.id);
  if (!session || !session.pendingDisambiguations || session.pendingDisambiguations.length === 0) {
    const hasOrders = await db.customerHasOrders(customer.id);
    await showMainMenu(customerPhone, hasOrders);
    return;
  }

  const pending = session.pendingDisambiguations[0];
  if (isNaN(index) || index >= pending.candidates.length) {
    await askDisambiguation(customerPhone, customerPhone, pending, false);
    return;
  }

  const chosen = pending.candidates[index];
  session.items.push({ product_id: chosen.id, product: chosen, quantity: pending.quantity });
  session.pendingDisambiguations.shift();

  if (session.pendingDisambiguations.length > 0) {
    customerSessions.set(customer.id, session);
    await askDisambiguation(customerPhone, customerPhone, session.pendingDisambiguations[0], false);
    return;
  }

  customerSessions.set(customer.id, session);
  await proceedAfterDisambiguation(customerPhone, customerPhone, customer, session, false);
}

async function proceedAfterDisambiguation(customerPhone, chatId, customer, session, isGroup) {
  if (session.items.length === 0) {
    const msg = '❌ No items could be matched.';
    if (isGroup) await sendGroupMessage(chatId, msg);
    else await sendTextMessage(customerPhone, msg);
    customerSessions.delete(customer.id);
    return;
  }

  if (isGroup) {
    let msg = '🛒 *Your order:*\n\n';
    session.items.forEach(m => {
      msg += `✅ ${m.product.name}${m.product.unit_size ? ` (${m.product.unit_size})` : ''} x${m.quantity}\n`;
    });
    if (session.notFound && session.notFound.length > 0) {
      session.notFound.forEach(r => { msg += `❓ "${r}" — not found, skipped\n`; });
    }
    msg += '\nReply *YES* to confirm or *CANCEL* to ignore.';
    session.step = 'text_order_confirm';
    if (!session.originatingGroupId) session.originatingGroupId = chatId;
    customerSessions.set(customer.id, session);
    await sendGroupMessage(chatId, msg);
  } else {
    if (!session.originatingGroupId) {
      session.originatingGroupId = await db.getPrimaryGroupId(customer.id);
    }
    session.step = 'cart_review';
    customerSessions.set(customer.id, session);
    await showCartReview(customerPhone, session);
  }
}

// ─── Free-text order parsing ─────────────────────────────────────────────────

function parseOrderLines(text) {
  const NOISE = /\b(i want|please|can i have|give me|order|just)\b/gi;
  const UNITS = /\b(pcs|pieces|unit|units|pack|packs|box|boxes)\b/gi;

  // Split on newlines, commas, and " and " (natural sentence delimiter)
  const segments = text.split(/[\n,]|\s+and\s+/i).map(s => s.trim()).filter(s => s.length > 0);
  const results = [];

  for (const segment of segments) {
    let cleaned = segment.replace(NOISE, ' ')
      .replace(/\bx\s*(\d+)\b/gi, ' $1 ')  // "x3" or "x 3" → " 3 "
      .replace(/(\d+)\s*x\b/gi, ' $1 ')     // "3x" → " 3 "
      .trim();

    const numMatch = cleaned.match(/\b(\d+)\b/);
    const quantity = numMatch ? parseInt(numMatch[1]) : 1;
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
  // Fallback: try each word individually (handles abbreviations like "veg oil")
  const words = searchTerm.split(' ').filter(w => w.length >= 3);
  for (const word of words) {
    results = await db.searchProducts(word);
    if (results.length > 0) return results;
  }
  return [];
}

async function handleFreeTextOrder(customerPhone, chatId, customer, text, isGroup) {
  if (!/\d/.test(text)) return false;
  if (text.replace(/\d/g, '').trim().length < 3) return false;

  const lines = parseOrderLines(text);
  if (lines.length === 0) return false;

  const session = customerSessions.get(customer.id) || { type: 'new_order', items: [], timestamp: Date.now() };

  const groupId = isGroup ? chatId : (session.originatingGroupId || await db.getPrimaryGroupId(customer.id));
  const groupProfile = groupId ? await db.getGroupProfile(groupId) : null;
  const profile = (groupProfile && groupProfile.customer_code) ? loadProfile(groupProfile.customer_code) : null;

  const resolved = [];   // { product_id, product, quantity }
  const ambiguous = [];  // { rawSegment, quantity, candidates[] }
  const notFound = [];

  for (const line of lines) {
    const results = await searchProductsFuzzy(line.searchTerm);
    if (results.length === 0) {
      notFound.push(line.rawSegment);
    } else if (results.length === 1) {
      resolved.push({ product_id: results[0].id, product: results[0], quantity: line.quantity });
    } else {
      const best = pickBestMatch(results, profile);
      if (best) {
        resolved.push({ product_id: best.id, product: best, quantity: line.quantity });
      } else {
        ambiguous.push({ rawSegment: line.rawSegment, quantity: line.quantity, candidates: results.slice(0, 10) });
      }
    }
  }

  if (resolved.length === 0 && ambiguous.length === 0) return false;

  // If any items need clarification, start disambiguation flow
  if (ambiguous.length > 0) {
    session.step = 'disambiguation';
    session.items = resolved;
    session.pendingDisambiguations = ambiguous;
    session.notFound = notFound;
    if (!session.originatingGroupId) session.originatingGroupId = isGroup ? chatId : null;
    customerSessions.set(customer.id, session);

    if (resolved.length > 0) {
      let matchedMsg = '✅ *Matched so far:*\n';
      resolved.forEach(m => { matchedMsg += `• ${m.product.name} x${m.quantity}\n`; });
      if (isGroup) await sendGroupMessage(chatId, matchedMsg);
      else await sendTextMessage(customerPhone, matchedMsg);
    }

    await askDisambiguation(customerPhone, chatId, ambiguous[0], isGroup);
    return true;
  }

  // All resolved — proceed to order flow
  let msg = `🛒 *Here's what I got:*\n\n`;
  resolved.forEach(m => {
    msg += `✅ ${m.product.name}${m.product.unit_size ? ` (${m.product.unit_size})` : ''} x${m.quantity}\n`;
  });
  notFound.forEach(r => { msg += `❓ "${r}" — not found, skipped\n`; });

  if (isGroup) {
    msg += `\nReply *YES* to confirm or *CANCEL* to ignore.`;
    await sendGroupMessage(chatId, msg);
    session.step = 'text_order_confirm';
    session.items = resolved;
    if (!session.originatingGroupId) session.originatingGroupId = chatId;
    customerSessions.set(customer.id, session);
  } else {
    session.items = resolved;
    if (!session.originatingGroupId) {
      session.originatingGroupId = await db.getPrimaryGroupId(customer.id);
    }
    session.step = 'cart_review';
    customerSessions.set(customer.id, session);
    await showCartReview(customerPhone, session);
  }

  return true;
}

// Clean up expired sessions every hour
setInterval(() => {
  const now = Date.now();
  const EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [customerId, session] of customerSessions.entries()) {
    if (session.timestamp && (now - session.timestamp > EXPIRY)) {
      customerSessions.delete(customerId);
      console.log(`🗑️ Cleaned up expired session for customer ${customerId}`);
    }
  }
}, 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Webhook URL: ${process.env.WEBHOOK_URL}/webhook`);
});

// Start Baileys WhatsApp (group notifications)
connectBaileys().catch(err => console.error('❌ Baileys startup error:', err.message));

process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, closing server...');
  db.close();
  process.exit(0);
});
