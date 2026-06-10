import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const requiredFiles = [
  path.join(appRoot, 'dist', 'electron', 'main.js'),
  path.join(appRoot, 'dist', 'electron', 'preload.cjs'),
  path.join(appRoot, 'dist', 'renderer', 'index.html')
]
const forbiddenPaths = [
  path.join(appRoot, 'dist', 'tests'),
  path.join(appRoot, 'dist', 'packages'),
  path.join(appRoot, 'dist', 'apps')
]

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing build artifact: ${file}`)
  }
}

for (const target of forbiddenPaths) {
  if (fs.existsSync(target)) {
    throw new Error(`Unexpected build output: ${target}`)
  }
}

console.log('desktop build artifacts verified')
