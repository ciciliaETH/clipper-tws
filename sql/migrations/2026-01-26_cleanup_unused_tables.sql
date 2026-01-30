-- Cleanup: Drop unused/unrestricted tables
-- Date: 2026-01-26
-- WARNING: Verify these tables are truly unused before running!

-- ========================================
-- ANALYSIS: Which tables are safe to drop?
-- ========================================
-- Based on code search:
-- 1. instagram_posts_daily_norm - VIEW only, never queried in app code
-- 2. groups_total_metrics - No references found in codebase
-- 3. group_leaderboard - VIEW, but logic moved to API endpoints
--
-- Tables that MUST NOT be dropped (still in use):
-- - employee_participants: Used in campaigns
-- - tiktok_posts_daily: Core table
-- - user_instagram_usernames: Mapping table, actively used
-- - user_tiktok_usernames: Mapping table, actively used

BEGIN;

-- ========================================
-- STEP 1: Drop unused views
-- ========================================

-- Drop instagram_posts_daily_norm view (if exists)
DROP VIEW IF EXISTS public.instagram_posts_daily_norm CASCADE;

-- Drop group_leaderboard view (logic moved to /api/leaderboard)
DROP VIEW IF EXISTS public.group_leaderboard CASCADE;

-- ========================================
-- STEP 2: Drop unused tables
-- ========================================

-- Drop groups_total_metrics if it exists (no references in code)
DROP TABLE IF EXISTS public.groups_total_metrics CASCADE;

-- Log what was dropped
DO $$
BEGIN
  RAISE NOTICE 'Cleanup complete:';
  RAISE NOTICE '  - Dropped view: instagram_posts_daily_norm (unused)';
  RAISE NOTICE '  - Dropped view: group_leaderboard (moved to API)';
  RAISE NOTICE '  - Dropped table: groups_total_metrics (unused)';
END $$;

COMMIT;

-- ========================================
-- VERIFICATION: Confirm required tables still exist
-- ========================================
DO $$
DECLARE
  required_tables TEXT[] := ARRAY[
    'users',
    'tiktok_posts_daily',
    'instagram_posts_daily',
    'campaigns',
    'campaign_participants',
    'campaign_instagram_participants',
    'employee_participants',
    'employee_instagram_participants',
    'social_metrics',
    'social_metrics_history',
    'user_tiktok_usernames',
    'user_instagram_usernames',
    'groups',
    'group_participants',
    'employee_groups',
    'instagram_user_ids'
  ];
  tbl TEXT;
  missing_count INTEGER := 0;
BEGIN
  FOREACH tbl IN ARRAY required_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE WARNING 'MISSING REQUIRED TABLE: %', tbl;
      missing_count := missing_count + 1;
    END IF;
  END LOOP;
  
  IF missing_count = 0 THEN
    RAISE NOTICE 'All % required tables verified ✓', array_length(required_tables, 1);
  ELSE
    RAISE EXCEPTION 'Found % missing required tables! Rollback recommended.', missing_count;
  END IF;
END $$;
