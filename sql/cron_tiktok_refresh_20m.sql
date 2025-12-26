-- pg_cron schedule for running the Edge Function "tiktok-refresh" every 20 minutes
-- IMPORTANT: Replace {{SERVICE_ROLE}} with your SUPABASE_SERVICE_ROLE_KEY before running.
-- Run this file in Supabase SQL Editor with Role = postgres and Limit = No limit.

-- 1) (Optional) Remove existing job if any
select cron.unschedule('tiktok_refresh_every_20m');

-- 2) Create job that calls the Edge Function with concurrency=3
--    Using a DO block and net.http_get; response is collected into a JSON expression
--    to avoid "no destination for result data" errors in some pg_net versions.
select cron.schedule(
  'tiktok_refresh_every_20m',
  '*/20 * * * *',
  $$do $job$
  declare
    r bigint;
  begin
    select net.http_get(
      url := 'https://nyiwkaipsmtehmlsrmtm.supabase.co/functions/v1/tiktok-refresh?concurrency=3',
      headers := jsonb_build_object(
        'Authorization','Bearer {{SERVICE_ROLE}}',
        'apikey','{{SERVICE_ROLE}}'
      ),
      timeout_milliseconds := 60000
    )
    into r;

    -- Collect the response (store into a JSON expression) to satisfy pg_net requirements
    perform (select to_jsonb(x) from (select * from net.http_collect_response(r)) x);
  end
  $job$;$$
);

-- 3) Inspect jobs and recent runs
-- List registered jobs
select jobid, jobname, schedule, active, command from cron.job;

-- Recent run details (wait at least one cycle for entries)
select jobid, status, start_time, end_time, return_message
from cron.job_run_details
order by start_time desc
limit 20;
