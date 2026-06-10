import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const sourcePath = path.join(appRoot, 'electron', 'preload.cjs')
const targetPath = path.join(appRoot, 'dist', 'electron', 'preload.cjs')

fs.mkdirSync(path.dirname(targetPath), { recursive: true })
fs.copyFileSync(sourcePath, targetPath)
console.log(`copied preload to ${targetPath}`)
