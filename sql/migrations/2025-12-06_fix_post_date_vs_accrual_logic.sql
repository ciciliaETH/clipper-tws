-- CRITICAL FIX: Correct Post Date vs Accrual Mode Logic
-- Date: 2025-12-06
-- 
-- POST DATE MODE: Shows metrics from videos POSTED within date range
--   - Video posted Aug 1 with 5M views → counts ALL 5M if posted in range
--   - Video posted before range → does NOT count
--
-- ACCRUAL MODE: Shows DAILY INCREMENTS summed within date range (regardless of post date)
--   - Day 1: Account has +1M views → count +1M
--   - Day 2: Account has +500K views → count +500K
--   - Day 3: Account has +200M views (viral!) → count +200M
--   - Total accrual: 1M + 500K + 200M = 201.5M
--   - Works by comparing CONSECUTIVE daily snapshots (today - yesterday)

-- ============================================================================
-- 1. FIX: campaign_participant_totals_v2 (TikTok)
-- ============================================================================
CREATE OR REPLACE FUNCTION campaign_participant_totals_v2(
  p_campaign_id TEXT,
  p_start_date TEXT,
  p_end_date TEXT,
  p_mode TEXT DEFAULT 'post_date'
)
RETURNS TABLE (
  tiktok_username TEXT,
  total_views BIGINT,
  total_likes BIGINT,
  total_comments BIGINT,
  total_shares BIGINT,
  total_saves BIGINT,
  video_count BIGINT
) AS $$
BEGIN
  IF p_mode = 'accrual' THEN
    -- ACCRUAL MODE: Sum DAILY INCREMENTS (today - yesterday) for each video
    -- This shows the daily growth rate, not total delta
    RETURN QUERY
    WITH daily_increments AS (
      SELECT 
        s.tiktok_username,
        s.aweme_id,
        s.snapshot_date,
        s.play_count,
        s.digg_count,
        s.comment_count,
        s.share_count,
        s.save_count,
        -- Get previous day's values using LAG
        LAG(s.play_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_views,
        LAG(s.digg_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_likes,
        LAG(s.comment_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_comments,
        LAG(s.share_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_shares,
        LAG(s.save_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_saves
      FROM campaign_participants_snapshot s
      WHERE s.campaign_id = p_campaign_id
        AND s.snapshot_date >= p_start_date::date
        AND s.snapshot_date <= p_end_date::date
    )
    SELECT 
      di.tiktok_username,
      -- Sum daily increments (only count positive growth)
      SUM(GREATEST(0, di.play_count - COALESCE(di.prev_views, 0)))::bigint as total_views,
      SUM(GREATEST(0, di.digg_count - COALESCE(di.prev_likes, 0)))::bigint as total_likes,
      SUM(GREATEST(0, di.comment_count - COALESCE(di.prev_comments, 0)))::bigint as total_comments,
      SUM(GREATEST(0, di.share_count - COALESCE(di.prev_shares, 0)))::bigint as total_shares,
      SUM(GREATEST(0, di.save_count - COALESCE(di.prev_saves, 0)))::bigint as total_saves,
      COUNT(DISTINCT di.aweme_id)::bigint as video_count
    FROM daily_increments di
    WHERE di.prev_views IS NOT NULL -- Skip first snapshot (no previous to compare)
    GROUP BY di.tiktok_username;
    
  ELSE
    -- POST DATE MODE: Sum metrics from videos POSTED within date range
    RETURN QUERY
    SELECT 
      s.tiktok_username,
      SUM(s.play_count)::bigint as total_views,
      SUM(s.digg_count)::bigint as total_likes,
      SUM(s.comment_count)::bigint as total_comments,
      SUM(s.share_count)::bigint as total_shares,
      SUM(s.save_count)::bigint as total_saves,
      COUNT(DISTINCT s.aweme_id)::bigint as video_count
    FROM campaign_participants_snapshot s
    WHERE s.campaign_id = p_campaign_id
      AND s.create_time::date >= p_start_date::date
      AND s.create_time::date <= p_end_date::date
      -- Use only the LATEST snapshot for each video to get current totals
      AND s.snapshot_date = (
        SELECT MAX(s2.snapshot_date)
        FROM campaign_participants_snapshot s2
        WHERE s2.campaign_id = s.campaign_id
          AND s2.tiktok_username = s.tiktok_username
          AND s2.aweme_id = s.aweme_id
      )
    GROUP BY s.tiktok_username;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. FIX: campaign_instagram_participant_totals_v2 (Instagram)
-- ============================================================================
CREATE OR REPLACE FUNCTION campaign_instagram_participant_totals_v2(
  p_campaign_id TEXT,
  p_start_date TEXT,
  p_end_date TEXT,
  p_mode TEXT DEFAULT 'post_date'
)
RETURNS TABLE (
  instagram_username TEXT,
  total_views BIGINT,
  total_likes BIGINT,
  total_comments BIGINT,
  post_count BIGINT
) AS $$
BEGIN
  IF p_mode = 'accrual' THEN
    -- ACCRUAL MODE: Sum DAILY INCREMENTS (today - yesterday) for each post
    -- This shows the daily growth rate, not total delta
    RETURN QUERY
    WITH daily_increments AS (
      SELECT 
        s.instagram_username,
        s.shortcode,
        s.snapshot_date,
        s.play_count,
        s.like_count,
        s.comment_count,
        -- Get previous day's values using LAG
        LAG(s.play_count) OVER (PARTITION BY s.instagram_username, s.shortcode ORDER BY s.snapshot_date) as prev_views,
        LAG(s.like_count) OVER (PARTITION BY s.instagram_username, s.shortcode ORDER BY s.snapshot_date) as prev_likes,
        LAG(s.comment_count) OVER (PARTITION BY s.instagram_username, s.shortcode ORDER BY s.snapshot_date) as prev_comments
      FROM campaign_instagram_participants_snapshot s
      WHERE s.campaign_id = p_campaign_id
        AND s.snapshot_date >= p_start_date::date
        AND s.snapshot_date <= p_end_date::date
    )
    SELECT 
      di.instagram_username,
      -- Sum daily increments (only count positive growth)
      SUM(GREATEST(0, di.play_count - COALESCE(di.prev_views, 0)))::bigint as total_views,
      SUM(GREATEST(0, di.like_count - COALESCE(di.prev_likes, 0)))::bigint as total_likes,
      SUM(GREATEST(0, di.comment_count - COALESCE(di.prev_comments, 0)))::bigint as total_comments,
      COUNT(DISTINCT di.shortcode)::bigint as post_count
    FROM daily_increments di
    WHERE di.prev_views IS NOT NULL -- Skip first snapshot (no previous to compare)
    GROUP BY di.instagram_username;
    
  ELSE
    -- POST DATE MODE: Sum metrics from posts POSTED within date range
    RETURN QUERY
    SELECT 
      s.instagram_username,
      SUM(s.play_count)::bigint as total_views,
      SUM(s.like_count)::bigint as total_likes,
      SUM(s.comment_count)::bigint as total_comments,
      COUNT(DISTINCT s.shortcode)::bigint as post_count
    FROM campaign_instagram_participants_snapshot s
    WHERE s.campaign_id = p_campaign_id
      AND s.taken_at::date >= p_start_date::date
      AND s.taken_at::date <= p_end_date::date
      -- Use only the LATEST snapshot for each post to get current totals
      AND s.snapshot_date = (
        SELECT MAX(s2.snapshot_date)
        FROM campaign_instagram_participants_snapshot s2
        WHERE s2.campaign_id = s.campaign_id
          AND s2.instagram_username = s.instagram_username
          AND s2.shortcode = s.shortcode
      )
    GROUP BY s.instagram_username;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to test)
-- ============================================================================

-- Test 1: Compare Post Date vs Accrual for a campaign
-- SELECT * FROM campaign_participant_totals_v2('your-campaign-id', '2025-11-01', '2025-11-30', 'post_date');
-- SELECT * FROM campaign_participant_totals_v2('your-campaign-id', '2025-11-01', '2025-11-30', 'accrual');

-- Test 2: Verify single video delta calculation
-- SELECT 
--   tiktok_username,
--   aweme_id,
--   snapshot_date,
--   play_count,
--   LAG(play_count) OVER (PARTITION BY aweme_id ORDER BY snapshot_date) as prev_views,
--   play_count - LAG(play_count) OVER (PARTITION BY aweme_id ORDER BY snapshot_date) as view_delta
-- FROM campaign_participants_snapshot
-- WHERE campaign_id = 'your-campaign-id'
--   AND tiktok_username = 'test-user'
-- ORDER BY aweme_id, snapshot_date;
