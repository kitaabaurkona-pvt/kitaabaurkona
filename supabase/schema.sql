-- =============================================================================
-- Kitaabaurkona: complete database setup
-- =============================================================================
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this WHOLE file -> Run.
--   It is safe to run again at any time: it never deletes data, and re-running
--   simply re-applies the same tables, rules and permissions.
--   Everything runs in one transaction: if any line fails, nothing is changed.
--
-- WHAT IT SETS UP
--   1. public.users         One profile per account: email, role (customer/admin),
--                           full name, mobile, gender, delivery address. Filled in
--                           automatically on signup (email/password AND Google).
--   2. public.books         The public catalogue, built from the columns of the
--                           bulk-upload file (listing_1.csv). Media are stored as
--                           links only; nothing is uploaded to Supabase Storage.
--   3. public.book_internal Admin-only business data per book (cost price, pickup
--                           address code). Kept out of books so it can never be
--                           shown to shoppers.
--   4. public.admin_upsert_books()
--                           The one call the bulk upload makes: adds or updates
--                           books and their internal data together.
--   Plus Row Level Security on all three tables, and public.is_admin(), the single
--   check every admin-only rule uses.
--
-- WHO CAN DO WHAT
--   Visitor (signed out): browse visible books. Nothing else.
--   Customer:             browse visible books; read and edit their OWN name,
--                         mobile, gender and address. Can never change their role
--                         or email, and can never see cost prices.
--   Admin:                everything a customer can, plus see hidden books and
--                         add/edit/delete books and their internal data.
--   Roles change ONLY here in the SQL Editor (see the last section of this file,
--   or supabase/admin.sql). The website has no way to make anyone an admin.
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. USERS (profiles)
-- -----------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profile fields collected on the sign-up page.
alter table public.users add column if not exists full_name text;
alter table public.users add column if not exists phone text;     -- 10-digit Indian mobile, without +91
alter table public.users add column if not exists gender text;
alter table public.users add column if not exists address text;   -- optional delivery address

-- The same limits the sign-up form enforces, so bad data cannot get in another way.
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

-- A signed-in user can read only their own row (the website reads it to learn the role).
drop policy if exists "Users view own record" on public.users;
create policy "Users view own record" on public.users
  for select to authenticated
  using ((select auth.uid()) = id);

-- A signed-in user can update only their own row...
drop policy if exists "Users update own record" on public.users;
create policy "Users update own record" on public.users
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ...and only these four columns. RLS decides WHICH rows; these grants decide WHICH
-- columns. Without them a user could set their own role to 'admin'.
-- Nobody can insert or delete users rows from the website at all.
revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;
grant update (full_name, phone, gender, address) on public.users to authenticated;

-- Keeps updated_at current on every change (used by users, books, book_internal).
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


-- -----------------------------------------------------------------------------
-- 2. AUTOMATIC PROFILE ON SIGNUP
-- -----------------------------------------------------------------------------
-- Runs whenever Supabase Auth creates an account (email sign-up or first Google
-- login). The profile values come from data the browser sent, so each one is
-- checked here; anything invalid is stored as empty instead of blocking signup.
-- The role is NEVER taken from that data: every new account starts as 'customer'.

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

-- Accounts created while testing the site, before this script existed, get a
-- profile row now (as customers).
insert into public.users (id, email)
select id, email from auth.users
where email is not null
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 3. ADMIN CHECK
-- -----------------------------------------------------------------------------
-- The one answer to "is the person making this request an admin?". It only looks
-- at the caller's own row. SECURITY DEFINER lets it read the role regardless of the
-- users table's own rules; the empty search_path stops look-alike tables or
-- functions from tricking it.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- -----------------------------------------------------------------------------
-- 4. BOOKS (public catalogue)
-- -----------------------------------------------------------------------------
-- Built from the columns of listing_1.csv, the bulk-upload file:
--
--   CSV column                         -> books column
--   Product Code                       -> product_code
--   Sku Id                             -> sku            (the upload matches rows on this)
--   Name                               -> title
--   Description                        -> description
--   Selling Price                      -> price          (rupees)
--   MRP                                -> mrp            (rupees)
--   GST %                              -> gst_percent
--   Quantity                           -> stock_quantity
--   Image 1 ... Image 10               -> image_urls     (same order; the first is the cover)
--   Video 1                            -> video_url
--   Packaging Length / Breadth / Height (in cm)
--                                      -> length_cm, breadth_cm, height_cm
--   Packaging Weight (in kg)           -> weight_kg
--   Return/Exchange Condition          -> return_policy  (the code number from the file)
--   Visibility                         -> is_visible
--   Product Type                       -> product_type   (marketplace code, kept as-is)
--   attr_Brand, attr_Country of Origin, attr_Ideal For, attr_Pack of, attr_Genre
--                                      -> attributes     (brand, country_of_origin,
--                                                          ideal_for, pack_of, genre)
--   Cost Price, Pickup Address Code    -> public.book_internal (admin only, section 5)
--
-- Not stored, because every row is empty or they belong to a clothing template:
--   Amazon ASIN, Video 2, Size Chart, HSN Code, Customisation Id, Size Type, Size,
--   Colour, Associated Pixel.
-- category is not in the file. It is left empty for the storefront's own categories
-- (Fiction, Non-Fiction, ...), to be filled in later.

