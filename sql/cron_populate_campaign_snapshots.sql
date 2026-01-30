-- CRON Job: Populate Campaign Snapshots Daily
-- Schedule: Every day at 01:00 UTC
-- Purpose: Create daily snapshots of all campaign participants' video metrics

-- ============================================================================
-- FUNCTION: Populate TikTok Campaign Snapshots
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_populate_tiktok_campaign_snapshots()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_date DATE := CURRENT_DATE;
  inserted_count INTEGER := 0;
BEGIN
  -- Insert snapshots for all active campaigns
  INSERT INTO public.campaign_tiktok_participants_snapshot (
    campaign_id,
    tiktok_username,
    snapshot_date,
    aweme_id,
    play_count,
    digg_count,
    comment_count,
    share_count,
    save_count,
    post_date,
    taken_at
  )
  SELECT 
    cp.campaign_id,
    cp.tiktok_username,
    snapshot_date,
    td.video_id as aweme_id,
    td.play_count,
    td.digg_count,
    td.comment_count,
    td.share_count,
    td.save_count,
    td.post_date,
    td.taken_at
  FROM public.campaign_participants cp
  INNER JOIN public.campaigns c ON c.id = cp.campaign_id
  INNER JOIN public.tiktok_posts_daily td ON LOWER(td.username) = LOWER(cp.tiktok_username)
  WHERE 
    -- Only active campaigns (start_date <= today, end_date null or >= today)
    c.start_date <= snapshot_date
    AND (c.end_date IS NULL OR c.end_date >= snapshot_date)
    -- Only posts within campaign dates
    AND td.taken_at >= (c.start_date || ' 00:00:00')::TIMESTAMPTZ
    AND (c.end_date IS NULL OR td.taken_at <= (c.end_date || ' 23:59:59')::TIMESTAMPTZ)
  ON CONFLICT (campaign_id, tiktok_username, aweme_id, snapshot_date) 
  DO UPDATE SET
    play_count = EXCLUDED.play_count,
    digg_count = EXCLUDED.digg_count,
    comment_count = EXCLUDED.comment_count,
    share_count = EXCLUDED.share_count,
    save_count = EXCLUDED.save_count;
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  
  RAISE NOTICE 'TikTok snapshots populated: % rows for %', inserted_count, snapshot_date;
END;
$$;

-- ============================================================================
-- FUNCTION: Populate Instagram Campaign Snapshots
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_populate_instagram_campaign_snapshots()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_date DATE := CURRENT_DATE;
  inserted_count INTEGER := 0;
BEGIN
  -- Insert snapshots for all active campaigns
  INSERT INTO public.campaign_instagram_participants_snapshot (
    campaign_id,
    instagram_username,
    snapshot_date,
    post_id,
    play_count,
    like_count,
    comment_count,
    post_date,
    taken_at
  )
  SELECT 
    cip.campaign_id,
    cip.instagram_username,
    snapshot_date,
    id.id as post_id,
    id.play_count,
    id.like_count,
    id.comment_count,
    id.post_date,
    id.taken_at
  FROM public.campaign_instagram_participants cip
  INNER JOIN public.campaigns c ON c.id = cip.campaign_id
  INNER JOIN public.instagram_posts_daily id ON LOWER(id.username) = LOWER(cip.instagram_username)
  WHERE 
    -- Only active campaigns
    c.start_date <= snapshot_date
    AND (c.end_date IS NULL OR c.end_date >= snapshot_date)
    -- Only posts within campaign dates
    AND id.taken_at >= (c.start_date || ' 00:00:00')::TIMESTAMPTZ
    AND (c.end_date IS NULL OR id.taken_at <= (c.end_date || ' 23:59:59')::TIMESTAMPTZ)
  ON CONFLICT (campaign_id, instagram_username, post_id, snapshot_date) 
  DO UPDATE SET
    play_count = EXCLUDED.play_count,
    like_count = EXCLUDED.like_count,
    comment_count = EXCLUDED.comment_count;
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  
  RAISE NOTICE 'Instagram snapshots populated: % rows for %', inserted_count, snapshot_date;
END;
$$;

-- ============================================================================
-- FUNCTION: Populate Both (Wrapper)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_populate_all_campaign_snapshots()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.fn_populate_tiktok_campaign_snapshots();
  PERFORM public.fn_populate_instagram_campaign_snapshots();
  
  RAISE NOTICE 'All campaign snapshots populated for %', CURRENT_DATE;
END;
$$;

-- ============================================================================
-- CRON Job: Schedule daily snapshot population
-- ============================================================================
-- Run every day at 01:00 UTC (after all metrics are refreshed)
-- NOTE: Requires pg_cron extension

-- First, unschedule if exists
SELECT cron.unschedule('populate-campaign-snapshots') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'populate-campaign-snapshots');

-- Schedule new job
SELECT cron.schedule(
  'populate-campaign-snapshots',
  '0 1 * * *',  -- Every day at 01:00 UTC
  $$SELECT public.fn_populate_all_campaign_snapshots()$$
);

-- ============================================================================
-- Manual trigger for initial population (backfill historical data)
-- ============================================================================
-- Uncomment and run to backfill last 30 days of snapshots:
/*
DO $$
DECLARE
  d DATE;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, '1 day')::DATE
  LOOP
    RAISE NOTICE 'Backfilling snapshots for %', d;
    
    -- Temporarily override CURRENT_DATE logic by direct insert
    INSERT INTO public.campaign_tiktok_participants_snapshot (
      campaign_id, tiktok_username, snapshot_date, aweme_id,
      play_count, digg_count, comment_count, share_count, save_count,
      post_date, taken_at
    )
    SELECT 
      cp.campaign_id, cp.tiktok_username, d, td.video_id,
      td.play_count, td.digg_count, td.comment_count, td.share_count, td.save_count,
      td.post_date, td.taken_at
    FROM public.campaign_participants cp
    INNER JOIN public.campaigns c ON c.id = cp.campaign_id
    INNER JOIN public.tiktok_posts_daily td ON LOWER(td.username) = LOWER(cp.tiktok_username)
    WHERE c.start_date <= d AND (c.end_date IS NULL OR c.end_date >= d)
      AND td.taken_at >= (c.start_date || ' 00:00:00')::TIMESTAMPTZ
      AND (c.end_date IS NULL OR td.taken_at <= (c.end_date || ' 23:59:59')::TIMESTAMPTZ)
    ON CONFLICT DO NOTHING;
    
    INSERT INTO public.campaign_instagram_participants_snapshot (
      campaign_id, instagram_username, snapshot_date, post_id,
      play_count, like_count, comment_count, post_date, taken_at
    )
    SELECT 
      cip.campaign_id, cip.instagram_username, d, id.id,
      id.play_count, id.like_count, id.comment_count, id.post_date, id.taken_at
    FROM public.campaign_instagram_participants cip
    INNER JOIN public.campaigns c ON c.id = cip.campaign_id
    INNER JOIN public.instagram_posts_daily id ON LOWER(id.username) = LOWER(cip.instagram_username)
    WHERE c.start_date <= d AND (c.end_date IS NULL OR c.end_date >= d)
      AND id.taken_at >= (c.start_date || ' 00:00:00')::TIMESTAMPTZ
      AND (c.end_date IS NULL OR id.taken_at <= (c.end_date || ' 23:59:59')::TIMESTAMPTZ)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
*/
