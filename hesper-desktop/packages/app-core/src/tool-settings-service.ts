import type { Persistence } from '@hesper/persistence'
import type { ToolDefinition, ToolPermissionPolicy } from '@hesper/shared'
import type { CredentialVaultService } from './credential-vault-service'

export type ToolCatalogEntry = ToolDefinition & {
  enabled: boolean
  hasApiKey?: boolean
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
  credentialVaultService?: CredentialVaultService
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

  const apiKeyStateFor = async (tool: ToolDefinition): Promise<{ hasApiKey?: boolean; credentialSatisfied: boolean }> => {
    if (!tool.requiresApiKey) return { credentialSatisfied: true }
    const status = await options.credentialVaultService?.getToolApiKeyStatus({ toolId: tool.id })
    const hasApiKey = status?.hasApiKey === true
    return { hasApiKey, credentialSatisfied: hasApiKey }
  }

  const withEnabledState = async (policyByToolId: Map<string, ToolPermissionPolicy>, tool: ToolDefinition): Promise<ToolCatalogEntry> => {
    const apiKeyState = await apiKeyStateFor(tool)
    return {
      ...tool,
      enabled: globalPolicyEnabled(policyByToolId.get(tool.id)) && apiKeyState.credentialSatisfied,
      ...(apiKeyState.hasApiKey !== undefined ? { hasApiKey: apiKeyState.hasApiKey } : {})
    }
  }

  const queueUpdate = async <T>(task: () => Promise<T>): Promise<T> => {
    const result = updateChain.then(task, task)
    updateChain = result.then(() => {}, () => {})
    return result
  }

  return {
    async listTools() {
      const policyByToolId = await loadGlobalPoliciesByToolId()
      return Promise.all(tools.map((tool) => withEnabledState(policyByToolId, tool)))
    },
    async getTool(id) {
      const tool = toolsById.get(id)
      if (!tool) return undefined
      const policy = await options.persistence.toolPermissionPolicies.get(globalToolPolicyId(id))
      const policyByToolId = new Map<string, ToolPermissionPolicy>()
      if (policy) policyByToolId.set(id, policy)
      return withEnabledState(policyByToolId, tool)
    },
    async setToolEnabled(id, enabled) {
      const tool = toolsById.get(id)
      if (!tool) {
        throw new Error(`Unknown builtin tool: ${id}`)
      }

      return queueUpdate(async () => {
        const apiKeyState = await apiKeyStateFor(tool)
        if (enabled && !apiKeyState.credentialSatisfied) {
          throw new Error(`API key is required before enabling tool: ${id}`)
        }

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
        return {
          ...tool,
          enabled,
          ...(apiKeyState.hasApiKey !== undefined ? { hasApiKey: apiKeyState.hasApiKey } : {})
        }
      })
    },
    async isToolEnabled(id) {
      const tool = toolsById.get(id)
      if (!tool) return false
      const policy = await options.persistence.toolPermissionPolicies.get(globalToolPolicyId(id))
      return globalPolicyEnabled(policy) && (await apiKeyStateFor(tool)).credentialSatisfied
    },
    async filterEnabledToolIds(ids) {
      const policyByToolId = await loadGlobalPoliciesByToolId()
      const enabledIds: string[] = []
      for (const id of ids) {
        const tool = toolsById.get(id)
        if (!tool) continue
        if (!globalPolicyEnabled(policyByToolId.get(id))) continue
        if (!(await apiKeyStateFor(tool)).credentialSatisfied) continue
        enabledIds.push(id)
      }
      return enabledIds
    }
  }
}
