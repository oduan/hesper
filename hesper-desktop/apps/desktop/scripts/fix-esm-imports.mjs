import fs from 'node:fs'
import path from 'node:path'

/**
 * Temporary desktop-runtime patch for workspace dist outputs.
 *
 * Scope is intentionally narrow:
 * - only explicit desktop runtime targets are touched
 * - only relative ESM specifiers missing an extension are rewritten
 * - every changed file is reported to stdout
 *
 * This must not become a silent catch-all mutation step.
 */
const appRoot = path.resolve(import.meta.dirname, '..')
const shouldWatch = process.argv.includes('--watch')
let debounceTimer
const runtimeTargetDirs = [
  path.resolve(appRoot, '../../packages/shared/dist'),
  path.resolve(appRoot, '../../packages/persistence/dist'),
  path.resolve(appRoot, '../../packages/app-core/dist'),
  path.resolve(appRoot, '../../packages/agent-runtime/dist'),
  path.resolve(appRoot, '../../packages/tools/dist'),
  path.resolve(appRoot, '../../packages/ui/dist'),
  path.join(appRoot, 'dist', 'electron')
]
const supportedExtensions = new Set(['.js', '.json', '.node', '.mjs', '.cjs'])
const changedFiles = []

function needsJsExtension(specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false
  if (specifier.endsWith('/')) return false
  return !supportedExtensions.has(path.extname(specifier))
}

function withJsExtension(match, prefix, specifier, suffix) {
  if (!needsJsExtension(specifier)) return match
  return `${prefix}${specifier}.js${suffix}`
}

function patchRelativeSpecifiers(source) {
  return source
    .replace(/(from\s+['"])(\.{1,2}\/[^'"\n]+)(['"])/g, withJsExtension)
    .replace(/(import\s+['"])(\.{1,2}\/[^'"\n]+)(['"])/g, withJsExtension)
    .replace(/(import\(\s*['"])(\.{1,2}\/[^'"\n]+)(['"]\s*\))/g, withJsExtension)
}

function visit(targetPath) {
  const stat = fs.statSync(targetPath)
  if (stat.isDirectory()) {
    if (path.basename(targetPath) === '__tests__') return

    for (const entry of fs.readdirSync(targetPath)) {
      visit(path.join(targetPath, entry))
    }
    return
  }

  if (!targetPath.endsWith('.js')) return

  const current = fs.readFileSync(targetPath, 'utf8')
  const next = patchRelativeSpecifiers(current)
  if (next !== current) {
    fs.writeFileSync(targetPath, next)
    changedFiles.push(targetPath)
  }
}

function patchRuntimeTargets() {
  changedFiles.length = 0

  for (const target of runtimeTargetDirs) {
    if (fs.existsSync(target)) {
      visit(target)
    }
  }

  if (changedFiles.length === 0) {
    console.log('[fix-esm-imports] no files changed')
  } else {
    console.log(`[fix-esm-imports] patched ${changedFiles.length} files:`)
    for (const file of changedFiles) {
      console.log(` - ${path.relative(appRoot, file)}`)
    }
  }
}

function schedulePatch() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(patchRuntimeTargets, 100)
}

patchRuntimeTargets()

if (shouldWatch) {
  console.log('[fix-esm-imports] watching desktop runtime dist targets')
  for (const target of runtimeTargetDirs) {
    if (!fs.existsSync(target)) continue
    fs.watch(target, { persistent: true, recursive: true }, schedulePatch)
  }
}
