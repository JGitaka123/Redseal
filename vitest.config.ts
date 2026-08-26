import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // The web app owns `src/` only; the API has its own suite under `server/`.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['server/**', 'node_modules/**', 'dist/**'],
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
  },
})
