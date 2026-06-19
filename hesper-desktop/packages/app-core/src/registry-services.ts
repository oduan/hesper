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
      allowedSkillIds: ['builtin:notes', 'builtin:files', 'builtin:web'],
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
        'roles.create',
        'roles.update',
        'system.execute-command',
        'system.show-notification'
      ],
      canBeMainAgent: true,
      canBeWorkerAgent: false
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
    { id: 'builtin:notes', name: 'Notes', source: 'builtin' },
    { id: 'workspace:notes', name: 'Workspace Notes', source: 'workspace' },
    { id: 'project:notes', name: 'Project Notes', source: 'project' }
  ]
  return {
    listSkills: () => [...skills],
    getSkill: (id) => skills.find((skill) => skill.id === id)
  }
}
