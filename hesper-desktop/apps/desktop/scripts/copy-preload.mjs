import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const sourcePath = path.join(appRoot, 'electron', 'preload.cjs')
const targetPath = path.join(appRoot, 'dist', 'electron', 'preload.cjs')
const shouldWatch = process.argv.includes('--watch')

function copyPreload() {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  console.log(`[copy-preload] copied preload to ${targetPath}`)
}

copyPreload()

if (shouldWatch) {
  console.log(`[copy-preload] watching ${sourcePath}`)
  fs.watch(sourcePath, { persistent: true }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      copyPreload()
    }
  })
}
