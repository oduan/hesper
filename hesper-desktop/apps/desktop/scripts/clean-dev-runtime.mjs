import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const workspaceRoot = path.resolve(appRoot, '../..')

const runtimeDistDirs = [
  path.join(appRoot, 'dist'),
  path.join(workspaceRoot, 'packages', 'shared', 'dist'),
  path.join(workspaceRoot, 'packages', 'persistence', 'dist'),
  path.join(workspaceRoot, 'packages', 'tools', 'dist'),
  path.join(workspaceRoot, 'packages', 'agent-runtime', 'dist'),
  path.join(workspaceRoot, 'packages', 'app-core', 'dist')
]

for (const distDir of runtimeDistDirs) {
  fs.rmSync(distDir, { recursive: true, force: true })
  console.log(`[clean-dev-runtime] removed ${path.relative(workspaceRoot, distDir)}`)
}
