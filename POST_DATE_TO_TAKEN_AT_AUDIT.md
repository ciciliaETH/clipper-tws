# POST_DATE → TAKEN_AT MIGRATION AUDIT

Date: 2026-01-27

## ✅ DASHBOARD ENDPOINTS (CRITICAL - ALREADY FIXED)

### Primary Dashboard APIs
- ✅ `/api/analytics/series` - Uses `taken_at` with TIMESTAMPTZ ranges
- ✅ `/api/posts-series` - Uses `taken_at` for TikTok & Instagram  
- ✅ `/api/leaderboard/top-videos` - Uses `taken_at` for count queries
- ✅ `/api/groups/[id]/series` - Uses `taken_at` for time series
- ✅ `/api/groups/[id]/members` - Uses `taken_at` for member metrics

### Fetch/Refresh Endpoints  
- ✅ `/api/fetch-metrics/[username]` - Writes `taken_at` on upsert
- ⚠️ `/api/fetch-ig/[username]` - PARTIALLY FIXED (main route OK, route_split.ts still has post_date)

---

## ⚠️ FILES STILL USING POST_DATE

### Campaign Management (NOT used in main dashboard)
1. **src/app/api/campaigns/[id]/metrics/route.ts** - 11 occurrences
   - Line 157-158: TikTok posts enrichment
   - Line 183-184: TikTok hashtag filtering  
   - Line 208-209: Instagram hashtag filtering
   - Line 333, 351, 371, 404: Various participant metrics queries
   
2. **src/app/api/campaigns/[id]/accrual/route.ts** - 8 occurrences
   - Line 152-155: TikTok post listings
   - Line 169-172: Instagram post listings
   - Line 303-306: TikTok accrual calculations
   - Line 342-345: Instagram accrual calculations

3. **src/app/api/campaigns/[id]/participants/[username]/route.ts** - 1 occurrence
   - Line 47: Single user post metrics

4. **src/app/api/campaigns/[id]/debug/route.ts** - 4 occurrences
   - Line 51-52, 68-69: Debug queries for campaign date ranges

### Background Jobs
5. **src/app/api/cron/sync-tiktok/route.ts** - 2 occurrences
   - Line 206-208: Aggregation query for sync

### Backfill/Migration Scripts  
6. **src/app/api/backfill/taken-at/route.ts** - 2 occurrences
   - Line 68, 162: Backfill script (intentionally uses post_date for migration)

7. **src/app/api/backfill/accrual/route.ts** - 2 occurrences
   - Line 74, 91: Legacy backfill (old script)

### Unused/Split Files
8. **src/app/api/fetch-ig/[username]/route_split.ts** - 3 occurrences
   - Line 342, 415, 417: Old backup file (not used)

---

## 📋 FIX PRIORITY

### HIGH PRIORITY (Campaign Management)
These are user-facing campaign features:
- [ ] campaigns/[id]/metrics/route.ts
- [ ] campaigns/[id]/accrual/route.ts  
- [ ] campaigns/[id]/participants/[username]/route.ts
- [ ] campaigns/[id]/debug/route.ts

### MEDIUM PRIORITY (Background)
- [ ] cron/sync-tiktok/route.ts

### LOW PRIORITY (Can Skip)
- Backfill scripts (intentionally use post_date for migration)
- route_split.ts (backup file, not used)

---

## 🎯 MIGRATION PATTERN

Replace ALL instances of:

```typescript
// BEFORE
.select('username, post_date, play_count, ...')
.gte('post_date', startISO)
.lte('post_date', endISO)

// AFTER
.select('username, taken_at, play_count, ...')
.gte('taken_at', startISO + 'T00:00:00Z')
.lte('taken_at', endISO + 'T23:59:59Z')
```

**Date extraction:**
```typescript
// BEFORE
const date = row.post_date;

// AFTER  
const date = new Date(row.taken_at).toISOString().slice(0,10);
```

---

## ✅ VERIFICATION QUERIES

After migration, verify with:

```sql
-- Should return 0 (no post_date in SELECT)
SELECT column_name 
FROM information_schema.columns 
WHERE table_name IN ('tiktok_posts_daily', 'instagram_posts_daily')
  AND column_name = 'post_date';

-- Should have taken_at populated
SELECT 
  COUNT(*) as total,
  COUNT(taken_at) as with_taken_at,
  COUNT(CASE WHEN taken_at IS NULL THEN 1 END) as nulls
FROM tiktok_posts_daily;

SELECT 
  COUNT(*) as total,
  COUNT(taken_at) as with_taken_at,
  COUNT(CASE WHEN taken_at IS NULL THEN 1 END) as nulls
FROM instagram_posts_daily;
```

---

## 📊 SUMMARY

**Dashboard (Main UI):** ✅ 100% migrated to `taken_at`  
**Campaign Management:** ⚠️ 26 post_date references to fix  
**Background Jobs:** ⚠️ 2 post_date references to fix  
**Backfill Scripts:** ⏭️ Skip (intentional for migration)

**Total to fix:** ~28 references across 5 files
