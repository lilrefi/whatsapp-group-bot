-- Add delivery_group_id snapshot to orders
-- (already applied to NeonDB via prisma db push on 2026-07-25)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_group_id INTEGER
  REFERENCES delivery_groups(id) ON DELETE SET NULL;
