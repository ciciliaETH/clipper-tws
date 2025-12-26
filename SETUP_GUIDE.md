# Setup Guide - Clipper Analytics Dashboard

Panduan lengkap untuk setup dan menjalankan Clipper Analytics Dashboard.

## 1. Prerequisites

Pastikan Anda sudah memiliki:
- Node.js v18+ (download dari https://nodejs.org/)
- npm atau yarn
- Supabase account (gratis di https://supabase.com)
- Text editor (VS Code recommended)

## 2. Setup Supabase Project

### Step 1: Create Supabase Project
1. Go ke https://supabase.com dan sign in / sign up
2. Klik "New Project"
3. Fill in project details:
   - **Project name**: dashboard-clipper (atau nama lain)
   - **Database password**: Buat password yang kuat
   - **Region**: Pilih region terdekat dengan lokasi Anda
4. Tunggu project selesai di-provision (biasanya ~2 menit)

### Step 2: Get Your Credentials
1. Pergi ke **Project Settings** > **API**
2. Copy 3 nilai ini:
   - **Project URL** (untuk `NEXT_PUBLIC_SUPABASE_URL`)
   - **anon public** key (untuk `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - **service_role** secret (untuk `SUPABASE_SERVICE_ROLE_KEY`)

### Step 3: Setup Database Schema
1. Di Supabase dashboard, buka **SQL Editor**
2. Click **"New Query"** atau **"New Snippet"**
3. Copy dan paste SQL berikut:

```sql
-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT auth.uid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'umum' CHECK (role IN ('admin', 'super_admin', 'leader', 'karyawan', 'umum')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create social_metrics table
CREATE TABLE IF NOT EXISTS social_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok')),
  username TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  video_title TEXT,
  video_url TEXT,
  video_posted_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_social_metrics_user_id ON social_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_social_metrics_platform ON social_metrics(platform);
CREATE INDEX IF NOT EXISTS idx_social_metrics_video_posted_at ON social_metrics(video_posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for users table
CREATE POLICY "Users can view own profile" ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admin can view all users" ON users FOR SELECT
  USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admin can manage all users" ON users FOR ALL
  USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- Create RLS policies for social_metrics table
CREATE POLICY "Users can view own metrics" ON social_metrics FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own metrics" ON social_metrics FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin can view all metrics" ON social_metrics FOR SELECT
  USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');
```

4. Click **"Run"** atau tekan Ctrl+Enter
5. Tunggu sampai selesai

### Step 4: Create Test Admin Account
Di SQL Editor, buat query baru dan jalankan:

```sql
-- Create admin user via Auth
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'admin@example.com',
  crypt('Admin123!', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  NOW(),
  NOW()
) ON CONFLICT DO NOTHING;

-- Create admin profile
INSERT INTO users (id, email, username, full_name, role)
SELECT id, email, 'admin', 'Admin User', 'admin'
FROM auth.users
WHERE email = 'admin@example.com'
ON CONFLICT DO NOTHING;

-- Create sample karyawan user
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'karyawan@example.com',
  crypt('Karyawan123!', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  NOW(),
  NOW()
) ON CONFLICT DO NOTHING;

-- Create karyawan profile
INSERT INTO users (id, email, username, full_name, role)
SELECT id, email, 'karyawan', 'Karyawan User', 'karyawan'
FROM auth.users
WHERE email = 'karyawan@example.com'
ON CONFLICT DO NOTHING;

-- Insert sample metrics
INSERT INTO social_metrics (user_id, platform, username, likes, views, comments, saves, video_title, video_posted_at)
SELECT 
  u.id,
  'tiktok',
  '@karyawan',
  500,
  20000000,
  50,
  20,
  'Video Tiktok #1',
  NOW() - INTERVAL '2 days'
FROM users u
WHERE u.username = 'karyawan'
ON CONFLICT DO NOTHING;

-- (Instagram/YouTube dihapus: fokus hanya TikTok)
```

Credentials untuk testing:
- **Admin Email**: admin@example.com
- **Admin Password**: Admin123!
- **Karyawan Email**: karyawan@example.com  
- **Karyawan Password**: Karyawan123!

## 3. Setup Project Lokal

### Step 1: Clone / Download Project
Pastikan project sudah tersedia di `c:\Users\USER\Downloads\dashboard-clipper`

### Step 2: Install Dependencies
```bash
cd c:\Users\USER\Downloads\dashboard-clipper
npm install
```

### Step 3: Configure Environment Variables
Edit file `.env.local` dan masukkan credentials dari Supabase:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Contoh:
```
NEXT_PUBLIC_SUPABASE_URL=https://abc123def456.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 4: Run Development Server
```bash
npm run dev
```

Buka browser dan pergi ke: http://localhost:3000

## 4. Testing Aplikasi

### Test Login Admin
1. Go ke `http://localhost:3000/login`
2. Enter:
   - Email: `admin@example.com`
   - Password: `Admin123!`
3. Klik Login
4. Seharusnya redirect ke `/dashboard`
5. Klik menu "Admin" di navbar
6. Bisa lihat User Management page

### Test Login Karyawan
1. Go ke `http://localhost:3000/login`
2. Enter:
   - Email: `karyawan@example.com`
   - Password: `Karyawan123!`
3. Klik Login
4. Seharusnya auto-load analytics dari akun karyawan ini
5. Lihat metrics dari TikTok

### Test Public User
1. Klik Logout
2. Go ke homepage (http://localhost:3000)
3. Cari username: `karyawan`
4. Seharusnya bisa lihat public metrics dari akun tersebut

## 5. File Structure

```
src/
├── app/
│   ├── page.tsx                 # Homepage
│   ├── login/page.tsx           # Login page
│   ├── signup/page.tsx          # Signup page
│   ├── layout.tsx               # Root layout
│   └── dashboard/
│       ├── page.tsx             # Main dashboard & analytics
│       ├── layout.tsx           # Dashboard layout (navbar)
│       └── admin/
│           └── page.tsx         # Admin user management
├── lib/
│   └── supabase/
│       ├── client.ts            # Browser Supabase client
│       └── server.ts            # Server Supabase client
├── types/
│   └── index.ts                 # TypeScript types
└── app/globals.css              # Global Tailwind styles
```

## 6. User Roles Explanation

### Admin
- Bisa CRUD semua users
- Bisa lihat semua analytics
- Akses ke `/dashboard/admin`
- Full control atas sistem

### Karyawan (Employee)
- Hanya bisa lihat analytics TikTok mereka sendiri
- Tidak bisa melihat data user lain
- Tidak bisa akses admin panel

### Umum (Public User)
- Bisa search dan lihat analytics dari username public
- Read-only access
- Hanya lihat data yang sudah di-publish
- Tidak bisa melihat username karyawan (kecuali di-share explicitly)

## 7. Adding New Users

Sebagai admin, Anda bisa tambah user baru:

1. Login sebagai admin
2. Go ke `/dashboard/admin`
3. Klik tombol "Tambah User"
4. Fill in form:
   - Email
   - Username
   - Full Name
   - Role (Umum/Karyawan/Admin)
5. Klik "Simpan"

Password akan di-generate otomatis atau bisa custom

## 8. Troubleshooting

### Error: "Invalid supabaseUrl"
- Check `.env.local` - pastikan NEXT_PUBLIC_SUPABASE_URL benar
- Format: `https://your-project-id.supabase.co`

### Error: "Invalid JWT"
- Check SUPABASE_SERVICE_ROLE_KEY di `.env.local`
- Pastikan key sudah di-copy dengan benar dari Supabase dashboard

### Tidak bisa login
- Check email dan password di SQL test query sebelumnya
- Pastikan database sudah selesai setup dengan benar

### Tidak bisa lihat data
- Check Row Level Security (RLS) policies di Supabase
- Pastikan user yang login punya role yang benar

## 9. Next Steps

Setelah setup berhasil, Anda bisa:

1. **Integrate Real Social Media APIs**
  - TikTok API untuk fetch data actual (RapidAPI)

2. **Add More Features**
   - Real-time updates dengan WebSockets
   - Advanced filtering dan search
   - Export data functionality
   - Charts dan analytics visualization
   - Notification system

3. **Deploy ke Production**
   ```bash
   npm run build
   # Deploy ke Vercel atau hosting lain
   ```

## 10. Contact & Support

Jika ada pertanyaan atau issues:
- Check README.md di root folder
- Review Supabase documentation: https://supabase.com/docs
- Check Next.js documentation: https://nextjs.org/docs
