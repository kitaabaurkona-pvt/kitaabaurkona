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
--                           admin_set_order_status() for admins.
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
-- Status flow: pending_payment -> paid -> shipped -> delivered, and
-- pending_payment or paid -> cancelled. Stock is reserved when an order is marked
-- paid and returned if a paid order is cancelled.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'shipped', 'delivered', 'cancelled')),
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
-- 9. ORDER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Places an order for the signed-in user. items: [{ "book_id": uuid, "quantity": 1-10 }]
-- (1 to 50 different books). shipping: { name, phone, address, city, state, pincode }.
-- Prices, titles and stock come from the books table, never from the request.
-- A user can have at most 5 orders awaiting payment at once.
create or replace function public.create_order(items jsonb, shipping jsonb)
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
  if jsonb_typeof(items) is distinct from 'array'
     or jsonb_array_length(items) not between 1 and 50 then
    raise exception 'An order needs between 1 and 50 different books' using errcode = '22023';
  end if;
  if jsonb_typeof(shipping) is distinct from 'object' then
    raise exception 'Delivery details are missing' using errcode = '22023';
  end if;
  if (select count(*) from public.orders where user_id = v_user and status = 'pending_payment') >= 5 then
    raise exception 'Too many orders are awaiting payment' using errcode = 'P0001', hint = 'pending_limit';
  end if;

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
    user_id, item_count, subtotal, mrp_total,
    shipping_name, shipping_phone, shipping_address,
    shipping_city, shipping_state, shipping_pincode
  )
  select
    v_user, sum(r.quantity), sum(b.price * r.quantity), sum(b.mrp * r.quantity),
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

  return v_order;
end;
$$;

revoke execute on function public.create_order(jsonb, jsonb) from public, anon;
grant execute on function public.create_order(jsonb, jsonb) to authenticated;

-- Lets a customer cancel their own order while it is still awaiting payment.
create or replace function public.cancel_order(p_order uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders
  set status = 'cancelled'
  where id = p_order and user_id = auth.uid() and status = 'pending_payment';
  if not found then
    raise exception 'This order can no longer be cancelled' using errcode = 'P0001';
  end if;
  return 'cancelled';
end;
$$;

revoke execute on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

-- Admin-only status changes. Marking an order paid takes the books out of stock
-- (all or nothing); cancelling a paid order puts them back.
create or replace function public.admin_set_order_status(p_order uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_short integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change orders' using errcode = '42501';
  end if;

  select status into v_current from public.orders where id = p_order for update;
  if v_current is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if not (
       (v_current = 'pending_payment' and p_status in ('paid', 'cancelled'))
    or (v_current = 'paid' and p_status in ('shipped', 'cancelled'))
    or (v_current = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'An order that is % cannot become %', v_current, p_status using errcode = '22023';
  end if;

  if p_status = 'paid' then
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
  elsif p_status = 'cancelled' and v_current = 'paid' then
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


-- Make the website's API see the new tables immediately.
notify pgrst, 'reload schema';

commit;


-- -----------------------------------------------------------------------------
-- 10. CHECK THE RESULT
-- -----------------------------------------------------------------------------
-- The SQL Editor shows this table after the run. Expected: six rows
-- (book_internal, books, order_items, orders, users, wishlist_items), all with
-- rls_enabled = true.
select
  t.tablename as table_name,
  t.rowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as policies
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in ('users', 'books', 'book_internal', 'wishlist_items', 'orders', 'order_items')
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
