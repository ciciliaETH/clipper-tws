-- Cleanup: Drop Unused Snapshot Tables
-- Date: 2026-01-28
-- Reason: Using Option 1 (social_metrics_history) for Mode Accrual instead of per-video snapshots

BEGIN;

-- Drop snapshot tables (created but not used)
DROP TABLE IF EXISTS public.campaign_tiktok_participants_snapshot CASCADE;
DROP TABLE IF EXISTS public.campaign_instagram_participants_snapshot CASCADE;

-- Drop populate functions (not needed)
DROP FUNCTION IF EXISTS public.fn_populate_tiktok_campaign_snapshots() CASCADE;
DROP FUNCTION IF EXISTS public.fn_populate_instagram_campaign_snapshots() CASCADE;
DROP FUNCTION IF EXISTS public.fn_populate_all_campaign_snapshots() CASCADE;

-- Unschedule cron job (if exists)
SELECT cron.unschedule('populate-campaign-snapshots') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'populate-campaign-snapshots'
);

COMMIT;

-- Verify cleanup
SELECT 
  'campaign_tiktok_participants_snapshot' as table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'campaign_tiktok_participants_snapshot'
  ) THEN '❌ Still exists' ELSE '✅ Deleted' END as status
UNION ALL
SELECT 
  'campaign_instagram_participants_snapshot',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'campaign_instagram_participants_snapshot'
  ) THEN '❌ Still exists' ELSE '✅ Deleted' END
UNION ALL
SELECT 
  'fn_populate_*_snapshots functions',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname LIKE '%populate%snapshot%'
  ) THEN '❌ Still exists' ELSE '✅ Deleted' END
UNION ALL
SELECT 
  'cron job: populate-campaign-snapshots',
  CASE WHEN EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'populate-campaign-snapshots'
  ) THEN '❌ Still scheduled' ELSE '✅ Unscheduled' END;
