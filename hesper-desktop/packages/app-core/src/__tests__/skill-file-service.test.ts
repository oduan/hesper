import type { Skill } from '@hesper/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSkillFileService, type SkillFileServiceFs, type SkillFileServiceTimer } from '../skill-file-service'

class MemoryFs implements SkillFileServiceFs {
  private readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>()

  constructor() {
    this.dirs.add('/')
  }

  readFile = vi.fn(async (path: string) => {
    const value = this.files.get(this.normalize(path))
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return value
  })

  writeFile = vi.fn(async (path: string, content: string) => {
    const normalized = this.normalize(path)
    this.mkdirSync(this.dirname(normalized), { recursive: true })
    this.files.set(normalized, content)
  })

  readdir = vi.fn(async (path: string, _options: { withFileTypes: true }) => {
    const normalized = this.normalize(path)
    if (!this.dirs.has(normalized)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    const names = new Set<string>()
    const prefix = normalized === '/' ? '/' : `${normalized}/`
    for (const dir of this.dirs) {
      if (dir === normalized || !dir.startsWith(prefix)) continue
      const rest = dir.slice(prefix.length)
      if (!rest.includes('/')) names.add(rest)
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      const [first] = rest.split('/')
      if (first) names.add(first)
    }
    return [...names].sort().map((name) => ({
      name,
      isDirectory: () => this.dirs.has(this.join(normalized, name)),
      isFile: () => this.files.has(this.join(normalized, name))
    }))
  })

  mkdir = vi.fn(async (path: string, _options?: { recursive?: boolean }) => {
    this.mkdirSync(path, { recursive: true })
  })

  existsSync = vi.fn((path: string) => this.files.has(this.normalize(path)) || this.dirs.has(this.normalize(path)))

  seedFile(path: string, content: string): void {
    const normalized = this.normalize(path)
    this.mkdirSync(this.dirname(normalized), { recursive: true })
    this.files.set(normalized, content)
  }

  getFile(path: string): string | undefined {
    return this.files.get(this.normalize(path))
  }

  private mkdirSync(path: string, _options?: { recursive?: boolean }): void {
    const normalized = this.normalize(path)
    const parts = normalized.split('/').filter(Boolean)
    let current = ''
    this.dirs.add('/')
    for (const part of parts) {
      current = `${current}/${part}`
      this.dirs.add(current)
    }
  }

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  }

  private dirname(path: string): string {
    const normalized = this.normalize(path)
    const index = normalized.lastIndexOf('/')
    return index <= 0 ? '/' : normalized.slice(0, index)
  }

  private join(base: string, name: string): string {
    return this.normalize(`${base}/${name}`)
  }
}

function makeTimer() {
  let callback: (() => void | Promise<void>) | undefined
  const timer: SkillFileServiceTimer = {
    setInterval: vi.fn((cb: () => void | Promise<void>, _ms: number) => {
      callback = cb
      return 123
    }),
    clearInterval: vi.fn((_handle: unknown) => {})
  }
  return { timer, tick: async () => { await callback?.() } }
}

