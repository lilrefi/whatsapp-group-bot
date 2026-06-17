-- Migration: Add order_attachments table for photo/voice-note/text attachments
-- Run once: npm run migrate-attachments

CREATE TABLE IF NOT EXISTS order_attachments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  url TEXT,
  text TEXT,
  transcript TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_order ON order_attachments(order_id);
