-- Add required_hashtags column to campaigns table for hashtag-based filtering
-- Date: 2025-12-03

BEGIN;

-- Add required_hashtags column (text array or JSONB for multiple hashtags)
ALTER TABLE public.campaigns 
ADD COLUMN IF NOT EXISTS required_hashtags TEXT[];

-- Add comment for documentation
COMMENT ON COLUMN public.campaigns.required_hashtags IS 
'Array of required hashtags (e.g., ["#SULMO", "#TRADING"]). Videos must contain at least one of these hashtags to be counted in campaign metrics. Case-insensitive matching.';

-- Create index for faster hashtag filtering
CREATE INDEX IF NOT EXISTS idx_campaigns_required_hashtags 
ON public.campaigns USING GIN (required_hashtags) 
WHERE required_hashtags IS NOT NULL;

COMMIT;
