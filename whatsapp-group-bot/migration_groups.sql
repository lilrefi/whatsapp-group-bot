-- Migration: Add customer_groups table and group_id to orders
-- Run once: npm run migrate

CREATE TABLE IF NOT EXISTS customer_groups (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  group_id VARCHAR(50) NOT NULL,
  group_name VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_groups_customer ON customer_groups(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_groups_group ON customer_groups(group_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_id VARCHAR(50);
