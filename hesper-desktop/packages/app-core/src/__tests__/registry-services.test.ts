import { describe, expect, it } from 'vitest'
import { createDefaultRoleService, createDefaultSkillService, createToolCatalogService } from '../registry-services'

describe('registry services', () => {
  it('exposes deterministic builtin roles and skills', () => {
    const roles = createDefaultRoleService().listRoles()
    const skills = createDefaultSkillService().listSkills()

    expect(roles.map((role) => role.id)).toEqual(['main-agent', 'worker-agent'])
    expect(roles.find((role) => role.id === 'worker-agent')?.name).toBe('Worker Agent')
    expect(roles.find((role) => role.id === 'main-agent')?.defaultToolIds).toEqual([
      'filesystem.read-file',
      'filesystem.write-file',
      'filesystem.edit-file',
      'filesystem.delete-file',
      'filesystem.delete-directory',
      'filesystem.list-directory',
      'filesystem.find',
      'filesystem.search',
      'git.status',
      'git.run',
      'web.fetch-url',
      'web.search',
      'roles.list',
      'roles.find',
      'roles.create',
      'roles.update',
      'skills.list',
      'skills.get',
      'models.list-available',
      'agent.spawn-worker-agent',
      'agent.list-worker-agents',
      'agent.get-worker-agent',
      'agent.wait-worker-agent',
      'agent.cancel-worker-agent',
      'ssh.list-servers',
      'ssh.run-commands',
      'ssh.list-executions',
      'ssh.get-execution-output',
      'time.current',
      'time.sleep',
      'time.wait-until',
      'system.execute-command',
      'system.show-notification'
    ])
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toEqual(expect.arrayContaining([
      'agent.spawn-worker-agent',
      'agent.wait-worker-agent'
    ]))
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toEqual(expect.arrayContaining([
      'ssh.list-servers',
      'ssh.run-commands',
      'ssh.list-executions',
      'ssh.get-execution-output'
    ]))
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toContain('roles.list')
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toContain('roles.find')
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toContain('roles.create')
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toContain('roles.update')
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).toEqual([
      'filesystem.read-file',
      'filesystem.list-directory',
      'filesystem.find',
      'filesystem.search',
      'git.status',
      'web.fetch-url',
      'web.search'
    ])
    expect(roles.find((role) => role.id === 'main-agent')?.allowedSkillIds).toEqual([
      'builtin:notes',
      'builtin:files',
      'builtin:web',
      'builtin:install-skills'
    ])
    expect(roles.find((role) => role.id === 'main-agent')?.defaultSkillIds).toEqual([
      'builtin:notes',
      'builtin:files',
      'builtin:web',
      'builtin:install-skills'
    ])
    expect(skills.map((skill) => skill.id)).toEqual([
      'builtin:install-skills',
      'builtin:notes',
      'workspace:notes',
      'project:notes'
    ])
  })

  it('groups injected tools by category deterministically', () => {
    const catalog = createToolCatalogService([
      { id: 'filesystem.read-file', name: 'Read File', description: 'Read file', inputSchema: {}, category: 'filesystem' },
      { id: 'web.fetch-url', name: 'Fetch URL', description: 'Fetch URL', inputSchema: {}, category: 'web' },
      { id: 'agent.spawn-worker-agent', name: 'Spawn Worker Agent', description: 'Spawn Worker Agent', inputSchema: {}, category: 'agent' }
    ])

    expect(catalog.list().map((tool) => tool.id)).toEqual([
      'filesystem.read-file',
      'web.fetch-url',
      'agent.spawn-worker-agent'
    ])
    expect(Object.keys(catalog.listByCategory())).toEqual(['filesystem', 'git', 'web', 'agent', 'system'])
    expect(catalog.get('web.fetch-url')?.category).toBe('web')
  })
})
