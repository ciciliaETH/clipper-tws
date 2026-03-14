# Dashboard Clipper V2 - Project Memory

## Overview
Social media analytics dashboard (TikTok, Instagram, YouTube) built with Next.js 16 + Supabase + Tailwind CSS v4. Deployed on Vercel. Indonesian locale (id-ID).

## Tech Stack
- Next.js 16 (App Router, Turbopack), React 19, TypeScript 5
- Supabase (PostgreSQL + Auth + Storage + RLS)
- Tailwind CSS v4, Chart.js, date-fns, Zod, xlsx, Axios
- Path alias: `@/*` → `./src/*`

## Architecture
See [architecture.md](architecture.md) for detailed notes.

## Database
See [database.md](database.md) for complete schema (32 tables).

## Key Patterns
- RapidAPI key rotation with cooldown (`src/lib/rapidapi.ts`)
- Dual API strategy: Aggregator (free) → RapidAPI (paid fallback)
- Accrual mode: snapshot-based delta tracking with cutoff date masking
- Multi-platform user linking via mapping tables (user_*_usernames)
- Role-based access: admin, super_admin, leader, karyawan, umum
- Middleware: auth check + admin gate on `/dashboard/admin` & `/dashboard/campaigns`

## Pages (14 pages, 3 layouts)
- `/` → redirect to /dashboard or /login
- `/login` → email/password auth
- `/dashboard` → main analytics with Chart.js
- `/dashboard/admin` → user CRUD, prizes, social accounts
- `/dashboard/campaigns` → redirects to /dashboard/groups
- `/dashboard/groups` → campaign management, leaderboard, metrics
- `/dashboard/account` → user profile, password, social accounts
- `/leaderboard` → global employee leaderboard with podium
- `/analytics` → individual account tracking
- `/groups`, `/groups/[id]`, `/groups/[id]/participant/[username]`
- `/admin/employee-historical`, `/admin/weekly-data`

## API Routes (~71 routes)
- Fetch: fetch-metrics, fetch-ig, fetch-youtube (external API calls)
- CRUD: manage-user, campaigns, groups
- Analytics: analytics/series, dashboard/series, leaderboard
- Admin: admin/ig/*, admin/tiktok/*, admin/youtube/*
- Cron: cron/instagram-refresh, cron/tiktok-refresh, cron/sync-tiktok
