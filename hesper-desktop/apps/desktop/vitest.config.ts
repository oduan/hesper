import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@hesper/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@hesper/persistence': fileURLToPath(new URL('../../packages/persistence/src/index.ts', import.meta.url)),
      '@hesper/app-core': fileURLToPath(new URL('../../packages/app-core/src/index.ts', import.meta.url)),
      '@hesper/tools': fileURLToPath(new URL('../../packages/tools/src/index.ts', import.meta.url)),
      '@hesper/agent-runtime': fileURLToPath(new URL('../../packages/agent-runtime/src/index.ts', import.meta.url)),
      '@hesper/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['renderer/tests/**/*.test.tsx', 'jsdom']],
    include: ['tests/**/*.test.ts', 'renderer/tests/**/*.test.ts', 'renderer/tests/**/*.test.tsx']
  }
})
