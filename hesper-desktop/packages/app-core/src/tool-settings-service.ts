import type { Persistence } from '@hesper/persistence'
import type { ToolDefinition, ToolPermissionPolicy } from '@hesper/shared'

export type ToolCatalogEntry = ToolDefinition & {
  enabled: boolean
}

export type ToolSettingsService = {
  listTools(): Promise<ToolCatalogEntry[]>
  getTool(id: string): Promise<ToolCatalogEntry | undefined>
  setToolEnabled(id: string, enabled: boolean): Promise<ToolCatalogEntry>
  isToolEnabled(id: string): Promise<boolean>
  filterEnabledToolIds(ids: string[]): Promise<string[]>
}

type ToolSettingsServiceOptions = {
  persistence: Persistence
  tools: ToolDefinition[]
  now?: () => Date
}

const globalToolPolicyId = (toolId: string) => `global-tool:${toolId}`

function globalPolicyEnabled(policy: ToolPermissionPolicy | undefined): boolean {
  return policy?.mode !== 'deny'
}

export function createToolSettingsService(options: ToolSettingsServiceOptions): ToolSettingsService {
  const now = options.now ?? (() => new Date())
  const tools = [...options.tools]
  const toolsById = new Map(tools.map((tool) => [tool.id, tool]))
  let updateChain: Promise<void> = Promise.resolve()

  const loadGlobalPoliciesByToolId = async (): Promise<Map<string, ToolPermissionPolicy>> => {
    const policies = await options.persistence.toolPermissionPolicies.listByScope('global')
    const byToolId = new Map<string, ToolPermissionPolicy>()
    for (const policy of policies) {
      if (policy.subjectId !== undefined) continue
      if (!toolsById.has(policy.toolId)) continue
      byToolId.set(policy.toolId, policy)
    }
    return byToolId
  }

  const withEnabledState = (policyByToolId: Map<string, ToolPermissionPolicy>, tool: ToolDefinition): ToolCatalogEntry => ({
    ...tool,
    enabled: globalPolicyEnabled(policyByToolId.get(tool.id))
  })

  const queueUpdate = async <T>(task: () => Promise<T>): Promise<T> => {
    const result = updateChain.then(task, task)
    updateChain = result.then(() => {}, () => {})
    return result
  }

  return {
    async listTools() {
      const policyByToolId = await loadGlobalPoliciesByToolId()
      return tools.map((tool) => withEnabledState(policyByToolId, tool))
    },
    async getTool(id) {
      const tool = toolsById.get(id)
      if (!tool) return undefined
      const policy = await options.persistence.toolPermissionPolicies.get(globalToolPolicyId(id))
      return {
        ...tool,
        enabled: globalPolicyEnabled(policy)
      }
    },
    async setToolEnabled(id, enabled) {
      const tool = toolsById.get(id)
      if (!tool) {
        throw new Error(`Unknown builtin tool: ${id}`)
      }

      return queueUpdate(async () => {
        const existing = await options.persistence.toolPermissionPolicies.get(globalToolPolicyId(id))
        const timestamp = now().toISOString()
        await options.persistence.toolPermissionPolicies.save({
          id: globalToolPolicyId(id),
          toolId: id,
          mode: enabled ? 'allow' : 'deny',
          scope: 'global',
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp
        })
        return { ...tool, enabled }
      })
    },
    async isToolEnabled(id) {
      const tool = toolsById.get(id)
      if (!tool) return false
      const policy = await options.persistence.toolPermissionPolicies.get(globalToolPolicyId(id))
      return globalPolicyEnabled(policy)
    },
    async filterEnabledToolIds(ids) {
      const policyByToolId = await loadGlobalPoliciesByToolId()
      return ids.filter((id) => toolsById.has(id) && globalPolicyEnabled(policyByToolId.get(id)))
    }
  }
}
