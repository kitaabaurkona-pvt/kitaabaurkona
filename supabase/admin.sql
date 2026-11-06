-- =============================================================================
-- Kitaabaurkona: admin management
-- =============================================================================
-- WHERE TO RUN: Supabase dashboard -> SQL Editor -> New query. Paste ONE numbered
-- block at a time and press Run.
--
-- RUN schema.sql FIRST. These queries need the tables it creates.
--
-- WHY HERE: the SQL Editor runs as the database owner and is the only place a
-- role can change. The website has no way to make anyone an admin:
--   * signed-in users may update only full_name, phone, gender and address;
--     the role and email columns are locked by column-level grants;
--   * users cannot insert rows into public.users at all;
--   * new accounts always start as 'customer'; a role sent at signup is ignored.
-- Admin powers are enforced by the database (RLS calling public.is_admin()), not by
-- the admin page. Even someone who edits the website's JavaScript to show the admin
-- screen cannot add, edit or delete books unless their row says role = 'admin'.
-- =============================================================================


-- 1. CONFIRM ROW LEVEL SECURITY IS ON --------------------------------------------
-- Expected: three rows (book_internal, books, users), and rowsecurity = true on all.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('users', 'books', 'book_internal')
order by tablename;


-- 2. REVIEW THE POLICIES ----------------------------------------------------------
-- Expected:
--   book_internal: "Admins only" (ALL)
--   books: "Visitors view visible books" (SELECT, anon);
--          "Signed-in users view books" (SELECT, authenticated);
--          "Admins add books" (INSERT); "Admins edit books" (UPDATE);
--          "Admins delete books" (DELETE)
--   users: "Users view own record" (SELECT); "Users update own record" (UPDATE)
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- 3. CONFIRM USERS CANNOT CHANGE THEIR OWN ROLE ----------------------------------
-- Expected UPDATE rows for 'authenticated': address, full_name, gender, phone.
-- There must be NO row for the role or email columns, and none for 'anon'.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'users'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE')
order by grantee, privilege_type, column_name;


-- 4. FIND THE ACCOUNT YOU WANT TO PROMOTE ----------------------------------------
-- The person must have signed up (email or Google) at least once.
-- Replace person@example.com with their sign-in email.
select u.id, u.email, u.role, u.created_at
from public.users u
join auth.users a on a.id = u.id
where a.email = lower('person@example.com');


-- 5. MAKE THEM AN ADMIN ------------------------------------------------------------
-- Replace the email (same one as step 4). The lookup goes through auth.users, so it
-- still works if they changed their email after signing up.
-- Expected: exactly ONE row comes back, showing role = admin.
--   0 rows -> no such account; ask them to sign up first, then rerun.
-- They see the admin panel the next time they load or refresh the site.
update public.users
set role = 'admin'
where id = (select id from auth.users where email = lower('person@example.com'))
returning id, email, role;


-- 6. REMOVE ADMIN ACCESS -------------------------------------------------------------
-- Takes effect in the database IMMEDIATELY: from this moment they can no longer add,
-- edit or delete books. The admin screen itself disappears on their next page load.
update public.users
set role = 'customer'
where id = (select id from auth.users where email = lower('person@example.com'))
returning id, email, role;


-- 7. LIST EVERY ADMIN ------------------------------------------------------------------
-- Review this regularly. Anyone here who should not be an admin: run step 6 for them.
select u.id, a.email, u.created_at
from public.users u
join auth.users a on a.id = u.id
where u.role = 'admin'
order by u.created_at;
