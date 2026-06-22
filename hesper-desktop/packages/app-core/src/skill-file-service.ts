import { existsSync as nodeExistsSync, promises as nodeFs } from 'node:fs'
import path from 'node:path'
import type { Skill } from '@hesper/shared'
import type { SkillService } from './registry-services'

export type SkillFileServicePaths = {
  builtinSkillsDir: string
  userSkillsDir: string
}

export type SkillFileServiceDirent = {
  name: string
  isDirectory(): boolean
  isFile?(): boolean
}

export type SkillFileServiceFs = {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, content: string, encoding: 'utf8'): Promise<void>
  readdir(path: string, options: { withFileTypes: true }): Promise<SkillFileServiceDirent[]>
  mkdir(path: string, options: { recursive: true }): Promise<void>
  existsSync(path: string): boolean
}

export type SkillFileServiceTimer = {
  setInterval(callback: () => void | Promise<void>, ms: number): unknown
  clearInterval(handle: unknown): void
}

export type SkillFileServiceOptions = {
  paths: SkillFileServicePaths
  fs?: SkillFileServiceFs
  timer?: SkillFileServiceTimer
  now?: () => Date
}

export type SkillFileService = SkillService & {
  refreshSkills(): Promise<Skill[]>
  startAutoScan(intervalMs?: number): void
  stopAutoScan(): void
}

const DEFAULT_AUTO_SCAN_INTERVAL_MS = 30_000
const INSTALL_SKILLS_SLUG = 'install-skills'
const SKILL_FILE_NAME = 'SKILL.md'

const nodeSkillFs: SkillFileServiceFs = {
  readFile: (filePath, encoding) => nodeFs.readFile(filePath, encoding),
  writeFile: (filePath, content, encoding) => nodeFs.writeFile(filePath, content, encoding),
  readdir: (dirPath, options) => nodeFs.readdir(dirPath, options),
  mkdir: (dirPath, options) => nodeFs.mkdir(dirPath, options).then(() => undefined),
  existsSync: (filePath) => nodeExistsSync(filePath)
}

function joinPath(root: string, ...segments: string[]): string {
  return path.join(root, ...segments).replace(/\\/g, '/')
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || slug
}

function yamlUnquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseSkillMarkdown(slug: string, content: string): Pick<Skill, 'name' | 'description' | 'prompt'> {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  let metadata: Record<string, string> = {}
  let body = normalized

  if (normalized.startsWith('---\n')) {
    const end = normalized.indexOf('\n---', 4)
    if (end >= 0) {
      const frontmatter = normalized.slice(4, end)
      metadata = Object.fromEntries(
        frontmatter
          .split('\n')
          .map((line) => line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => [match[1]!.toLowerCase(), yamlUnquote(match[2] ?? '')])
      )
      const bodyStart = normalized.startsWith('\n', end + 4) ? end + 5 : end + 4
      body = normalized.slice(bodyStart)
    }
  }

  const prompt = body.trim()
  const name = metadata.name?.trim() || titleFromSlug(slug)
  const description = metadata.description?.trim()

  return {
    name,
    ...(description ? { description } : {}),
    ...(prompt ? { prompt } : {})
  }
}

function skillCompare(left: Skill, right: Skill): number {
  return left.id.localeCompare(right.id)
}

function installSkillsContent(now: () => Date): string {
  return [
    '---',
    'name: Install Skills',
    'description: Install reusable skills into the user skill directory.',
    '---',
    'When the user asks to install or update a skill, create or update a directory under `~/.hesper/skills/<slug>/` and write the skill instructions to `SKILL.md`.',
    '',
    'Use the format `~/.hesper/skills/<slug>/SKILL.md`. Include YAML-like frontmatter with `name` and `description`, then put the reusable agent guidance in the body.',
    '',
    'Do not write skills into project folders unless the user explicitly asks for a project-local skill.',
    '',
    `Generated at: ${now().toISOString()}`,
    ''
  ].join('\n')
}

async function ensureInstallSkill(fs: SkillFileServiceFs, paths: SkillFileServicePaths, now: () => Date): Promise<void> {
  const dir = joinPath(paths.builtinSkillsDir, INSTALL_SKILLS_SLUG)
  const skillFile = joinPath(dir, SKILL_FILE_NAME)
  await fs.mkdir(dir, { recursive: true })
  if (!fs.existsSync(skillFile)) {
    await fs.writeFile(skillFile, installSkillsContent(now), 'utf8')
  }
}

async function scanRoot(options: {
  fs: SkillFileServiceFs
  root: string
  source: 'builtin' | 'user'
}): Promise<Skill[]> {
  const { fs, root, source } = options
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  const skills: Skill[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const slug = entry.name.trim()
    if (!slug) continue
    const skillFile = joinPath(root, slug, SKILL_FILE_NAME)
    let content: string
    try {
      content = await fs.readFile(skillFile, 'utf8')
    } catch {
      continue
    }
    const parsed = parseSkillMarkdown(slug, content)
    skills.push({
      id: `${source}:${slug}`,
      name: parsed.name,
      source,
      path: joinPath(root, slug),
      sourcePath: skillFile,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.prompt ? { prompt: parsed.prompt } : {})
    })
  }

  return skills.sort(skillCompare)
}

export function createSkillFileService(options: SkillFileServiceOptions): SkillFileService {
  const fs = options.fs ?? nodeSkillFs
  const timer: SkillFileServiceTimer = options.timer ?? {
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>)
  }
  const now = options.now ?? (() => new Date())
  let skills: Skill[] = []
  let autoScanHandle: unknown
  let refreshInFlight: Promise<Skill[]> | undefined

  async function refreshSkills(): Promise<Skill[]> {
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = (async () => {
      await ensureInstallSkill(fs, options.paths, now)
      const scanned = [
        ...(await scanRoot({ fs, root: options.paths.builtinSkillsDir, source: 'builtin' })),
        ...(await scanRoot({ fs, root: options.paths.userSkillsDir, source: 'user' }))
      ].sort(skillCompare)
      skills = scanned
      return [...skills]
    })().finally(() => {
      refreshInFlight = undefined
    })
    return refreshInFlight
  }

  return {
    listSkills: () => [...skills],
    getSkill: (id) => skills.find((skill) => skill.id === id),
    refreshSkills,
    startAutoScan(intervalMs = DEFAULT_AUTO_SCAN_INTERVAL_MS) {
      if (autoScanHandle !== undefined) return
      autoScanHandle = timer.setInterval(() => refreshSkills().then(() => undefined).catch(() => undefined), intervalMs)
    },
    stopAutoScan() {
      if (autoScanHandle === undefined) return
      timer.clearInterval(autoScanHandle)
      autoScanHandle = undefined
    }
  }
}
