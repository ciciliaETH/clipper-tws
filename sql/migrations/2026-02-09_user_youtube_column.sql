BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT;

COMMIT;
