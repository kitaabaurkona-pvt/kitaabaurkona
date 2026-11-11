-- =============================================================================
-- Kitaabaurkona: scheduled shipping jobs (live Supabase project only)
-- =============================================================================
-- Run AFTER schema.sql and after the `shipping` Edge Function is deployed.
-- Replace <project-ref> below with the project's reference (Settings -> General).
-- Safe to run again: secrets are kept, the helper functions and jobs are replaced.
--
--   every 5 minutes   book any parcel still waiting (a safety net: each order already
--                     wakes the booking worker the moment it is placed)
--   every 5 minutes   cancel booked parcels of cancelled orders with Xpressbees (also a
--                     safety net: a cancellation wakes the worker at once)
--   every 15 minutes  refresh tracking of parcels on the way (Xpressbees has no webhooks)
--
-- The jobs call the function with a secret header. The secret is generated here, inside
-- the database, straight into Supabase Vault: nobody types, sees or copies it. The
-- function reads it through shipping_cron_secret(), which only the service role may run.
-- =============================================================================

create extension if not exists pg_cron;
-- pg_net keeps its functions in the `net` schema; the extension itself is registered in
-- `extensions` (not `public`), as Supabase's security advisor recommends.
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'shipping_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'shipping_cron_secret',
      'Header secret for the shipping Edge Function''s scheduled jobs');
  end if;
  if not exists (select 1 from vault.secrets where name = 'shipping_function_url') then
    perform vault.create_secret('https://<project-ref>.supabase.co/functions/v1/shipping', 'shipping_function_url',
      'Address of the shipping Edge Function');
  end if;
end $$;

-- The function compares the job header with this (service role only).
create or replace function public.shipping_cron_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'shipping_cron_secret';
$$;

revoke execute on function public.shipping_cron_secret() from public, anon, authenticated;
grant execute on function public.shipping_cron_secret() to service_role;

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
select cron.schedule('shipping-track-active', '*/15 * * * *', $$select public.shipping_run_job('track_active')$$);

-- Expected: three rows.
select jobname, schedule, active from cron.job where jobname like 'shipping-%' order by jobname;
