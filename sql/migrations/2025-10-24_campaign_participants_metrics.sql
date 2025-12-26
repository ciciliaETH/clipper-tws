-- Add aggregate metric columns and JSON snapshot to campaign_participants
-- Date: 2025-10-24

BEGIN;

ALTER TABLE public.campaign_participants
  ADD COLUMN IF NOT EXISTS followers bigint,
  ADD COLUMN IF NOT EXISTS views bigint,
  ADD COLUMN IF NOT EXISTS likes bigint,
  ADD COLUMN IF NOT EXISTS comments bigint,
  ADD COLUMN IF NOT EXISTS shares bigint,
  ADD COLUMN IF NOT EXISTS saves bigint,
  ADD COLUMN IF NOT EXISTS posts_total integer,
  ADD COLUMN IF NOT EXISTS sec_uid text,
  ADD COLUMN IF NOT EXISTS metrics_json jsonb,
  ADD COLUMN IF NOT EXISTS last_refreshed timestamptz;

-- Helpful index when summing totals for a campaign
CREATE INDEX IF NOT EXISTS idx_campaign_participants_campaign_totals
  ON public.campaign_participants(campaign_id, tiktok_username);

COMMIT;
