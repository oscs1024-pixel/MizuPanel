import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        ws: true
      },
      '/scripts': {
        target: 'http://localhost:8080',
        changeOrigin: false
      },
      '/downloads': {
        target: 'http://localhost:8080',
        changeOrigin: false
      }
    }
  }
})
