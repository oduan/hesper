import { describe, expect, it } from 'vitest'
import { createDefaultRoleService, createDefaultSkillService, createToolCatalogService } from '../registry-services'

describe('registry services', () => {
  it('exposes deterministic builtin roles and skills', () => {
    const roles = createDefaultRoleService().listRoles()
    const skills = createDefaultSkillService().listSkills()

    expect(roles.map((role) => role.id)).toEqual(['main-agent', 'subagent'])
    expect(roles.find((role) => role.id === 'main-agent')?.defaultToolIds).toEqual([
      'filesystem.read-file',
      'git.status',
      'web.fetch-url',
      'agent.spawn-subagent',
      'system.show-notification'
    ])
    expect(roles.find((role) => role.id === 'main-agent')?.defaultToolIds).not.toContain('filesystem.write-file')
    expect(skills.map((skill) => skill.id)).toEqual([
      'builtin:notes',
      'workspace:notes',
      'project:notes'
    ])
  })

  it('groups injected tools by category deterministically', () => {
    const catalog = createToolCatalogService([
      { id: 'filesystem.read-file', name: 'Read File', description: 'Read file', inputSchema: {}, category: 'filesystem' },
      { id: 'web.fetch-url', name: 'Fetch URL', description: 'Fetch URL', inputSchema: {}, category: 'web' },
      { id: 'agent.spawn-subagent', name: 'Spawn Subagent', description: 'Spawn subagent', inputSchema: {}, category: 'agent' }
    ])

    expect(catalog.list().map((tool) => tool.id)).toEqual([
      'filesystem.read-file',
      'web.fetch-url',
      'agent.spawn-subagent'
    ])
    expect(Object.keys(catalog.listByCategory())).toEqual(['filesystem', 'git', 'web', 'agent', 'system'])
    expect(catalog.get('web.fetch-url')?.category).toBe('web')
  })
})
