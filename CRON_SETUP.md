# ⏰ Cron Jobs Setup (Supabase pg_cron - GRATIS)

Karena Vercel Free Plan **TIDAK support cron jobs**, kita gunakan **Supabase pg_cron** yang GRATIS.

## 🔧 Setup Steps

### 1. Buat CRON_SECRET

Generate random secret untuk protect cron endpoints:

```bash
# Contoh:
cron_secret_2025_instagram_tiktok_xyz123abc
```

Simpan di `.env` dan Vercel Environment Variables:
```
CRON_SECRET=cron_secret_2025_instagram_tiktok_xyz123abc
```

### 2. Setup Instagram Cron (Setiap 4 jam)

1. Buka **Supabase Dashboard** → SQL Editor
2. Copy script dibawah, replace placeholders:

```sql
-- Instagram Refresh Cron (Setiap 4 jam)
select cron.unschedule('instagram_refresh_every_4h');

select cron.schedule(
  'instagram_refresh_every_4h',
  '0 */4 * * *',
  $$do $job$
  declare
    r bigint;
    base text := 'https://clippertws.vercel.app';
    endpoint text := base || '/api/cron/instagram-refresh?limit=200&concurrency=6';
    secret text := 'cron_secret_2025_instagram_tiktok_xyz123abc'; -- GANTI INI
  begin
    select net.http_get(
      url := endpoint,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || secret,
        'Accept','application/json'
      ),
      timeout_milliseconds := 300000
    ) into r;

    perform (select to_jsonb(x) from (select * from net.http_collect_response(r)) x);
  end
  $job$;$$
);

-- Verify
select jobid, jobname, schedule, active from cron.job where jobname='instagram_refresh_every_4h';
```

3. Run SQL script
4. Cek status: `select * from cron.job_run_details order by start_time desc limit 5;`

### 3. Setup TikTok Cron (Setiap 4 jam)

```sql
-- TikTok Refresh Cron (Setiap 4 jam)
select cron.unschedule('tiktok_refresh_every_4h');

select cron.schedule(
  'tiktok_refresh_every_4h',
  '0 */4 * * *',
  $$do $job$
  declare
    r bigint;
    base text := 'https://clippertws.vercel.app';
    endpoint text := base || '/api/cron/tiktok-refresh?concurrency=3';
    secret text := 'cron_secret_2025_instagram_tiktok_xyz123abc'; -- GANTI INI
  begin
    select net.http_get(
      url := endpoint,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || secret,
        'Accept','application/json'
      ),
      timeout_milliseconds := 300000
    ) into r;

    perform (select to_jsonb(x) from (select * from net.http_collect_response(r)) x);
  end
  $job$;$$
);

-- Verify
select jobid, jobname, schedule, active from cron.job where jobname='tiktok_refresh_every_4h';
```

## 📊 Monitoring

### Cek cron jobs yang terdaftar:
```sql
select jobid, jobname, schedule, active, command 
from cron.job;
```

### Cek history execution:
```sql
select jobid, jobname, status, start_time, end_time, return_message
from cron.job_run_details
order by start_time desc
limit 20;
```

### Disable cron job sementara:
```sql
select cron.unschedule('instagram_refresh_every_4h');
select cron.unschedule('tiktok_refresh_every_4h');
```

## ⚙️ Cara Kerja

**Setiap 4 jam (00:00, 04:00, 08:00, 12:00, 16:00, 20:00):**

1. Supabase pg_cron trigger HTTP GET ke Vercel
2. `/api/cron/instagram-refresh` → fetch Instagram data
3. **Auto-trigger** `/api/backfill/accrual` → update social_metrics_history
4. `/api/cron/tiktok-refresh` → fetch TikTok data
5. **Auto-trigger** `/api/backfill/accrual` → update social_metrics_history

## 🔒 Security

- ✅ CRON_SECRET untuk protect endpoints
- ✅ Vercel endpoints juga check `Authorization: Bearer` header
- ✅ Supabase pg_cron hanya bisa diakses dari Supabase internal

## 💰 Cost

- **Supabase pg_cron**: GRATIS (termasuk di Free plan)
- **Vercel Hosting**: GRATIS (Free plan cukup jika tidak pakai Vercel Cron)
- **Total**: GRATIS 100% ✅

## ⚠️ Important Notes

1. **WAJIB** set `CRON_SECRET` di Vercel Environment Variables
2. Ganti `cron_secret_2025_instagram_tiktok_xyz123abc` dengan secret Anda
3. Ganti `https://clippertws.vercel.app` jika URL production berbeda
4. Setelah setup, **klik button "📊 Accrual Backfill"** di Admin page (satu kali)
