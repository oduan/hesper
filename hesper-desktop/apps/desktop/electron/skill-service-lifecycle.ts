import os from 'node:os'
import path from 'node:path'
import { createSkillFileService, type SkillFileService } from '@hesper/app-core'

export function createElectronSkillService(): SkillFileService {
  const homeDir = os.homedir()
  return createSkillFileService({
    paths: {
      userSkillsDir: path.join(homeDir, '.hesper', 'skills'),
      builtinSkillsDir: path.join(homeDir, '.hesper', 'default', 'skills')
    }
  })
}

export async function startSkillService(skillService: Pick<SkillFileService, 'refreshSkills' | 'startAutoScan'>, warn: (message: string, error: unknown) => void = console.warn): Promise<void> {
  try {
    await skillService.refreshSkills()
  } catch (error) {
    warn('Failed to refresh skills during startup; continuing with the cached skill catalog.', error)
  }
  skillService.startAutoScan()
}
