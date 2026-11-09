-- =============================================================================
-- Kitaabaurkona: scheduled shipping jobs (live Supabase project only)
-- =============================================================================
-- Run AFTER schema.sql and after the `shipping` Edge Function is deployed.
-- The jobs call the function with the cron secret. Both the function address and the
-- secret are read from Supabase Vault at run time; their values are NEVER written in
-- this file. Create them once (SQL Editor), replacing the placeholders:
--
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/shipping', 'shipping_function_url');
--   select vault.create_secret('<the same value as the SHIPPING_CRON_SECRET function secret>', 'shipping_cron_secret');
--
-- Safe to run again: existing shipping jobs are replaced.
--   every 5 minutes      book parcels whose hold time is over (if automatic booking is on)
--   every 5 minutes      cancel booked parcels of cancelled orders with Xpressbees
--   every 2 hours        refresh tracking of parcels on the way
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Calls the shipping function for one job. Only the scheduler (postgres) may run it.
create or replace function public.shipping_run_job(p_job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_job not in ('book_due', 'cancel_requested', 'track_active') then
    raise exception 'Unknown shipping job %', p_job;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'shipping_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'shipping_cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'Vault secrets shipping_function_url and shipping_cron_secret are missing';
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('action', 'run_job', 'job', p_job),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function public.shipping_run_job(text) from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job
where jobname in ('shipping-book-due', 'shipping-cancel-requested', 'shipping-track-active');

select cron.schedule('shipping-book-due', '*/5 * * * *', $$select public.shipping_run_job('book_due')$$);
select cron.schedule('shipping-cancel-requested', '2-59/5 * * * *', $$select public.shipping_run_job('cancel_requested')$$);
select cron.schedule('shipping-track-active', '17 */2 * * *', $$select public.shipping_run_job('track_active')$$);

-- Expected: three rows.
select jobname, schedule, active from cron.job where jobname like 'shipping-%' order by jobname;
