import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const sourceDir = path.join(appRoot, 'assets')
const targetDir = path.join(appRoot, 'dist', 'assets')
const shouldWatch = process.argv.includes('--watch')

function copyAssets() {
  fs.mkdirSync(targetDir, { recursive: true })
  if (!fs.existsSync(sourceDir)) {
    console.log(`[copy-assets] skipped missing ${sourceDir}`)
    return
  }
  fs.cpSync(sourceDir, targetDir, { recursive: true })
  console.log(`[copy-assets] copied assets to ${targetDir}`)
}

copyAssets()

if (shouldWatch && fs.existsSync(sourceDir)) {
  console.log(`[copy-assets] watching ${sourceDir}`)
  fs.watch(sourceDir, { persistent: true }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      copyAssets()
    }
  })
}
