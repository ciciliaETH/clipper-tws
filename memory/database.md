# Database Schema (32 tables)

## Core Tables
- **users**: id, email, username, role, full_name, tiktok_username, instagram_username, youtube_channel_id, profile_picture_url, is_hidden
- **social_metrics**: user_id, platform, followers, following, total_posts/views/likes/comments (legacy)

## Social Media Handle Mapping
- **user_tiktok_usernames**: (user_id, tiktok_username) PK
- **user_instagram_usernames**: (user_id, instagram_username) PK
- **user_youtube_channels**: (user_id, youtube_channel_id) PK
- **user_youtube_usernames**: (user_id, youtube_username) PK
- **instagram_user_ids**: instagram_username PK → instagram_user_id (cache)

## Posts Tables
- **tiktok_posts_daily**: video_id PK, username, post_date, taken_at, play/digg/comment/share/save_count, title
- **instagram_posts_daily**: id PK, code, username, post_date, taken_at, play/like/comment_count, caption
- **youtube_posts_daily**: (id, video_id) PK, channel_id, title, post_date, views/likes/comments, shortcode

## Metrics History (triggers auto-populate)
- **tiktok_post_metrics_history**: post_id FK, captured_at, all counts
- **instagram_post_metrics_history**: post_id, captured_at, play/like/comment_count

## Campaign Tables
- **campaigns**: id, name, required_hashtags[], start_date, end_date
- **campaign_participants**: (campaign_id, tiktok_username) PK
- **campaign_instagram_participants**: (campaign_id, instagram_username) PK
- **campaign_youtube_participants**: campaign_id, youtube_channel_id
- **campaign_prizes**: campaign_id UNIQUE FK, first/second/third_prize
- **employee_groups**: (campaign_id, employee_id) PK, is_head

## Snapshot Tables (daily accrual tracking)
- **campaign_tiktok_participants_snapshot**: campaign/username/aweme_id/snapshot_date UNIQUE
- **campaign_instagram_participants_snapshot**: campaign/username/post_id/snapshot_date UNIQUE

## Employee Mapping
- **employee_participants**: (employee_id, tiktok_username) PK
- **employee_instagram_participants**: (employee_id, instagram_username) PK
- **employee_youtube_participants**: (employee_id, campaign_id, youtube_channel_id) PK
- **employee_accounts**: employee_id → account_user_id

## Historical Data
- **employee_historical_metrics**: start/end_date, platform, views/likes/comments/shares/saves
- **weekly_historical_data**: week_label, start/end_date, year/month/week_num, campaign_id, platform, metrics

## Legacy Groups
- **groups**, **group_members**, **group_participants**, **group_participant_snapshots**

## Other
- **analytics_tracked_accounts**: platform, username, label
- **refresh_retry_queue**: platform, username, retry tracking

## Key RLS Patterns
- Admin-only: campaigns, participants, prizes, employee mappings
- Public read: posts_daily tables, snapshots, youtube participants
- Authenticated: historical data
- User-specific: profile updates, avatar storage
