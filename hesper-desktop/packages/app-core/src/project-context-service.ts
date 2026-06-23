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
  return relativePath.split(path.sep).join('/')
}

function pathDepth(relativePath: string): number {
  return normalizeRelativePath(relativePath).split('/').length - 1
}

function compareProjectContextPaths(left: string, right: string): number {
  const leftDepth = pathDepth(left)
  const rightDepth = pathDepth(right)
  if (leftDepth !== rightDepth) return leftDepth - rightDepth

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

  async function visit(absoluteDirectoryPath: string, relativeDirectoryPath: string): Promise<void> {
    const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true })

    await Promise.all(entries.map(async (entry) => {
      const entryNameLower = entry.name.toLowerCase()
      const relativePath = relativeDirectoryPath ? `${relativeDirectoryPath}/${entry.name}` : entry.name
      const absolutePath = path.join(absoluteDirectoryPath, entry.name)

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entryNameLower)) return
        await visit(absolutePath, relativePath)
        return
      }

      if (entry.isFile() && PROJECT_CONTEXT_FILE_NAMES.has(entryNameLower)) {
        results.push(normalizeRelativePath(relativePath))
      }
    }))
  }

  await visit(options.workspacePath, '')

  return results.sort(compareProjectContextPaths).slice(0, maxFiles)
}
