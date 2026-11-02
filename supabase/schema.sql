-- Run this in the Supabase SQL editor for this project.
-- Defines the users table and row-level security policies.

create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users enable row level security;

-- Users may read only their own record.
create policy "Users view own record" on users
  for select using (auth.uid() = id);

-- Users may update only their own record.
create policy "Users update own record" on users
  for update using (auth.uid() = id);

-- Example admin-only table. Replace `inventory` and its columns with your
-- actual schema; the policy pattern (role lookup via EXISTS) is what matters.
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table inventory enable row level security;

create policy "Admins only" on inventory
  for all using (
    exists (
      select 1 from users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Trigger: create a users row automatically when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
