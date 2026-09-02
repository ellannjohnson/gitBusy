import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { githubProxy } from './server/githubProxy.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), githubProxy()],
})
