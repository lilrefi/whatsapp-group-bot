const db = require('./database');

/**
 * Handle product search (US-1.3)
 */
async function handleProductSearch(searchTerm) {
  const cleanTerm = searchTerm.trim().toLowerCase();
  const results = await db.searchProducts(cleanTerm);
  return results;
}

/**
 * Get all product categories (US-1.1)
 */
async function getProductCategories() {
  return await db.getProductCategories();
}

/**
 * Get products in a category
 */
async function getProductsByCategory(categoryId) {
  return await db.getProductsByCategory(categoryId);
}

/**
 * Get product details
 */
async function getProductDetails(productId) {
  return await db.getProductById(productId);
}

/**
 * Format product list for display
 */
function formatProductList(products) {
  if (products.length === 0) return 'No products found.';
  
  let message = '';
  products.forEach((p, i) => {
    message += `${p.id}. *${p.name}*\n`;
    message += `   ${p.unit_size}`;
    if (p.description) {
      message += ` - ${p.description.substring(0, 50)}`;
    }
    message += `\n`;
    if (i < products.length - 1) message += `\n`;
  });
  
  return message;
}

/**
 * Format single product details (US-1.2)
 */
function formatProductDetails(product) {
  let message = `*${product.name}*\n\n`;
  message += `📦 Unit: ${product.unit_size}\n`;
  
  if (product.description) {
    message += `📝 ${product.description}\n`;
  }
  
  message += `\n💡 To order: /add ${product.id} [quantity]`;
  
  return message;
}

module.exports = {
  handleProductSearch,
  getProductCategories,
  getProductsByCategory,
  getProductDetails,
  formatProductList,
  formatProductDetails
};
