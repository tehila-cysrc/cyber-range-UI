import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allows manual/automated QA through a temporary localtunnel (npx localtunnel --port 5173)
    // during dev — never used in production (this whole file only applies to `vite dev`).
    allowedHosts: ['.loca.lt'],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
})
