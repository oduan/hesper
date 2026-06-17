import { AgentRuntime, MockAgentAdapter, PiCoreAgentAdapter, createPiAgentTools, createRegistryModelResolver } from '@hesper/agent-runtime'
import {
  createConversationService,
  createCredentialVaultService,
  createDefaultRoleService,
  createDefaultSkillService,
  createModelProviderService,
  createPromptAssemblyService,
  createSessionService,
  createSettingsService,
  createToolCatalogService,
  type CredentialVaultCodec
} from '@hesper/app-core'
import type { Persistence } from '@hesper/persistence'
import { Notification } from 'electron'
import { createAllowlistPermissionPolicy, createBuiltinToolDefinitions, createBuiltinToolExecutor, createToolRunner } from '@hesper/tools'

export type AgentMode = 'mock' | 'pi-core'

export type ServiceContainerOptions = {
  persistence: Persistence
  agentMode: AgentMode
  credentialCodec?: CredentialVaultCodec
}

export type ServiceContainer = ReturnType<typeof createServiceContainer>

export function createServiceContainer(options: ServiceContainerOptions) {
  const sessionService = createSessionService(options.persistence)
  const conversationService = createConversationService(options.persistence)
  const settingsService = createSettingsService({ persistence: options.persistence })
  const roleService = createDefaultRoleService()
  const skillService = createDefaultSkillService()
  const toolDefinitions = createBuiltinToolDefinitions()
  const toolCatalogService = createToolCatalogService(toolDefinitions)
  const promptAssemblyService = createPromptAssemblyService()
  const credentialVaultService = createCredentialVaultService({
    persistence: options.persistence,
    ...(options.credentialCodec ? { codec: options.credentialCodec } : {})
  })
  const modelProviderService = createModelProviderService({ persistence: options.persistence, credentialVaultService })
  void modelProviderService.ensureBuiltinProviders()
  const modelResolver = createRegistryModelResolver({
    registry: {
      ensureReady: () => modelProviderService.ensureBuiltinProviders(),
      getProvider: (id) => modelProviderService.getProvider(id),
      listModels: (providerId) => modelProviderService.listModels(providerId)
    },
    readProviderApiKey: (providerId) => credentialVaultService.readProviderApiKey(providerId)
  })
  const toolRunner = createToolRunner({
    policy: createAllowlistPermissionPolicy(),
    executor: createBuiltinToolExecutor({
      showNotification: (message) => {
        if (!Notification.isSupported()) {
          throw new Error('Desktop notifications are not supported on this system')
        }
        new Notification({ title: 'hesper', body: message }).show()
      }
    })
  })
  const adapter = options.agentMode === 'pi-core'
    ? new PiCoreAgentAdapter({
        modelResolver,
        createTools: (input) => createPiAgentTools({
          tools: toolDefinitions.filter((tool) => input.enabledToolIds?.includes(tool.id)),
          runner: toolRunner,
          context: {
            runId: input.runId,
            sessionId: input.sessionId,
            allowedToolIds: input.enabledToolIds ?? [],
            ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {})
          }
        })
      })
    : new MockAgentAdapter({ delayMs: 0 })
  const agentRuntime = new AgentRuntime({ persistence: options.persistence, adapter })

  return {
    persistence: options.persistence,
    sessionService,
    conversationService,
    settingsService,
    roleService,
    skillService,
    toolCatalogService,
    promptAssemblyService,
    toolRunner,
    credentialVaultService,
    modelProviderService,
    agentRuntime
  }
}
