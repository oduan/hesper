import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.e2e.spec.ts'],
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [['list']]
})
