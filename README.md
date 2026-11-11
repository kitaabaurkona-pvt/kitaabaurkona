# kitaabaurkona
our main website for kitaabaurkona

## Two versions: test and live

| Branch | Site | Who it is for |
| --- | --- | --- |
| `test` | https://kitaabaurkona.vercel.app | Trying new work before customers see it. Shows a striped "Test site" bar. |
| `main` | https://www.kitaabaurkona.com | The live store. |

- Vercel builds each branch on its own. A build knows its branch (`src/utils/release.js`), and
  anyone who opens it on another Vercel address is sent to its own site: the live store
  always ends up on www.kitaabaurkona.com, the test site on kitaabaurkona.vercel.app
  (`vercel.json` redirects the known aliases before the page loads; the app catches any
  other Vercel address).
- Vercel addresses are marked `noindex`, so search engines only list the live store.
- Both versions use the same Supabase database, so orders placed on the test site are
  real orders (stock, Xpressbees booking). The bar says so.

## Releasing

1. New work is committed to `test` and pushed. Vercel deploys it to the test site.
2. Check it on https://kitaabaurkona.vercel.app.
3. When the owner says to ship: run lint, build and the browser tests, then move `main` to
   exactly what is on `test` (`git push origin test:main`, a fast-forward). Vercel deploys
   the live store.
4. Database changes (`supabase/schema.sql`) and Edge Function deploys are applied to the
   one shared Supabase project only with the owner's go, since both sites use it.

Never commit `.env*` files; keys live in Vercel and Supabase settings.
