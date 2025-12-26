-- Schedule Supabase Edge Function "ig-refresh" every 2 hours via pg_cron
-- Run with Role=postgres in SQL Editor. Ensure secrets RAPID_API_KEYS, RAPIDAPI_INSTAGRAM_HOST or RAPIDAPI_IG_SCRAPER_HOST are set in Edge Functions.

select cron.unschedule('instagram_refresh_every_2h');

select cron.schedule(
  'instagram_refresh_every_2h',
  '0 */2 * * *',
  $$do $job$
  declare
    r bigint;
  begin
    select net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/ig-refresh',
      headers := jsonb_build_object(
        'Authorization','Bearer {{SERVICE_ROLE}}',
        'apikey','{{SERVICE_ROLE}}',
        'Content-Type','application/json'
      ),
      body := 'null'::jsonb,
      timeout_milliseconds := 180000
    ) into r;

    perform (select to_jsonb(x) from (select * from net.http_collect_response(r)) x);
  end
  $job$;$$
);

-- Validate
select jobid, jobname, schedule, active from cron.job where jobname='instagram_refresh_every_2h';
