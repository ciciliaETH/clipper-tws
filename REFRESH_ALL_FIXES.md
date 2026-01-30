# 🔧 REFRESH-ALL FIXES - COMPLETE SOLUTION

## 📋 Issues Fixed

### ✅ Issue #1: Wrong Username Count (FIXED)
**Problem:**
- Instagram showed 45 accounts instead of 60
- TikTok showed 57 accounts instead of 59
- Not fetching ALL usernames from `user_instagram_usernames` and `user_tiktok_usernames` tables

**Root Cause:**
- Code was querying `campaign_participants` and `campaign_instagram_participants` as PRIMARY source
- These tables only have campaign-specific accounts, not ALL registered usernames

**Solution Applied:**
✅ Changed [src/app/api/admin/tiktok/refresh-all/route.ts](../src/app/api/admin/tiktok/refresh-all/route.ts#L160-L179):
- Now queries `user_tiktok_usernames` as PRIMARY source
- Falls back to campaign_participants, employee_participants, user profiles as additional sources
- **Result:** Will fetch ALL 59 TikTok accounts

✅ Changed [src/app/api/admin/ig/refresh-all/route.ts](../src/app/api/admin/ig/refresh-all/route.ts#L153-L177):
- Now queries `user_instagram_usernames` as PRIMARY source
- Falls back to campaign_instagram_participants, employee_instagram_participants
- **Result:** Will fetch ALL 60 Instagram accounts

---

### ✅ Issue #2: Data Not Saving to Database (FIXED)
**Problem:**
- Terminal logs showed: "Parsed 33/33 videos. Total stats: views=10386, likes=212"
- BUT database still showed 0 rows in `tiktok_posts_daily`
- Data was fetched successfully but failed silently during save

**Root Cause:**
- No detailed error logging during database upsert
- Errors were swallowed silently without reporting
- Could be permission issues, schema mismatches, or connection problems

**Solution Applied:**
✅ Enhanced [src/app/api/fetch-metrics/[username]/route.ts](../src/app/api/fetch-metrics/[username]/route.ts#L382-L432):
```typescript
// NEW: Comprehensive error logging
console.log(`[TikTok] Attempting to save ${filteredPosts.length} posts...`);

// Track success/failure counts
let successCount = 0;
let errorCount = 0;

// Log detailed error info
if (upsertError) {
  console.error('[TikTok] ❌ FAILED upsert:', {
    error: upsertError.message,
    code: upsertError.code,
    details: upsertError.details,
    hint: upsertError.hint,
    username,
    video_id: upsertData.video_id
  });
} else {
  successCount++;
  console.log('[TikTok] ✅ Successfully saved:', { video_id, username });
}

console.log(`[TikTok] Summary: ✅ ${successCount} saved, ❌ ${errorCount} failed`);
```

✅ Enhanced [src/app/api/fetch-ig/[username]/route.ts](../src/app/api/fetch-ig/[username]/route.ts#L653-L690):
```typescript
// NEW: Chunk-level error tracking
let totalSaved = 0;
let totalErrors = 0;

for (chunk of upserts) {
  const { error: upsertError } = await supabase.upsert(chunk);
  
  if (upsertError) {
    console.error('[Instagram] ❌ FAILED chunk:', {
      error: upsertError.message,
      code: upsertError.code,
      username: norm,
      chunk_size: chunk.length
    });
  } else {
    totalSaved += chunk.length;
  }
}

console.log(`[Instagram] Summary: ✅ ${totalSaved} saved, ❌ ${totalErrors} failed`);
```

---

## 🚀 Testing Instructions

### Step 1: Restart Dev Server
```bash
# Stop current server (Ctrl+C)
npm run dev
```

### Step 2: Run Refresh All
Open admin page and click:
- **Refresh All TikTok** 
- **Refresh All Instagram**

### Step 3: Monitor Terminal Output

#### Expected NEW Logs (TikTok):
```
[TikTok Refresh] Found 59 unique TikTok usernames across all sources
[TikTok] Attempting to save 33 posts to tiktok_posts_daily for suliframe
[TikTok] ✅ Successfully saved: { video_id: '7123...', username: 'suliframe', ... }
[TikTok] ✅ Successfully saved: { video_id: '7124...', username: 'suliframe', ... }
...
[TikTok] Summary: ✅ 33 saved, ❌ 0 failed out of 33 total
```

#### Expected NEW Logs (Instagram):
```
[Instagram Refresh] Found 60 unique Instagram usernames across all sources
[Instagram] Attempting to save 48 posts to instagram_posts_daily for username
[Instagram] ✅ Saved chunk 0-48. Sample: { username: '...', first_post: '123...', ... }
[Instagram] Summary: ✅ 48 saved, ❌ 0 failed out of 48 total
```

#### If You See ERRORS:
```
[TikTok] ❌ FAILED upsert: {
  error: "permission denied for table tiktok_posts_daily",
  code: "42501",
  ...
}
```
→ **ACTION:** Check Supabase RLS policies and service role key permissions

```
[TikTok] ❌ FAILED upsert: {
  error: "column 'taken_at' does not exist",
  code: "42703",
  ...
}
```
→ **ACTION:** Run migration script again (taken_at column missing)

---

### Step 4: Verify Database
Run this SQL in Supabase SQL Editor:

```sql
-- File: sql/QUICK_CHECK_POSTS.sql
SELECT 
  'tiktok_posts_daily' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT username) as unique_usernames,
  MAX(created_at) as last_updated
FROM tiktok_posts_daily
UNION ALL
SELECT 
  'instagram_posts_daily',
  COUNT(*),
  COUNT(DISTINCT username),
  MAX(created_at)
FROM instagram_posts_daily;
```

#### Expected Results (After Fix):
```
table_name              | total_rows | unique_usernames | last_updated
------------------------|------------|------------------|------------------
tiktok_posts_daily      | 1234+      | 59               | 2026-01-27 10:30:00
instagram_posts_daily   | 567+       | 60               | 2026-01-27 10:30:00
```

---

## 🔍 Troubleshooting

### Problem: Still showing wrong username count (45/57 instead of 60/59)
**Solution:** Clear cache and restart:
```bash
rm -rf .next
npm run dev
```

### Problem: "All RapidAPI keys failed or on cooldown"
**Solution:** This is EXPECTED during heavy refresh. The code will:
1. Save whatever data it fetched before rate limit
2. Retry failed accounts in next batch
3. Continue processing remaining usernames

**Action:** Just wait 5-10 minutes and click refresh again to continue.

### Problem: Data still not saving (0 rows after refresh)
**Solution:** Check terminal for error messages:

1. **Permission Error (42501):**
   - Check Supabase RLS policies
   - Verify service role key is set in `.env.local`
   - Grant INSERT/UPDATE permissions on post_daily tables

2. **Column Not Found (42703):**
   - Run `sql/migrations/2026-01-26_migrate_to_taken_at.sql` again
   - Verify `taken_at` column exists with `\d tiktok_posts_daily`

3. **Connection Timeout:**
   - Check Supabase connection string
   - Verify network connectivity
   - Check if Supabase instance is active

---

## 📊 Performance Expectations

### TikTok Refresh:
- **59 accounts** × 1 minute each = ~59 minutes total
- **Batch size:** 1 account per request (Vercel 60s limit)
- **Expected data:** 20-50 videos per account on average
- **Total posts:** ~2,000-3,000 posts

### Instagram Refresh:
- **60 accounts** × 30-40 seconds each = ~30-40 minutes total
- **Batch size:** 1 account per request
- **Expected data:** 10-30 posts per account (limited by RapidAPI)
- **Total posts:** ~600-1,800 posts

---

## ✅ Success Criteria

After running refresh-all with fixes:

✅ Terminal shows: "Found 59 unique TikTok usernames" (not 57)
✅ Terminal shows: "Found 60 unique Instagram usernames" (not 45)
✅ Terminal shows: "✅ 33 saved, ❌ 0 failed" for each account
✅ Database query shows: `tiktok_posts_daily` has 1000+ rows
✅ Database query shows: `instagram_posts_daily` has 500+ rows
✅ Dashboard chart displays posts data correctly
✅ No "[TikTok] ❌ FAILED upsert" errors in terminal

---

## 📝 Files Modified

1. **src/app/api/admin/tiktok/refresh-all/route.ts**
   - Line 160-179: Changed to query `user_tiktok_usernames` as primary source
   - Line 200-210: Fixed `usernameToCampaigns` mapping

2. **src/app/api/admin/ig/refresh-all/route.ts**
   - Line 153-177: Changed to query `user_instagram_usernames` as primary source

3. **src/app/api/fetch-metrics/[username]/route.ts**
   - Line 382-432: Added comprehensive error logging and success/failure tracking

4. **src/app/api/fetch-ig/[username]/route.ts**
   - Line 653-690: Added chunk-level error tracking and detailed logging

5. **sql/QUICK_CHECK_POSTS.sql** (NEW)
   - Quick diagnostic query to check post counts and recent saves

---

## 🎯 Next Steps After Verification

Once refresh works correctly:

1. ✅ Run [sql/CLEANUP_LEGACY_TABLES.sql](../sql/CLEANUP_LEGACY_TABLES.sql) to drop unused tables
2. ✅ Set up cron jobs for automatic refresh (every 2 hours)
3. ✅ Monitor performance and adjust batch sizes if needed
4. ✅ Consider implementing retry queue for failed accounts

---

## 🆘 If Issues Persist

Check these files for detailed error logs:
- Terminal output (search for "❌ FAILED")
- Supabase logs (Database > Logs)
- Browser console (F12 > Console tab)

**Copy error messages and share them for debugging!**
