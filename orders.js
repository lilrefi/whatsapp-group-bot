const db = require('./database');

/**
 * Handle repeat order request (US-2)
 */
async function handleRepeatOrder(customerId) {
  const lastOrder = await db.getLastOrder(customerId);
  
  if (!lastOrder) {
    return null;
  }
  
  const orderItems = await db.getOrderItems(lastOrder.id);
  
  // Check availability of each item
  const availableItems = [];
  const unavailableItems = [];
  
  for (const item of orderItems) {
    const product = await db.getProductById(item.product_id);
    
    if (product && product.is_active) {
      availableItems.push({
        product_id: item.product_id,
        product: product,
        quantity: item.quantity
      });
    } else {
      unavailableItems.push({
        product_name: item.product_name,
        quantity: item.quantity
      });
    }
  }
  
  return {
    availableItems,
    unavailableItems,
    originalOrder: lastOrder
  };
}

/**
 * Confirm and create order (US-3.1, US-3.2)
 */
async function confirmOrder(customerId, items) {
  try {
    if (!items || items.length === 0) {
      return {
        success: false,
        message: 'No items in order'
      };
    }
    
    // Verify all products still exist and active
    for (const item of items) {
      const product = await db.getProductById(item.product_id);
      if (!product || !product.is_active) {
        return {
          success: false,
          message: `Product ${item.product.name} is no longer available`
        };
      }
    }
    
    // Create order
    const order = await db.createOrder(customerId, items);
    
    // Get full order items
    const orderItems = await db.getOrderItems(order.id);
    
    return {
      success: true,
      order: order,
      items: orderItems
    };
  } catch (error) {
    console.error('❌ Error confirming order:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Create new order directly
 */
async function createNewOrder(customerId, items) {
  return await db.createOrder(customerId, items);
}

/**
 * Get order summary for display
 */
function formatOrderSummary(order, items) {
  let message = `📦 *Order #${order.id}*\n`;
  message += `📅 ${new Date(order.created_at).toLocaleDateString()}\n\n`;
  message += `*Items:*\n`;
  
  items.forEach((item, i) => {
    message += `${i + 1}. ${item.product_name} x${item.quantity} (${item.unit_size})\n`;
  });
  
  return message;
}

module.exports = {
  handleRepeatOrder,
  confirmOrder,
  createNewOrder,
  formatOrderSummary
};