-- True when every entry is a complete https:// link (no empty entries, no spaces).
create or replace function public.is_https_url_list(urls text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select array_position(urls, null) is null
     and coalesce(bool_and(u ~ '^https://\S+$' and char_length(u) <= 2048), true)
  from unnest(urls) as u;
$$;

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique check (char_length(product_code) between 1 and 64),
  sku text not null unique check (char_length(sku) between 1 and 64),
  title text not null check (char_length(title) between 1 and 300),
  description text check (description is null or char_length(description) <= 5000),
  price numeric(10, 2) not null check (price >= 0),
  mrp numeric(10, 2) not null check (mrp >= 0),
  gst_percent numeric(5, 2) not null default 0 check (gst_percent between 0 and 100),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  -- Links to the images on your image host, never files. https only, so a
  -- "javascript:" or plain-http link can never be stored. At most 10, like the file.
  image_urls text[] not null default '{}'
    check (cardinality(image_urls) <= 10 and public.is_https_url_list(image_urls)),
  video_url text
    check (video_url is null or (video_url ~ '^https://\S+$' and char_length(video_url) <= 2048)),
  length_cm numeric(7, 2) check (length_cm is null or length_cm > 0),
  breadth_cm numeric(7, 2) check (breadth_cm is null or breadth_cm > 0),
  height_cm numeric(7, 2) check (height_cm is null or height_cm > 0),
  weight_kg numeric(7, 3) check (weight_kg is null or weight_kg > 0),
  return_policy smallint check (return_policy is null or return_policy between 0 and 100),
  is_visible boolean not null default true,
  product_type text check (product_type is null or char_length(product_type) <= 100),
  category text check (category is null or char_length(category) <= 100),
  attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Catches a swapped Selling Price / MRP in an upload. Every row in listing_1.csv passes.
  constraint books_price_not_above_mrp check (price <= mrp)
);

create index if not exists books_visible_category_idx on public.books (is_visible, category);

drop trigger if exists books_set_updated_at on public.books;
create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

alter table public.books enable row level security;

-- Signed-out visitors see only visible books.
drop policy if exists "Visitors view visible books" on public.books;
create policy "Visitors view visible books" on public.books
  for select to anon
  using (is_visible);

-- Signed-in users see visible books; admins also see hidden ones.
drop policy if exists "Signed-in users view books" on public.books;
create policy "Signed-in users view books" on public.books
  for select to authenticated
  using (is_visible or (select public.is_admin()));

drop policy if exists "Admins add books" on public.books;
create policy "Admins add books" on public.books
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins edit books" on public.books;
create policy "Admins edit books" on public.books
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins delete books" on public.books;
create policy "Admins delete books" on public.books
  for delete to authenticated
  using ((select public.is_admin()));

-- Grants allow the request to reach the table; the policies above decide who succeeds.
revoke all on public.books from anon, authenticated;
grant select on public.books to anon, authenticated;
grant insert, update, delete on public.books to authenticated;


-- -----------------------------------------------------------------------------
-- 5. BOOK INTERNAL DATA (admin only)
-- -----------------------------------------------------------------------------
-- One row per book for business data shoppers must never see. Separate from books
-- because books is readable by everyone: keeping cost price there would publish
-- your margins.

create table if not exists public.book_internal (
  book_id uuid primary key references public.books (id) on delete cascade,
  cost_price numeric(10, 2) check (cost_price is null or cost_price >= 0),
  pickup_address_code text check (pickup_address_code is null or char_length(pickup_address_code) <= 64),
  updated_at timestamptz not null default now()
);

drop trigger if exists book_internal_set_updated_at on public.book_internal;
create trigger book_internal_set_updated_at
  before update on public.book_internal
  for each row execute function public.set_updated_at();

alter table public.book_internal enable row level security;

drop policy if exists "Admins only" on public.book_internal;
create policy "Admins only" on public.book_internal
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.book_internal from anon, authenticated;
grant select, insert, update, delete on public.book_internal to authenticated;


