require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const db = require('./database');
const { sendTextMessage, sendGroupMessage } = require('./whatsapp');
const { handleProductSearch, getProductCategories, formatProductList } = require('./products');
const { handleRepeatOrder, confirmOrder, createNewOrder } = require('./orders');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

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
      
      if (value.messages && value.messages[0]) {
        const message = value.messages[0];
        const from = message.from; // Sender's phone number
        const messageType = message.type;
        
        // Check if message is from group or private chat
        const isGroup = value.messages[0].from.includes('@g.us') || 
                       (value.messages[0].context && value.messages[0].context.from.includes('@g.us'));
        
        const chatId = isGroup ? message.from : from;
        
        console.log(`📩 Received ${messageType} from ${from} in ${isGroup ? 'GROUP' : 'PRIVATE'} chat`);
        
        if (messageType === 'text') {
          const text = message.text.body;
          await handleMessage(from, chatId, text, isGroup);
        }
      }
      
      res.sendStatus(200);
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
    else {
      // Default: treat as product search
      await handleSearchCommand(customerPhone, chatId, text, isGroup);
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
  
  let message = `👋 Hello! Welcome to our ordering system.\n\n`;
  
  if (hasOrders) {
    message += `I see you've ordered before!\n\n`;
  }
  
  message += `📋 *Available Commands:*\n`;
  message += `/catalog - Browse all products\n`;
  message += `/search [keyword] - Search products\n`;
  if (hasOrders) {
    message += `/repeat - Repeat your last order\n`;
  }
  message += `/cart - View your cart\n`;
  message += `/help - Show all commands\n\n`;
  message += `Or just type a product name to search!`;
  
  if (isGroup) {
    await sendGroupMessage(chatId, message);
  } else {
    await sendTextMessage(customerPhone, message);
  }
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

process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, closing server...');
  db.close();
  process.exit(0);
});
