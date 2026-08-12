import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // File-change events don't cross the macOS→VM bind mount in
    // docker-compose dev, so poll (same reason air uses poll mode).
    watch: { usePolling: true, interval: 500 },
    proxy: {
      // In docker-compose dev the backend is another service, not localhost.
      '/api': process.env.LCM_API_TARGET ?? 'http://127.0.0.1:8080',
    },
  },
})
