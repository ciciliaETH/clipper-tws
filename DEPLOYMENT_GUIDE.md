# 🚀 Production Deployment Guide - Unlimited Sync System

## Pre-Deployment Checklist

### 1. Environment Variables Setup
Copy `.env.example` to `.env.local` dan isi semua values:

```bash
# Priority: Aggregator API (Free, Unlimited)
AGGREGATOR_API_BASE=http://202.10.44.90/api/v1
AGGREGATOR_ENABLED=1
AGGREGATOR_UNLIMITED=1
AGGREGATOR_MAX_PAGES=999
AGGREGATOR_PER_PAGE=1000
AGGREGATOR_RATE_MS=500

# Fallback: RapidAPI (Paid, Limited)
RAPID_API_KEYS=key1,key2,key3  # Multiple keys untuk rotation
RAPIDAPI_USE_CURSOR=1
RAPIDAPI_MAX_ITER=999
RAPIDAPI_RATE_LIMIT_MS=350
RAPIDAPI_PROVIDER=fast

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Cron Secret
CRON_SECRET=your_random_secure_token_here
```

### 2. Aggregator API Testing

**CRITICAL: Test Aggregator API sebelum deploy!**

```bash
# Test basic connectivity
curl "http://202.10.44.90/api/v1/user/posts?unique_id=USERNAME&count=100"

# Expected response:
{
  "code": 0,
  "msg": "success",
  "data": {
    "videos": [ ... ],
    "cursor": 1234567890000,
    "hasMore": true
  }
}
```

**If Aggregator fails:**
- System auto-fallback ke RapidAPI
- No manual intervention needed
- Check logs: `[Aggregator Fetch] ✗ Error:` untuk debugging

### 3. Database Migrations

Run all migrations di Supabase SQL Editor (order penting!):

```bash
sql/migrations/2025-10-23_campaign_metrics_fn.sql
sql/migrations/2025-10-23_campaigns.sql
sql/migrations/2025-10-24_campaign_participants_metrics.sql
sql/migrations/2025-11-24_instagram_posts_daily.sql
sql/migrations/2025-12-04_add_title_caption_columns.sql
# ... dan seterusnya (lihat sql/migrations/ directory)
```

**Verify tables exist:**
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('tiktok_posts_daily', 'social_metrics_history', 'users');
```

### 4. Cron Jobs Setup (Supabase)

Enable pg_cron extension di Supabase:

```sql
-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- TikTok sync every 2 hours (unlimited mode)
SELECT cron.schedule(
  'sync-tiktok-unlimited',
  '0 */2 * * *',  -- Every 2 hours
  $$
  SELECT net.http_post(
    url := 'https://your-domain.vercel.app/api/cron/sync-tiktok',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object('mode', 'unlimited')
  )
  $$
);

-- Instagram sync every 4 hours
SELECT cron.schedule(
  'sync-instagram',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-domain.vercel.app/api/cron/sync-instagram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    )
  )
  $$
);
```

**View active cron jobs:**
```sql
SELECT * FROM cron.job;
```

---

## Deployment Steps

### Option 1: Vercel (Recommended)

1. **Install Vercel CLI**
```bash
npm install -g vercel
```

2. **Login**
```bash
vercel login
```

3. **Deploy**
```bash
vercel --prod
```

4. **Set Environment Variables** (via Vercel Dashboard)
   - Go to: Project Settings → Environment Variables
   - Add semua variables dari `.env.example`
   - Mark sebagai "Production" environment

5. **Configure Vercel Settings**
```json
// vercel.json
{
  "functions": {
    "src/app/api/fetch-metrics/[username]/route.ts": {
      "maxDuration": 300
    },
    "src/app/api/cron/sync-tiktok/route.ts": {
      "maxDuration": 300
    }
  }
}
```

### Option 2: Docker

1. **Create Dockerfile**
```dockerfile
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

2. **Build & Run**
```bash
docker build -t clipper-dashboard .
docker run -p 3000:3000 --env-file .env.local clipper-dashboard
```

---

## Post-Deployment Verification

