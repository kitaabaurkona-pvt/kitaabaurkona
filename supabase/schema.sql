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
--   5. public.wishlist_items Each signed-in user's saved books.
--   6. public.orders, public.order_items
--                           Orders and a snapshot of what was ordered. Created
--                           only by create_order(), which prices everything from
--                           the books table; cancel_order() for customers and
--                           admin_set_order_status() for admins. Payment is cash
--                           on delivery (confirmed at once) or online.
--   7. Shipping (Xpressbees or Delhivery, per parcel): shipping_settings, shipments, shipment_events and
--                           service-role-only helper tables, used by the
--                           `shipping` Edge Function. See section 8b.
--   8. GoKwik checkout (online payment): checkout_carts, order_payments,
--                           payment_events, gokwik_order_updates, used by the
--                           `gokwik` Edge Function. See section 9c.
--   Plus Row Level Security on every table, and public.is_admin(), the single
--   check every admin-only rule uses.
--
-- WHO CAN DO WHAT
--   Visitor (signed out): browse visible books. Nothing else.
--   Customer:             browse visible books; read and edit their OWN name,
--                         mobile, gender and address. Can never change their role
--                         or email, and can never see cost prices.
--                         They manage their own wishlist, place orders, see only
--                         their own orders and cancel them while unpaid.
--   Admin:                everything a customer can, plus see hidden books,
--                         add/edit/delete books and their internal data, see all
--                         orders and move them through paid, shipped, delivered.
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

-- Worked out by the database from price and MRP, so it is always correct and the
-- shop can sort by it.
alter table public.books add column if not exists discount_percent integer
  generated always as (
    case when mrp > 0 then floor((1 - price / mrp) * 100)::integer else 0 end
  ) stored;

create index if not exists books_visible_category_idx on public.books (is_visible, category);
create index if not exists books_discount_idx on public.books (discount_percent desc);

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


-- -----------------------------------------------------------------------------
-- 7. WISHLIST
-- -----------------------------------------------------------------------------
-- One row per saved book per signed-in user. Each user sees and changes only
-- their own rows. Removing a book from the catalogue removes it from wishlists.

create table if not exists public.wishlist_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.wishlist_items enable row level security;

drop policy if exists "Users view own wishlist" on public.wishlist_items;
create policy "Users view own wishlist" on public.wishlist_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add to own wishlist" on public.wishlist_items;
create policy "Users add to own wishlist" on public.wishlist_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users remove from own wishlist" on public.wishlist_items;
create policy "Users remove from own wishlist" on public.wishlist_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.wishlist_items from anon, authenticated;
grant select, insert, delete on public.wishlist_items to authenticated;


-- -----------------------------------------------------------------------------
-- 8. ORDERS
-- -----------------------------------------------------------------------------
-- Orders are created ONLY by create_order() below, which reads prices and stock
-- from the books table itself. Nothing the browser sends about prices or totals
-- is trusted. Customers can read their own orders; admins can read all of them.
-- Status flow, online payment: pending_payment -> paid -> shipped -> delivered.
-- Cash on delivery: confirmed -> shipped -> delivered (confirmed straight away).
-- pending_payment, confirmed or paid -> cancelled. Stock is taken when an order is
-- confirmed (COD) or marked paid, and returned if that order is cancelled.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled')),
  payment_method text not null default 'online' check (payment_method in ('online', 'cod')),
  item_count integer not null check (item_count between 1 and 500),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  mrp_total numeric(12, 2) not null check (mrp_total >= subtotal),
  shipping_name text not null check (char_length(shipping_name) between 2 and 80),
  shipping_phone text not null check (shipping_phone ~ '^[6-9][0-9]{9}$'),
  shipping_address text not null check (char_length(shipping_address) between 5 and 300),
  shipping_city text not null check (char_length(shipping_city) between 2 and 60),
  shipping_state text not null check (char_length(shipping_state) between 2 and 60),
  shipping_pincode text not null check (shipping_pincode ~ '^[1-9][0-9]{5}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Databases set up before cash on delivery existed get the new column and status here.
alter table public.orders add column if not exists payment_method text not null default 'online';
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('online', 'cod'));
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending_payment', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled'));

-- Money for orders placed through GoKwik's checkout (section 9c). discount_total is what
-- GoKwik's coupons and offers took off, other_charges what it added (for example a cash
-- on delivery fee), amount_paid what the customer already paid online. total is what the
-- order is worth; total - amount_paid is collected in cash on delivery. Orders placed on
-- the site's own checkout keep all three at 0, so their total is the books subtotal.
alter table public.orders add column if not exists discount_total numeric(12, 2) not null default 0;
alter table public.orders add column if not exists other_charges numeric(12, 2) not null default 0;
alter table public.orders add column if not exists amount_paid numeric(12, 2) not null default 0;
alter table public.orders add column if not exists total numeric(12, 2)
  generated always as (subtotal - discount_total + other_charges) stored;
-- A test order placed through GoKwik's sandbox (no real money moved): it never gets a
-- parcel, so nothing is shipped for it.
alter table public.orders add column if not exists is_test boolean not null default false;
alter table public.orders drop constraint if exists orders_money_check;
alter table public.orders add constraint orders_money_check check (
  discount_total >= 0 and other_charges >= 0 and amount_paid >= 0
  and discount_total <= subtotal + other_charges
  and amount_paid <= subtotal - discount_total + other_charges
);

create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- A snapshot of each book at the moment of ordering, so later price or title
-- changes never alter a past order.
create table if not exists public.order_items (
  order_id uuid not null references public.orders (id) on delete cascade,
  book_id uuid references public.books (id) on delete set null,
  sku text not null,
  title text not null,
  image_url text,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  unit_mrp numeric(10, 2) not null check (unit_mrp >= unit_price),
  quantity integer not null check (quantity between 1 and 10),
  primary key (order_id, sku)
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Users view own orders" on public.orders;
create policy "Users view own orders" on public.orders
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "Users view own order items" on public.order_items;
create policy "Users view own order items" on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and ((select auth.uid()) = o.user_id or (select public.is_admin()))
    )
  );

-- Read-only from the website. All changes go through the functions below.
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;


-- -----------------------------------------------------------------------------
-- 8b. SHIPPING (Xpressbees)
-- -----------------------------------------------------------------------------
-- Parcels are booked with Xpressbees by the `shipping` Edge Function, which alone holds
-- the Xpressbees login (as a Supabase secret). The website can never write to these
-- tables: admins read them, customers see their own parcel through
-- get_my_shipments(), and the function changes them through the service role.

-- One row of settings: the automatic booking switch and the pickup warehouse as
-- registered in the Xpressbees panel. Returns go back to the same address. A new order
-- is booked straight away; the customer can still cancel until the courier picks it up.
create table if not exists public.shipping_settings (
  id boolean primary key default true check (id),
  auto_book boolean not null default true,
  warehouse_name text not null default '' check (char_length(warehouse_name) <= 100),
  pickup_name text not null default 'Kitaabaurkona' check (char_length(pickup_name) between 2 and 80),
  pickup_address text not null default '59 Nakoda Nagar, Hiran Magri Sector 3'
    check (char_length(pickup_address) between 5 and 200),
  pickup_city text not null default 'Udaipur' check (char_length(pickup_city) between 2 and 60),
  pickup_state text not null default 'Rajasthan' check (char_length(pickup_state) between 2 and 60),
  pickup_pincode text not null default '313002' check (pickup_pincode ~ '^[1-9][0-9]{5}$'),
  pickup_phone text not null default '8690965448' check (pickup_phone ~ '^[6-9][0-9]{9}$'),
  updated_at timestamptz not null default now()
);

insert into public.shipping_settings (id) values (true) on conflict (id) do nothing;
-- The old wait before booking is gone: orders are booked as soon as they are placed.
alter table public.shipping_settings drop column if exists hold_minutes;
-- Couriers never used for automatic booking (exact names as Xpressbees lists them, or
-- courier ids). The shipping function adds a courier here by itself when Xpressbees
-- answers a booking with that courier unclearly; admins can remove it again.
alter table public.shipping_settings add column if not exists skip_couriers text[] not null default '{}'::text[]
  constraint shipping_settings_skip_couriers_check check (cardinality(skip_couriers) <= 30);
-- Two carriers, chosen per parcel. New orders start with default_carrier (and are booked
-- with it at once while auto_book is on); an admin can move any parcel to the other
-- carrier until it is booked. warehouse_name is the Xpressbees warehouse;
-- delhivery_warehouse_name is the pickup location exactly as registered with Delhivery.
alter table public.shipping_settings add column if not exists default_carrier text not null default 'xpressbees'
  constraint shipping_settings_default_carrier_check check (default_carrier in ('xpressbees', 'delhivery'));
alter table public.shipping_settings add column if not exists delhivery_warehouse_name text not null default ''
  constraint shipping_settings_delhivery_warehouse_name_check check (char_length(delhivery_warehouse_name) <= 100);
-- Contact email for the pickup address. Delhivery asks for one when the pickup address
-- is registered with it as a pickup location (Admin > Shipping).
alter table public.shipping_settings add column if not exists pickup_email text not null default 'kitaabaurkona@gmail.com'
  constraint shipping_settings_pickup_email_check
  check (char_length(pickup_email) <= 120 and pickup_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$');

drop trigger if exists shipping_settings_set_updated_at on public.shipping_settings;
create trigger shipping_settings_set_updated_at
  before update on public.shipping_settings
  for each row execute function public.set_updated_at();

alter table public.shipping_settings enable row level security;

drop policy if exists "Admins view shipping settings" on public.shipping_settings;
create policy "Admins view shipping settings" on public.shipping_settings
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins edit shipping settings" on public.shipping_settings;
create policy "Admins edit shipping settings" on public.shipping_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.shipping_settings from anon, authenticated;
grant select, update on public.shipping_settings to authenticated;

-- A parcel. kind 'forward' goes to the customer; 'reverse' is a return pickup.
-- Status: queued (waiting for its booking time) -> booking -> booked (AWB and label made)
-- -> in_transit -> out_for_delivery -> delivered. While automatic booking is off, queued
-- parcels wait for an admin's "Book now". Side roads: failed (booking kept failing; an
-- admin retries), exception (delivery attempt failed, see NDR), rto (sent back to us),
-- cancel_requested -> cancelled.
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null default 'forward' check (kind in ('forward', 'reverse')),
  status text not null default 'queued' check (status in (
    'queued', 'booking', 'booked', 'in_transit', 'out_for_delivery', 'delivered',
    'exception', 'rto', 'cancel_requested', 'cancelled', 'failed'
  )),
  book_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  awb_number text unique check (awb_number ~ '^[0-9A-Za-z]{6,30}$'),
  xb_order_id text check (char_length(xb_order_id) <= 40),
  xb_shipment_id text check (char_length(xb_shipment_id) <= 40),
  xb_status text check (char_length(xb_status) <= 80),
  courier_id text check (courier_id ~ '^([0-9]{1,10}|surface|express)$'),
  courier_name text check (char_length(courier_name) <= 100),
  courier_chosen_by_admin boolean not null default false,
  freight_charges numeric(10, 2) check (freight_charges >= 0),
  cod_charges numeric(10, 2) check (cod_charges >= 0),
  total_charges numeric(10, 2) check (total_charges >= 0),
  label_url text check (label_url ~ '^https://xb-files\.s3\.amazonaws\.com/[A-Za-z0-9._/-]+$'),
  manifest_url text check (manifest_url ~ '^https://xb-files\.s3\.amazonaws\.com/[A-Za-z0-9._/-]+$'),
  package_weight_g integer check (package_weight_g between 1 and 100000),
  package_length_cm numeric(6, 1) check (package_length_cm > 0),
  package_breadth_cm numeric(6, 1) check (package_breadth_cm > 0),
  package_height_cm numeric(6, 1) check (package_height_cm > 0),
  return_details jsonb,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  last_tracked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one live parcel of each kind per order.
