-- Ensure save_count column exists on tiktok_posts_daily
-- Date: 2025-10-24

BEGIN;

ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;

COMMIT;
