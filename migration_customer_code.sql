-- Migration: Add group_profiles table for customer profile and overview group linking
-- Run once: npm run migrate-code

CREATE TABLE IF NOT EXISTS group_profiles (
  group_id VARCHAR(50) PRIMARY KEY,
  customer_code VARCHAR(20),
  overview_group_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