create unique index if not exists shipments_one_live_forward
  on public.shipments (order_id) where kind = 'forward' and status <> 'cancelled';
create unique index if not exists shipments_one_live_reverse
  on public.shipments (order_id) where kind = 'reverse' and status <> 'cancelled';
create index if not exists shipments_due_idx on public.shipments (status, book_after);

-- Set when a booking attempt ended without a clear answer (an error with no reason, a
-- timeout): Xpressbees may have booked the parcel anyway, so it is never booked again
-- automatically, and an admin must confirm they checked the Xpressbees dashboard first.
alter table public.shipments add column if not exists needs_check boolean not null default false;

-- The carrier that books, tracks and cancels this parcel. Parcels made before Delhivery
-- was added are all Xpressbees. courier_id is an Xpressbees courier number, or 'surface'
-- / 'express' for Delhivery. xb_status holds the carrier's own status wording.
alter table public.shipments add column if not exists carrier text not null default 'xpressbees'
  constraint shipments_carrier_check check (carrier in ('xpressbees', 'delhivery'));
alter table public.shipments drop constraint if exists shipments_courier_id_check;
alter table public.shipments add constraint shipments_courier_id_check
  check (courier_id ~ '^([0-9]{1,10}|surface|express)$');
create index if not exists shipments_carrier_status_idx on public.shipments (carrier, status);

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

alter table public.shipments enable row level security;

drop policy if exists "Admins view shipments" on public.shipments;
create policy "Admins view shipments" on public.shipments
  for select to authenticated
  using ((select public.is_admin()));

revoke all on public.shipments from anon, authenticated;
grant select on public.shipments to authenticated;

