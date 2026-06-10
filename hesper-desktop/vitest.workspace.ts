import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    fileParallelism: false,
    maxWorkers: 1,
    projects: ['apps/desktop', 'packages/*']
  }
})
