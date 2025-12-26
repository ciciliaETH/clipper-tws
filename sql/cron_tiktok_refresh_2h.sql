-- Schedule Supabase Edge Function "tiktok-refresh" every 2 hours via pg_cron
-- IMPORTANT:
-- - Run in Supabase SQL Editor with Role = postgres and no statement timeout
-- - SERVICE ROLE is required in headers to call Edge Functions internally
-- - Replace {{SERVICE_ROLE}} only if you are not executing as postgres with env available

select cron.unschedule('tiktok_refresh_every_2h');

select cron.schedule(
  'tiktok_refresh_every_2h',
  '0 */2 * * *',
  $$do $job$
  declare
    r bigint;
    fn text := coalesce(current_setting('app.settings.supabase_function_tiktok_fetch', true), 'tiktok-refresh');
    url text := (select coalesce(current_setting('app.settings.supabase_url', true), '') ) || '/functions/v1/' || fn;
  begin
    if url is null or url = '/functions/v1/tiktok-refresh' then
      -- Fallback to injected constant if app.settings not present
      url := 'https://nyiwkaipsmtehmlsrmtm.supabase.co/functions/v1/tiktok-refresh';
    end if;

    select net.http_post(
      url := url || '?concurrency=6&limit=0',
      headers := jsonb_build_object(
        'Authorization','Bearer {{SERVICE_ROLE}}',
        'apikey','{{SERVICE_ROLE}}',
        'Content-Type','application/json'
      ),
      body := 'null'::jsonb,
      timeout_milliseconds := 120000
    ) into r;

    perform (select to_jsonb(x) from (select * from net.http_collect_response(r)) x);
  end
  $job$;$$
);

-- Inspect registered jobs
select jobid, jobname, schedule, active, command from cron.job where jobname='tiktok_refresh_every_2h';
