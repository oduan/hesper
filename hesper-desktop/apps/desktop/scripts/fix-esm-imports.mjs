import fs from 'node:fs'
import path from 'node:path'

const targets = process.argv.slice(2)

if (targets.length === 0) {
  console.error('Usage: node scripts/fix-esm-imports.mjs <dir> [dir...]')
  process.exit(1)
}

const supportedExtensions = new Set(['.js', '.json', '.node', '.mjs', '.cjs'])

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
  }
}

for (const target of targets) {
  if (fs.existsSync(target)) {
    visit(path.resolve(target))
  }
}
