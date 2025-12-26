# 🚀 UNLIMITED SYNC IMPLEMENTATION

## Status: Ready to Implement

Sistem baru untuk **sinkronisasi unlimited** semua data TikTok & Instagram dari awal.

---

## 🎯 OBJECTIVE

1. **Ambil SEMUA data historis** - Video dari bulan Agustus yang viral sekarang tetap tercatat
2. **No Limits** - Bypass semua batasan page/cursor
3. **Priority: Aggregator API** - Gratis, unlimited, reliable
4. **Fallback: RapidAPI** - Jika aggregator gagal
5. **Auto-tracking 7/28/90 hari** - Growth metrics accurate

---

## 📊 CURRENT vs NEW SYSTEM

### Current System ❌
```
- Limited to 6 pages per refresh (~600 videos max)
- RapidAPI primary (costly, rate limited)
- Missing old viral videos
- Inaccurate 90-day metrics
```

### New System ✅
```
- UNLIMITED pages (fetch all history)
- Aggregator API primary (free, no limits)
- Captures ALL videos from account creation
- Accurate 7/28/90 day rolling windows
```

---

## 🏗️ ARCHITECTURE

### Fetch Priority Flow
```
┌──────────────────────────────────────┐
│  1. TRY AGGREGATOR API (UNLIMITED)   │
│     - Free API: 202.10.44.90         │
│     - 90-day windows                 │
│     - 999 pages max per window       │
│     - 1000 videos per page           │
└──────────┬───────────────────────────┘
           │
           ↓ If fails/empty
┌──────────────────────────────────────┐
│  2. FALLBACK: RAPIDAPI               │
│     - tiktok-scraper7                │
│     - Cursor-based unlimited         │
│     - Premium key priority           │
└──────────────────────────────────────┘
```

### 90-Day Window Strategy
```
Timeline:  [2016-01-01] ←───────────────→ [NOW]
           
Window 1:  [NOW-90d] ────→ [NOW]
Window 2:  [NOW-180d] ───→ [NOW-90d]
Window 3:  [NOW-270d] ───→ [NOW-180d]
...
Window N:  [2016-01-01] ─→ [...]

Result: Complete historical coverage, no gaps
```

---

## 🔧 IMPLEMENTATION STEPS

### Step 1: Update Environment Variables

Add to `.env.local`:
```env
# ========================================
# AGGREGATOR API (Priority #1)
# ========================================
AGGREGATOR_API_BASE=http://202.10.44.90/api/v1
AGGREGATOR_ENABLED=1              # Enable aggregator
AGGREGATOR_UNLIMITED=1            # No limits
AGGREGATOR_MAX_PAGES=999          # High limit per window
AGGREGATOR_PER_PAGE=1000          # Max videos per request
AGGREGATOR_RATE_MS=500            # Rate limit (ms)

# ========================================
# RAPIDAPI (Fallback #2)
# ========================================
RAPIDAPI_KEY=your_premium_key
RAPIDAPI_TIKTOK_HOST=tiktok-scraper7.p.rapidapi.com
RAPIDAPI_USE_CURSOR=1             # Cursor mode
RAPIDAPI_MAX_ITER=999             # Unlimited iterations
RAPIDAPI_RATE_LIMIT_MS=350
RAPIDAPI_FALLBACK_ON_429=1        # Auto-retry on rate limit
```

### Step 2: Update Fetch Logic

File: `src/app/api/fetch-metrics/[username]/route.ts`

**Key Changes:**
1. Add `fetchFromAggregator()` function for unlimited historical fetch
2. Implement 90-day window pagination
3. Priority: Aggregator → RapidAPI
4. Remove all page limits (default to unlimited)

### Step 3: Update Cron Job

File: `src/app/api/cron/sync-tiktok/route.ts`

**Changes:**
1. Add `?all=1` parameter for unlimited sync
2. Remove user count limits
3. Parallel processing for all employees
4. Smart scheduling (daily full sync)

### Step 4: Update Admin Controls

File: `src/app/dashboard/admin/page.tsx`

**Add:**
- "Full Historical Sync" button
- Progress indicator for unlimited sync
- Date range selector (default: ALL)
- Source indicator (Aggregator/RapidAPI)

---

## 📝 NEW API PARAMETERS

### GET /api/fetch-metrics/[username]

```typescript
// UNLIMITED MODE (default)
GET /api/fetch-metrics/tradewithsuli

// With date range (still unlimited within range)
GET /api/fetch-metrics/tradewithsuli?start=2024-01-01&end=2024-12-31

// Force RapidAPI (skip aggregator)
GET /api/fetch-metrics/tradewithsuli?rapid=1

// Force page limit (for testing)
GET /api/fetch-metrics/tradewithsuli?all=0&pages=10
```

