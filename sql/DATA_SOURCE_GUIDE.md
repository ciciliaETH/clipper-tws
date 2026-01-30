# 🔍 DATA SOURCE INVESTIGATION & CLEANUP GUIDE

## Problem Statement
User reports: **"post_daily itu 0 loh"** (post_daily tables have 0 rows)
BUT dashboard chart shows Posts data (purple dotted line visible)

**This is a contradiction!** Either:
1. ❓ post_daily tables DO have data (user checked wrong)
2. 📦 Data is in legacy tables (tiktok_posts, instagram_posts)
3. 🔄 Data hasn't been synced yet from API to database

---

## ✅ VERIFIED: Code Only Queries post_daily Tables

**Dashboard endpoints confirmed:**
- ✅ `src/app/api/posts-series/route.ts` line 113: `.from('tiktok_posts_daily')`
- ✅ `src/app/api/posts-series/route.ts` line 146: `.from('instagram_posts_daily')`
- ✅ NO queries to `tiktok_posts` or `instagram_posts` found in codebase
- ✅ NO external API calls for posts data (database-only architecture)

**Conclusion:** If chart shows data, it MUST be coming from post_daily tables.

---

## 📋 STEP-BY-STEP RESOLUTION

### **STEP 1: Run Diagnostic**
```sql
-- Open Supabase SQL Editor and run this file:
sql/CRITICAL_DATA_DIAGNOSTIC.sql
```

**What to look for:**
```
table_name              | row_count
------------------------+-----------
tiktok_posts_daily      | ???       <- Should show actual count
instagram_posts_daily   | ???       <- Should show actual count
tiktok_posts            | ???       <- Legacy table (if exists)
instagram_posts         | ???       <- Legacy table (if exists)
```

**Possible Scenarios:**

#### 🟢 Scenario A: post_daily HAS DATA
```
tiktok_posts_daily: 1,234 rows
instagram_posts_daily: 567 rows
```
**Action:** Skip to STEP 3 (cleanup only)
**Conclusion:** System is working correctly, user checked wrong database/environment

---

#### 🟡 Scenario B: Legacy tables HAVE DATA
```
tiktok_posts_daily: 0 rows
instagram_posts_daily: 0 rows
tiktok_posts: 1,234 rows          <- DATA IS HERE!
instagram_posts: 567 rows         <- DATA IS HERE!
```
**Action:** Proceed to STEP 2 (migrate data)
**Conclusion:** Need to migrate from legacy tables to post_daily

---

#### 🔴 Scenario C: ALL TABLES EMPTY
```
tiktok_posts_daily: 0 rows
instagram_posts_daily: 0 rows
tiktok_posts: 0 rows
instagram_posts: 0 rows
```
**Action:** Run refresh operations first
**Conclusion:** No data exists yet, need to fetch from APIs

---

### **STEP 2: Migrate Data (Only if Scenario B)**
```sql
-- Only run if legacy tables have data
sql/MIGRATE_LEGACY_TO_DAILY.sql
```

**This script will:**
- ✅ Copy all data from `tiktok_posts` → `tiktok_posts_daily`
- ✅ Copy all data from `instagram_posts` → `instagram_posts_daily`
- ✅ Use `taken_at` if available, fallback to `post_date`, fallback to `created_at`
- ✅ Handle duplicates with `ON CONFLICT` update
- ✅ Verify row counts match

**After migration, verify:**
```sql
SELECT COUNT(*) FROM tiktok_posts_daily;    -- Should match legacy count
SELECT COUNT(*) FROM instagram_posts_daily; -- Should match legacy count
```

---

### **STEP 3: Test Dashboard**
1. Open dashboard in browser
2. Check **Posts chart** (purple dotted line)
3. Verify data displays correctly
4. Check date ranges are accurate

**If data displays correctly:** ✅ Safe to proceed to cleanup

**If data missing:** ❌ STOP! Do not cleanup, investigate further

---

### **STEP 4: Cleanup Unused Tables**
```sql
-- Only run after verifying dashboard displays data correctly
sql/CLEANUP_LEGACY_TABLES.sql
```

