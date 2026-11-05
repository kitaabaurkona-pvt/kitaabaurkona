-- Run this in the Supabase SQL editor. It is safe to run again on an existing project.

-- Users ---------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists full_name text;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists gender text;
alter table public.users add column if not exists address text;

alter table public.users drop constraint if exists users_full_name_length;
alter table public.users add constraint users_full_name_length
  check (full_name is null or char_length(full_name) between 2 and 80);

alter table public.users drop constraint if exists users_phone_format;
alter table public.users add constraint users_phone_format
  check (phone is null or phone ~ '^[6-9][0-9]{9}$');

alter table public.users drop constraint if exists users_gender_values;
alter table public.users add constraint users_gender_values
  check (gender is null or gender in ('male', 'female', 'other'));

alter table public.users drop constraint if exists users_address_length;
alter table public.users add constraint users_address_length
  check (address is null or char_length(address) <= 300);

alter table public.users enable row level security;

drop policy if exists "Users view own record" on public.users;
create policy "Users view own record" on public.users
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users update own record" on public.users;
create policy "Users update own record" on public.users
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- RLS limits which rows can be updated; column grants limit which columns.
-- Without this, a user could set their own role to 'admin'.
revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;
grant update (full_name, phone, gender, address) on public.users to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Create a users row for every new auth user. Profile fields come from
-- user-editable metadata, so each one is validated here. The role is never read
-- from metadata and always starts as 'customer'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(left(btrim(coalesce(meta ->> 'full_name', '')), 80), '');
  v_phone text := nullif(btrim(coalesce(meta ->> 'phone', '')), '');
  v_gender text := nullif(btrim(coalesce(meta ->> 'gender', '')), '');
  v_address text := nullif(left(btrim(coalesce(meta ->> 'address', '')), 300), '');
begin
  if v_name is not null and char_length(v_name) < 2 then v_name := null; end if;
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then v_phone := null; end if;
  if v_gender is not null and v_gender not in ('male', 'female', 'other') then v_gender := null; end if;

  insert into public.users (id, email, full_name, phone, gender, address)
  values (new.id, new.email, v_name, v_phone, v_gender, v_address)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill accounts created before the trigger existed.
insert into public.users (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Admin-only data (example) --------------------------------------------------
-- Replace `inventory` with your real admin tables; the policy pattern is what matters.

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.inventory enable row level security;

drop policy if exists "Admins only" on public.inventory;
create policy "Admins only" on public.inventory
  for all to authenticated
  using (
    exists (
      select 1 from public.users
      where id = (select auth.uid()) and role = 'admin'
    )
  );

revoke all on public.inventory from anon;
