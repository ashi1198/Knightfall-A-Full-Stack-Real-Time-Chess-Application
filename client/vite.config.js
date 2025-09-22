import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // <-- 1. Import the 'path' module

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 2. Add this 'resolve' section
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})