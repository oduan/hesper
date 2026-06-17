import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true
  },
  resolve: {
    alias: {
      '@hesper/shared': fileURLToPath(new URL('../../../packages/shared/src/index.ts', import.meta.url)),
      '@hesper/persistence': fileURLToPath(new URL('../../../packages/persistence/src/index.ts', import.meta.url)),
      '@hesper/app-core': fileURLToPath(new URL('../../../packages/app-core/src/index.ts', import.meta.url)),
      '@hesper/tools': fileURLToPath(new URL('../../../packages/tools/src/index.ts', import.meta.url)),
      '@hesper/agent-runtime': fileURLToPath(new URL('../../../packages/agent-runtime/src/index.ts', import.meta.url)),
      '@hesper/ui': fileURLToPath(new URL('../../../packages/ui/src/index.ts', import.meta.url))
    }
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/renderer'),
    emptyOutDir: true
  }
})
