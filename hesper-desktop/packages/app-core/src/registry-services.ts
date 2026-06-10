import { type Role, type Skill, type ToolDefinition } from '@hesper/shared'

export type RoleService = {
  listRoles(): Role[]
  getRole(id: string): Role | undefined
}

export type SkillService = {
  listSkills(): Skill[]
  getSkill(id: string): Skill | undefined
}

export class ToolCatalogService {
  private readonly tools: Record<ToolDefinition['category'], ToolDefinition[]>

  constructor() {
    this.tools = {
      filesystem: [
        {
          id: 'filesystem.read-file',
          name: 'Read File',
          description: 'Read a file from the local filesystem.',
          inputSchema: {},
          category: 'filesystem'
        }
      ],
      git: [
        {
          id: 'git.status',
          name: 'Git Status',
          description: 'Inspect repository status.',
          inputSchema: {},
          category: 'git'
        }
      ],
      web: [
        {
          id: 'web.fetch-url',
          name: 'Fetch URL',
          description: 'Fetch a URL over the web.',
          inputSchema: {},
          category: 'web'
        }
      ],
      agent: [
        {
          id: 'agent.ask',
          name: 'Ask Agent',
          description: 'Delegate to an agent step.',
          inputSchema: {},
          category: 'agent'
        }
      ],
      system: [
        {
          id: 'system.shell',
          name: 'Shell',
          description: 'Run a system command.',
          inputSchema: {},
          category: 'system'
        }
      ]
    }
  }

  listToolsByCategory(): Record<ToolDefinition['category'], ToolDefinition[]> {
    return {
      filesystem: [...this.tools.filesystem],
      git: [...this.tools.git],
      web: [...this.tools.web],
      agent: [...this.tools.agent],
      system: [...this.tools.system]
    }
  }
}

export function createDefaultRoleService(): RoleService {
  const roles: Role[] = [
    { id: 'main-agent', name: 'Main Agent', allowedSkillIds: ['builtin:notes', 'builtin:files', 'builtin:web'], canBeMainAgent: true, canBeSubagent: false },
    { id: 'subagent', name: 'Subagent', allowedSkillIds: ['builtin:notes'], canBeMainAgent: false, canBeSubagent: true }
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
