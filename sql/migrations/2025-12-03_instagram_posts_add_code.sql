-- Add code column to instagram_posts_daily for Instagram shortcode (used in reel URLs)
-- Date: 2025-12-03

BEGIN;

-- Add code column (nullable, will be populated gradually)
ALTER TABLE public.instagram_posts_daily 
ADD COLUMN IF NOT EXISTS code TEXT;

-- Create index for faster lookups by code
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_code 
ON public.instagram_posts_daily(code) WHERE code IS NOT NULL;

-- Backfill code from id where they match (shortcode format)
-- Skip if id looks like numeric (those are media IDs, not shortcodes)
UPDATE public.instagram_posts_daily 
SET code = id 
WHERE code IS NULL 
  AND id ~ '^[A-Za-z0-9_-]{11}$'; -- Shortcode format (11 chars alphanumeric)

COMMIT;
