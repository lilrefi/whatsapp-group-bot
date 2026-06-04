-- Migration: Add confidence tracking to order items
-- Run once: npm run migrate-status

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS flagged BOOLEAN DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS confidence_note VARCHAR(200);
