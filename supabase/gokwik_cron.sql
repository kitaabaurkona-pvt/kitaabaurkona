-- =============================================================================
-- Kitaabaurkona: scheduled GoKwik job (live Supabase project only)
-- =============================================================================
-- Run AFTER schema.sql, after shipping_cron.sql (it makes the jobs' secret) and after
-- the `gokwik` Edge Function is deployed.
-- Replace <project-ref> below with the project's reference (Settings -> General).
-- Safe to run again: the secret is kept, the helper function and the job are replaced.
--
--   every 5 minutes   send queued order updates to GoKwik (AWB, parcel status,
--                     cancellations, refunds). A safety net: each change already wakes
--                     the worker the moment it happens.
--
-- The job calls the function with the same secret header as the shipping jobs
-- (Vault secret shipping_cron_secret, generated inside the database).
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'gokwik_function_url') then
    perform vault.create_secret('https://<project-ref>.supabase.co/functions/v1/gokwik', 'gokwik_function_url',
      'Address of the gokwik Edge Function');
  end if;
end $$;

-- Calls the gokwik function for one job. Only the scheduler (postgres) and the
-- database's own triggers may run it.
create or replace function public.gokwik_run_job(p_job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_job not in ('push_updates') then
    raise exception 'Unknown GoKwik job %', p_job;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gokwik_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'shipping_cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'Vault secrets gokwik_function_url and shipping_cron_secret are missing';
  end if;
  return net.http_post(
    url := v_url || '/jobs/' || replace(p_job, '_', '-'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function public.gokwik_run_job(text) from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname in ('gokwik-push-updates');

select cron.schedule('gokwik-push-updates', '1-59/5 * * * *', $$select public.gokwik_run_job('push_updates')$$);

-- Expected: one row.
select jobname, schedule, active from cron.job where jobname like 'gokwik-%' order by jobname;
