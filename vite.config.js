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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: { headers: vercelHeaders() },
})
