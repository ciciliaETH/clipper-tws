# Architecture Details

## Data Flow
1. Cron jobs or manual triggers call fetch-metrics/fetch-ig/fetch-youtube
2. These endpoints call Aggregator API (primary) or RapidAPI (fallback)
3. Data upserted into *_posts_daily tables
4. Triggers auto-log to *_post_metrics_history for delta tracking
5. Frontend calls analytics/leaderboard APIs that aggregate from DB

## Authentication Flow
- Supabase Auth (email/password)
- Middleware (`middleware.ts`) checks auth on /dashboard/* routes
- Admin gate: queries users.role for /dashboard/admin and /dashboard/campaigns
- Server-side Supabase client for API routes, browser client for frontend

## API Strategy - Social Media
- Aggregator API: http://202.10.44.90/api/v1 (free, unlimited)
- RapidAPI: Multiple providers with key rotation
  - TikTok: tiktok-scraper7, tiktok-api15
  - Instagram: instagram-scraper-api11, instagram120, instagram-api-fast
  - YouTube: Aggregator v2 primary
- Key rotation: RAPID_API_KEYS (comma-separated), premium key first

## Campaign System
- Campaigns have start/end dates, optional required_hashtags
- Participants linked via campaign_participants (TikTok), campaign_instagram_participants, campaign_youtube_participants
- Employee groups (employee_groups) link employees to campaigns with is_head flag
- Snapshot tables track daily metrics per participant per campaign
- Accrual calculation: delta between daily snapshots, with cutoff date masking

## Groups System (Legacy + New)
- Legacy: groups/group_members/group_participants tables
- New: campaigns used as groups with employee_groups mapping
- Both coexist; API supports kind=groups or kind=campaigns

## Components
- EmployeeAvatar.tsx (minimal)
- TopViralDashboard.tsx - ranked viral videos with platform filters
- TopViralVideos.tsx - similar, grid layout variant
