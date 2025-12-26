# Quick Start - Clipper Analytics Dashboard

Panduan cepat untuk mulai menggunakan Clipper Dashboard dengan **Unlimited Sync System**.

## ⚡ 5-Menit Setup

### 1. Clone & Install
```bash
# Clone repository
git clone <repository-url>
cd dashboard-clipper

# Install dependencies
npm install
```

### 2. Siapkan Credentials dari Supabase
- Go ke https://supabase.com - create project
- Copy 3 keys dari Settings > API:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

### 3. Setup Environment Variables
```bash
# Copy template
cp .env.example .env.local

# Edit .env.local dengan credentials Anda
```

**Required variables:**
```bash
# Supabase (from step 2)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Aggregator API (unlimited, free)
AGGREGATOR_API_BASE=http://202.10.44.90/api/v1
AGGREGATOR_ENABLED=1
AGGREGATOR_UNLIMITED=1

# RapidAPI (fallback, paid)
RAPID_API_KEYS=your_rapidapi_key_here
RAPIDAPI_USE_CURSOR=1
RAPIDAPI_MAX_ITER=999

# Cron Secret (random string)
CRON_SECRET=your_random_secret_here
```

### 4. Setup Database
**Di Supabase SQL Editor, run migrations:**
```bash
# Navigate to sql/migrations/ folder
# Run files in chronological order (2025-10-23 → 2025-12-04)
```

**Or use quick setup:**
```sql
-- See SETUP_GUIDE.md for complete SQL
-- Creates: users, tiktok_posts_daily, social_metrics_history, campaigns, etc.
```

### 5. Test Aggregator API (Optional but Recommended)
```bash
# Test API connectivity before running
npm run test:aggregator khaby.lame

# Expected: All 5 tests pass ✅
```

### 6. Run Development Server
```bash
npm run dev

# Open http://localhost:3000
```

### 7. Login & Test
- Go to http://localhost:3000/login
- Email: `admin@example.com`
- Password: `Admin123!`

---

## 🚀 Test Unlimited Sync

### Test Fetch Endpoint
```bash
# Unlimited mode (default) - fetches ALL videos
curl "http://localhost:3000/api/fetch-metrics/khaby.lame"

# Expected response:
{
  "success": true,
  "fetchSource": "aggregator",
  "totalVideos": 1547,
  "telemetry": {
    "source": "aggregator",
    "windowsProcessed": 8,
    "oldestVideoDate": "2016-03-15"
  }
}
```

### Force RapidAPI Fallback
```bash
curl "http://localhost:3000/api/fetch-metrics/khaby.lame?rapid=1"

# Should use RapidAPI instead of Aggregator
```

### Limited Mode (Testing)
```bash
# Fetch only 10 pages (legacy mode)
curl "http://localhost:3000/api/fetch-metrics/khaby.lame?all=0&pages=10"
```

---

## 📍 URLs & Pages

| Page | URL | Akses |
|------|-----|-------|
| Homepage | http://localhost:3000 | Public |
| Login | http://localhost:3000/login | Public |
| Sign Up | http://localhost:3000/signup | Public |
| Dashboard | http://localhost:3000/dashboard | Logged in users |
| Admin Panel | http://localhost:3000/dashboard/admin | Admin only |

---

## 👥 Test Accounts

Setelah setup, gunakan account ini untuk test:

**Admin Account:**
```
Email: admin@example.com
Password: Admin123!
```

**Karyawan Account:**
```
Email: karyawan@example.com
Password: Karyawan123!
```

---

## 🎯 Fitur Per Role

### Admin
- ✅ CRUD Users
- ✅ View all analytics
- ✅ Manage dashboard

### Karyawan
- ✅ View own analytics
- ✅ See TikTok metrics

### Public User
- ✅ Search analytics
- ✅ View public data

---

## 🚀 Development Commands

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Run linting
npm run lint
```

---

## 📦 Project Structure

```
src/
├── app/              # Next.js app routes
├── lib/              # Utilities & config
├── types/            # TypeScript definitions
└── components/       # React components
```

---

## 🔧 Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Icons**: React Icons
- **UI Components**: Custom Tailwind components

---

## 📋 Checklist Setup

- [ ] Create Supabase project
- [ ] Copy Supabase credentials
- [ ] Setup database schema
- [ ] Create test users
- [ ] Configure .env.local
- [ ] Run `npm install`
- [ ] Run `npm run dev`
- [ ] Test login with admin account
- [ ] Explore dashboard

---

## ❓ Common Issues

**Issue**: "Invalid supabaseUrl"
- Solution: Check `.env.local`, format should be `https://xxx.supabase.co`

**Issue**: Can't login
- Solution: Make sure test users were created (run SQL from SETUP_GUIDE.md)

**Issue**: No metrics showing
- Solution: Test user should have sample data, check if it's there in Supabase

**Issue**: "Permission denied" errors
- Solution: Check RLS policies in Supabase, make sure they're enabled

---

## 📚 Next Steps

1. **Read Full Setup Guide** → `SETUP_GUIDE.md`
2. **Read README** → `README.md`
3. **Integrate Real APIs** → Configure TikTok API (RapidAPI)
4. **Deploy** → Deploy to Vercel, Netlify, etc.

---

## 🎨 Customization

Edit these files untuk custom:

- `src/app/globals.css` - Change colors/fonts
- `src/components/` - Custom components
- `tailwind.config.ts` - Tailwind config

---

**Happy coding! 🎉**
