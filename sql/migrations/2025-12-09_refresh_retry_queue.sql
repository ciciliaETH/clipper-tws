-- Persistent retry queue for platform refreshes
create table if not exists refresh_retry_queue (
  id bigserial primary key,
  platform text not null check (platform in ('tiktok','instagram')),
  username text not null,
  last_error text,
  retry_count int not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, username)
);

create index if not exists idx_refresh_retry_queue_due on refresh_retry_queue(platform, next_retry_at);

-- trigger to update updated_at
create or replace function set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_refresh_retry_queue_updated_at
before update on refresh_retry_queue
for each row execute procedure set_updated_at_timestamp();
