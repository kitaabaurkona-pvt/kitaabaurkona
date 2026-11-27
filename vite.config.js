import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The production preview (npm run preview) sends the same security headers as Vercel
// (vercel.json), so the browser tests run under the real Content-Security-Policy.
// HSTS and upgrade-insecure-requests are left out locally because the preview is plain
// http on localhost.
function vercelHeaders() {
  const config = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
  const headers = {}
  for (const { key, value } of config.headers?.[0]?.headers ?? []) {
    if (key === 'Strict-Transport-Security') continue
    headers[key] = key === 'Content-Security-Policy' ? value.replace(/;\s*upgrade-insecure-requests/, '') : value
  }
  return headers
}

// Which version this build is: Vercel provides the git branch, environment and commit
// while building. Local builds and test runs have none (see src/utils/release.js).
const release = {
  'import.meta.env.VITE_RELEASE_BRANCH': JSON.stringify(process.env.VERCEL_GIT_COMMIT_REF ?? ''),
  'import.meta.env.VITE_RELEASE_ENV': JSON.stringify(process.env.VERCEL_ENV ?? 'local'),
  'import.meta.env.VITE_RELEASE_COMMIT': JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7)),
}

// The two fonts every page uses are fetched together with the page, instead of only
// after the stylesheet has been read (which showed text in a stand-in font first).
function preloadFonts() {
  return {
    name: 'preload-fonts',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        return Object.keys(ctx.bundle)
          .filter((file) => /(dm-sans|bricolage-grotesque)-latin-wght-normal-[\w-]+\.woff2$/.test(file))
          .map((file) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: true }, injectTo: 'head' }))
      },
    },
  }
}

// Meta (Facebook) pixel for ads, exactly as Meta gave it. Only the live store gets it
// (Vercel production = branch main), so the admin panel, the test shops, local builds
// and browser tests never send page views to Meta. The inline script's sha256 is allowed
// in vercel.json's Content-Security-Policy: if this text changes, update that hash.
// The pixel also counts in-app page changes itself (it watches the browser history).
const META_PIXEL = `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1942397910075181');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=1942397910075181&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
`

// One codebase builds separate sites:
//   store    the shop customers use (branch main, www.kitaabaurkona.com)
//   admin    the admin panel, sign-in only (branch test, kitaabaurkona.vercel.app)
//   staging  the shop again, as a test shop for GoKwik's sandbox checkout (branch
//            staging, kitaabaurkonastaging.bizwitheet.com): same pages as the store, plus a
//            "Test shop" bar, hidden from search engines, and no cash-on-delivery checkout
// Vercel's branch decides; locally, add --mode admin or --mode staging.
// The admin site starts from its own entry file, so neither site ships the other's pages.
function siteEntry(site, staging) {
  return {
    name: 'site-entry',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (staging) {
          return html
            .replace('<title>Kitaab Aur Kona</title>', '<title>Kitaab Aur Kona (test shop)</title>')
            .replace(/<meta name="description"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />')
        }
        if (site !== 'admin') {
          return process.env.VERCEL_ENV === 'production' ? html.replace('</head>', `${META_PIXEL}  </head>`) : html
        }
        return html
          .replace('<html lang="en"', '<html lang="en" data-site="admin"')
          .replace('src="/src/main.jsx"', 'src="/src/admin/main.jsx"')
          .replace('<title>Kitaab Aur Kona</title>', '<title>Kitaab Aur Kona Admin</title>')
          .replace(/<meta name="description"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />')
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const branch = process.env.VERCEL_GIT_COMMIT_REF
  const site = mode === 'admin' || branch === 'test' ? 'admin' : 'store'
  const staging = site === 'store' && (mode === 'staging' || branch === 'staging')
  return {
    plugins: [react(), preloadFonts(), siteEntry(site, staging)],
    define: {
      ...release,
      'import.meta.env.VITE_SITE': JSON.stringify(site),
      'import.meta.env.VITE_STAGING': JSON.stringify(staging ? 'true' : ''),
    },
    preview: { headers: vercelHeaders() },
  }
})