### 1. Test Unlimited Sync

**Test Aggregator API:**
```bash
# Should fetch ALL videos (unlimited mode)
curl "https://your-domain.vercel.app/api/fetch-metrics/USERNAME"

# Expected response:
{
  "success": true,
  "fetchSource": "aggregator",
  "totalVideos": 1547,  # Could be thousands!
  "telemetry": {
    "source": "aggregator",
    "windowsProcessed": 8,
    "oldestVideoDate": "2016-03-15"
  }
}
```

**Test RapidAPI Fallback:**
```bash
# Force RapidAPI
curl "https://your-domain.vercel.app/api/fetch-metrics/USERNAME?rapid=1"

# Should return:
{
  "fetchSource": "rapidapi",
  "totalVideos": 999,
  "telemetry": { "source": "rapidapi" }
}
```

### 2. Monitor Logs

**Check Vercel Function Logs:**
```
[Aggregator Fetch] 🎯 Fetching: @username
[Aggregator Fetch] 📅 Window 1/8: 2024-12-01 to 2024-09-02
[Aggregator Fetch] ✓ Page 1: +100 videos (cursor: 1234567890000)
[Aggregator Fetch] ✓ Page 2: +100 videos (cursor: 1234567890001)
[Aggregator Fetch] ✓ Window 1 complete: 547 videos
[Aggregator Fetch] 📅 Window 2/8: 2024-09-02 to 2024-06-04
...
[Aggregator Fetch] ✅ Completed: 1547 total videos, 8 windows
[TikTok Fetch] Final result: 1547 videos from aggregator
```

**Error Patterns to Watch:**
```
[Aggregator Fetch] ✗ Error: Network timeout
→ Auto-fallback to RapidAPI

[TikTok Fetch] RapidAPI error: Rate limit exceeded
→ Key rotation should handle this

[Database] ✗ Insert failed: duplicate key
→ Normal for deduplication
```

### 3. Performance Metrics

**Expected Performance:**
- **Aggregator API**: 500-1000 videos per minute
- **RapidAPI**: 200-400 videos per minute
- **Cron Job Duration**: 5-15 minutes untuk 50 users
- **Database Insert Rate**: 100-200 videos/second

**Monitor Vercel Dashboard:**
- Function Duration: Should stay under 300s limit
- Invocations: Track cron job executions
- Errors: Should be <1% error rate

---

## Rollback Plan

### If Unlimited Sync Fails

**Quick Rollback to Legacy Mode:**

1. **Disable Aggregator** (via environment variable)
```bash
# Vercel Dashboard → Environment Variables
AGGREGATOR_ENABLED=0
```

2. **Revert to Limited Mode**
```bash
AGGREGATOR_UNLIMITED=0
RAPIDAPI_MAX_ITER=400  # Back to legacy limit
```

3. **Redeploy**
```bash
vercel --prod
```

**System will automatically:**
- Skip Aggregator API
- Use RapidAPI with 6-page limit (legacy behavior)
- All existing data remains intact

### Emergency Hotfix

**If production is broken:**

1. **Rollback to previous deployment**
```bash
vercel rollback
```

2. **Check previous deployment hash**
```bash
vercel ls
vercel rollback <deployment-url>
```

---

## Monitoring & Maintenance

### Daily Checks

**1. Cron Job Status**
```sql
-- Check last sync timestamps
SELECT 
  platform,
  username,
  MAX(created_at) as last_sync,
  COUNT(*) as total_videos
FROM social_metrics_history
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY platform, username
ORDER BY last_sync DESC;
```

**2. API Success Rate**
```sql
-- Monitor fetch sources (if you add telemetry table)
SELECT 
  fetch_source,
  COUNT(*) as total_fetches,
  AVG(total_videos) as avg_videos,
  COUNT(CASE WHEN success = true THEN 1 END) as successful
FROM fetch_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY fetch_source;
```

### Weekly Maintenance