-- What happened to each parcel and who did it (null actor = the automatic worker).
-- Never holds tokens, passwords or full addresses.
create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid references public.shipments (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  actor uuid,
  action text not null check (char_length(action) <= 40),
  detail text check (char_length(detail) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists shipment_events_order_idx on public.shipment_events (order_id, created_at desc);
create index if not exists shipment_events_shipment_idx on public.shipment_events (shipment_id);

alter table public.shipment_events enable row level security;

drop policy if exists "Admins view shipment events" on public.shipment_events;
create policy "Admins view shipment events" on public.shipment_events
  for select to authenticated
  using ((select public.is_admin()));

revoke all on public.shipment_events from anon, authenticated;
grant select on public.shipment_events to authenticated;

-- Used only by the Edge Function (service role): the cached Xpressbees session token,
-- the PIN code answer cache and request counters for rate limits. Row Level Security is
-- on with no policies and no grants, so the website can never read or write them.
create table if not exists public.integration_tokens (
  provider text primary key check (provider in ('xpressbees')),
  token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pincode_checks (
  pincode text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  payment_type text not null check (payment_type in ('cod', 'prepaid')),
  serviceable boolean not null,
  checked_at timestamptz not null default now(),
  primary key (pincode, payment_type)
);

create table if not exists public.rate_limits (
  bucket text not null check (char_length(bucket) <= 120),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.integration_tokens enable row level security;
alter table public.pincode_checks enable row level security;
alter table public.rate_limits enable row level security;
revoke all on public.integration_tokens, public.pincode_checks, public.rate_limits from public, anon, authenticated;
grant all on public.integration_tokens, public.pincode_checks, public.rate_limits to service_role;
grant select, update on public.shipping_settings to service_role;
grant all on public.shipments, public.shipment_events to service_role;


-- -----------------------------------------------------------------------------
-- 9. ORDER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Places an order for the signed-in user. items: [{ "book_id": uuid, "quantity": 1-10 }]
-- (1 to 50 different books). shipping: { name, phone, address, city, state, pincode }.
-- payment: 'cod' (cash on delivery: confirmed at once, books taken out of stock now) or
-- 'online' (saved as awaiting payment; stock is taken when it is marked paid).
-- Prices, titles and stock come from the books table, never from the request.
-- A user can have at most 5 orders awaiting online payment at once.
drop function if exists public.create_order(jsonb, jsonb);

create or replace function public.create_order(items jsonb, shipping jsonb, payment text default 'online')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order uuid;
  v_lines integer;
  v_distinct integer;
  v_unavailable integer;
begin
  if v_user is null then
    raise exception 'Sign in to place an order' using errcode = '42501';
  end if;
  if payment is null or payment not in ('online', 'cod') then
    raise exception 'Choose a payment method' using errcode = '22023';
  end if;
  if jsonb_typeof(items) is distinct from 'array'
     or jsonb_array_length(items) not between 1 and 50 then
    raise exception 'An order needs between 1 and 50 different books' using errcode = '22023';
  end if;
  if jsonb_typeof(shipping) is distinct from 'object' then
    raise exception 'Delivery details are missing' using errcode = '22023';
  end if;
  if payment = 'online'
     and (select count(*) from public.orders where user_id = v_user and status = 'pending_payment') >= 5 then
    raise exception 'Too many orders are awaiting payment' using errcode = 'P0001', hint = 'pending_limit';
  end if;

  -- Lock the books being ordered so two orders cannot take the same last copy.
  perform 1
  from public.books b
  where b.id in (
    select (e ->> 'book_id')::uuid from jsonb_array_elements(items) as e
    where (e ->> 'book_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  for update;

  with req as (
    select (e ->> 'book_id')::uuid as book_id, (e ->> 'quantity')::integer as quantity
    from jsonb_array_elements(items) as e
  )
  select
    count(*),
    count(distinct r.book_id),
    count(*) filter (
      where b.id is null or not b.is_visible or r.quantity is null
         or r.quantity not between 1 and 10 or b.stock_quantity < r.quantity
    )
  into v_lines, v_distinct, v_unavailable
  from req r
  left join public.books b on b.id = r.book_id;

  if v_distinct <> v_lines then
    raise exception 'The same book appears twice' using errcode = '22023';
  end if;
  if v_unavailable > 0 then
    raise exception 'Some books are no longer available in that quantity'
      using errcode = 'P0001', hint = 'unavailable';
  end if;

  with req as (
    select (e ->> 'book_id')::uuid as book_id, (e ->> 'quantity')::integer as quantity
    from jsonb_array_elements(items) as e
  )
  insert into public.orders (
    user_id, status, payment_method, item_count, subtotal, mrp_total,
    shipping_name, shipping_phone, shipping_address,
    shipping_city, shipping_state, shipping_pincode
  )
  select
    v_user,
    case when payment = 'cod' then 'confirmed' else 'pending_payment' end,
    payment,
    sum(r.quantity), sum(b.price * r.quantity), sum(b.mrp * r.quantity),
    btrim(shipping ->> 'name'), btrim(shipping ->> 'phone'), btrim(shipping ->> 'address'),
    btrim(shipping ->> 'city'), btrim(shipping ->> 'state'), btrim(shipping ->> 'pincode')
  from req r
  join public.books b on b.id = r.book_id
  returning id into v_order;

  with req as (
    select (e ->> 'book_id')::uuid as book_id, (e ->> 'quantity')::integer as quantity
    from jsonb_array_elements(items) as e
  )
  insert into public.order_items (order_id, book_id, sku, title, image_url, unit_price, unit_mrp, quantity)
  select v_order, b.id, b.sku, b.title, b.image_urls[1], b.price, b.mrp, r.quantity
  from req r
  join public.books b on b.id = r.book_id;

  -- Cash on delivery is confirmed now, so its books leave stock now (rows are locked above).
  if payment = 'cod' then
    update public.books b
    set stock_quantity = b.stock_quantity - i.quantity
    from public.order_items i
    where i.order_id = v_order and b.id = i.book_id;
  end if;

  return v_order;
end;
$$;

revoke execute on function public.create_order(jsonb, jsonb, text) from public, anon;
grant execute on function public.create_order(jsonb, jsonb, text) to authenticated;

-- True once the parcel has left the warehouse (picked up or further), after which an
-- order can no longer be cancelled from the website.
create or replace function public.order_has_left(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shipments s
    where s.order_id = p_order and s.kind = 'forward'
      and s.status in ('in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto')
  );
$$;

revoke execute on function public.order_has_left(uuid) from public, anon, authenticated;

-- Lets a customer cancel their own order while it is awaiting payment, or a cash on
-- delivery order until the parcel has been picked up. Books taken from stock go back.
-- A shipment already booked with the courier is cancelled with them by the shipping
-- worker (see the orders trigger in section 10).
create or replace function public.cancel_order(p_order uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_test boolean;
begin
  select status, is_test into v_status, v_test
  from public.orders
  where id = p_order and user_id = auth.uid()
  for update;

  if v_status is null or v_status not in ('pending_payment', 'confirmed') or public.order_has_left(p_order) then
    raise exception 'This order can no longer be cancelled' using errcode = 'P0001';
  end if;

  -- A GoKwik sandbox test order never took books from stock, so none go back.
  if v_status = 'confirmed' and not v_test then
    update public.books b
    set stock_quantity = b.stock_quantity + i.quantity
    from public.order_items i
    where i.order_id = p_order and b.id = i.book_id;
  end if;

  update public.orders set status = 'cancelled' where id = p_order;
  return 'cancelled';
end;
$$;

revoke execute on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

-- Admin-only status changes. Marking an online order paid takes the books out of stock
-- (all or nothing); cancelling a paid or confirmed order puts them back. A shipped order
-- can be cancelled only after the courier returned it (shipment status rto).
create or replace function public.admin_set_order_status(p_order uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_test boolean;
  v_short integer;
  v_returned boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change orders' using errcode = '42501';
  end if;

  select status, is_test into v_current, v_test from public.orders where id = p_order for update;
  if v_current is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.shipments
    where order_id = p_order and kind = 'forward' and status = 'rto'
  ) into v_returned;

  if not (
       (v_current = 'pending_payment' and p_status in ('paid', 'cancelled'))
    or (v_current in ('paid', 'confirmed') and p_status in ('shipped', 'cancelled'))
    or (v_current = 'shipped' and p_status = 'delivered')
    or (v_current = 'shipped' and p_status = 'cancelled' and v_returned)
  ) then
    raise exception 'An order that is % cannot become %', v_current, p_status using errcode = '22023';
  end if;

  if v_current in ('paid', 'confirmed') and p_status = 'cancelled' and public.order_has_left(p_order) then
    raise exception 'This parcel has left the warehouse' using errcode = 'P0001', hint = 'shipped';
  end if;

  -- A GoKwik sandbox test order never touches stock (it shares the live database).
  if v_test then
    null;
  elsif p_status = 'paid' then
    select count(*) into v_short
    from public.order_items i
    join public.books b on b.id = i.book_id
    where i.order_id = p_order and b.stock_quantity < i.quantity;
    if v_short > 0 or exists (select 1 from public.order_items where order_id = p_order and book_id is null) then
      raise exception 'Not enough stock to mark this order paid' using errcode = 'P0001', hint = 'stock';
    end if;
    update public.books b
    set stock_quantity = b.stock_quantity - i.quantity
    from public.order_items i
    where i.order_id = p_order and b.id = i.book_id;
  elsif p_status = 'cancelled' and v_current in ('paid', 'confirmed', 'shipped') then
    update public.books b
    set stock_quantity = b.stock_quantity + i.quantity
    from public.order_items i
    where i.order_id = p_order and b.id = i.book_id;
  end if;

  update public.orders set status = p_status where id = p_order;
  return p_status;
end;
$$;

revoke execute on function public.admin_set_order_status(uuid, text) from public, anon;
grant execute on function public.admin_set_order_status(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 9b. SHIPPING FUNCTIONS
-- -----------------------------------------------------------------------------
-- Everything below except get_my_shipments() may only be called by the `shipping`
-- Edge Function (service role). The website calls the function, never these directly.

create or replace function public.log_shipment_event(
  p_shipment uuid, p_order uuid, p_actor uuid, p_action text, p_detail text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.shipment_events (shipment_id, order_id, actor, action, detail)
  values (p_shipment, p_order, p_actor, left(p_action, 40), left(p_detail, 300));
$$;

-- When an order is confirmed (cash on delivery) or marked paid, queue its parcel and ask
-- the worker to book it now. When it is cancelled, drop a parcel not booked yet, or ask
-- the worker to cancel one that is booked with Xpressbees now (possible until the
-- courier picks it up). The 5-minute jobs only catch anything these wake-ups miss.
create or replace function public.orders_shipping_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment uuid;
  v_status text;
  v_carrier text;
begin
  if new.status in ('confirmed', 'paid')
     and not new.is_test
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (
       select 1 from public.shipments
       where order_id = new.id and kind = 'forward' and status <> 'cancelled'
     ) then
    insert into public.shipments (order_id, kind, status, book_after, carrier)
    values (new.id, 'forward', 'queued', now(),
      coalesce((select default_carrier from public.shipping_settings where id), 'xpressbees'))
    returning id, carrier into v_shipment, v_carrier;
    perform public.log_shipment_event(v_shipment, new.id, null, 'queued',
      case when v_carrier = 'delhivery' then 'Delhivery' else 'Xpressbees' end);
    -- Wake the booking worker now instead of at its next 5-minute round. The request is
    -- sent only once this order is saved (pg_net sends after commit). Where the jobs are
    -- not set up (shipping_cron.sql), or the call cannot be queued, the round books it.
    begin
      if to_regprocedure('public.shipping_run_job(text)') is not null then
        execute 'select public.shipping_run_job($1)' using 'book_due';
      end if;
    exception when others then
      null;
    end;
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.shipments
    set status = case when status in ('booking', 'booked') then 'cancel_requested' else 'cancelled' end
    where order_id = new.id and kind = 'forward' and status in ('queued', 'failed', 'booking', 'booked')
    returning id, status into v_shipment, v_status;
    if v_shipment is not null then
      perform public.log_shipment_event(v_shipment, new.id, null, 'order_cancelled', null);
    end if;
    if v_status = 'cancel_requested' then
      begin
        if to_regprocedure('public.shipping_run_job(text)') is not null then
          execute 'select public.shipping_run_job($1)' using 'cancel_requested';
        end if;
      exception when others then
        null;
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_shipping_sync on public.orders;
create trigger orders_shipping_sync
  after insert or update of status on public.orders
  for each row execute function public.orders_shipping_sync();

-- The worker takes parcels whose booking time has come, at most p_limit at a time.
-- skip locked: two workers running at once never take the same parcel. A parcel stuck in
-- "booking" for 15 minutes (the worker died) is taken again; Xpressbees refuses a second
-- booking of the same order number, so it can never be booked twice.
create or replace function public.claim_due_shipments(p_limit integer default 10)
returns setof public.shipments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.shipping_settings;
begin
  select * into v_settings from public.shipping_settings where id;
  if not coalesce(v_settings.auto_book, false) then
    return;
  end if;
  -- Each carrier books only once its own warehouse name is set.
  return query
  update public.shipments s
  set status = 'booking', attempts = s.attempts + 1, last_error = null
  where s.id in (
    select id from public.shipments
    where kind = 'forward'
      and ((carrier = 'xpressbees' and v_settings.warehouse_name <> '')
        or (carrier = 'delhivery' and v_settings.delhivery_warehouse_name <> ''))
      and ((status = 'queued' and book_after <= now() and (next_attempt_at is null or next_attempt_at <= now()))
        or (status = 'booking' and updated_at < now() - interval '15 minutes'))
    order by book_after
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning s.*;
end;
$$;

-- An admin's "Book now" / "Retry": takes one parcel whatever the switch says.
create or replace function public.claim_shipment(p_shipment uuid)
returns setof public.shipments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_carrier text;
begin
  select carrier into v_carrier from public.shipments where id = p_shipment;
  if v_carrier = 'delhivery' and exists (select 1 from public.shipping_settings where id and delhivery_warehouse_name = '') then
    raise exception 'Set the Delhivery warehouse name in Admin > Shipping first' using errcode = 'P0001', hint = 'no_warehouse';
  end if;
  if v_carrier = 'xpressbees' and exists (select 1 from public.shipping_settings where id and warehouse_name = '') then
    raise exception 'Set the Xpressbees warehouse name in Admin > Shipping first' using errcode = 'P0001', hint = 'no_warehouse';
  end if;
  return query
  update public.shipments s
  set status = 'booking', attempts = s.attempts + 1, last_error = null, next_attempt_at = null, needs_check = false
  where s.id = p_shipment and s.kind = 'forward' and s.status in ('queued', 'failed')
  returning s.*;
end;
$$;

-- Everything needed to book a parcel, read from the database only.
create or replace function public.shipment_booking_data(p_shipment uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shipment', to_jsonb(s),
    'order', jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'status', o.status,
      'payment_method', o.payment_method, 'subtotal', o.subtotal,
      -- What the parcel is worth, and the cash the courier collects (0 once paid online).
      'total', o.total,
      'cod_amount', case when o.payment_method = 'cod' then o.total - o.amount_paid else 0 end,
      'name', o.shipping_name, 'phone', o.shipping_phone, 'address', o.shipping_address,
      'city', o.shipping_city, 'state', o.shipping_state, 'pincode', o.shipping_pincode
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', i.title, 'sku', i.sku, 'quantity', i.quantity, 'unit_price', i.unit_price,
        'weight_kg', b.weight_kg, 'length_cm', b.length_cm, 'breadth_cm', b.breadth_cm, 'height_cm', b.height_cm
      ) order by i.title)
      from public.order_items i
      left join public.books b on b.id = i.book_id
      where i.order_id = o.id
    ), '[]'::jsonb),
    'settings', (select to_jsonb(st) from public.shipping_settings st where st.id)
  )
  from public.shipments s
  join public.orders o on o.id = s.order_id
  where s.id = p_shipment;
$$;

-- Saves a successful booking. If the order was cancelled while the booking was in flight
-- the parcel stays cancel_requested, so the worker cancels it with Xpressbees next.
create or replace function public.record_booking(p_shipment uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  update public.shipments
  set status = case when status = 'cancel_requested' then 'cancel_requested' else 'booked' end,
      awb_number = p ->> 'awb_number',
      xb_order_id = p ->> 'xb_order_id',
      xb_shipment_id = p ->> 'xb_shipment_id',
      xb_status = p ->> 'xb_status',
      courier_id = p ->> 'courier_id',
      courier_name = p ->> 'courier_name',
      freight_charges = (p ->> 'freight_charges')::numeric,
      cod_charges = (p ->> 'cod_charges')::numeric,
      total_charges = (p ->> 'total_charges')::numeric,
      label_url = p ->> 'label_url',
      manifest_url = p ->> 'manifest_url',
      package_weight_g = (p ->> 'package_weight_g')::integer,
      package_length_cm = (p ->> 'package_length_cm')::numeric,
      package_breadth_cm = (p ->> 'package_breadth_cm')::numeric,
      package_height_cm = (p ->> 'package_height_cm')::numeric,
      routing_code = left(p ->> 'routing_code', 60),
      last_error = null,
      next_attempt_at = null,
      needs_check = false
  where id = p_shipment and status in ('booking', 'cancel_requested')
  returning order_id into v_order;
  if v_order is null then
    raise exception 'This parcel is not being booked' using errcode = 'P0001';
  end if;
  perform public.log_shipment_event(p_shipment, v_order, (p ->> 'actor')::uuid, 'booked',
    'AWB ' || (p ->> 'awb_number') || ' with ' || coalesce(p ->> 'courier_name', 'courier'));
end;
$$;

-- A booking attempt failed. Retried later (5, 20, 45, 80 minutes) unless it cannot work
-- or it has failed 5 times; then it waits for an admin.
-- p_needs_check: the attempt ended without a clear answer, so Xpressbees may have booked
-- the parcel; it is never retried by itself (see shipments.needs_check).
drop function if exists public.record_booking_failure(uuid, text, boolean, uuid);
create or replace function public.record_booking_failure(p_shipment uuid, p_error text, p_retry boolean, p_actor uuid default null, p_needs_check boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_attempts integer;
  v_status text;
begin
  select order_id, attempts, status into v_order, v_attempts, v_status
  from public.shipments where id = p_shipment for update;
  if v_order is null then
    return;
  end if;
  if v_status = 'cancel_requested' then
    update public.shipments set status = 'cancelled', last_error = left(p_error, 300), needs_check = coalesce(p_needs_check, false) where id = p_shipment;
  elsif coalesce(p_needs_check, false) then
    update public.shipments set status = 'failed', last_error = left(p_error, 300), needs_check = true where id = p_shipment;
  elsif p_retry and v_attempts < 5 then
    update public.shipments
    set status = 'queued', last_error = left(p_error, 300),
        next_attempt_at = now() + make_interval(mins => 5 * v_attempts * v_attempts)
    where id = p_shipment;
  else
    update public.shipments set status = 'failed', last_error = left(p_error, 300) where id = p_shipment;
  end if;
  perform public.log_shipment_event(p_shipment, v_order, p_actor, 'booking_failed', p_error);
end;
$$;

-- Saves the latest tracking and moves the order along: picked up -> shipped,
-- delivered -> delivered.
create or replace function public.record_tracking(p_shipment uuid, p_status text, p_xb_status text, p_history jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_old text;
  v_kind text;
begin
  if p_status not in ('booked', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto', 'cancelled') then
    raise exception 'Unknown parcel status' using errcode = '22023';
  end if;
  if jsonb_typeof(p_history) is distinct from 'array' then
    raise exception 'Tracking history must be a list' using errcode = '22023';
  end if;
  select order_id, status, kind into v_order, v_old, v_kind
  from public.shipments where id = p_shipment for update;
  if v_order is null then
    return;
  end if;
  update public.shipments
  set status = case when v_old = 'cancel_requested' and p_status = 'booked' then v_old else p_status end,
      xb_status = left(p_xb_status, 80),
      history = p_history,
      last_tracked_at = now()
  where id = p_shipment;
  if v_kind = 'forward' then
    if p_status in ('in_transit', 'out_for_delivery', 'exception') then
      update public.orders set status = 'shipped' where id = v_order and status in ('confirmed', 'paid');
    elsif p_status = 'delivered' then
      update public.orders set status = 'delivered' where id = v_order and status in ('confirmed', 'paid', 'shipped');
    end if;
  end if;
  if v_old is distinct from p_status then
    perform public.log_shipment_event(p_shipment, v_order, null, 'status_' || p_status, left(p_xb_status, 80));
  end if;
end;
$$;

-- Parcels whose tracking should be refreshed (not checked in the last p_minutes).
create or replace function public.shipments_to_track(p_minutes integer default 110, p_limit integer default 50)
returns setof public.shipments
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.shipments
  where awb_number is not null
    and status in ('booked', 'in_transit', 'out_for_delivery', 'exception')
    and (last_tracked_at is null or last_tracked_at < now() - make_interval(mins => p_minutes))
  order by last_tracked_at nulls first
  limit greatest(1, least(p_limit, 200));
$$;

-- Counts one request in a time window; false once the limit is reached.
create or replace function public.hit_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (bucket, window_start, hits)
  values (left(p_bucket, 120), v_window, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;

-- What a customer may see about their own order's parcel (admins: any order).
-- No label, charges, errors or courier account details.
create or replace function public.get_my_shipments(p_order uuid)
returns table (
  kind text, status text, awb_number text, courier_name text,
  history jsonb, last_tracked_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.kind, s.status, s.awb_number, s.courier_name, s.history, s.last_tracked_at, s.updated_at
  from public.shipments s
  join public.orders o on o.id = s.order_id
  where s.order_id = p_order
    and (o.user_id = (select auth.uid()) or (select public.is_admin()))
  order by s.created_at;
$$;

revoke execute on function public.log_shipment_event(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.orders_shipping_sync() from public, anon, authenticated;
revoke execute on function public.claim_due_shipments(integer) from public, anon, authenticated;
revoke execute on function public.claim_shipment(uuid) from public, anon, authenticated;
revoke execute on function public.shipment_booking_data(uuid) from public, anon, authenticated;
revoke execute on function public.record_booking(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.record_booking_failure(uuid, text, boolean, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.record_tracking(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.shipments_to_track(integer, integer) from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.order_has_left(uuid) from public, anon, authenticated;

grant execute on function public.log_shipment_event(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.claim_due_shipments(integer) to service_role;
grant execute on function public.claim_shipment(uuid) to service_role;
grant execute on function public.shipment_booking_data(uuid) to service_role;
grant execute on function public.record_booking(uuid, jsonb) to service_role;
grant execute on function public.record_booking_failure(uuid, text, boolean, uuid, boolean) to service_role;
grant execute on function public.record_tracking(uuid, text, text, jsonb) to service_role;
grant execute on function public.shipments_to_track(integer, integer) to service_role;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.order_has_left(uuid) to service_role;

-- Puts a courier on the automatic-booking skip list (once), from the shipping function.
create or replace function public.add_skip_courier(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shipping_settings
  set skip_couriers = array_append(skip_couriers, left(btrim(p_name), 100))
  where id
    and btrim(coalesce(p_name, '')) <> ''
    and not (lower(btrim(p_name)) = any (select lower(x) from unnest(skip_couriers) x))
    and cardinality(skip_couriers) < 30;
$$;

revoke execute on function public.add_skip_courier(text) from public, anon, authenticated;
grant execute on function public.add_skip_courier(text) to service_role;

-- A parcel was cancelled with Xpressbees (or never got booked).
create or replace function public.record_cancelled(p_shipment uuid, p_actor uuid default null, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  update public.shipments set status = 'cancelled'
  where id = p_shipment and status in ('queued', 'failed', 'booking', 'booked', 'cancel_requested')
  returning order_id into v_order;
  if v_order is not null then
    perform public.log_shipment_event(p_shipment, v_order, p_actor, 'cancelled', p_detail);
  end if;
end;
$$;

-- An admin picked a different courier for a parcel that is not booked yet.
create or replace function public.set_shipment_courier(p_shipment uuid, p_courier_id text, p_courier_name text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  update public.shipments
  set courier_id = p_courier_id, courier_name = left(p_courier_name, 100), courier_chosen_by_admin = true
  where id = p_shipment and status in ('queued', 'failed')
  returning order_id into v_order;
  if v_order is null then
    raise exception 'The courier can only be changed before booking' using errcode = 'P0001';
  end if;
  perform public.log_shipment_event(p_shipment, v_order, p_actor, 'courier_set', p_courier_name);
end;
$$;

-- An admin moved a parcel that is not booked yet to the other carrier. The courier choice
-- belonged to the old carrier, so it is cleared, and so is the "check the panel" hold
-- (the shipping function asks the admin to confirm that check before calling this).
create or replace function public.set_shipment_carrier(p_shipment uuid, p_carrier text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_old text;
begin
  if p_carrier not in ('xpressbees', 'delhivery') then
    raise exception 'Unknown carrier' using errcode = '22023';
  end if;
  select carrier into v_old from public.shipments
  where id = p_shipment and kind = 'forward' and status in ('queued', 'failed')
  for update;
  if v_old is null then
    raise exception 'The carrier can only be changed before booking' using errcode = 'P0001';
  end if;
  update public.shipments
  set carrier = p_carrier, courier_id = null, courier_name = null, courier_chosen_by_admin = false,
      needs_check = false, last_error = null, next_attempt_at = null, attempts = 0
  where id = p_shipment
  returning order_id into v_order;
  perform public.log_shipment_event(p_shipment, v_order, p_actor, 'carrier_set',
    case when v_old = 'delhivery' then 'Delhivery' else 'Xpressbees' end || ' -> ' ||
    case when p_carrier = 'delhivery' then 'Delhivery' else 'Xpressbees' end);
end;
$$;

revoke execute on function public.set_shipment_carrier(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_shipment_carrier(uuid, text, uuid) to service_role;

-- Starts a return pickup for a delivered order (one live return per order), with the
-- carrier that delivered it.
drop function if exists public.create_return_shipment(uuid, uuid);
create or replace function public.create_return_shipment(p_order uuid, p_actor uuid, p_carrier text default 'xpressbees')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.orders where id = p_order and status = 'delivered') then
    raise exception 'Only a delivered order can be picked up for return' using errcode = 'P0001';
  end if;
  if p_carrier not in ('xpressbees', 'delhivery') then
    raise exception 'Unknown carrier' using errcode = '22023';
  end if;
  insert into public.shipments (order_id, kind, status, attempts, carrier)
  values (p_order, 'reverse', 'booking', 1, p_carrier)
  returning id into v_id;
  perform public.log_shipment_event(v_id, p_order, p_actor, 'return_requested', null);
  return v_id;
end;
$$;

-- Cached answers to "does Xpressbees deliver to this PIN code?" (null = not cached).
create or replace function public.get_pincode_check(p_pincode text, p_payment_type text, p_max_age_minutes integer default 1440)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select serviceable from public.pincode_checks
  where pincode = p_pincode and payment_type = p_payment_type
    and checked_at > now() - make_interval(mins => p_max_age_minutes);
$$;

create or replace function public.save_pincode_check(p_pincode text, p_payment_type text, p_serviceable boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pincode_checks (pincode, payment_type, serviceable, checked_at)
  values (p_pincode, p_payment_type, p_serviceable, now())
  on conflict (pincode, payment_type) do update set serviceable = excluded.serviceable, checked_at = now();
$$;

-- The cached Xpressbees session token (expires after a few hours).
create or replace function public.xb_token_get()
returns table (token text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select token, expires_at from public.integration_tokens where provider = 'xpressbees' and expires_at > now();
$$;

create or replace function public.xb_token_set(p_token text, p_expires_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.integration_tokens (provider, token, expires_at, updated_at)
  values ('xpressbees', p_token, p_expires_at, now())
  on conflict (provider) do update set token = excluded.token, expires_at = excluded.expires_at, updated_at = now();
$$;

revoke execute on function public.record_cancelled(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.set_shipment_courier(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.create_return_shipment(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.get_pincode_check(text, text, integer) from public, anon, authenticated;
revoke execute on function public.save_pincode_check(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.xb_token_get() from public, anon, authenticated;
revoke execute on function public.xb_token_set(text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_cancelled(uuid, uuid, text) to service_role;
grant execute on function public.set_shipment_courier(uuid, text, text, uuid) to service_role;
grant execute on function public.create_return_shipment(uuid, uuid, text) to service_role;
grant execute on function public.get_pincode_check(text, text, integer) to service_role;
grant execute on function public.save_pincode_check(text, text, boolean) to service_role;
grant execute on function public.xb_token_get() to service_role;
grant execute on function public.xb_token_set(text, timestamptz) to service_role;


revoke execute on function public.get_my_shipments(uuid) from public, anon;
grant execute on function public.get_my_shipments(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 9c. GOKWIK CHECKOUT (online payment and cash on delivery through GoKwik)
-- -----------------------------------------------------------------------------
-- How it fits together:
--   1. The website saves the books being bought as a checkout cart
--      (create_checkout_cart) and opens GoKwik's checkout with the cart's id.
--   2. GoKwik's servers read that cart, send the delivery address and finally place the
--      order, all through the `gokwik` Edge Function (service role), which calls the
--      gokwik_* functions below. The website itself can never mark an order paid.
--   3. Order and parcel changes that GoKwik must hear about (AWB, cancellation, refund)
--      are queued in gokwik_order_updates and sent by the same Edge Function.
-- Prices are fixed when the cart is made, from the books table, so the customer pays
-- exactly what GoKwik showed. Stock is checked again, with the rows locked, when the
-- order is placed.
-- A customer has one open cart at a time, and its id stays the same until it becomes an
-- order: "<user id>-<n>", n counting that customer's carts from 1. GoKwik matches its
-- abandoned-cart reminders to the customer by it.

create table if not exists public.checkout_carts (
  id text primary key check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[1-9][0-9]{0,6}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  seq integer not null check (seq >= 1),
  -- How often checkout was started on this cart since starts_since (at most 30 an hour).
  starts integer not null default 1 check (starts >= 0),
  starts_since timestamptz not null default now(),
  -- [{ book_id, sku, title, image_url, author, unit_price, unit_mrp, quantity }]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  item_count integer not null check (item_count between 1 and 500),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  mrp_total numeric(12, 2) not null check (mrp_total >= subtotal),
  -- The site the checkout was started from (live or test), for the link back to the order.
  site text check (site is null or site ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$'),
  -- The delivery address GoKwik sent last, with whether the PIN code can be served.
  shipping jsonb check (shipping is null or jsonb_typeof(shipping) = 'object'),
  order_id uuid unique references public.orders (id) on delete set null,
  ordered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (user_id, seq),
  check (id = user_id::text || '-' || seq::text)
);

-- At most one cart per customer that is not an order yet. ordered_at (not order_id, which
-- empties if the order row is ever removed) is what closes a cart for good.
create unique index if not exists checkout_carts_one_open_idx on public.checkout_carts (user_id) where ordered_at is null;

drop trigger if exists checkout_carts_set_updated_at on public.checkout_carts;
create trigger checkout_carts_set_updated_at
  before update on public.checkout_carts
  for each row execute function public.set_updated_at();

-- How each GoKwik order was paid. Admins can read it; only the Edge Function writes it.
create table if not exists public.order_payments (
  order_id uuid primary key references public.orders (id) on delete cascade,
  provider text not null default 'gokwik' check (provider in ('gokwik')),
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  cart_id text check (char_length(cart_id) <= 100),
  method text not null check (method in ('prepaid', 'cod', 'pp-cod')),
  payment_id text check (char_length(payment_id) <= 100),
  gateway_payment_id text check (char_length(gateway_payment_id) <= 100),
  instrument text check (char_length(instrument) <= 40),
  gokwik_order_id text check (char_length(gokwik_order_id) <= 100),
  rto_risk text check (char_length(rto_risk) <= 40),
  discounts jsonb not null default '[]'::jsonb check (jsonb_typeof(discounts) = 'array' and octet_length(discounts::text) <= 4000),
  charges jsonb not null default '[]'::jsonb check (jsonb_typeof(charges) = 'array' and octet_length(charges::text) <= 4000),
  refund_status text check (refund_status in ('requested', 'initiated', 'pending', 'successful', 'failed', 'auto_refund')),
  refunded_amount numeric(12, 2) not null default 0 check (refunded_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One payment can pay for one order only.
create unique index if not exists order_payments_payment_id_key
  on public.order_payments (payment_id) where payment_id is not null and payment_id <> '';
create index if not exists order_payments_gokwik_order_idx on public.order_payments (gokwik_order_id);

drop trigger if exists order_payments_set_updated_at on public.order_payments;
create trigger order_payments_set_updated_at
  before update on public.order_payments
  for each row execute function public.set_updated_at();

-- Payment and refund notices from GoKwik (webhooks), each kept once.
create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'gokwik' check (provider in ('gokwik')),
  event text not null check (char_length(event) between 1 and 40),
  payment_id text not null check (char_length(payment_id) between 1 and 100),
  reference_id text check (char_length(reference_id) <= 100),
  cart_id text check (char_length(cart_id) <= 100),
  order_id uuid references public.orders (id) on delete set null,
  amount numeric(12, 2) not null default 0,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2000),
  received_at timestamptz not null default now(),
  unique (event, payment_id)
);

-- What GoKwik must be told about an order (its Update Order API): the parcel's AWB and
-- status, a cancellation, and with refund_amount a refund of money paid online.
create table if not exists public.gokwik_order_updates (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  order_status text not null check (order_status in ('Confirmed', 'Pending', 'Failed', 'Cancelled')),
  awb_number text check (char_length(awb_number) <= 30),
  awb_status text check (char_length(awb_status) <= 40),
  shipping_provider text check (char_length(shipping_provider) <= 100),
  order_note text check (char_length(order_note) <= 200),
  refund_amount numeric(12, 2) check (refund_amount is null or refund_amount > 0),
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  last_error text check (char_length(last_error) <= 300),
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists gokwik_order_updates_due_idx on public.gokwik_order_updates (state, next_try_at);

alter table public.checkout_carts enable row level security;
alter table public.order_payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.gokwik_order_updates enable row level security;

drop policy if exists "Admins view order payments" on public.order_payments;
create policy "Admins view order payments" on public.order_payments
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins view payment events" on public.payment_events;
create policy "Admins view payment events" on public.payment_events
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins view GoKwik updates" on public.gokwik_order_updates;
create policy "Admins view GoKwik updates" on public.gokwik_order_updates
  for select to authenticated using ((select public.is_admin()));

-- checkout_carts has no policy on purpose: the website uses the two functions below.
revoke all on public.checkout_carts, public.order_payments, public.payment_events, public.gokwik_order_updates
  from public, anon, authenticated;
grant select on public.order_payments, public.payment_events, public.gokwik_order_updates to authenticated;
grant all on public.checkout_carts, public.order_payments, public.payment_events, public.gokwik_order_updates to service_role;

-- Puts the books being bought into the signed-in customer's open checkout cart and
-- returns its id, which the website hands to GoKwik. The id stays the same on every
-- start until the cart becomes an order; the next start then opens "<user id>-<n+1>".
-- p_items: [{ "book_id": uuid, "quantity": 1-10 }] (1 to 50 different books). Prices,
-- titles and stock come from the books table.
create or replace function public.create_checkout_cart(p_items jsonb, p_site text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_open public.checkout_carts%rowtype;
  v_seq integer;
  v_id text;
  v_lines integer;
  v_distinct integer;
  v_unavailable integer;
  v_items jsonb;
  v_count integer;
  v_subtotal numeric;
  v_mrp numeric;
  v_site text := case when p_site ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$' then p_site end;
begin
  if v_user is null then
    raise exception 'Sign in to check out' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'A checkout needs between 1 and 50 different books' using errcode = '22023';
  end if;

  -- One start at a time per customer, so two tabs cannot open two carts.
  perform pg_advisory_xact_lock(hashtextextended('checkout_cart:' || v_user::text, 0));

  if (select coalesce(sum(starts), 0) from public.checkout_carts
      where user_id = v_user and starts_since > now() - interval '1 hour') >= 30 then
    raise exception 'Too many checkouts were started' using errcode = 'P0001', hint = 'cart_limit';
  end if;

  with req as (
    select (e ->> 'book_id')::uuid as book_id, (e ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as e
  )
  select
    count(*),
    count(distinct r.book_id),
    count(*) filter (
      where b.id is null or not b.is_visible or r.quantity is null
         or r.quantity not between 1 and 10 or b.stock_quantity < r.quantity
    )
  into v_lines, v_distinct, v_unavailable
  from req r
  left join public.books b on b.id = r.book_id;

  if v_distinct <> v_lines then
    raise exception 'The same book appears twice' using errcode = '22023';
  end if;
  if v_unavailable > 0 then
    raise exception 'Some books are no longer available in that quantity'
      using errcode = 'P0001', hint = 'unavailable';
  end if;

  with req as (
    select (e ->> 'book_id')::uuid as book_id, (e ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as e
  )
  select
    jsonb_agg(jsonb_build_object(
      'book_id', b.id, 'sku', b.sku, 'title', b.title, 'image_url', b.image_urls[1],
      'author', nullif(left(btrim(b.attributes ->> 'author'), 120), ''),
      'unit_price', b.price, 'unit_mrp', b.mrp, 'quantity', r.quantity
    ) order by b.title),
    sum(r.quantity), sum(b.price * r.quantity), sum(b.mrp * r.quantity)
  into v_items, v_count, v_subtotal, v_mrp
  from req r
  join public.books b on b.id = r.book_id;

  select * into v_open from public.checkout_carts
  where user_id = v_user and ordered_at is null
  for update;

  if found then
    -- Same cart, same id: its books, prices and expiry are brought up to date. The
    -- delivery address GoKwik saved stays.
    update public.checkout_carts
    set items = v_items, item_count = v_count, subtotal = v_subtotal, mrp_total = v_mrp,
        site = v_site, abandoned_at = null,
        expires_at = now() + interval '24 hours',
        starts = case when starts_since > now() - interval '1 hour' then starts + 1 else 1 end,
        starts_since = case when starts_since > now() - interval '1 hour' then starts_since else now() end
    where id = v_open.id;
    return v_open.id;
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from public.checkout_carts where user_id = v_user;
  v_id := v_user::text || '-' || v_seq::text;
  insert into public.checkout_carts (id, user_id, seq, items, item_count, subtotal, mrp_total, site)
  values (v_id, v_user, v_seq, v_items, v_count, v_subtotal, v_mrp, v_site);

  return v_id;
end;
$$;

revoke execute on function public.create_checkout_cart(jsonb, text) from public, anon;
grant execute on function public.create_checkout_cart(jsonb, text) to authenticated;

-- The order made from one of the caller's own checkout carts (null until it is placed).
create or replace function public.checkout_cart_order(p_cart text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select order_id from public.checkout_carts where id = p_cart and user_id = auth.uid();
$$;

revoke execute on function public.checkout_cart_order(text) from public, anon;
grant execute on function public.checkout_cart_order(text) to authenticated;

-- Everything below may only be called by the `gokwik` Edge Function (service role).

-- A checkout cart with today's stock beside each book, and its order once placed.
create or replace function public.gokwik_cart(p_cart text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'user_id', c.user_id, 'site', c.site, 'shipping', c.shipping,
    'expired', c.expires_at < now(), 'ordered', c.ordered_at is not null,
    'item_count', c.item_count, 'subtotal', c.subtotal, 'mrp_total', c.mrp_total,
    'items', (
      select jsonb_agg(i.item || jsonb_build_object('salable_qty', coalesce((
        select case when b.is_visible then b.stock_quantity else 0 end
        from public.books b where b.id = (i.item ->> 'book_id')::uuid
      ), 0)) order by i.ord)
      from jsonb_array_elements(c.items) with ordinality as i(item, ord)
    ),
    'order', (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status)
      from public.orders o where o.id = c.order_id
    )
  )
  from public.checkout_carts c
  where c.id = p_cart;
$$;

create or replace function public.gokwik_set_address(p_cart text, p_shipping jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checkout_carts set shipping = p_shipping
  where id = p_cart and ordered_at is null;
  return found;
end;
$$;

-- Turns a checkout cart into an order once GoKwik says how it is paid. p:
--   method           'prepaid' (paid in full online), 'cod', or 'pp-cod' (part paid online,
--                    the rest in cash on delivery)
--   payment_amount   what the order comes to after GoKwik's discounts and charges
--   discount_total, other_charges, prepaid_amount (pp-cod only)
--   shipping         { name, phone, address, city, state, pincode }
--   environment      'production' or 'sandbox' (a sandbox order is a test: no parcel)
--   payment_id, gateway_payment_id, instrument, gokwik_order_id, rto_risk, discounts, charges
-- Answers { status }: placed / exists (with order_id and order_number), or why not:
-- invalid_cart, expired, invalid_method, amount_mismatch, unavailable, invalid_address,
-- duplicate_payment. Calling it again for the same cart returns the same order, so a
-- retry can never make a second one.
create or replace function public.gokwik_place_order(p_cart text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.checkout_carts%rowtype;
  v_order uuid;
  v_number bigint;
  v_method text := p ->> 'method';
  v_amount numeric := (p ->> 'payment_amount')::numeric;
  v_discount numeric := coalesce((p ->> 'discount_total')::numeric, 0);
  v_charges numeric := coalesce((p ->> 'other_charges')::numeric, 0);
  v_paid numeric;
  v_diff numeric;
  v_ship jsonb := coalesce(p -> 'shipping', '{}'::jsonb);
  v_environment text := case when p ->> 'environment' = 'sandbox' then 'sandbox' else 'production' end;
  v_unavailable integer;
begin
  if v_method is null or v_method not in ('prepaid', 'cod', 'pp-cod') then
    return jsonb_build_object('status', 'invalid_method');
  end if;

  select * into v_cart from public.checkout_carts where id = p_cart for update;
  if not found then
    return jsonb_build_object('status', 'invalid_cart');
  end if;
  if v_cart.order_id is not null then
    select order_number into v_number from public.orders where id = v_cart.order_id;
    return jsonb_build_object('status', 'exists', 'order_id', v_cart.order_id, 'order_number', v_number);
  end if;
  if v_cart.ordered_at is not null then
    return jsonb_build_object('status', 'invalid_cart');
  end if;
  if v_cart.expires_at + interval '1 hour' < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  -- The amount must be explained by the cart: never less than the books minus the
  -- discounts GoKwik lists, never more than the books plus the charges it lists (one
  -- rupee of rounding either way).
  if v_amount is null or v_amount < 0 or v_discount < 0 or v_charges < 0
     or v_amount < v_cart.subtotal - v_discount - 1
     or v_amount > v_cart.subtotal + v_charges + 1 then
    return jsonb_build_object('status', 'amount_mismatch');
  end if;
  -- Discount and charges are then settled so the order total is exactly that amount.
  v_diff := v_amount - (v_cart.subtotal - v_discount);
  if v_diff >= 0 then
    v_charges := v_diff;
  else
    v_discount := v_discount - v_diff;
    v_charges := 0;
  end if;

  v_paid := case v_method
    when 'prepaid' then v_amount
    when 'cod' then 0
    else coalesce((p ->> 'prepaid_amount')::numeric, -1)
  end;
  if v_paid < 0 or v_paid > v_amount then
    return jsonb_build_object('status', 'amount_mismatch');
  end if;

  -- Lock the books so two orders cannot take the same last copy.
  perform 1
  from public.books b
  where b.id in (select (e ->> 'book_id')::uuid from jsonb_array_elements(v_cart.items) as e)
  for update;

  select count(*) into v_unavailable
  from jsonb_array_elements(v_cart.items) as e
  left join public.books b on b.id = (e ->> 'book_id')::uuid
  where b.id is null or not b.is_visible or b.stock_quantity < (e ->> 'quantity')::integer;
  if v_unavailable > 0 then
    return jsonb_build_object('status', 'unavailable');
  end if;

  begin
    insert into public.orders (
      user_id, status, payment_method, item_count, subtotal, mrp_total,
      discount_total, other_charges, amount_paid, is_test,
      shipping_name, shipping_phone, shipping_address,
      shipping_city, shipping_state, shipping_pincode
    )
    values (
      v_cart.user_id,
      case when v_method = 'prepaid' then 'paid' else 'confirmed' end,
      case when v_method = 'prepaid' then 'online' else 'cod' end,
      v_cart.item_count, v_cart.subtotal, v_cart.mrp_total,
      v_discount, v_charges, v_paid, v_environment = 'sandbox',
      btrim(v_ship ->> 'name'), btrim(v_ship ->> 'phone'), btrim(v_ship ->> 'address'),
      btrim(v_ship ->> 'city'), btrim(v_ship ->> 'state'), btrim(v_ship ->> 'pincode')
    )
    returning id, order_number into v_order, v_number;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('status', 'invalid_address');
  end;

  insert into public.order_items (order_id, book_id, sku, title, image_url, unit_price, unit_mrp, quantity)
  select
    v_order, (e ->> 'book_id')::uuid, e ->> 'sku', e ->> 'title', e ->> 'image_url',
    (e ->> 'unit_price')::numeric, (e ->> 'unit_mrp')::numeric, (e ->> 'quantity')::integer
  from jsonb_array_elements(v_cart.items) as e;

  -- Paid or confirmed straight away, so the books leave stock now. A sandbox test order
  -- takes nothing: the test shop shares the live database and its stock.
  if v_environment <> 'sandbox' then
    update public.books b
    set stock_quantity = b.stock_quantity - i.quantity
    from public.order_items i
    where i.order_id = v_order and b.id = i.book_id;
  end if;

  insert into public.order_payments (
    order_id, environment, cart_id, method, payment_id, gateway_payment_id, instrument,
    gokwik_order_id, rto_risk, discounts, charges
  )
  values (
    v_order, v_environment, p_cart, v_method,
    nullif(left(p ->> 'payment_id', 100), ''), nullif(left(p ->> 'gateway_payment_id', 100), ''),
    nullif(left(p ->> 'instrument', 40), ''), nullif(left(p ->> 'gokwik_order_id', 100), ''),
    nullif(left(p ->> 'rto_risk', 40), ''),
    case when jsonb_typeof(p -> 'discounts') = 'array' then p -> 'discounts' else '[]'::jsonb end,
    case when jsonb_typeof(p -> 'charges') = 'array' then p -> 'charges' else '[]'::jsonb end
  );

  update public.checkout_carts set order_id = v_order, ordered_at = now(), shipping = v_ship where id = p_cart;

  return jsonb_build_object('status', 'placed', 'order_id', v_order, 'order_number', v_number);
exception when unique_violation then
  -- The same payment was already used for another order: nothing above is kept.
  return jsonb_build_object('status', 'duplicate_payment');
end;
$$;

-- Wakes the worker that sends queued updates to GoKwik, where the job is set up
-- (gokwik_cron.sql). Its 5-minute round sends anything this misses.
create or replace function public.gokwik_wake()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('public.gokwik_run_job(text)') is not null then
    execute 'select public.gokwik_run_job($1)' using 'push_updates';
  end if;
exception when others then
  null;
end;
$$;

-- Records a payment or refund notice once and applies it to the order it belongs to:
--   transaction.auto_refund  GoKwik is returning the money by itself, so an order that
--                            has not left the warehouse is cancelled and its books go
--                            back into stock
--   refund.*                 the refund's progress is noted on the order's payment
-- p: { event, payment_id, transaction_payment_id, reference_id, cart_id, amount, detail }
create or replace function public.gokwik_record_event(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text := left(p ->> 'event', 40);
  v_payment text := left(p ->> 'payment_id', 100);
  v_amount numeric := coalesce((p ->> 'amount')::numeric, 0);
  v_order uuid;
  v_status text;
  v_test boolean;
  v_cancelled boolean := false;
begin
  insert into public.payment_events (event, payment_id, reference_id, cart_id, amount, detail)
  values (
    v_event, v_payment, left(p ->> 'reference_id', 100), left(p ->> 'cart_id', 100), v_amount,
    case when jsonb_typeof(p -> 'detail') = 'object' then p -> 'detail' else '{}'::jsonb end
  )
  on conflict (event, payment_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
  end if;

  select op.order_id into v_order
  from public.order_payments op
  where op.payment_id = coalesce(nullif(p ->> 'transaction_payment_id', ''), v_payment)
     or op.gokwik_order_id = nullif(p ->> 'reference_id', '')
     or op.cart_id = nullif(p ->> 'cart_id', '')
  order by op.created_at desc
  limit 1;
  if v_order is null then
    return jsonb_build_object('matched', false);
  end if;
  update public.payment_events set order_id = v_order where event = v_event and payment_id = v_payment;

  if v_event = 'transaction.auto_refund' then
    -- Noted first, so cancelling below does not ask GoKwik for a second refund.
    update public.order_payments set refund_status = 'auto_refund' where order_id = v_order;
    select status, is_test into v_status, v_test from public.orders where id = v_order for update;
    if v_status in ('paid', 'confirmed') and not public.order_has_left(v_order) then
      -- A sandbox test order took no books, so none go back.
      if not v_test then
        update public.books b
        set stock_quantity = b.stock_quantity + i.quantity
        from public.order_items i
        where i.order_id = v_order and b.id = i.book_id;
      end if;
      update public.orders set status = 'cancelled' where id = v_order;
      v_cancelled := true;
    end if;
  elsif v_event like 'refund.%' then
    update public.order_payments
    set refund_status = case v_event
          when 'refund.successful' then 'successful'
          when 'refund.failure' then 'failed'
          when 'refund.pending' then 'pending'
          else 'initiated'
        end,
        refunded_amount = refunded_amount + case when v_event = 'refund.successful' then v_amount else 0 end
    where order_id = v_order
      and (refund_status is distinct from 'successful' or v_event = 'refund.successful');
  end if;

  return jsonb_build_object('matched', true, 'order_id', v_order, 'cancelled', v_cancelled);
end;
$$;

-- Marks carts GoKwik reports as abandoned (started but never ordered). p_carts: ["id", ...]
create or replace function public.gokwik_mark_abandoned(p_carts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.checkout_carts set abandoned_at = now()
  where id in (select jsonb_array_elements_text(p_carts)) and ordered_at is null and abandoned_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A cancelled GoKwik order is reported to GoKwik, and money paid online for it is
-- refunded through GoKwik (once: never when a refund is already under way).
create or replace function public.gokwik_order_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.order_payments%rowtype;
  v_refund numeric;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    select * into v_pay from public.order_payments where order_id = new.id;
    if found then
      v_refund := case when new.amount_paid > 0 and v_pay.refund_status is null then new.amount_paid end;
      insert into public.gokwik_order_updates (order_id, environment, order_status, order_note, refund_amount)
      values (new.id, v_pay.environment, 'Cancelled', 'Order cancelled', v_refund);
      if v_refund is not null then
        update public.order_payments set refund_status = 'requested' where order_id = new.id;
      end if;
      perform public.gokwik_wake();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_gokwik_sync on public.orders;
create trigger orders_gokwik_sync
  after update of status on public.orders
  for each row execute function public.gokwik_order_changed();

-- A GoKwik order's parcel: its AWB and every change of status are reported to GoKwik.
create or replace function public.gokwik_shipment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'forward' and new.awb_number is not null
     and new.status in ('booked', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto')
     and (tg_op = 'INSERT' or old.status is distinct from new.status
          or old.awb_number is distinct from new.awb_number) then
    insert into public.gokwik_order_updates (order_id, environment, order_status, awb_number, awb_status, shipping_provider)
    select new.order_id, op.environment, 'Confirmed', new.awb_number, new.status,
      left(coalesce(nullif(new.courier_name, ''), initcap(new.carrier)), 100)
    from public.order_payments op
    where op.order_id = new.order_id;
    if found then
      perform public.gokwik_wake();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_gokwik_sync on public.shipments;
create trigger shipments_gokwik_sync
  after insert or update of status, awb_number on public.shipments
  for each row execute function public.gokwik_shipment_changed();

-- The worker takes updates that are due for the given environments (["production",
-- "sandbox"]), oldest first, at most p_limit at a time. A
-- taken update is tried again after 10 minutes if the worker never reports back.
create or replace function public.gokwik_claim_updates(p_environments jsonb, p_limit integer default 20)
returns table (
  id bigint, order_id uuid, order_number bigint, environment text, order_status text,
  awb_number text, awb_status text, shipping_provider text, order_note text,
  refund_amount numeric, attempts integer
)
language sql
security definer
set search_path = ''
as $$
  update public.gokwik_order_updates u
  set attempts = u.attempts + 1, next_try_at = now() + interval '10 minutes'
  from public.orders o
  where o.id = u.order_id
    and u.id in (
      select q.id from public.gokwik_order_updates q
      where q.state = 'pending' and q.next_try_at <= now() and q.environment in (select jsonb_array_elements_text(p_environments))
      order by q.id
      limit greatest(1, least(coalesce(p_limit, 20), 50))
      for update skip locked
    )
  returning u.id, u.order_id, o.order_number, u.environment, u.order_status,
    u.awb_number, u.awb_status, u.shipping_provider, u.order_note, u.refund_amount, u.attempts;
$$;

-- Sent, or to be tried again later (given up after 8 tries and left as failed). p_final
-- stops further tries at once: a refund request that got no clear answer may have gone
-- through, so it is never sent again automatically.
create or replace function public.gokwik_update_done(p_id bigint, p_ok boolean, p_error text default null, p_final boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gokwik_order_updates
  set state = case when p_ok then 'sent' when p_final or attempts >= 8 then 'failed' else 'pending' end,
      sent_at = case when p_ok then now() else sent_at end,
      last_error = case when p_ok then null else left(p_error, 300) end,
      next_try_at = case when p_ok then next_try_at else now() + least(attempts, 6) * interval '10 minutes' end
  where id = p_id;
$$;

revoke execute on function public.gokwik_cart(text) from public, anon, authenticated;
revoke execute on function public.gokwik_set_address(text, jsonb) from public, anon, authenticated;
revoke execute on function public.gokwik_place_order(text, jsonb) from public, anon, authenticated;
revoke execute on function public.gokwik_wake() from public, anon, authenticated;
revoke execute on function public.gokwik_record_event(jsonb) from public, anon, authenticated;
revoke execute on function public.gokwik_mark_abandoned(jsonb) from public, anon, authenticated;
revoke execute on function public.gokwik_order_changed() from public, anon, authenticated;
revoke execute on function public.gokwik_shipment_changed() from public, anon, authenticated;
revoke execute on function public.gokwik_claim_updates(jsonb, integer) from public, anon, authenticated;
revoke execute on function public.gokwik_update_done(bigint, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.gokwik_cart(text) to service_role;
grant execute on function public.gokwik_set_address(text, jsonb) to service_role;
grant execute on function public.gokwik_place_order(text, jsonb) to service_role;
grant execute on function public.gokwik_record_event(jsonb) to service_role;
grant execute on function public.gokwik_mark_abandoned(jsonb) to service_role;
grant execute on function public.gokwik_claim_updates(jsonb, integer) to service_role;
grant execute on function public.gokwik_update_done(bigint, boolean, text, boolean) to service_role;




-- Make the website's API see the new tables immediately.
notify pgrst, 'reload schema';

commit;


-- -----------------------------------------------------------------------------
-- 9d. PROCESS ORDERS (admin: Print -> Pack -> Handover, notes, address fixes)
-- -----------------------------------------------------------------------------
-- Where each order still to ship stands in the packing workflow, and the admins' own
-- note about it. Kept apart from orders, which customers can read, so a customer never
-- sees the note. The website only reads this table; the functions below change it.
--   Print        label not printed yet       (label_printed_at is null)
--   Pack         label printed, not packed   (packed_at is null)
--   Handover     packed, not handed over     (handed_over_at is null)
--   Handed over  given to the courier, waiting for the pickup scan
create table if not exists public.order_fulfilment (
  order_id uuid primary key references public.orders (id) on delete cascade,
  label_printed_at timestamptz,
  packed_at timestamptz,
  handed_over_at timestamptz,
  note text check (char_length(note) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.order_fulfilment enable row level security;

drop policy if exists "Admins view order fulfilment" on public.order_fulfilment;
create policy "Admins view order fulfilment" on public.order_fulfilment
  for select to authenticated
  using ((select public.is_admin()));

revoke all on public.order_fulfilment from anon, authenticated;
grant select on public.order_fulfilment to authenticated;

-- The first time this runs, orders whose parcel is already booked start at Pack (their
-- label was most likely printed already); every other order to ship starts at Print.
do $$
begin
  if not exists (select 1 from public.order_fulfilment) then
    insert into public.order_fulfilment (order_id, label_printed_at)
    select o.id, now()
    from public.orders o
    where o.status in ('confirmed', 'paid')
      and exists (
        select 1 from public.shipments s
        where s.order_id = o.id and s.kind = 'forward' and s.status = 'booked'
      );
  end if;
end $$;

-- A parcel booked again (a new AWB, or a new parcel after switching carrier) needs a
-- new label: its order goes back to Print.
create or replace function public.reset_fulfilment_on_new_awb()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'forward' and (tg_op = 'INSERT' or old.awb_number is distinct from new.awb_number) then
    update public.order_fulfilment
    set label_printed_at = null, handed_over_at = null, updated_at = now()
    where order_id = new.order_id and (label_printed_at is not null or handed_over_at is not null);
  end if;
  return null;
end;
$$;

drop trigger if exists shipments_reset_fulfilment on public.shipments;
create trigger shipments_reset_fulfilment
  after insert or update of awb_number on public.shipments
  for each row execute function public.reset_fulfilment_on_new_awb();

-- Order ids from a JSON array of 1 to 500 ids.
create or replace function public.order_ids_from_json(p_ids jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids) not between 1 and 500 then
    raise exception 'Choose 1 to 500 orders' using errcode = '22023';
  end if;
  select array_agg(distinct value::uuid) into v_ids from jsonb_array_elements_text(p_ids);
  return v_ids;
end;
$$;

-- Moves orders to a step: 'print', 'pack', 'handover' or 'handed_over'. Only orders
-- still to ship (order placed or paid) move. Returns how many moved.
create or replace function public.admin_set_fulfilment_stage(p_orders jsonb, p_stage text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change orders' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('print', 'pack', 'handover', 'handed_over') then
    raise exception 'Unknown step' using errcode = '22023';
  end if;
  v_ids := public.order_ids_from_json(p_orders);

  insert into public.order_fulfilment (order_id)
  select o.id from public.orders o
  where o.id = any(v_ids) and o.status in ('confirmed', 'paid')
  on conflict (order_id) do nothing;

  update public.order_fulfilment f
  set label_printed_at = case when p_stage = 'print' then null else coalesce(f.label_printed_at, now()) end,
      packed_at = case when p_stage in ('print', 'pack') then null else coalesce(f.packed_at, now()) end,
      handed_over_at = case when p_stage = 'handed_over' then coalesce(f.handed_over_at, now()) else null end,
      updated_at = now()
  from public.orders o
  where f.order_id = o.id and o.id = any(v_ids) and o.status in ('confirmed', 'paid');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The admins' note on an order (empty removes it).
create or replace function public.admin_set_order_note(p_order uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change orders' using errcode = '42501';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023', hint = 'note';
  end if;
  if not exists (select 1 from public.orders where id = p_order) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  insert into public.order_fulfilment (order_id, note) values (p_order, v_note)
  on conflict (order_id) do update set note = excluded.note, updated_at = now();
  return v_note;
end;
$$;

-- Corrects the delivery address while the parcel is not booked yet. The courier is
-- given the address when it books, so a booked parcel keeps the old one.
create or replace function public.admin_update_order_address(p_order uuid, p_address jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change orders' using errcode = '42501';
  end if;
  select status into v_status from public.orders where id = p_order for update;
  if v_status is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('pending_payment', 'confirmed', 'paid')
     or exists (
       select 1 from public.shipments
       where order_id = p_order and kind = 'forward'
         and (status not in ('queued', 'failed', 'cancelled') or (status = 'failed' and needs_check))
     ) then
    raise exception 'The parcel is booked, so the address cannot change' using errcode = 'P0001', hint = 'booked';
  end if;
  update public.orders
  set shipping_name = btrim(p_address ->> 'name'),
      shipping_phone = btrim(p_address ->> 'phone'),
      shipping_address = btrim(p_address ->> 'address'),
      shipping_city = btrim(p_address ->> 'city'),
      shipping_state = btrim(p_address ->> 'state'),
      shipping_pincode = btrim(p_address ->> 'pincode')
  where id = p_order;
end;
$$;

-- Orders to ship at one step, for the Print / Pack / Handover lists.
create or replace function public.admin_fulfilment_order_ids(p_stage text)
returns table (order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.orders o
  left join public.order_fulfilment f on f.order_id = o.id
  where public.is_admin()
    and o.status in ('confirmed', 'paid')
    and case p_stage
      when 'print' then f.label_printed_at is null
      when 'pack' then f.label_printed_at is not null and f.packed_at is null
      when 'handover' then f.packed_at is not null and f.handed_over_at is null
      when 'handed_over' then f.handed_over_at is not null
      else false
    end
$$;

-- How many orders to ship are at each step.
create or replace function public.admin_fulfilment_counts()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'print', count(*) filter (where f.label_printed_at is null),
    'pack', count(*) filter (where f.label_printed_at is not null and f.packed_at is null),
    'handover', count(*) filter (where f.packed_at is not null and f.handed_over_at is null),
    'handed_over', count(*) filter (where f.handed_over_at is not null)
  )
  from public.orders o
  left join public.order_fulfilment f on f.order_id = o.id
  where public.is_admin() and o.status in ('confirmed', 'paid')
$$;

-- Orders to ship whose mobile number placed another order within 3 days: possibly the
-- same order twice.
create or replace function public.admin_duplicate_order_ids()
returns table (order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.orders o
  where public.is_admin()
    and o.status in ('confirmed', 'paid')
    and exists (
      select 1 from public.orders d
      where d.id <> o.id
        and d.shipping_phone = o.shipping_phone
        and d.status not in ('pending_payment', 'cancelled')
        and d.created_at between o.created_at - interval '3 days' and o.created_at + interval '3 days'
    )
$$;

-- How many orders (not unpaid, not cancelled) each mobile number has placed: one means
-- a new customer.
create or replace function public.admin_phone_order_counts(p_phones jsonb)
returns table (phone text, orders integer)
language sql
stable
security definer
set search_path = ''
as $$
  select o.shipping_phone, count(*)::integer
  from public.orders o
  where public.is_admin()
    and jsonb_typeof(p_phones) = 'array'
    and o.shipping_phone in (select value from jsonb_array_elements_text(p_phones) limit 100)
    and o.status not in ('pending_payment', 'cancelled')
  group by o.shipping_phone
$$;

revoke execute on function public.reset_fulfilment_on_new_awb() from public, anon, authenticated;
revoke execute on function public.order_ids_from_json(jsonb) from public, anon;
revoke execute on function public.admin_set_fulfilment_stage(jsonb, text) from public, anon;
revoke execute on function public.admin_set_order_note(uuid, text) from public, anon;
revoke execute on function public.admin_update_order_address(uuid, jsonb) from public, anon;
revoke execute on function public.admin_fulfilment_order_ids(text) from public, anon;
revoke execute on function public.admin_fulfilment_counts() from public, anon;
revoke execute on function public.admin_duplicate_order_ids() from public, anon;
revoke execute on function public.admin_phone_order_counts(jsonb) from public, anon;
grant execute on function public.admin_set_fulfilment_stage(jsonb, text) to authenticated;
grant execute on function public.admin_set_order_note(uuid, text) to authenticated;
grant execute on function public.admin_update_order_address(uuid, jsonb) to authenticated;
grant execute on function public.admin_fulfilment_order_ids(text) to authenticated;
grant execute on function public.admin_fulfilment_counts() to authenticated;
grant execute on function public.admin_duplicate_order_ids() to authenticated;
grant execute on function public.admin_phone_order_counts(jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 9e. ORDER DOCUMENTS (admin: tax invoices, label routing code)
-- -----------------------------------------------------------------------------
-- Each order gets one tax invoice number, the first time its label or invoice is
-- printed: KAK/26-27/00001, a running number that starts again every 1 April (the
-- Indian financial year). Numbers are never reused or changed.
create table if not exists public.order_invoices (
  order_id uuid primary key references public.orders (id) on delete restrict,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  serial integer not null check (serial > 0),
  invoice_number text not null unique,
  issued_at timestamptz not null default now(),
  unique (financial_year, serial)
);

alter table public.order_invoices enable row level security;

drop policy if exists "Admins view invoices" on public.order_invoices;
create policy "Admins view invoices" on public.order_invoices
  for select to authenticated
  using ((select public.is_admin()));

revoke all on public.order_invoices from anon, authenticated;
grant select on public.order_invoices to authenticated;

-- The courier's sorting code for the parcel (Delhivery's sort code), printed on our own
-- label. Saved by the shipping function when it books.
alter table public.shipments add column if not exists routing_code text check (char_length(routing_code) <= 60);

-- The seller details printed on invoices ("Sold by"). Typed once by an admin in Admin >
-- Shipping > Invoice details; empty until then. The state decides IGST (another state)
-- or CGST + SGST (the same state).
alter table public.shipping_settings add column if not exists invoice_business_name text not null default ''
  check (char_length(invoice_business_name) <= 100);
alter table public.shipping_settings add column if not exists invoice_address text not null default ''
  check (char_length(invoice_address) <= 200);
alter table public.shipping_settings add column if not exists invoice_phone text not null default ''
  check (invoice_phone = '' or invoice_phone ~ '^[0-9]{10}$');
alter table public.shipping_settings add column if not exists invoice_gstin text not null default ''
  check (invoice_gstin = '' or invoice_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');
alter table public.shipping_settings add column if not exists invoice_pan text not null default ''
  check (invoice_pan = '' or invoice_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
alter table public.shipping_settings add column if not exists invoice_state text not null default 'Rajasthan'
  check (char_length(invoice_state) <= 60);

-- Gives invoice numbers to the orders that have none yet and returns every order's
-- number and date. Unpaid and cancelled orders get none.
create or replace function public.admin_issue_invoices(p_orders jsonb)
returns table (order_id uuid, invoice_number text, issued_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ids uuid[];
  v_now timestamp := (now() at time zone 'Asia/Kolkata');
  v_start integer;
  v_fy text;
  v_next integer;
  v_order uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can make invoices' using errcode = '42501';
  end if;
  v_ids := public.order_ids_from_json(p_orders);
  v_start := extract(year from v_now)::integer - case when extract(month from v_now) < 4 then 1 else 0 end;
  v_fy := lpad((v_start % 100)::text, 2, '0') || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');

  -- One numbering at a time, so two admins never get the same number.
  perform pg_advisory_xact_lock(hashtext('public.order_invoices'));
  select coalesce(max(i.serial), 0) into v_next from public.order_invoices i where i.financial_year = v_fy;

  for v_order in
    select o.id from public.orders o
    where o.id = any(v_ids)
      and o.status not in ('pending_payment', 'cancelled')
      and not exists (select 1 from public.order_invoices i where i.order_id = o.id)
    order by o.order_number
  loop
    v_next := v_next + 1;
    insert into public.order_invoices (order_id, financial_year, serial, invoice_number)
    values (v_order, v_fy, v_next, 'KAK/' || v_fy || '/' || lpad(v_next::text, 5, '0'));
  end loop;

  return query
    select i.order_id, i.invoice_number, i.issued_at
    from public.order_invoices i
    where i.order_id = any(v_ids);
end;
$$;

revoke execute on function public.admin_issue_invoices(jsonb) from public, anon;
grant execute on function public.admin_issue_invoices(jsonb) to authenticated;

-- A customer's return pickup that reached the shop: when it was checked in. Its books
-- go back into stock once (the order itself stays Delivered).
alter table public.order_fulfilment add column if not exists return_received_at timestamptz;

create or replace function public.admin_receive_return(p_order uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test boolean;
  v_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change orders' using errcode = '42501';
  end if;
  select is_test into v_test from public.orders where id = p_order for update;
  if v_test is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.shipments where order_id = p_order and kind = 'reverse' and status <> 'cancelled') then
    raise exception 'This order has no return pickup' using errcode = 'P0001', hint = 'no_return';
  end if;
  select return_received_at into v_at from public.order_fulfilment where order_id = p_order;
  if v_at is not null then
    return v_at;
  end if;
  insert into public.order_fulfilment (order_id, return_received_at) values (p_order, now())
  on conflict (order_id) do update set return_received_at = now(), updated_at = now();
  if not v_test then
    update public.books b
    set stock_quantity = b.stock_quantity + i.quantity
    from public.order_items i
    where i.order_id = p_order and b.id = i.book_id;
  end if;
  return now();
end;
$$;

revoke execute on function public.admin_receive_return(uuid) from public, anon;
grant execute on function public.admin_receive_return(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 9f. CANCELLED ORDERS (admin: when, by whom, from which step)
-- -----------------------------------------------------------------------------
-- Every cancellation records when it happened, who did it and where the order was at
-- the time (Process orders > Cancelled, as on ShopDeck):
--   cancelled_by   'seller' (an admin), 'customer' (on the website) or 'system'
--                  (GoKwik's automatic refund, the courier worker). Null for orders
--                  cancelled before this was added.
--   cancelled_from 'payment_pending', 'print', 'pack', 'handover', 'handed_over',
--                  'shipped' (a parcel that came back) or 'delivered'.
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancelled_by text;
alter table public.orders add column if not exists cancelled_from text;
alter table public.orders drop constraint if exists orders_cancelled_by_check;
alter table public.orders add constraint orders_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('seller', 'customer', 'system'));
alter table public.orders drop constraint if exists orders_cancelled_from_check;
alter table public.orders add constraint orders_cancelled_from_check
  check (cancelled_from is null or cancelled_from in ('payment_pending', 'print', 'pack', 'handover', 'handed_over', 'shipped', 'delivered'));
create index if not exists orders_cancelled_at_idx on public.orders (cancelled_at) where cancelled_at is not null;

create or replace function public.orders_record_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
    new.cancelled_by := case
      when public.is_admin() then 'seller'
      when auth.uid() is not null and auth.uid() = new.user_id then 'customer'
      else 'system'
    end;
    new.cancelled_from := case old.status
      when 'pending_payment' then 'payment_pending'
      when 'shipped' then 'shipped'
      when 'delivered' then 'delivered'
      else coalesce(
        (select case
            when f.handed_over_at is not null then 'handed_over'
            when f.packed_at is not null then 'handover'
            when f.label_printed_at is not null then 'pack'
          end
         from public.order_fulfilment f where f.order_id = new.id),
        'print')
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.orders_record_cancel() from public, anon, authenticated;

drop trigger if exists orders_record_cancel on public.orders;
create trigger orders_record_cancel
  before update of status on public.orders
  for each row execute function public.orders_record_cancel();

-- Orders cancelled before this section existed: their last change is the best guess
-- of when (who and from where stay unknown). Runs once; later runs find nothing.
update public.orders set cancelled_at = updated_at
where status = 'cancelled' and cancelled_at is null;

-- -----------------------------------------------------------------------------
-- 10. CHECK THE RESULT
-- -----------------------------------------------------------------------------
-- The SQL Editor shows this table after the run. Expected: eighteen rows, all with
-- rls_enabled = true (integration_tokens, pincode_checks, rate_limits and
-- checkout_carts have 0 policies on purpose: only the Edge Functions may touch them).
select
  t.tablename as table_name,
  t.rowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as policies
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in ('users', 'books', 'book_internal', 'wishlist_items', 'orders', 'order_items',
    'shipping_settings', 'shipments', 'shipment_events', 'integration_tokens', 'pincode_checks', 'rate_limits',
    'checkout_carts', 'order_payments', 'payment_events', 'gokwik_order_updates', 'order_fulfilment', 'order_invoices')
order by t.tablename;


-- -----------------------------------------------------------------------------
-- 11. MAKE YOURSELF AN ADMIN (optional, do it once)
-- -----------------------------------------------------------------------------
-- Sign up on the website first, then remove the two dashes at the start of the
-- three lines below, put your sign-in email in place of you@example.com, select
-- just those lines and press Run. Expect exactly one row back with role = admin.
-- Refresh the website and the Admin link appears. More admin tasks: supabase/admin.sql.
--
-- update public.users set role = 'admin'
-- where id = (select id from auth.users where email = lower('you@example.com'))
-- returning id, email, role;
