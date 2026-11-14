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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preloadFonts()],
  define: release,
  preview: { headers: vercelHeaders() },
})