-- -----------------------------------------------------------------------------
-- 6. BULK UPLOAD (admin only)
-- -----------------------------------------------------------------------------
-- Called once per upload by the admin page with the cleaned rows of the CSV.
-- Writes books and book_internal together in ONE transaction: if any row is
-- rejected, nothing is saved, so a failed upload never leaves the catalogue
-- half-updated.
--   * Idempotent: rows are matched on sku. Existing books get the new values from
--     the file; new skus are added. Uploading the same file twice changes nothing.
--   * category is never touched, so categories you set later survive re-uploads.
--   * SECURITY INVOKER: it runs with the caller's own permissions, so the RLS
--     policies above still decide what is allowed, and it also refuses non-admins
--     up front.
--   * Up to 5,000 books per upload.

create or replace function public.admin_upsert_books(payload jsonb)
returns table (inserted integer, updated integer)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can upload books' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) is distinct from 'array'
     or jsonb_array_length(payload) = 0
     or jsonb_array_length(payload) > 5000 then
    raise exception 'Upload between 1 and 5000 books at a time' using errcode = '22023';
  end if;

  return query
  with incoming as (
    select *
    from jsonb_to_recordset(payload) as r(
      product_code text, sku text, title text, description text,
      price numeric, mrp numeric, gst_percent numeric, stock_quantity integer,
      image_urls text[], video_url text,
      length_cm numeric, breadth_cm numeric, height_cm numeric, weight_kg numeric,
      return_policy smallint, is_visible boolean, product_type text,
      attributes jsonb, internal jsonb
    )
  ),
  saved as (
    insert into public.books as b (
      product_code, sku, title, description, price, mrp, gst_percent, stock_quantity,
      image_urls, video_url, length_cm, breadth_cm, height_cm, weight_kg,
      return_policy, is_visible, product_type, attributes
    )
    select
      product_code, sku, title, description, price, mrp, coalesce(gst_percent, 0),
      coalesce(stock_quantity, 0), coalesce(image_urls, '{}'), video_url,
      length_cm, breadth_cm, height_cm, weight_kg, return_policy,
      coalesce(is_visible, true), product_type, coalesce(attributes, '{}'::jsonb)
    from incoming
    on conflict (sku) do update set
      product_code = excluded.product_code,
      title = excluded.title,
      description = excluded.description,
      price = excluded.price,
      mrp = excluded.mrp,
      gst_percent = excluded.gst_percent,
      stock_quantity = excluded.stock_quantity,
      image_urls = excluded.image_urls,
      video_url = excluded.video_url,
      length_cm = excluded.length_cm,
      breadth_cm = excluded.breadth_cm,
      height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg,
      return_policy = excluded.return_policy,
      is_visible = excluded.is_visible,
      product_type = excluded.product_type,
      attributes = excluded.attributes
    returning b.id, b.sku, (xmax = 0) as was_inserted
  ),
  saved_internal as (
    insert into public.book_internal as bi (book_id, cost_price, pickup_address_code)
    select s.id, (i.internal ->> 'cost_price')::numeric, i.internal ->> 'pickup_address_code'
    from saved s
    join incoming i on i.sku = s.sku
    on conflict (book_id) do update set
      cost_price = excluded.cost_price,
      pickup_address_code = excluded.pickup_address_code
    returning bi.book_id
  )
  select
    (count(*) filter (where s.was_inserted))::integer,
    (count(*) filter (where not s.was_inserted))::integer
  from saved s;
end;
$$;

revoke execute on function public.admin_upsert_books(jsonb) from public, anon;
grant execute on function public.admin_upsert_books(jsonb) to authenticated;


-- Make the website's API see the new tables immediately.
notify pgrst, 'reload schema';

commit;


-- -----------------------------------------------------------------------------
-- 7. CHECK THE RESULT
-- -----------------------------------------------------------------------------
-- The SQL Editor shows this table after the run. Expected: three rows
-- (book_internal, books, users), all with rls_enabled = true.
select
  t.tablename as table_name,
  t.rowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as policies
from pg_tables t
where t.schemaname = 'public' and t.tablename in ('users', 'books', 'book_internal')
order by t.tablename;


-- -----------------------------------------------------------------------------
-- 8. MAKE YOURSELF AN ADMIN (optional, do it once)
-- -----------------------------------------------------------------------------
-- Sign up on the website first, then remove the two dashes at the start of the
-- three lines below, put your sign-in email in place of you@example.com, select
-- just those lines and press Run. Expect exactly one row back with role = admin.
-- Refresh the website and the Admin link appears. More admin tasks: supabase/admin.sql.
--
-- update public.users set role = 'admin'
-- where id = (select id from auth.users where email = lower('you@example.com'))
-- returning id, email, role;
