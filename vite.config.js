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

// Which version this build is: the host provides the git branch and commit while
// building. Vercel builds the store, admin panel and test shop; Cloudflare (Pages or
// Workers Builds) builds the test site from frontend_test. Local builds and test runs
// have none (see src/utils/release.js).
const env = process.env
const onCloudflare = Boolean(env.CF_PAGES || env.WORKERS_CI)
const gitBranch = env.VERCEL_GIT_COMMIT_REF ?? env.CF_PAGES_BRANCH ?? env.WORKERS_CI_BRANCH
const gitCommit = env.VERCEL_GIT_COMMIT_SHA ?? env.CF_PAGES_COMMIT_SHA ?? env.WORKERS_CI_COMMIT_SHA ?? ''
const release = {
  'import.meta.env.VITE_RELEASE_BRANCH': JSON.stringify(gitBranch ?? ''),
  'import.meta.env.VITE_RELEASE_ENV': JSON.stringify(env.VERCEL_ENV ?? (onCloudflare ? 'cloudflare' : 'local')),
  'import.meta.env.VITE_RELEASE_COMMIT': JSON.stringify(gitCommit.slice(0, 7)),
}

// Cloudflare ignores vercel.json, so the test site gets the same security and cache
// headers as a Cloudflare _headers file, written from vercel.json, plus noindex.
function cloudflareHeaders(enabled) {
  return {
    name: 'cloudflare-headers',
    apply: 'build',
    generateBundle() {
      if (!enabled) return
      const config = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
      const blocks = []
      for (const rule of config.headers ?? []) {
        if (rule.has) continue // rules for Vercel's own addresses only
        const lines = rule.headers.map(({ key, value }) => `  ${key}: ${value}`)
        if (rule.source === '/(.*)') lines.push('  X-Robots-Tag: noindex, nofollow')
        blocks.push(`${rule.source.replace('(.*)', '*')}\n${lines.join('\n')}`)
      }
      this.emitFile({ type: 'asset', fileName: '_headers', source: `${blocks.join('\n\n')}\n` })
    },
  }
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

// One codebase builds separate sites:
//   store    the shop customers use (branch main, www.kitaabaurkona.com)
//   admin    the admin panel, sign-in only (branch test, kitaabaurkona.vercel.app)
//   staging  the shop again, as a test shop for GoKwik's sandbox checkout (branch
//            staging, kitaabaurkonastaging.bizwitheet.com): same pages as the store, plus a
//            "Test shop" bar, hidden from search engines, and no cash-on-delivery checkout
//   test site  the shop again, for trying store changes before they go live (branch
//            frontend_test, built on Cloudflare, not Vercel): same pages as the store,
//            plus a "Test site" bar, hidden from search engines. It uses the live
//            database, so its orders are real.
// The git branch decides; locally, add --mode admin, --mode staging or --mode test-site.
// The admin site starts from its own entry file, so neither site ships the other's pages.
function siteEntry(site, staging, testSite) {
  return {
    name: 'site-entry',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (testSite) {
          return html
            .replace('<title>Kitaab Aur Kona</title>', '<title>Kitaab Aur Kona (test site)</title>')
            .replace(/<meta name="description"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />')
        }
        if (staging) {
          return html
            .replace('<title>Kitaab Aur Kona</title>', '<title>Kitaab Aur Kona (test shop)</title>')
            .replace(/<meta name="description"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />')
        }
        if (site !== 'admin') return html
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
  const branch = gitBranch
  const site = mode === 'admin' || branch === 'test' ? 'admin' : 'store'
  const staging = site === 'store' && (mode === 'staging' || branch === 'staging')
  const testSite = site === 'store' && !staging && (mode === 'test-site' || branch === 'frontend_test')
  return {
    plugins: [react(), preloadFonts(), siteEntry(site, staging, testSite), cloudflareHeaders(testSite)],
    define: {
      ...release,
      'import.meta.env.VITE_SITE': JSON.stringify(site),
      'import.meta.env.VITE_STAGING': JSON.stringify(staging ? 'true' : ''),
      'import.meta.env.VITE_TEST_SITE': JSON.stringify(testSite ? 'true' : ''),
    },
    preview: { headers: vercelHeaders() },
  }
})
