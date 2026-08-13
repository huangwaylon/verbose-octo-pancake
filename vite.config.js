import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveBase } from './base.js'

// The base path lives in base.js, which scripts/build-sw.js reads too — the two
// must agree or the service worker precaches URLs that do not exist.
export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
  },
})
