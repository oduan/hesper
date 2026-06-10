import { describe, expect, it } from 'vitest'
import {
  ToolCatalogService,
  createDefaultRoleService,
  createDefaultSkillService
} from './registry-services'

describe('registry services', () => {
  it('exposes deterministic builtin roles and skills', () => {
    const roles = createDefaultRoleService().listRoles()
    const skills = createDefaultSkillService().listSkills()

    expect(roles.map((role) => role.id)).toEqual(['main-agent', 'subagent'])
    expect(skills.map((skill) => skill.id)).toEqual(['builtin:notes', 'builtin:files', 'builtin:web'])
  })

  it('groups tools by category deterministically', () => {
    const catalog = new ToolCatalogService().listToolsByCategory()

    expect(Object.keys(catalog)).toEqual(['filesystem', 'git', 'web', 'agent', 'system'])
    expect(catalog.filesystem?.[0]?.id).toBe('filesystem.read-file')
  })
})
