-- Schedule an HTTP GET to your Vercel endpoint /api/cron/instagram-refresh every 2 hours
-- This runs inside Supabase using pg_cron + pg_net
-- BEFORE RUNNING: Replace {{CRON_SECRET}} and {{VERCEL_BASE_URL}}
-- Example VERCEL_BASE_URL: https://your-app.vercel.app

select cron.unschedule('instagram_refresh_every_2h');

select cron.schedule(
  'instagram_refresh_every_2h',
  '0 */2 * * *',
  $$do $job$
  declare
    r bigint;
    base text := '{{VERCEL_BASE_URL}}';
    endpoint text := base || '/api/cron/instagram-refresh?limit=200&concurrency=6';
  begin
    if base is null or base = '' then
      raise exception 'Set {{VERCEL_BASE_URL}} before running this script';
    end if;

    select net.http_get(
      url := endpoint,
      headers := jsonb_build_object(
        'Authorization', 'Bearer {{CRON_SECRET}}',
        'Accept','application/json'
      ),
      timeout_milliseconds := 180000
    ) into r;

    perform (select to_jsonb(x) from (select * from net.http_collect_response(r)) x);
  end
  $job$;$$
);

-- Inspect registered jobs
select jobid, jobname, schedule, active, command from cron.job where jobname='instagram_refresh_every_2h';