describe('SkillFileService', () => {
  let fs: MemoryFs

  beforeEach(() => {
    fs = new MemoryFs()
  })

  it('refreshes builtin and user skills from <root>/<slug>/SKILL.md frontmatter', async () => {
    fs.seedFile('/builtin/code-review/SKILL.md', '---\nname: Code Review\ndescription: Review TypeScript changes\n---\nUse the project checklist.\n')
    fs.seedFile('/user/research/SKILL.md', '---\nname: Research\ndescription: Find current references\n---\nUse citations.\n')

    const service = createSkillFileService({
      paths: { builtinSkillsDir: '/builtin', userSkillsDir: '/user' },
      fs,
      now: () => new Date('2026-06-22T00:00:00.000Z')
    })

    await service.refreshSkills()

    expect(service.listSkills()).toMatchObject<Partial<Skill>[]>([
      { id: 'Code Review', name: 'Code Review', description: 'Review TypeScript changes', source: 'builtin', prompt: 'Use the project checklist.' },
      { id: 'Install Skills', name: 'Install Skills', source: 'builtin' },
      { id: 'Research', name: 'Research', description: 'Find current references', source: 'user', prompt: 'Use citations.' }
    ])
    expect(service.getSkill('Research')?.sourcePath).toBe('/user/research/SKILL.md')
  })

  it('ensures builtin install-skills exists without overwriting an existing file', async () => {
    fs.seedFile('/builtin/install-skills/SKILL.md', '---\nname: Custom Installer\n---\nKeep custom text.\n')

    const service = createSkillFileService({ paths: { builtinSkillsDir: '/builtin', userSkillsDir: '/user' }, fs })
    await service.refreshSkills()

    expect(fs.getFile('/builtin/install-skills/SKILL.md')).toContain('Keep custom text.')
    expect(service.getSkill('Custom Installer')).toMatchObject({ id: 'Custom Installer', name: 'Custom Installer', prompt: 'Keep custom text.' })
  })

  it('falls back to slug metadata and skips malformed or missing skill files', async () => {
    fs.seedFile('/builtin/no-frontmatter/SKILL.md', 'Body only.\n')
    fs.seedFile('/user/empty/SKILL.md', '---\nname:    \n---\n')
    fs.seedFile('/user/not-a-skill/README.md', '# ignored')

    const service = createSkillFileService({ paths: { builtinSkillsDir: '/builtin', userSkillsDir: '/user' }, fs })
    await service.refreshSkills()

    expect(service.getSkill('No Frontmatter')).toMatchObject({ id: 'No Frontmatter', name: 'No Frontmatter', prompt: 'Body only.' })
    expect(service.getSkill('Empty')).toMatchObject({ id: 'Empty', name: 'Empty' })
    expect(service.getSkill('Empty')?.prompt).toBeUndefined()
    expect(service.getSkill('Not A Skill')).toBeUndefined()
  })

  it('rejects duplicate skill names across builtin and user roots', async () => {
    fs.seedFile('/builtin/research/SKILL.md', '---\nname: Research\n---\nBuilt-in guidance')
    fs.seedFile('/user/research-copy/SKILL.md', '---\nname: research\n---\nUser guidance')

    const service = createSkillFileService({ paths: { builtinSkillsDir: '/builtin', userSkillsDir: '/user' }, fs })

    await expect(service.refreshSkills()).rejects.toThrow(/Duplicate skill name/i)
    expect(service.listSkills()).toEqual([])
  })

  it('keeps existing cache and resolves auto refresh ticks when scanning fails', async () => {
    fs.seedFile('/user/stable/SKILL.md', '---\nname: Stable\n---\nCached prompt')
    const { timer, tick } = makeTimer()
    const service = createSkillFileService({ paths: { builtinSkillsDir: '/builtin', userSkillsDir: '/user' }, fs, timer })
    await service.refreshSkills()

    expect(service.getSkill('Stable')).toMatchObject({ id: 'Stable', name: 'Stable', prompt: 'Cached prompt' })
    fs.readdir.mockRejectedValueOnce(new Error('scan failed'))

    service.startAutoScan(500)
    await expect(tick()).resolves.toBeUndefined()

    expect(service.getSkill('Stable')).toMatchObject({ id: 'Stable', name: 'Stable', prompt: 'Cached prompt' })
  })

  it('starts and stops auto refresh with injected timer', async () => {
    fs.seedFile('/user/first/SKILL.md', '---\nname: First\n---\nOne')
    const { timer, tick } = makeTimer()
    const service = createSkillFileService({ paths: { builtinSkillsDir: '/builtin', userSkillsDir: '/user' }, fs, timer })

    service.startAutoScan(500)
    expect(timer.setInterval).toHaveBeenCalledWith(expect.any(Function), 500)

    await tick()
    expect(service.getSkill('First')).toMatchObject({ id: 'First', name: 'First' })

    service.stopAutoScan()
    expect(timer.clearInterval).toHaveBeenCalledWith(123)
  })
})
