import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the bundle needs a base
// path matching the repository name. Override with VITE_BASE=/ for a custom
// domain, or with a different path if the repo is ever renamed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/verbose-octo-pancake/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
  },
})
