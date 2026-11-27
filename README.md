# kitaabaurkona
our main website for kitaabaurkona

## Branches and sites

| Branch | Site | Built by | What it is |
| --- | --- | --- | --- |
| `main` | https://www.kitaabaurkona.com | Vercel | The store customers use. It has no admin pages. |
| `test` | https://kitaabaurkona.vercel.app | Vercel | The admin panel: a sign-in page and the panel, nothing else. Only admins get in. |
| `staging` | https://kitaabaurkonastaging.bizwitheet.com | Vercel | The test shop for GoKwik's sandbox checkout ("Test shop" bar, no cash on delivery). |
| `frontend_test` | https://knk-frontend-test.pages.dev | Cloudflare Pages | The test site for store design work ("Test site" bar). |

Which branch gets what:

- **Store design work goes to `frontend_test` only.** It reaches `main` only when the
  owner ships it (merge `frontend_test` into `test`, then release as below).
- `test` holds the admin panel and is the branch releases are made from; `main` and
  `staging` get the same commit as `test` when the owner ships. Never push store-only
  work straight to `test`, `staging` or `main`.
- The build picks the site from its git branch (Vercel's or Cloudflare's), so the bars
  and `noindex` switch on by themselves. A branch with any other name builds the plain
  store, which looks exactly like the live one.
- All sites use the same Supabase database: orders placed on the test site are real.
- On Cloudflare the build writes a `_headers` file (security headers from `vercel.json`,
  plus `noindex`). Vercel does not build `frontend_test` (`vercel.json`, `git`).

### Store and admin panel

- `main` and `test` hold the same code. Vercel builds each branch on its own, and the build
  decides which site it is from its branch (`vite.config.js`, `src/utils/release.js`):
  `main` starts from `src/main.jsx` (the store), `test` from `src/admin/main.jsx` (the admin
  panel). Neither site ships the other's pages.
- The admin site asks everyone to sign in. An account that is not an admin is signed out
  again straight away. There is no sign-up there; admins are made in the database
  (`supabase/admin.sql`). The database and the shipping function check the admin role on
  every request as well, so the sign-in page is not the only lock.
- Anyone who opens a build on another Vercel address is sent to its own site: the store
  always ends up on www.kitaabaurkona.com, the admin panel on kitaabaurkona.vercel.app
  (`vercel.json` redirects the known aliases before the page loads; the app catches any
  other Vercel address).
- Vercel addresses are marked `noindex`, so search engines only list the store.
- Both sites use the same Supabase database.

## Frontend test hosting

Cloudflare Pages project `knk-frontend-test` deploys `frontend_test` to
https://knk-frontend-test.pages.dev.

- Production branch: `frontend_test`
- Build command: `npm run build:test-site`
- Build output directory: `dist-test-site`
- Without Supabase environment variables, the site uses the bundled preview catalogue.
  Sign-in and orders require `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Running it locally

| What | Command | Address |
| --- | --- | --- |
| Store | `npm run dev` | http://localhost:5173 |
| Admin panel | `npm run dev:admin` | http://localhost:5198 |
| Test site (store with the "Test site" bar) | `npm run dev:test-site` | http://localhost:5173 |
| Browser tests | `npm run build`, `npm run build:admin`, `npm run preview -- --port 5200`, `npm run preview:admin`, then `BASE=http://localhost:5200 ADMIN_BASE=http://localhost:5201 npm run e2e` | |

## Releasing

1. Run lint, both builds and the browser tests.
2. Commit, then push the same commit to both branches: `git push origin test` updates the
   admin panel, `git push origin test:main` (a fast-forward) updates the store. Only when
   the owner says to ship.
3. To try store work before customers see it, push it to `frontend_test` and open the
   test site at https://knk-frontend-test.pages.dev.
4. Database changes (`supabase/schema.sql`)
