# Campaign Snapshots Setup Guide

## Overview

Campaign snapshot tables menyimpan **daily snapshots** dari metrics setiap video participant dalam campaign. Digunakan untuk **Mode Accrual** di analytics chart.

## Architecture

### Mode Postdate
- **Data Source:** `tiktok_posts_daily` & `instagram_posts_daily`
- **Logic:** Direct aggregation by `taken_at` date
- **Use Case:** Show metrics by post date (when video was posted)

### Mode Accrual  
- **Data Source:** `campaign_tiktok_participants_snapshot` & `campaign_instagram_participants_snapshot`
- **Logic:** Daily snapshots → LAG() comparison → Sum daily deltas
- **Use Case:** Show daily growth/increments (like social_metrics_history but per campaign)

---

## Tables Structure

### campaign_tiktok_participants_snapshot

```sql
CREATE TABLE campaign_tiktok_participants_snapshot (
  id UUID PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id),
  tiktok_username TEXT,
  snapshot_date DATE,           -- Date of snapshot (daily)
  aweme_id TEXT,                -- Video ID
  
  -- Snapshot metrics (cumulative at this date)
  play_count BIGINT,
  digg_count BIGINT,
  comment_count BIGINT,
  share_count BIGINT,
  save_count BIGINT,
  
  -- Post metadata
  post_date DATE,
  taken_at TIMESTAMPTZ,
  
  UNIQUE(campaign_id, tiktok_username, aweme_id, snapshot_date)
);
```

### campaign_instagram_participants_snapshot

```sql
CREATE TABLE campaign_instagram_participants_snapshot (
  id UUID PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id),
  instagram_username TEXT,
  snapshot_date DATE,           -- Date of snapshot (daily)
  post_id TEXT,                 -- Instagram post ID
  
  -- Snapshot metrics
  play_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  
  -- Post metadata
  post_date DATE,
  taken_at TIMESTAMPTZ,
  
  UNIQUE(campaign_id, instagram_username, post_id, snapshot_date)
);
```

---

## Setup Instructions

### Step 1: Create Tables

Run SQL migration:
```bash
# Via Supabase SQL Editor
```
Execute: `sql/migrations/2026-01-28_create_campaign_snapshots.sql`

### Step 2: Setup Cron Job

Run cron setup:
```bash
# Via Supabase SQL Editor
```
Execute: `sql/cron_populate_campaign_snapshots.sql`

This creates:
- `fn_populate_tiktok_campaign_snapshots()` - Populate TikTok snapshots
- `fn_populate_instagram_campaign_snapshots()` - Populate Instagram snapshots
- `fn_populate_all_campaign_snapshots()` - Wrapper for both
- Cron job scheduled daily at 01:00 UTC

### Step 3: Backfill Historical Data (Optional)

Uncomment and run backfill block in `cron_populate_campaign_snapshots.sql`:

```sql
DO $$
DECLARE
  d DATE;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, '1 day')::DATE
  LOOP
    -- ... backfill logic ...
  END LOOP;
END;
$$;
```

This populates last 30 days of snapshots.

---

## How It Works

### Daily Snapshot Population (Automatic)

**Every day at 01:00 UTC:**

1. **Query Active Campaigns**
   - Filter: `start_date <= today AND (end_date IS NULL OR end_date >= today)`

2. **For Each Campaign:**
   - Get all participants from `campaign_participants` (TikTok) and `campaign_instagram_participants` (Instagram)
   
3. **For Each Participant:**
   - Query `posts_daily` tables
   - Filter posts: `taken_at >= campaign.start_date AND taken_at <= campaign.end_date`
   
4. **Insert Snapshots:**
   - Create snapshot for each video with today's metrics
   - UPSERT: If snapshot exists, update metrics

### Mode Accrual Calculation

**When analytics API calls mode=accrual:**

1. **Query Snapshots:**
   ```sql
   SELECT * FROM campaign_tiktok_participants_snapshot
   WHERE campaign_id = ?
     AND snapshot_date >= start_date
     AND snapshot_date <= end_date
   ORDER BY aweme_id, snapshot_date
   ```

2. **Calculate Daily Deltas:**
   ```sql
   WITH daily_increments AS (
     SELECT 
       aweme_id,
       snapshot_date,
       play_count - LAG(play_count) OVER (PARTITION BY aweme_id ORDER BY snapshot_date) as delta_views
     FROM snapshots
   )
   SELECT 
     DATE_TRUNC('week', snapshot_date) as week,
     SUM(GREATEST(0, delta_views)) as total_weekly_growth
   FROM daily_increments
   WHERE delta_views IS NOT NULL  -- Skip first snapshot
   GROUP BY 1
   ```

3. **Return Series:**
   - Weekly aggregation of daily deltas
   - Only positive growth counted

---

## Maintenance

### Check Snapshot Coverage

```sql
-- TikTok snapshots by date
SELECT snapshot_date, COUNT(*) as count
FROM campaign_tiktok_participants_snapshot
WHERE campaign_id = 'YOUR_CAMPAIGN_ID'
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 30;

-- Instagram snapshots by date
SELECT snapshot_date, COUNT(*) as count
FROM campaign_instagram_participants_snapshot
WHERE campaign_id = 'YOUR_CAMPAIGN_ID'
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 30;
```

