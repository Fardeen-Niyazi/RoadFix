import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/report': 'http://localhost:8000',
      '/reports': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
    },
  },
})
