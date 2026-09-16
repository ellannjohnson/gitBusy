import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { githubProxy } from './server/githubProxy.js'
import { BASE_PATH } from './server/basePath.ts'

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  plugins: [react(), githubProxy()],
  cacheDir: process.env.GITBUSY_VITE_CACHE_DIR || 'node_modules/.vite',
  // No allowedHosts override: Vite's default (which accepts loopback
  // and hostnames that resolve to a loopback interface) is sufficient
  // for local development. Tailscale remote-development is
  // intentionally out of scope; if it is needed later, gate it
  // behind an explicit GITBUSY_DEV_REMOTE_HOST environment variable
  // and add that single hostname here, never a wildcard suffix.
  server: {},
})
