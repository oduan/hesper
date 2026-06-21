import fs from 'node:fs/promises'
import path from 'node:path'
import type { LocalFilePreview, LocalFilePreviewKind } from '@hesper/shared'

const ONE_MIB = 1024 * 1024
const TEXT_PREVIEW_LIMIT_BYTES = ONE_MIB
const IMAGE_PREVIEW_LIMIT_BYTES = 10 * ONE_MIB
const MEDIA_PREVIEW_LIMIT_BYTES = 25 * ONE_MIB

const imageMimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

const videoMimeTypes: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v'
}

const textMimeTypes: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml'
}

type PreviewSpec = {
  kind: LocalFilePreviewKind
  mimeType: string
  readMode: 'dataUrl' | 'text' | 'unsupported'
  limitBytes?: number
}

export type ReadLocalFilePreviewInput = {
  workspacePath: string
  path: string
}

function normalizeWorkspaceRelativePath(rawPath: string): string {
  if (rawPath.trim().length === 0) {
    throw new Error('File preview path must not be empty')
  }
  if (rawPath.includes('\0')) {
    throw new Error('File preview path must not contain NUL bytes')
  }
  if (path.isAbsolute(rawPath) || path.posix.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath) || /^[a-zA-Z]:/.test(rawPath)) {
    throw new Error('File preview path must be workspace-relative')
  }

  const segments = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.length === 0) {
    throw new Error('File preview path must not be empty')
  }
  if (segments.some((segment) => segment === '..')) {
    throw new Error('File preview path must not escape the workspace')
  }

  return segments.join('/')
}

function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
}

async function realpathWorkspace(workspacePath: string): Promise<string> {
  try {
    return await fs.realpath(workspacePath)
  } catch (error) {
    throw new Error(`Selected workspace is unavailable: ${(error as Error).message}`)
  }
}

function getPreviewSpec(relativePath: string): PreviewSpec {
  const extension = path.posix.extname(relativePath).slice(1).toLowerCase()

  if (extension in imageMimeTypes) {
    return { kind: 'image', mimeType: imageMimeTypes[extension]!, readMode: 'dataUrl', limitBytes: IMAGE_PREVIEW_LIMIT_BYTES }
  }
  if (extension in videoMimeTypes) {
    return { kind: 'video', mimeType: videoMimeTypes[extension]!, readMode: 'dataUrl', limitBytes: MEDIA_PREVIEW_LIMIT_BYTES }
  }
  if (extension === 'pdf') {
    return { kind: 'pdf', mimeType: 'application/pdf', readMode: 'dataUrl', limitBytes: MEDIA_PREVIEW_LIMIT_BYTES }
  }
  if (extension === 'md' || extension === 'markdown') {
    return { kind: 'markdown', mimeType: 'text/markdown', readMode: 'text', limitBytes: TEXT_PREVIEW_LIMIT_BYTES }
  }
  if (extension === 'json' || extension === 'jsonc') {
    return { kind: 'json', mimeType: 'application/json', readMode: 'text', limitBytes: TEXT_PREVIEW_LIMIT_BYTES }
  }
  if (extension === 'html' || extension === 'htm') {
    return { kind: 'html', mimeType: 'text/html', readMode: 'text', limitBytes: TEXT_PREVIEW_LIMIT_BYTES }
  }
  if (extension in textMimeTypes) {
    return { kind: 'text', mimeType: textMimeTypes[extension]!, readMode: 'text', limitBytes: TEXT_PREVIEW_LIMIT_BYTES }
  }

  return { kind: 'unsupported', mimeType: 'application/octet-stream', readMode: 'unsupported' }
}

function assertSizeWithinLimit(kind: LocalFilePreviewKind, bytes: number, limitBytes: number | undefined): void {
  if (limitBytes !== undefined && bytes > limitBytes) {
    throw new Error(`File is too large to preview as ${kind}: ${bytes} bytes exceeds ${limitBytes} bytes`)
  }
}

function stripJsonComments(input: string): string {
  let output = ''
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    const next = input[index + 1]

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false
        output += char
      } else {
        output += ' '
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        output += '  '
        index += 1
      } else {
        output += char === '\n' || char === '\r' ? char : ' '
      }
      continue
    }

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      output += '  '
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      output += '  '
      index += 1
      continue
    }

    output += char
  }

  return output
}

function removeTrailingJsonCommas(input: string): string {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === ',') {
      let lookaheadIndex = index + 1
      while (lookaheadIndex < input.length && /\s/.test(input[lookaheadIndex]!)) {
        lookaheadIndex += 1
      }
      if (input[lookaheadIndex] === '}' || input[lookaheadIndex] === ']') {
        continue
      }
    }

    output += char
  }

  return output
}

function formatJsonPreview(rawContent: string): Pick<LocalFilePreview, 'content' | 'warning'> {
  try {
    return { content: JSON.stringify(JSON.parse(rawContent), null, 2) }
  } catch {
    try {
      const jsoncContent = removeTrailingJsonCommas(stripJsonComments(rawContent))
      return { content: JSON.stringify(JSON.parse(jsoncContent), null, 2) }
    } catch (error) {
      return {
        content: rawContent,
        warning: `Unable to parse JSON for preview; showing raw file content. ${(error as Error).message}`
      }
    }
  }
}

export async function readLocalFilePreview(input: ReadLocalFilePreviewInput): Promise<LocalFilePreview> {
  const relativePath = normalizeWorkspaceRelativePath(input.path)
  const workspaceRealPath = await realpathWorkspace(input.workspacePath)
  const candidatePath = path.resolve(workspaceRealPath, ...relativePath.split('/'))

  if (!isPathInsideOrEqual(workspaceRealPath, candidatePath)) {
    throw new Error('File preview path must not escape the workspace')
  }

  const realFilePath = await fs.realpath(candidatePath)
  if (!isPathInsideOrEqual(workspaceRealPath, realFilePath)) {
    throw new Error('File preview target resolves outside the workspace')
  }

  let fileHandle: Awaited<ReturnType<typeof fs.open>>
  try {
    fileHandle = await fs.open(realFilePath, 'r')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EISDIR' || code === 'EPERM') {
      throw new Error('File preview path must point to a file, not a directory')
    }
    throw error
  }

  try {
    const stat = await fileHandle.stat()
    if (!stat.isFile()) {
      throw new Error('File preview path must point to a file, not a directory')
    }

    const spec = getPreviewSpec(relativePath)
    const basePreview = {
      path: relativePath,
      name: path.posix.basename(relativePath),
      kind: spec.kind,
      mimeType: spec.mimeType,
      bytes: stat.size
    }

    if (spec.readMode === 'unsupported') {
      return basePreview
    }

    assertSizeWithinLimit(spec.kind, stat.size, spec.limitBytes)
    const fileBuffer = await fileHandle.readFile()
    assertSizeWithinLimit(spec.kind, fileBuffer.byteLength, spec.limitBytes)

    if (spec.readMode === 'dataUrl') {
      return {
        ...basePreview,
        dataUrl: `data:${spec.mimeType};base64,${fileBuffer.toString('base64')}`
      }
    }

    const rawContent = fileBuffer.toString('utf8')
    if (spec.kind === 'json') {
      return {
        ...basePreview,
        ...formatJsonPreview(rawContent)
      }
    }

    return {
      ...basePreview,
      content: rawContent
    }
  } finally {
    await fileHandle.close()
  }
}
