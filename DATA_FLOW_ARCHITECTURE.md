# Data Flow Architecture

## Prinsip Utama
**SEMUA METRICS HANYA DARI DATABASE**
- `tiktok_posts_daily` - Source of truth untuk TikTok
- `instagram_posts_daily` - Source of truth untuk Instagram

**Kalau kedua tabel kosong = SEMUA metrics kosong**

## Endpoint Classification

### 📊 READ-ONLY ENDPOINTS (Database Only)
Endpoints ini **HANYA QUERY DATABASE**, tidak fetch external API:

| Endpoint | Table Source | Behavior kalau DB kosong |
|----------|-------------|-------------------------|
| `/api/leaderboard` | tiktok_posts_daily + instagram_posts_daily | Return 0 metrics, empty array |
| `/api/leaderboard/top-videos` | tiktok_posts_daily + instagram_posts_daily | Return empty videos array |
| `/api/employee/profile` | employee_total_metrics (materialized view) | Return 0 total metrics |
| `/api/get-metrics` | tiktok_posts_daily | Return 0 metrics |
| `/api/posts-series` | tiktok_posts_daily + instagram_posts_daily | Return empty date series |
| `/api/groups/[id]/members` | tiktok_posts_daily + instagram_posts_daily | Return 0 metrics per member |
| `/api/groups/series` | tiktok_posts_daily + instagram_posts_daily | Return empty series data |
| `/api/analytics/series` | tiktok_posts_daily + instagram_posts_daily | Return empty analytics |
| `/api/campaigns/[id]/accrual` | tiktok_posts_daily + instagram_posts_daily | Return 0 accrual metrics |

**Verifikasi:**
```sql
-- Check TikTok data
SELECT COUNT(*) FROM tiktok_posts_daily; -- Jika 0 = semua TikTok metrics kosong

-- Check Instagram data  
SELECT COUNT(*) FROM instagram_posts_daily; -- Jika 0 = semua Instagram metrics kosong
```

### 🔄 REFRESH ENDPOINTS (Fetch External → Update DB)
Endpoints ini **FETCH DARI EXTERNAL API** kemudian **INSERT/UPDATE DATABASE**:

| Endpoint | Purpose | External Source | Database Write |
|----------|---------|----------------|----------------|
| `/api/fetch-metrics/[username]` | Refresh TikTok data | RapidAPI + Aggregator | tiktok_posts_daily |
| `/api/fetch-ig/[username]` | Refresh Instagram data | RapidAPI (3 providers) | instagram_posts_daily |
| `/api/admin/tiktok/refresh-all` | Batch TikTok refresh | Aggregator only | tiktok_posts_daily |
| `/api/admin/ig/refresh-all` | Batch Instagram refresh | RapidAPI | instagram_posts_daily |
| `/api/campaigns/[id]/refresh` | Campaign refresh | Via fetch-metrics | tiktok_posts_daily + snapshots |
| `/api/groups/[id]/refresh` | Group refresh | Via fetch-metrics | tiktok_posts_daily |

**Flow:**
```
User → Refresh Endpoint → External API → Parse Data → Database (tiktok_posts_daily/instagram_posts_daily) → Read Endpoints → Display
```

**Jika refresh belum pernah dijalankan:**
- Database kosong
- All metrics = 0
- UI shows "No data available"

## Data Validation

### Ensure Database is Populated
```sql
-- TikTok sample check
SELECT 
  username,
  COUNT(*) as post_count,
  MAX(taken_at) as last_updated
FROM tiktok_posts_daily
GROUP BY username
ORDER BY last_updated DESC
LIMIT 10;

-- Instagram sample check
SELECT 
  username,
  COUNT(*) as post_count,
  MAX(taken_at) as last_updated
FROM instagram_posts_daily
GROUP BY username
ORDER BY last_updated DESC
LIMIT 10;
```

### Materialized View Refresh
```sql
-- Employee total metrics (aggregation dari daily tables)
REFRESH MATERIALIZED VIEW employee_total_metrics;

-- Verify
SELECT 
  full_name,
  total_tiktok_views,
  total_instagram_views,
  total_views
FROM employee_total_metrics
ORDER BY total_views DESC
LIMIT 10;
```

## Best Practices

### ✅ CORRECT: Read dari database
```typescript
// Leaderboard aggregation - 100% dari DB
const { data: ttPosts } = await supabase
  .from('tiktok_posts_daily')
  .select('play_count, digg_count, comment_count')
  .in('username', usernames)
  .gte('taken_at', start + 'T00:00:00Z')
  .lte('taken_at', end + 'T23:59:59Z');
```

### ❌ WRONG: Fetch langsung dari external
```typescript
// DON'T DO THIS in read endpoints
const response = await fetch('https://rapidapi.com/...');
const metrics = await response.json();
```

### ⚠️ EXCEPTION: Refresh endpoints boleh fetch external
```typescript
// fetch-metrics endpoint - OK untuk fetch external
const data = await rapidApiRequest({...}); // ✓ OK
await supabase.from('tiktok_posts_daily').upsert(data); // Then save to DB
```

## Deployment Checklist

- [ ] Run initial refresh for all users: `POST /api/admin/tiktok/refresh-all`
- [ ] Run initial refresh for Instagram: `POST /api/admin/ig/refresh-all`
- [ ] Verify tiktok_posts_daily has data: `SELECT COUNT(*) FROM tiktok_posts_daily;`
- [ ] Verify instagram_posts_daily has data: `SELECT COUNT(*) FROM instagram_posts_daily;`
- [ ] Refresh materialized view: `REFRESH MATERIALIZED VIEW employee_total_metrics;`
- [ ] Setup cron for periodic refresh (recommended: every 2 hours)
- [ ] Test read endpoints return non-zero metrics

## Monitoring

### Empty Database Alert
```sql
-- Alert if database empty (no recent data)
SELECT 
  'TikTok' as platform,
  COUNT(*) as total_posts,
  MAX(taken_at) as last_post,
  CASE 
    WHEN MAX(taken_at) < NOW() - INTERVAL '24 hours' THEN '⚠️ STALE DATA'
    WHEN COUNT(*) = 0 THEN '❌ NO DATA'
    ELSE '✅ OK'
  END as status
FROM tiktok_posts_daily

UNION ALL

SELECT 
  'Instagram' as platform,
  COUNT(*) as total_posts,
  MAX(taken_at) as last_post,
  CASE 
    WHEN MAX(taken_at) < NOW() - INTERVAL '24 hours' THEN '⚠️ STALE DATA'
    WHEN COUNT(*) = 0 THEN '❌ NO DATA'
    ELSE '✅ OK'
  END as status
FROM instagram_posts_daily;
```

### Expected Result:
```
platform  | total_posts | last_post           | status
----------|-------------|---------------------|--------
TikTok    | 15,234      | 2026-01-27 10:30:00 | ✅ OK
Instagram | 8,456       | 2026-01-27 09:15:00 | ✅ OK
```

## Summary

✅ **ALL READ ENDPOINTS = DATABASE ONLY**
- Kalau `tiktok_posts_daily` kosong → TikTok metrics = 0
- Kalau `instagram_posts_daily` kosong → Instagram metrics = 0
- Tidak ada fallback ke external API di read endpoints

⚠️ **REFRESH ENDPOINTS = EXTERNAL API → DATABASE**
- Harus dijalankan dulu untuk populate database
- Recommended: Setup cron job untuk auto-refresh

🔍 **VERIFICATION**
- Cek row count di kedua tabel
- Cek timestamp terakhir (should be recent)
- Test read endpoints return data setelah refresh
