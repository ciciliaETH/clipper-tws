-- Migration: create table to cache Instagram username -> user_id mappings
create table if not exists instagram_user_ids (
  instagram_username text primary key,
  instagram_user_id text not null,
  created_at timestamptz default now()
);

-- index for quick lookup
create index if not exists instagram_user_ids_username_idx on instagram_user_ids(instagram_username);
