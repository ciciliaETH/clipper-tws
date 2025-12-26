-- Add snapshot columns to campaign_instagram_participants to store IG summary per campaign
-- Date: 2025-11-24

BEGIN;

ALTER TABLE public.campaign_instagram_participants
  ADD COLUMN IF NOT EXISTS followers BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_json JSONB,
  ADD COLUMN IF NOT EXISTS last_refreshed TIMESTAMPTZ;

COMMIT;
