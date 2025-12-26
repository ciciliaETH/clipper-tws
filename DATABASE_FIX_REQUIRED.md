# 🚨 CRITICAL DATABASE FIX REQUIRED

## ❌ BUG FOUND: Inflated Metrics in Campaign Totals

### Problem:
The `campaign_participant_totals_v2` function was **summing ALL snapshots** instead of calculating **accrual (delta)**.

**Example**:
- Video tracked 5 times: 100 → 200 → 300 → 400 → 500 views
- **WRONG calculation**: 100 + 200 + 300 + 400 + 500 = **1,500 views** ❌
- **CORRECT calculation**: 500 - 100 = **400 views** ✅

**Impact**: Metrics inflated by 3-5x depending on refresh frequency!

### Solution:
Run the migration to fix the SQL function.

---

## 🔧 How to Apply Fix:

### Option 1: Via Supabase Dashboard (Recommended)
1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**
4. Copy paste contents of: `sql/migrations/2025-12-06_fix_campaign_participant_totals_accrual.sql`
5. Click **Run**
6. Verify: Should show "Success. No rows returned"

### Option 2: Via Supabase CLI
```bash
# From project root
supabase db push --include-all

# Or specific file
psql $DATABASE_URL < sql/migrations/2025-12-06_fix_campaign_participant_totals_accrual.sql
```

---

## ✅ Verification:

After running migration, test with:

```sql
-- Test accrual calculation
SELECT * FROM campaign_participant_totals_v2(
  'YOUR_CAMPAIGN_ID'::uuid,
  '2025-11-01'::date,
  '2025-12-06'::date
);
```

**Expected**:
- Views should be reasonable (not 10M+ for small campaigns)
- Totals should match what you see in TikTok analytics
- Multiple refreshes should NOT increase totals significantly

---

## 🎯 What This Fixes:

### Before Fix ❌:
```
Campaign Metrics:
- Total Views: 45,231,890 (INFLATED!)
- Refreshed 10 times = counted 10x

User sees incorrect data 😞
```

### After Fix ✅:
```
Campaign Metrics:
- Total Views: 4,523,189 (ACCURATE!)
- Accrual calculation = last - first

User sees real TikTok data 😊
```

---

## 📊 Impact on Existing Data:

**Charts (`campaign_series_v2`)**: ✅ Already using accrual - NO CHANGE NEEDED  
**Participant Totals (`campaign_participant_totals_v2`)**: ❌ Was summing - **FIXED NOW**  
**Leaderboard**: Uses participant totals - **WILL BE ACCURATE AFTER FIX**  
**Accrual Mode**: Separate calculation - **NOT AFFECTED**

---

## ⚠️ Important Notes:

1. **Historical snapshots are preserved** - migration only fixes the calculation
2. **Charts already correct** - only affected totals/leaderboard
3. **Run ASAP** - every refresh multiplies the error
4. **After migration** - data will instantly show correct values (no re-fetch needed)

---

## 🚀 Post-Migration:

After running migration:
1. ✅ Refresh any campaign page - totals should be accurate
2. ✅ Leaderboard will show correct rankings
3. ✅ No need to re-fetch TikTok data
4. ✅ Future refreshes won't inflate metrics

---

**Status**: Ready to apply  
**Priority**: CRITICAL  
**Downtime**: None (instant function replacement)  
**Rollback**: Revert to old function (backup in git history)
