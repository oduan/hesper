import { AgentRuntime, MockAgentAdapter, PiCoreAgentAdapter } from '@hesper/agent-runtime'
import {
  createConversationService,
  createDefaultRoleService,
  createDefaultSkillService,
  createSessionService,
  createSettingsService,
  createToolCatalogService
} from '@hesper/app-core'
import type { Persistence } from '@hesper/persistence'
import { createBuiltinToolDefinitions } from '@hesper/tools'

export type AgentMode = 'mock' | 'pi-core'

export type ServiceContainerOptions = {
  persistence: Persistence
  agentMode: AgentMode
}

export type ServiceContainer = ReturnType<typeof createServiceContainer>

export function createServiceContainer(options: ServiceContainerOptions) {
  const sessionService = createSessionService(options.persistence)
  const conversationService = createConversationService(options.persistence)
  const settingsService = createSettingsService()
  const roleService = createDefaultRoleService()
  const skillService = createDefaultSkillService()
  const toolCatalogService = createToolCatalogService(createBuiltinToolDefinitions())
  const adapter = options.agentMode === 'pi-core' ? new PiCoreAgentAdapter() : new MockAgentAdapter({ delayMs: 0 })
  const agentRuntime = new AgentRuntime({ persistence: options.persistence, adapter })

  return {
    persistence: options.persistence,
    sessionService,
    conversationService,
    settingsService,
    roleService,
    skillService,
    toolCatalogService,
    agentRuntime
  }
}
