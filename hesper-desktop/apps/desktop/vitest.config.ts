import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['renderer/tests/**/*.test.tsx', 'jsdom']],
    include: ['tests/**/*.test.ts', 'renderer/tests/**/*.test.ts', 'renderer/tests/**/*.test.tsx']
  }
})