**1. Check for Stale Data**
```sql
-- Users not synced in 7+ days
SELECT 
  u.username,
  u.platform,
  MAX(sm.created_at) as last_sync
FROM users u
LEFT JOIN social_metrics_history sm ON u.username = sm.username
GROUP BY u.username, u.platform
HAVING MAX(sm.created_at) < NOW() - INTERVAL '7 days'
OR MAX(sm.created_at) IS NULL;
```

**2. Database Cleanup**
```sql
-- Remove duplicate entries (if any)
DELETE FROM tiktok_posts_daily a
USING tiktok_posts_daily b
WHERE a.id > b.id 
AND a.video_id = b.video_id 
AND a.snapshot_date = b.snapshot_date;
```

---

## Troubleshooting

### Issue: "Aggregator API returning empty data"

**Debug Steps:**
1. Test endpoint directly:
```bash
curl "http://202.10.44.90/api/v1/user/posts?unique_id=USERNAME&count=100"
```

2. Check logs for specific error:
```
[Aggregator Fetch] ✗ Error: {"code": 10404, "msg": "user not found"}
```

3. **Solution:** System auto-fallback ke RapidAPI, no action needed.

### Issue: "Function timeout (300s exceeded)"

**Causes:**
- Too many users in single cron job
- Slow API response
- Database insert bottleneck

**Solutions:**
1. Batch users into smaller groups:
```typescript
// Split users into chunks of 10
const userChunks = chunkArray(users, 10);
for (const chunk of userChunks) {
  await Promise.all(chunk.map(user => fetchMetrics(user)));
}
```

2. Increase function timeout (Vercel Pro):
```json
{
  "functions": {
    "src/app/api/cron/sync-tiktok/route.ts": {
      "maxDuration": 600  // 10 minutes
    }
  }
}
```

### Issue: "RapidAPI rate limit errors"

**Solutions:**
1. Add more API keys to rotation:
```bash
RAPID_API_KEYS=key1,key2,key3,key4,key5
```

2. Increase rate limit delay:
```bash
RAPIDAPI_RATE_LIMIT_MS=500  # Slower but safer
```

3. Enable Aggregator to reduce RapidAPI usage:
```bash
AGGREGATOR_ENABLED=1  # Priority first
```

---

## Security Checklist

- [ ] CRON_SECRET is strong random token (min 32 chars)
- [ ] Supabase RLS policies enabled
- [ ] RAPID_API_KEYS not exposed in frontend
- [ ] SUPABASE_SERVICE_ROLE_KEY only used in server-side code
- [ ] Environment variables set in production (not committed to git)
- [ ] Rate limiting enabled untuk public endpoints
- [ ] CORS configured properly

---

## Success Metrics

### After 1 Week
- ✅ All historical videos synced (check oldest video dates)
- ✅ Cron jobs running without errors
- ✅ 0% function timeout rate
- ✅ 95%+ Aggregator API success rate
- ✅ Database size increase tracked (expected: 10x for historical data)

### After 1 Month
- ✅ Accurate 7/28/90 day growth metrics
- ✅ Viral video detection working (old videos getting new views)
- ✅ <5% RapidAPI usage (most traffic on free Aggregator)
- ✅ User feedback positive (complete data visibility)

---

## Support & Debugging

**Enable Debug Mode:**
```bash
# Add to environment variables
DEBUG_MODE=1
VERBOSE_LOGGING=1
```

**Check Logs:**
```bash
# Vercel CLI
vercel logs --follow

# Filter errors only
vercel logs --follow | grep "Error"
```

**Contact Information:**
- Technical Issues: [Your Email/Slack]
- Database Issues: Supabase Support
- API Issues: Aggregator API Admin / RapidAPI Dashboard

---

## Backup & Recovery

**Automatic Backups:**
- Supabase: Daily automated backups (retention: 7 days on free tier)
- Manual backup:
```bash
# Export database
pg_dump -h db.your-project.supabase.co -U postgres -d postgres > backup.sql
```

**Recovery:**
```bash
# Restore from backup
psql -h db.your-project.supabase.co -U postgres -d postgres < backup.sql
```

---

**🎉 Deployment Complete! Monitor logs untuk 24 jam pertama untuk ensure stability.**
