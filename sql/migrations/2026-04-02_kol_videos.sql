-- KOL Videos: track individual video links from Key Opinion Leaders
CREATE TABLE IF NOT EXISTS kol_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube')),
  video_url TEXT NOT NULL,
  video_id TEXT,
  username TEXT,
  title TEXT,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  thumbnail_url TEXT,
  added_by UUID,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_kol_videos_campaign ON kol_videos(campaign_id);
CREATE INDEX IF NOT EXISTS idx_kol_videos_platform ON kol_videos(platform);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kol_videos_url ON kol_videos(video_url);

-- Enable RLS
ALTER TABLE kol_videos ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "kol_videos_read" ON kol_videos FOR SELECT TO authenticated USING (true);

-- Allow admins to insert/update/delete
CREATE POLICY "kol_videos_admin_write" ON kol_videos FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin'))
  );
