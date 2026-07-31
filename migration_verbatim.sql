-- Migration: Add verbatim tracking to order items
-- Run once: npm run migrate-verbatim

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS verbatim TEXT;
