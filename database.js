const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Get customer by phone number
 */
async function getCustomerByPhone(phone) {
  const result = await pool.query(
    'SELECT * FROM customers WHERE phone = $1',
    [phone]
  );
  return result.rows[0] || null;
}

/**
 * Create new customer
 */
async function createCustomer(phone) {
  const result = await pool.query(
    'INSERT INTO customers (phone, created_at, updated_at) VALUES ($1, NOW(), NOW()) RETURNING *',
    [phone]
  );
  return result.rows[0];
}

/**
 * Update customer last activity
 */
async function updateCustomerActivity(customerId) {
  await pool.query(
    'UPDATE customers SET updated_at = NOW() WHERE id = $1',
    [customerId]
  );
}

/**
 * Check if customer has any orders
 */
async function customerHasOrders(customerId) {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM orders WHERE customer_id = $1',
    [customerId]
  );
  return parseInt(result.rows[0].count) > 0;
}

/**
 * Get customer's last order
 */
async function getLastOrder(customerId) {
  const result = await pool.query(
    `SELECT * FROM orders 
     WHERE customer_id = $1 AND status = 'completed'
     ORDER BY created_at DESC 
     LIMIT 1`,
    [customerId]
  );
  return result.rows[0] || null;
}

/**
 * Get order items
 */
async function getOrderItems(orderId) {
  const result = await pool.query(
    `SELECT oi.*, p.name as product_name, p.unit_size
     FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = $1`,
    [orderId]
  );
  return result.rows;
}

/**
 * Get all product categories with count
 */
async function getProductCategories() {
  const result = await pool.query(
    `SELECT c.*, COUNT(p.id) as product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.is_active = true
     GROUP BY c.id
     HAVING COUNT(p.id) > 0
     ORDER BY c.name`
  );
  return result.rows;
}

/**
 * Get category by ID
 */
async function getCategoryById(id) {
  const result = await pool.query(
    'SELECT * FROM categories WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Get products by category
 */
async function getProductsByCategory(categoryId) {
  const result = await pool.query(
    `SELECT * FROM products 
     WHERE category_id = $1 AND is_active = true
     ORDER BY name`,
    [categoryId]
  );
  return result.rows;
}

/**
 * Get product by ID
 */
async function getProductById(id) {
  const result = await pool.query(
    'SELECT * FROM products WHERE id = $1 AND is_active = true',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Search products by name (partial match)
 */
async function searchProducts(searchTerm) {
  const result = await pool.query(
    `SELECT * FROM products 
     WHERE is_active = true 
     AND LOWER(name) LIKE $1
     ORDER BY name
     LIMIT 20`,
    [`%${searchTerm.toLowerCase()}%`]
  );
  return result.rows;
}

/**
 * Create new order
 */
async function createOrder(customerId, items) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (customer_id, status, created_at, updated_at) 
       VALUES ($1, 'completed', NOW(), NOW()) 
       RETURNING *`,
      [customerId]
    );
    const order = orderResult.rows[0];
    
    // Insert order items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, product_name, unit_size, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          order.id, 
          item.product_id, 
          item.quantity, 
          item.product.name, 
          item.product.unit_size
        ]
      );
    }
    
    await client.query('COMMIT');
    return order;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, status) {
  await pool.query(
    'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, orderId]
  );
}

/**
 * Close database connection
 */
async function close() {
  await pool.end();
}

module.exports = {
  getCustomerByPhone,
  createCustomer,
  updateCustomerActivity,
  customerHasOrders,
  getLastOrder,
  getOrderItems,
  getProductCategories,
  getCategoryById,
  getProductsByCategory,
  getProductById,
  searchProducts,
  createOrder,
  updateOrderStatus,
  close
};
