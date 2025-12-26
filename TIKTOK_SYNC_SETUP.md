# TikTok Auto-Sync Setup

## GitHub Actions Secrets yang Perlu Ditambahkan

Buka: `https://github.com/ciciliaETH/dashboard-clipper/settings/secrets/actions`

Tambahkan 2 secrets berikut:

### 1. `APP_URL`
**Value:** URL production app kamu
```
https://your-app.vercel.app
```
atau
```
https://your-domain.com
```

### 2. `CRON_SECRET`
**Value:** Token rahasia untuk autentikasi cron job

Bisa pakai value yang sama dengan `SUPABASE_SERVICE_ROLE_KEY` atau generate random token:

**Option 1 - Pakai Service Role Key:**
```
(copy value dari SUPABASE_SERVICE_ROLE_KEY)
```

**Option 2 - Generate Random Token:**
Di terminal/PowerShell, jalankan:
```powershell
# PowerShell
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()))
```

## Environment Variables (.env.local)

Pastikan sudah ada:
```env
NEXT_PUBLIC_SUPABASE_URL=https://nyiwkaipsmtehmlsrmtm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
CRON_SECRET=your_secret_token_here
```

## Cara Kerja

1. **GitHub Actions** jalan setiap 20 menit
2. Hit endpoint: `GET /api/cron/sync-tiktok`
3. Endpoint akan:
   - Ambil semua users dengan `tiktok_username`
   - Fetch data dari API `http://202.10.44.90`
   - Simpan metrics ke Supabase:
     - Update `users` table (totals)
     - Insert ke `tiktok_posts_daily` (individual posts)
4. Process dengan concurrency control (3 users parallel)

## Test Manual

Setelah deploy, test dengan:

```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://your-app.vercel.app/api/cron/sync-tiktok?limit=5&concurrency=2"
```

## Response Example

```json
{
  "success": true,
  "processed": 10,
  "succeeded": 9,
  "failed": 1,
  "results": [
    {
      "username": "tradewithsuli",
      "success": true,
      "videos": 10,
      "metrics": {
        "views": 15000,
        "likes": 1200,
        "comments": 50,
        "shares": 30
      }
    }
  ],
  "processed_time": 12.45
}
```

## Manual Trigger

Bisa trigger manual dari GitHub:
1. Buka: `https://github.com/ciciliaETH/dashboard-clipper/actions`
2. Pilih workflow: `tiktok-refresh-cron`
3. Klik: `Run workflow`

## Notes

- ✅ Tidak perlu Supabase Edge Function lagi
- ✅ Semua logic ada di Next.js
- ✅ Data langsung simpan ke Supabase
- ✅ Concurrency control untuk avoid rate limit
- ✅ Batch processing untuk efficiency
- ⚠️ Pastikan table `tiktok_posts_daily` sudah ada di Supabase
