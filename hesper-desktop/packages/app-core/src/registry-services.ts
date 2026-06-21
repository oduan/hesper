import { type Role, type Skill, type ToolDefinition } from '@hesper/shared'

export type SkillSource = Skill['source']

export type RoleService = {
  listRoles(): Role[]
  getRole(id: string): Role | undefined
}

export type SkillService = {
  listSkills(): Skill[]
  getSkill(id: string): Skill | undefined
}

export type ToolCatalogService = {
  list(): ToolDefinition[]
  listByCategory(): Record<ToolDefinition['category'], ToolDefinition[]>
  get(id: string): ToolDefinition | undefined
}

export function createToolCatalogService(tools: ToolDefinition[]): ToolCatalogService {
  const ordered = [...tools]
  const categories: ToolDefinition['category'][] = ['filesystem', 'git', 'web', 'agent', 'system']
  return {
    list: () => [...ordered],
    listByCategory: () =>
      categories.reduce((acc, category) => {
        acc[category] = ordered.filter((tool) => tool.category === category)
        return acc
      }, {} as Record<ToolDefinition['category'], ToolDefinition[]>),
    get: (id) => ordered.find((tool) => tool.id === id)
  }
}

export function createDefaultRoleService(): RoleService {
  const roles: Role[] = [
    {
      id: 'main-agent',
      name: 'Main Agent',
      allowedSkillIds: ['builtin:notes', 'builtin:files', 'builtin:web', 'builtin:install-skills'],
      defaultSkillIds: ['builtin:notes', 'builtin:files', 'builtin:web', 'builtin:install-skills'],
      defaultToolIds: [
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
      ],
      canBeMainAgent: true,
      canBeWorkerAgent: true
    },
    {
      id: 'worker-agent',
      name: 'Worker Agent',
      allowedSkillIds: ['builtin:notes'],
      defaultToolIds: ['filesystem.read-file', 'filesystem.list-directory', 'filesystem.find', 'filesystem.search', 'git.status', 'web.fetch-url', 'web.search'],
      canBeMainAgent: false,
      canBeWorkerAgent: true
    }
  ]
  return {
    listRoles: () => [...roles],
    getRole: (id) => roles.find((role) => role.id === id)
  }
}

export function createDefaultSkillService(): SkillService {
  const skills: Skill[] = [
    { id: 'builtin:install-skills', name: 'Install Skills', description: 'Install reusable skills into the user skill directory.', source: 'builtin' },
    { id: 'builtin:notes', name: 'Notes', source: 'builtin' },
    { id: 'workspace:notes', name: 'Workspace Notes', source: 'workspace' },
    { id: 'project:notes', name: 'Project Notes', source: 'project' }
  ]
  return {
    listSkills: () => [...skills],
    getSkill: (id) => skills.find((skill) => skill.id === id)
  }
}
