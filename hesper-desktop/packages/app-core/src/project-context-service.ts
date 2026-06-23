import { readdir } from 'node:fs/promises'
import path from 'node:path'

const PROJECT_CONTEXT_FILE_NAMES = new Set(['agents.md', 'claude.md'])
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.cache',
  '.turbo',
  'out',
  '.output'
])

export type DiscoverProjectContextFilesOptions = {
  workspacePath: string
  maxFiles?: number
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/[\\/]+/g, '/')
}

function compareNames(left: string, right: string): number {
  const leftLower = left.toLowerCase()
  const rightLower = right.toLowerCase()
  if (leftLower < rightLower) return -1
  if (leftLower > rightLower) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export async function discoverProjectContextFiles(options: DiscoverProjectContextFilesOptions): Promise<string[]> {
  const maxFiles = options.maxFiles ?? 30
  if (maxFiles <= 0) return []

  const results: string[] = []
  const directoryQueue: Array<{ absolutePath: string; relativePath: string }> = [
    { absolutePath: options.workspacePath, relativePath: '' }
  ]

  while (directoryQueue.length > 0 && results.length < maxFiles) {
    const directory = directoryQueue.shift()!
    const entries = (await readdir(directory.absolutePath, { withFileTypes: true }))
      .sort((left, right) => compareNames(left.name, right.name))

    for (const entry of entries) {
      if (results.length >= maxFiles) break
      if (!entry.isFile() || !PROJECT_CONTEXT_FILE_NAMES.has(entry.name.toLowerCase())) continue

      const relativePath = directory.relativePath ? `${directory.relativePath}/${entry.name}` : entry.name
      results.push(normalizeRelativePath(relativePath))
    }

    if (results.length >= maxFiles) break

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue

      const relativePath = directory.relativePath ? `${directory.relativePath}/${entry.name}` : entry.name
      directoryQueue.push({
        absolutePath: path.join(directory.absolutePath, entry.name),
        relativePath: normalizeRelativePath(relativePath)
      })
    }
  }

  return results
}