### Manual Populate (If Cron Fails)

```sql
-- Populate today's snapshots
SELECT fn_populate_all_campaign_snapshots();

-- Check cron status
SELECT * FROM cron.job WHERE jobname = 'populate-campaign-snapshots';

-- Check cron run history
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'populate-campaign-snapshots')
ORDER BY start_time DESC
LIMIT 10;
```

### Cleanup Old Snapshots

```sql
-- Delete snapshots older than 90 days
DELETE FROM campaign_tiktok_participants_snapshot
WHERE snapshot_date < CURRENT_DATE - INTERVAL '90 days';

DELETE FROM campaign_instagram_participants_snapshot
WHERE snapshot_date < CURRENT_DATE - INTERVAL '90 days';
```

---

## Troubleshooting

### Issue: Snapshots not populating

**Check:**
1. pg_cron extension enabled: `CREATE EXTENSION IF NOT EXISTS pg_cron;`
2. Cron job exists: `SELECT * FROM cron.job WHERE jobname = 'populate-campaign-snapshots';`
3. Function exists: `\df fn_populate_all_campaign_snapshots`
4. Manual run: `SELECT fn_populate_all_campaign_snapshots();`

### Issue: Mode accrual shows zeros

**Check:**
1. Snapshots exist for date range: `SELECT COUNT(*) FROM campaign_tiktok_participants_snapshot WHERE snapshot_date BETWEEN ? AND ?;`
2. Campaign has participants: `SELECT COUNT(*) FROM campaign_participants WHERE campaign_id = ?;`
3. posts_daily has data: `SELECT COUNT(*) FROM tiktok_posts_daily WHERE username IN (...);`

### Issue: Duplicate snapshots

**Should not happen** due to UNIQUE constraint. If occurs:
```sql
-- Find duplicates
SELECT campaign_id, tiktok_username, aweme_id, snapshot_date, COUNT(*)
FROM campaign_tiktok_participants_snapshot
GROUP BY 1,2,3,4
HAVING COUNT(*) > 1;
```

---

## Performance Considerations

### Indexes
- `idx_tt_snapshot_campaign_date` - Fast campaign + date queries
- `idx_tt_snapshot_username` - Fast username lookups
- `idx_tt_snapshot_video` - Fast video history

### Data Volume Estimate
- **Per campaign:** ~1000 videos × 30 days = 30,000 snapshots/month
- **Storage:** ~100 bytes/row = ~3 MB/month per campaign
- **10 campaigns:** ~30 MB/month
- **Annual:** ~360 MB/year (very manageable)

### Query Optimization
Mode accrual queries use:
1. **Window functions (LAG)** - Efficient in PostgreSQL
2. **PARTITION BY aweme_id** - Separate calculation per video
3. **Date range filters** - Use indexed `snapshot_date`

---

## Migration Path

If you already have existing analytics:

1. ✅ **Create tables** (2026-01-28_create_campaign_snapshots.sql)
2. ✅ **Setup cron** (cron_populate_campaign_snapshots.sql)
3. ✅ **Backfill 30 days** (uncomment backfill block)
4. ✅ **Test mode accrual** (analytics page)
5. ✅ **Monitor daily cron** (check job_run_details)

---

## API Integration

### TypeScript Implementation (Coming)

```typescript
// src/app/api/analytics/series/route.ts

if (mode === 'accrual') {
  // Query snapshots
  const { data: ttSnapshots } = await supa
    .from('campaign_tiktok_participants_snapshot')
    .select('*')
    .in('tiktok_username', ttHandles)
    .gte('snapshot_date', startISO)
    .lte('snapshot_date', endISO)
    .order('aweme_id')
    .order('snapshot_date');
  
  // Calculate deltas per video
  const deltasByVideo = new Map();
  for (const snap of ttSnapshots) {
    const key = snap.aweme_id;
    if (!deltasByVideo.has(key)) {
      deltasByVideo.set(key, []);
    }
    deltasByVideo.get(key).push(snap);
  }
  
  // Sum daily increments
  for (const [videoId, snaps] of deltasByVideo.entries()) {
    for (let i = 1; i < snaps.length; i++) {
      const prev = snaps[i-1];
      const curr = snaps[i];
      const delta = Math.max(0, curr.play_count - prev.play_count);
      // Add to series...
    }
  }
}
```

---

## Summary

✅ **Tables:** campaign_tiktok_participants_snapshot & campaign_instagram_participants_snapshot  
✅ **Population:** Daily cron at 01:00 UTC  
✅ **Mode Accrual:** Uses snapshots with LAG() delta calculation  
✅ **Mode Postdate:** Uses posts_daily direct aggregation  
✅ **Storage:** ~360 MB/year for 10 campaigns (scalable)  
✅ **Maintenance:** Minimal, auto-cleanup old snapshots if needed  

🎯 **Ready to implement mode accrual with proper historical tracking!**
