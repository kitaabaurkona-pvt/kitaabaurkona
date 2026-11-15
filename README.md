# kitaabaurkona
our main website for kitaabaurkona

## Two sites from one codebase

| Branch | Site | What it is |
| --- | --- | --- |
| `main` | https://www.kitaabaurkona.com | The store customers use. It has no admin pages. |
| `test` | https://kitaabaurkona.vercel.app | The admin panel: a sign-in page and the panel, nothing else. Only admins get in. |

- Both branches hold the same code. Vercel builds each branch on its own, and the build
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

## Running it locally

| What | Command | Address |
| --- | --- | --- |
| Store | `npm run dev` | http://localhost:5173 |
| Admin panel | `npm run dev:admin` | http://localhost:5198 |
| Browser tests | `npm run build`, `npm run build:admin`, `npm run preview -- --port 5200`, `npm run preview:admin`, then `BASE=http://localhost:5200 ADMIN_BASE=http://localhost:5201 npm run e2e` | |

## Releasing

1. Run lint, both builds and the browser tests.
2. Commit, then push the same commit to both branches: `git push origin test` updates the
   admin panel, `git push origin test:main` (a fast-forward) updates the store. Only when
   the owner says to ship.
3. There is no separate test site any more. To try store work before customers see it,
   push it to another branch and open the preview address Vercel gives that branch.
4. Database changes (`supabase/schema.sql`)
