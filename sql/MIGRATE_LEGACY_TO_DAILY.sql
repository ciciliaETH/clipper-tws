-- ============================================================
-- DATA MIGRATION FROM LEGACY TABLES TO POST_DAILY
-- ============================================================
-- Run this ONLY IF diagnostic shows you have data in tiktok_posts or instagram_posts
-- This will migrate all legacy data to the new post_daily tables

-- ============================================================
-- STEP 1: MIGRATE TIKTOK DATA (if tiktok_posts exists)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_posts') THEN
    RAISE NOTICE 'Migrating data from tiktok_posts to tiktok_posts_daily...';
    
    -- Insert all records from tiktok_posts into tiktok_posts_daily
    INSERT INTO tiktok_posts_daily (
      video_id,
      username,
      taken_at,
      play_count,
      digg_count,
      share_count,
      comment_count,
      collect_count,
      title,
      description,
      cover_url,
      video_url,
      music_title,
      music_author,
      duration,
      is_ad,
      created_at,
      updated_at
    )
    SELECT 
      video_id,
      username,
      -- Use taken_at if available, otherwise use post_date, otherwise use created_at
      COALESCE(
        taken_at,
        (post_date || 'T00:00:00Z')::timestamptz,
        created_at
      ) as taken_at,
      play_count,
      digg_count,
      share_count,
      comment_count,
      collect_count,
      title,
      description,
      cover_url,
      video_url,
      music_title,
      music_author,
      duration,
      is_ad,
      created_at,
      updated_at
    FROM tiktok_posts
    ON CONFLICT (video_id) DO UPDATE SET
      play_count = EXCLUDED.play_count,
      digg_count = EXCLUDED.digg_count,
      share_count = EXCLUDED.share_count,
      comment_count = EXCLUDED.comment_count,
      collect_count = EXCLUDED.collect_count,
      taken_at = EXCLUDED.taken_at,
      updated_at = EXCLUDED.updated_at;
    
    RAISE NOTICE 'TikTok migration complete. Rows affected: %', (SELECT COUNT(*) FROM tiktok_posts);
  ELSE
    RAISE NOTICE 'tiktok_posts table does not exist - skipping migration';
  END IF;
END $$;

-- ============================================================
-- STEP 2: MIGRATE INSTAGRAM DATA (if instagram_posts exists)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts') THEN
    RAISE NOTICE 'Migrating data from instagram_posts to instagram_posts_daily...';
    
    -- Insert all records from instagram_posts into instagram_posts_daily
    INSERT INTO instagram_posts_daily (
      id,
      username,
      taken_at,
      like_count,
      comment_count,
      caption,
      media_type,
      media_url,
      thumbnail_url,
      permalink,
      is_video,
      video_view_count,
      created_at,
      updated_at
    )
    SELECT 
      id,
      username,
      -- Use taken_at if available, otherwise use post_date, otherwise use created_at
      COALESCE(
        taken_at,
        (post_date || 'T00:00:00Z')::timestamptz,
        created_at
      ) as taken_at,
      like_count,
      comment_count,
      caption,
      media_type,
      media_url,
      thumbnail_url,
      permalink,
      is_video,
      video_view_count,
      created_at,
      updated_at
    FROM instagram_posts
    ON CONFLICT (id) DO UPDATE SET
      like_count = EXCLUDED.like_count,
      comment_count = EXCLUDED.comment_count,
      video_view_count = EXCLUDED.video_view_count,
      taken_at = EXCLUDED.taken_at,
      updated_at = EXCLUDED.updated_at;
    
    RAISE NOTICE 'Instagram migration complete. Rows affected: %', (SELECT COUNT(*) FROM instagram_posts);
  ELSE
    RAISE NOTICE 'instagram_posts table does not exist - skipping migration';
  END IF;
END $$;

-- ============================================================
-- STEP 3: VERIFY MIGRATION
-- ============================================================
SELECT 
  'Migration Verification' as status,
  (SELECT COUNT(*) FROM tiktok_posts_daily) as tiktok_daily_rows,
  (SELECT COUNT(*) FROM instagram_posts_daily) as instagram_daily_rows,
  CASE 
    WHEN (SELECT COUNT(*) FROM tiktok_posts_daily) > 0 OR (SELECT COUNT(*) FROM instagram_posts_daily) > 0
    THEN '✅ DATA SUCCESSFULLY MIGRATED TO POST_DAILY TABLES'
    ELSE '⚠️ WARNING: POST_DAILY TABLES STILL EMPTY AFTER MIGRATION'
  END as result;

-- Show sample migrated data
SELECT 'TikTok Sample (Latest 5)' as info;
SELECT video_id, username, taken_at, play_count, created_at
FROM tiktok_posts_daily
ORDER BY taken_at DESC
LIMIT 5;

SELECT 'Instagram Sample (Latest 5)' as info;
SELECT id, username, taken_at, like_count, created_at
FROM instagram_posts_daily
ORDER BY taken_at DESC
LIMIT 5;

-- ============================================================
-- STEP 4: COUNT COMPARISON (if legacy tables exist)
-- ============================================================
DO $$
DECLARE
  legacy_tiktok_count INT;
  daily_tiktok_count INT;
  legacy_instagram_count INT;
  daily_instagram_count INT;
BEGIN
  -- Check TikTok counts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_posts') THEN
    SELECT COUNT(*) INTO legacy_tiktok_count FROM tiktok_posts;
    SELECT COUNT(*) INTO daily_tiktok_count FROM tiktok_posts_daily;
    RAISE NOTICE 'TikTok: Legacy table has % rows, Daily table has % rows', legacy_tiktok_count, daily_tiktok_count;
    
    IF daily_tiktok_count >= legacy_tiktok_count THEN
      RAISE NOTICE '✅ All TikTok data migrated successfully';
    ELSE
      RAISE WARNING '⚠️ TikTok daily table has FEWER rows than legacy table!';
    END IF;
  END IF;

  -- Check Instagram counts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts') THEN
    SELECT COUNT(*) INTO legacy_instagram_count FROM instagram_posts;
    SELECT COUNT(*) INTO daily_instagram_count FROM instagram_posts_daily;
    RAISE NOTICE 'Instagram: Legacy table has % rows, Daily table has % rows', legacy_instagram_count, daily_instagram_count;
    
    IF daily_instagram_count >= legacy_instagram_count THEN
      RAISE NOTICE '✅ All Instagram data migrated successfully';
    ELSE
      RAISE WARNING '⚠️ Instagram daily table has FEWER rows than legacy table!';
    END IF;
  END IF;
END $$;

-- ============================================================
-- NOTES:
-- ============================================================
-- After running this migration and verifying data:
-- 1. Test your dashboard to make sure charts display correctly
-- 2. Run CRITICAL_DATA_DIAGNOSTIC.sql again to confirm
-- 3. Only then run CLEANUP_LEGACY_TABLES.sql to drop old tables
