import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const requiredFiles = [
  path.join(appRoot, 'dist', 'electron', 'main.js'),
  path.join(appRoot, 'dist', 'electron', 'preload.cjs')
]

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing dev runtime artifact: ${file}`)
  }
}

console.log('[verify-dev-runtime] desktop dev runtime artifacts verified')
