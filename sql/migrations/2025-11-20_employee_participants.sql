-- Map employees to specific campaign participants (by tiktok_username)
create table if not exists employee_participants (
  employee_id uuid not null references users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  tiktok_username text not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, campaign_id, tiktok_username)
);

create index if not exists employee_participants_campaign_idx on employee_participants(campaign_id);
create index if not exists employee_participants_username_idx on employee_participants(tiktok_username);
