-- Delete All Data from instagram_post_metrics_history
-- Date: 2026-01-28
-- WARNING: This will permanently delete all historical snapshots
-- Trigger will continue to work and repopulate on future updates

BEGIN;

-- Backup count before delete (optional - for reference)
SELECT COUNT(*) as records_before_delete 
FROM instagram_post_metrics_history;

-- Delete all records
DELETE FROM instagram_post_metrics_history;

-- Verify deletion
SELECT COUNT(*) as records_after_delete 
FROM instagram_post_metrics_history;

-- Reset auto-increment ID to 1 (optional)
ALTER SEQUENCE instagram_post_metrics_history_id_seq RESTART WITH 1;

COMMIT;

-- Final verification
SELECT 
  'instagram_post_metrics_history' as table_name,
  COUNT(*) as total_records,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ Empty'
    ELSE '❌ Still has data'
  END as status
FROM instagram_post_metrics_history;
