-- Schedules the daily 6 AM IST call to the auto-complete-aged-picklists
-- Edge Function. Run this in Supabase SQL Editor AFTER the function is
-- deployed (see README.md in this folder) and CRON_SECRET is set.
--
-- 06:00 IST = 00:30 UTC — pg_cron schedules run in UTC.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'auto-complete-aged-picklists-daily',
  '30 0 * * *',
  $$
  select net.http_post(
    url := 'https://kytktvvcbgslwokywmds.supabase.co/functions/v1/auto-complete-aged-picklists',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_WITH_YOUR_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's registered:
--   select * from cron.job;
-- To see run history (after it's fired at least once):
--   select * from cron.job_run_details order by start_time desc limit 10;
-- To remove it entirely:
--   select cron.unschedule('auto-complete-aged-picklists-daily');