### Cron Sync

```bash
# Full unlimited sync for all users
GET /api/cron/sync-tiktok?mode=unlimited

# With Authorization
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-app.vercel.app/api/cron/sync-tiktok?mode=unlimited"
```

---

## 🎮 USAGE EXAMPLES

### Scenario 1: Video Viral Belakangan
```
Video posted: August 2024
Goes viral: December 2024

OLD SYSTEM: ❌ Missed (only fetched last 6 pages)
NEW SYSTEM: ✅ Captured (fetches ALL history)
```

### Scenario 2: Growth Metrics
```
Query: "7-day growth for @tradewithsuli"

OLD: ❌ Incomplete (missing old videos gaining views)
NEW: ✅ Accurate (delta dari social_metrics_history)
```

### Scenario 3: Campaign Analytics
```
Campaign: November 1-30, 2024

OLD: ❌ Partial data (limited fetch)
NEW: ✅ Complete data (ALL videos in Nov + recent views)
```

---

## ⚡ PERFORMANCE OPTIMIZATION

### Aggregator API Benefits
- **Speed**: ~500ms per request
- **Cost**: FREE (no API costs)
- **Limits**: NONE (unlimited requests)
- **Reliability**: Direct server access

### Smart Caching
```typescript
// Cache strategy for repeated fetches
- Cache TTL: 1 hour for historical data
- Cache key: username + date_range
- Skip cache for ?force=1 parameter
```

### Batch Processing
```typescript
// Process multiple users in parallel
const concurrency = 5; // Process 5 users at once
const batchSize = 20;  // 20 users per batch

// Estimate: 100 users × 2 min = ~40 min total
```

---

## 📈 EXPECTED RESULTS

### Before Implementation
```
Average videos per user: ~500
Historical coverage: Last 3 months
Sync time per user: 30 seconds
Missing viral videos: 15-20%
```

### After Implementation
```
Average videos per user: ~5,000+
Historical coverage: Since account creation
Sync time per user: 2-3 minutes (first time)
Missing viral videos: <1%
Incremental syncs: 30 seconds (same as before)
```

---

## 🔍 MONITORING & DEBUGGING

### Success Metrics
```typescript
{
  source: 'aggregator',
  totalVideos: 4582,
  totalPages: 47,
  windows: 3,
  success: true,
  duration_ms: 142500
}
```

### Failure Handling
```typescript
{
  source: 'rapidapi',  // Fallback activated
  aggregatorError: 'Connection timeout',
  totalVideos: 4580,   // Nearly same as aggregator
  success: true
}
```

### Logs
```bash
[Aggregator] Starting unlimited fetch for @tradewithsuli
[Aggregator] Window: 2024-09-08 to 2024-12-08
[Aggregator] Page 1: +1000 videos (window total: 1000)
[Aggregator] Page 2: +1000 videos (window total: 2000)
...
[Aggregator] Completed: 4582 unique videos from 47 pages
```

---

## 🚨 ROLLBACK PLAN

If issues occur:

### Quick Rollback
```env
# Disable aggregator, use old system
AGGREGATOR_ENABLED=0
RAPIDAPI_USE_CURSOR=0
```

### Gradual Rollback
```env
# Keep aggregator but limit
AGGREGATOR_MAX_PAGES=10
AGGREGATOR_UNLIMITED=0
```

---

## ✅ TESTING CHECKLIST

- [ ] Test aggregator API connection
- [ ] Verify 90-day window logic
- [ ] Test RapidAPI fallback
- [ ] Validate deduplication (no duplicate videos)
- [ ] Check date filtering accuracy
- [ ] Monitor memory usage (large datasets)
- [ ] Test error handling (timeout, network fail)
- [ ] Verify database upsert performance
- [ ] Test parallel user processing
- [ ] Validate metrics calculations (7/28/90 day)

---

## 📞 NEXT STEPS

1. **Review this implementation plan**
2. **Approve environment variables**
3. **I'll implement the code changes**
4. **Test on staging/development**
5. **Deploy to production**
6. **Monitor first full sync**

---

## 🎯 TIMELINE

- **Implementation**: 1-2 hours
- **Testing**: 1 hour
- **First full sync**: 2-4 hours (all users)
- **Daily incremental syncs**: Same as current (30 sec/user)

**Ready to proceed?** 🚀
