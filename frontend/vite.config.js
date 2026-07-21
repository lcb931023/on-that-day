import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8000'

  return {
    // GitHub Pages serves the app from a repo subpath; the Go server serves it
    // from the root.
    base: env.VITE_BASE || '/',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/data': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
