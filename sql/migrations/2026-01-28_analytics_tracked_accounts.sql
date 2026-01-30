-- Create analytics_tracked_accounts table
-- This table stores accounts to be tracked in Analytics page

CREATE TABLE IF NOT EXISTS analytics_tracked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('tiktok','instagram')),
  username TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, username)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_analytics_tracked_platform ON analytics_tracked_accounts(platform);

-- Enable RLS
ALTER TABLE analytics_tracked_accounts ENABLE ROW LEVEL SECURITY;

-- Allow admin to manage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_analytics_tracked' AND tablename = 'analytics_tracked_accounts') THEN
    CREATE POLICY admin_analytics_tracked ON analytics_tracked_accounts FOR ALL USING (
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    );
  END IF;
END$$;

-- Populate from existing user_tiktok_usernames
INSERT INTO analytics_tracked_accounts (platform, username, label)
SELECT DISTINCT 
  'tiktok',
  tiktok_username,
  NULL
FROM user_tiktok_usernames
WHERE tiktok_username IS NOT NULL AND tiktok_username != ''
ON CONFLICT (platform, username) DO NOTHING;

-- Populate from existing user_instagram_usernames
INSERT INTO analytics_tracked_accounts (platform, username, label)
SELECT DISTINCT 
  'instagram',
  instagram_username,
  NULL
FROM user_instagram_usernames
WHERE instagram_username IS NOT NULL AND instagram_username != ''
ON CONFLICT (platform, username) DO NOTHING;

-- Verify
SELECT platform, COUNT(*) as count FROM analytics_tracked_accounts GROUP BY platform;
