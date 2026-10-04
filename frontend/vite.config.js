import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const bypassHtml = (req) => (req.headers.accept?.includes('text/html') ? req.url : undefined)

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/report': { target: 'http://localhost:8000', bypass: bypassHtml },
      '/reports': { target: 'http://localhost:8000', bypass: bypassHtml },
      '/uploads': 'http://localhost:8000',
    },
  },
})
