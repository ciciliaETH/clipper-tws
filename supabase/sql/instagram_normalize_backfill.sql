-- Instagram username normalization + backfill + indexes
-- Run this in Supabase SQL Editor (or psql). It is safe to re-run.

-- =========================
-- Helpers
-- =========================
create or replace function strip_at_lower(t text)
returns text language sql immutable as $$
  select case when t is null then null else lower(regexp_replace(t, '^@+', '')) end
$$;

-- =========================
-- One-time normalization (fix existing rows)
-- =========================
update instagram_posts_daily
set username = strip_at_lower(username)
where username is not null and (username ~ '^@' or username <> lower(username));

update user_instagram_usernames
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

update campaign_instagram_participants
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

update employee_instagram_participants
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

update users
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

-- NOTE: your schema may not have users.extra_instagram_usernames (array). We will rely on
-- user_instagram_usernames table for additional handles. If you do have that array column,
-- you can normalize it separately.

-- =========================
-- Triggers to enforce normalization on future writes
-- =========================
-- instagram_posts_daily.username
drop trigger if exists trg_norm_ig_posts on instagram_posts_daily;
create or replace function trg_norm_ig_posts_fn()
returns trigger language plpgsql as $$
begin
  new.username := strip_at_lower(new.username);
  return new;
end$$;
create trigger trg_norm_ig_posts
before insert or update on instagram_posts_daily
for each row execute function trg_norm_ig_posts_fn();

-- generic map normalizer function
create or replace function trg_norm_map_fn()
returns trigger language plpgsql as $$
begin
  new.instagram_username := strip_at_lower(new.instagram_username);
  return new;
end$$;

-- user_instagram_usernames.instagram_username
drop trigger if exists trg_norm_map on user_instagram_usernames;
create trigger trg_norm_map
before insert or update on user_instagram_usernames
for each row execute function trg_norm_map_fn();

-- campaign_instagram_participants.instagram_username
drop trigger if exists trg_norm_camp_ig on campaign_instagram_participants;
create trigger trg_norm_camp_ig
before insert or update on campaign_instagram_participants
for each row execute function trg_norm_map_fn();

-- employee_instagram_participants.instagram_username
drop trigger if exists trg_norm_emp_ig on employee_instagram_participants;
create trigger trg_norm_emp_ig
before insert or update on employee_instagram_participants
for each row execute function trg_norm_map_fn();

-- users profile fields (single)
drop trigger if exists trg_norm_users_ig on users;
create or replace function trg_norm_users_ig_fn()
returns trigger language plpgsql as $$
begin
  if new.instagram_username is not null then
    new.instagram_username := strip_at_lower(new.instagram_username);
  end if;
  return new;
end$$;
create trigger trg_norm_users_ig
before insert or update on users
for each row execute function trg_norm_users_ig_fn();

-- =========================
-- Backfill: map IG handles to employees for all groups
-- =========================
-- From users profile (instagram_username + extra_instagram_usernames)
-- 1a) Profile primary username
insert into employee_instagram_participants (employee_id, campaign_id, instagram_username)
select eg.employee_id,
       eg.campaign_id,
       strip_at_lower(us.instagram_username)
from employee_groups eg
join users us on us.id = eg.employee_id
where strip_at_lower(us.instagram_username) is not null
on conflict (employee_id, campaign_id, instagram_username) do nothing;

-- From alias table user_instagram_usernames
insert into employee_instagram_participants (employee_id, campaign_id, instagram_username)
select eg.employee_id,
       eg.campaign_id,
       strip_at_lower(ui.instagram_username)
from employee_groups eg
join user_instagram_usernames ui on ui.user_id = eg.employee_id
where strip_at_lower(ui.instagram_username) is not null
on conflict (employee_id, campaign_id, instagram_username) do nothing;

-- Ensure campaign has all IG handles used in the group
insert into campaign_instagram_participants (campaign_id, instagram_username)
select distinct eip.campaign_id, eip.instagram_username
from employee_instagram_participants eip
on conflict (campaign_id, instagram_username) do nothing;

-- =========================
-- Indexes for performance
-- =========================
create index if not exists idx_ig_posts_username_date on instagram_posts_daily (username, post_date);
create index if not exists idx_emp_ig_part_employee on employee_instagram_participants (employee_id, campaign_id);
create index if not exists idx_camp_ig_part on campaign_instagram_participants (campaign_id, instagram_username);
create index if not exists idx_user_ig_alias on user_instagram_usernames (user_id, instagram_username);

-- =========================
-- Optional debugging helpers
-- =========================
-- View with normalized username (if desired by analytics)
create or replace view instagram_posts_daily_norm as
select strip_at_lower(username) as username,
       post_date, play_count, like_count, comment_count, id
from instagram_posts_daily;

-- Verification query example (replace EMP_ID, CAMPAIGN_ID, START, END)
-- select ipd.post_date, sum(ipd.play_count) views, sum(ipd.like_count) likes, sum(ipd.comment_count) comments
-- from instagram_posts_daily ipd
-- where ipd.username in (
--   select instagram_username from employee_instagram_participants
--   where employee_id = 'EMP_ID' and campaign_id = 'CAMPAIGN_ID'
-- )
-- and ipd.post_date between 'START' and 'END'
-- group by 1 order by 1;