**This script will:**
- ✅ Drop `instagram_posts_daily_norm` (unused normalized table)
- ✅ Drop `group_leaderboard` (unused aggregation table)
- ✅ Drop `groups_total_metrics` (unused aggregation table)
- ✅ Drop `tiktok_posts` (legacy table - after data migrated)
- ✅ Drop `instagram_posts` (legacy table - after data migrated)
- ✅ Create performance indexes on post_daily tables
- ✅ Run VACUUM ANALYZE for optimization

**Safety checks built-in:**
- ❌ Script will ABORT if post_daily tables are empty
- ✅ Only drops legacy tables if post_daily has data
- ✅ Verifies only post_daily tables remain after cleanup

---

## 🎯 Expected Final State

### Tables Remaining:
```
✅ tiktok_posts_daily      (PRIMARY - all TikTok posts)
✅ instagram_posts_daily   (PRIMARY - all Instagram posts)
✅ user_tiktok_usernames   (username mappings)
✅ user_instagram_usernames (username mappings)
✅ employee_participants   (campaign participants)
✅ campaigns               (campaign metadata)
... (other non-posts tables)
```

### Tables Removed:
```
❌ tiktok_posts            (REMOVED - legacy)
❌ instagram_posts         (REMOVED - legacy)
❌ instagram_posts_daily_norm (REMOVED - unused)
❌ group_leaderboard       (REMOVED - unused)
❌ groups_total_metrics    (REMOVED - unused)
```

---

## 🔄 If You Need to Refresh All Data

If diagnostic shows 0 rows everywhere (Scenario C), run these endpoints:

### Refresh TikTok Data:
```
POST /api/admin/refresh-all?platform=tiktok
```

### Refresh Instagram Data:
```
POST /api/admin/refresh-all?platform=instagram
```

**These endpoints will:**
- Fetch latest posts from RapidAPI
- Save to `tiktok_posts_daily` and `instagram_posts_daily`
- Include `taken_at` timestamps (not just post_date)

---

## ⚙️ Technical Details

### post_daily Schema
```sql
-- tiktok_posts_daily
CREATE TABLE tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL,  -- ⭐ New precision timestamp
  post_date DATE,                 -- ⚠️ Can be dropped later
  play_count BIGINT,
  digg_count BIGINT,
  ...
);

-- instagram_posts_daily
CREATE TABLE instagram_posts_daily (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL,  -- ⭐ New precision timestamp
  post_date DATE,                 -- ⚠️ Can be dropped later
  like_count BIGINT,
  comment_count BIGINT,
  ...
);
```

### Query Pattern
```typescript
// All dashboard endpoints use this pattern:
const { data: posts } = await supabase
  .from('tiktok_posts_daily')  // or 'instagram_posts_daily'
  .select('*')
  .gte('taken_at', startDate + 'T00:00:00Z')
  .lte('taken_at', endDate + 'T23:59:59Z');
```

---

## ❓ FAQ

**Q: Why might chart show data but tables show 0 rows?**
A: Possible causes:
- Checking wrong database (dev vs prod)
- Haven't refreshed query results in Supabase UI
- Looking at wrong schema (public vs other)
- Chart is cached but database was reset

**Q: Is it safe to drop legacy tables?**
A: YES, but only after:
1. Running diagnostic and confirming post_daily has data
2. Testing dashboard to verify charts display correctly
3. Running cleanup script (has built-in safety checks)

**Q: What if I accidentally drop tables?**
A: If you have backup:
- Restore from Supabase backup/snapshot
Otherwise:
- Run refresh-all endpoints to re-fetch from APIs
- Data will be re-downloaded and saved to post_daily

**Q: Do campaign endpoints work after cleanup?**
A: Yes! Campaign endpoints still need migration to `taken_at`, but they will query `post_daily` tables once migrated.

---

## 📞 Next Steps

1. **RUN:** `sql/CRITICAL_DATA_DIAGNOSTIC.sql` in Supabase
2. **REPORT:** What are the actual row counts?
3. **PROCEED:** Based on scenario (A, B, or C) above
4. **TEST:** Dashboard displays correctly
5. **CLEANUP:** Run cleanup script to drop unused tables

---

## 🚨 Important Reminders

- ⚠️ **NEVER drop tables before diagnostic**
- ⚠️ **ALWAYS test dashboard before cleanup**
- ⚠️ **BACKUP database before any DROP commands**
- ✅ **Diagnostic → Migrate (if needed) → Test → Cleanup**
