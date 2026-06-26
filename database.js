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
     AND (LOWER(name) LIKE $1 OR chinese_name LIKE $1)
     ORDER BY name
     LIMIT 20`,
    [`%${searchTerm.toLowerCase()}%`]
  );
  return result.rows;
}

/**
 * Save or update the group a customer belongs to
 */
async function saveCustomerGroup(customerId, groupId, groupName = null) {
  await pool.query(
    `INSERT INTO customer_groups (customer_id, group_id, group_name, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (customer_id, group_id)
     DO UPDATE SET is_active = true, group_name = COALESCE(EXCLUDED.group_name, customer_groups.group_name)`,
    [customerId, groupId, groupName]
  );
}

/**
 * Get all active groups a customer is registered in
 */
async function getCustomerGroups(customerId) {
  const result = await pool.query(
    `SELECT * FROM customer_groups
     WHERE customer_id = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [customerId]
  );
  return result.rows;
}

/**
 * Get the most recently registered group_id for a customer
 */
async function getPrimaryGroupId(customerId) {
  const result = await pool.query(
    `SELECT group_id FROM customer_groups
     WHERE customer_id = $1 AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [customerId]
  );
  return result.rows[0]?.group_id || null;
}

/**
 * Create new order
 */
async function createOrder(customerId, items, groupId = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (customer_id, status, group_id, created_at, updated_at)
       VALUES ($1, 'completed', $2, NOW(), NOW())
       RETURNING *`,
      [customerId, groupId]
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
 * Upsert group profile (customer code + optional overview group)
 */
async function upsertGroupProfile(groupId, customerCode, overviewGroupId = null) {
  await pool.query(
    `INSERT INTO group_profiles (group_id, customer_code, overview_group_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (group_id)
     DO UPDATE SET
       customer_code = COALESCE(EXCLUDED.customer_code, group_profiles.customer_code),
       overview_group_id = COALESCE(EXCLUDED.overview_group_id, group_profiles.overview_group_id),
       updated_at = NOW()`,
    [groupId, customerCode, overviewGroupId]
  );
}

/**
 * Get group profile (customer code + overview group)
 */
async function getGroupProfile(groupId) {
  const result = await pool.query(
    'SELECT * FROM group_profiles WHERE group_id = $1',
    [groupId]
  );
  return result.rows[0] || null;
}

/**
 * Get all active customer-group registrations (for admin UI)
 */
async function getRegistrations() {
  const result = await pool.query(`
    SELECT c.id AS customer_id, c.phone, cg.group_id, cg.group_name, cg.created_at
    FROM customer_groups cg
    JOIN customers c ON c.id = cg.customer_id
    WHERE cg.is_active = true
    ORDER BY cg.created_at DESC
  `);
  return result.rows;
}

/**
 * Deregister a customer from a group
 */
async function deregisterCustomer(customerId, groupId) {
  await pool.query(
    `UPDATE customer_groups SET is_active = false WHERE customer_id = $1 AND group_id = $2`,
    [customerId, groupId]
  );
}

/**
 * Get all group profiles
 */
async function getAllGroupProfiles() {
  const result = await pool.query('SELECT * FROM group_profiles ORDER BY created_at DESC');
  return result.rows;
}

/**
 * Delete a group profile
 */
async function deleteGroupProfile(groupId) {
  await pool.query('DELETE FROM group_profiles WHERE group_id = $1', [groupId]);
}

/**
 * Get recent orders with items (for admin UI)
 */
async function getRecentOrders(limit = 50) {
  const result = await pool.query(`
    SELECT o.id, o.created_at, o.group_id, c.phone,
           json_agg(json_build_object('name', oi.product_name, 'qty', oi.quantity) ORDER BY oi.id) AS items
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id, c.phone
    ORDER BY o.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Create a group order with optional flagged items
 */
async function createGroupOrder(customerId, groupId, items, status = 'confirmed', attachments = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `INSERT INTO orders (customer_id, status, group_id, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
      [customerId, status, groupId]
    );
    const order = orderResult.rows[0];
    for (const item of items) {
      let productId = item.product_id || null;

      // If product_id wasn't round-tripped from the dashboard, look it up by name.
      if (!productId && item.product && item.product.name) {
        const pr = await client.query(
          `SELECT id FROM products
           WHERE (TRIM(name) ILIKE TRIM($1)
               OR TRIM(chinese_name) ILIKE TRIM($1)
               OR TRIM(name_zh) ILIKE TRIM($1))
             AND is_active = true
           LIMIT 1`,
          [item.product.name]
        );
        if (pr.rows.length > 0) productId = pr.rows[0].id;
      }

      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, product_name, unit_size, flagged, confidence_note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [order.id, productId, item.quantity, item.product.name,
         item.product.unit_size || null, item.flagged || false, item.confidence_note || null]
      );
    }
    for (const att of attachments) {
      await client.query(
        `INSERT INTO order_attachments (order_id, type, url, text, transcript, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))`,
        [order.id, att.type, att.url || null, att.text || null, att.transcript || null, att.timestamp || null]
      );
    }
    await client.query('COMMIT');
    const itemsResult = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]
    );
    return { order, items: itemsResult.rows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get recent orders with full item detail for staff view
 */
async function getStaffOrders(limit = 100) {
  const result = await pool.query(`
    SELECT o.id, o.created_at, o.group_id, o.status, c.phone,
           json_agg(json_build_object(
             'item_id', oi.id,
             'product_id', oi.product_id,
             'name', oi.product_name,
             'sku', p.sku,
             'qty', oi.quantity,
             'unit_size', oi.unit_size,
             'flagged', oi.flagged,
             'confidence_note', oi.confidence_note
           ) ORDER BY oi.id) AS items
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    GROUP BY o.id, c.phone
    ORDER BY o.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

async function addItemToOrder(orderId, productId, productName, unitSize, quantity) {
  const result = await pool.query(
    `INSERT INTO order_items (order_id, product_id, quantity, product_name, unit_size, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
    [orderId, productId, quantity, productName, unitSize || null]
  );
  return result.rows[0];
}

/**
 * Update quantity of a single order item
 */
async function updateOrderItemQty(itemId, quantity) {
  await pool.query('UPDATE order_items SET quantity = $1 WHERE id = $2', [quantity, itemId]);
}

/**
 * Remove a single order item
 */
async function removeOrderItem(itemId) {
  await pool.query('DELETE FROM order_items WHERE id = $1', [itemId]);
}

/**
 * Cancel a placed order
 */
async function cancelOrderById(orderId) {
  await pool.query(
    `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [orderId]
  );
}

/**
 * Set Chinese name/keywords for a product
 */
async function updateProductZh(productId, nameZh) {
  await pool.query(
    'UPDATE products SET chinese_name = $1 WHERE id = $2',
    [nameZh || null, productId]
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
  saveCustomerGroup,
  getCustomerGroups,
  getPrimaryGroupId,
  upsertGroupProfile,
  getGroupProfile,
  getRegistrations,
  deregisterCustomer,
  getAllGroupProfiles,
  deleteGroupProfile,
  getRecentOrders,
  createGroupOrder,
  getStaffOrders,
  updateOrderItemQty,
  removeOrderItem,
  cancelOrderById,
  addItemToOrder,
  updateProductZh,
  getCustomerByCode,
  getCustomerByGroupId,
  upsertOrderHistory,
  getCustomerOrderHistory,
  close
};

/**
 * Find a customer by their customer_code field (PSOFT code like "3000/002")
 */
async function getCustomerByCode(customerCode) {
  const result = await pool.query(
    'SELECT * FROM customers WHERE customer_code = $1 LIMIT 1',
    [customerCode]
  );
  return result.rows[0] || null;
}

/**
 * Upsert a row in mgmt_customer_order_history.
 * If (customer_id, item_code) already exists → increment times_ordered + total_qty.
 * Otherwise insert a new row.
 */
async function upsertOrderHistory(customerId, sku, description, unit, qty) {
  await pool.query(`
    INSERT INTO mgmt_customer_order_history
      (customer_id, item_code, description, unit, times_ordered, total_qty)
    VALUES ($1, $2, $3, $4, 1, $5)
    ON CONFLICT (customer_id, item_code) DO UPDATE
      SET times_ordered = mgmt_customer_order_history.times_ordered + 1,
          total_qty     = mgmt_customer_order_history.total_qty + $5
  `, [customerId, sku, description || null, unit || null, qty]);
}

/**
 * Look up the customer that owns a WhatsApp group via customer_groups.
 * This is the canonical attribution path for group orders.
 */
async function getCustomerByGroupId(groupId) {
  const result = await pool.query(
    `SELECT c.* FROM customers c
     JOIN customer_groups cg ON cg.customer_id = c.id
     WHERE cg.group_id = $1 AND cg.is_active = true
     LIMIT 1`,
    [groupId]
  );
  return result.rows[0] || null;
}

/**
 * Get order history for a customer by their customer_code (e.g. "3000/006").
 * Returns rows shaped as { item_code, times_ordered } ordered by most-ordered first.
 */
async function getCustomerOrderHistory(customerCode) {
  const result = await pool.query(`
    SELECT h.item_code, h.times_ordered
    FROM mgmt_customer_order_history h
    JOIN customers c ON c.id = h.customer_id
    WHERE c.customer_code = $1
    ORDER BY h.times_ordered DESC
  `, [customerCode]);
  return result.rows;
}
