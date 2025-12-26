-- Allow multiple TikTok usernames per user
create table if not exists user_tiktok_usernames (
  user_id uuid not null references users(id) on delete cascade,
  tiktok_username text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tiktok_username)
);
create index if not exists user_tiktok_usernames_username_idx on user_tiktok_usernames(tiktok_username);
