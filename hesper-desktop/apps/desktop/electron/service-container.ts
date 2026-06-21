import { AgentRuntime, MockAgentAdapter, PiCoreAgentAdapter, createPiAgentTools, createRegistryModelResolver, createSessionTitleGenerator, createWorkerAgentService } from '@hesper/agent-runtime'
import {
  createCodexOAuthGateway,
  createConversationService,
  createCredentialVaultService,
  createDefaultRoleService,
  createDefaultSkillService,
  createModelProviderService,
  createPromptAssemblyService,
  createRoleManagementService,
  createSessionService,
  createSettingsService,
  createToolCatalogService,
  createToolSettingsService,
  type CredentialVaultCodec,
  type ProviderOAuthGateway
} from '@hesper/app-core'
import type { Persistence } from '@hesper/persistence'
import type { ModelConfig, ModelProviderConfig, Role } from '@hesper/shared'
import { Notification } from 'electron'
import { createAllowlistPermissionPolicy, createBuiltinToolDefinitions, createBuiltinToolExecutor, createToolRunner } from '@hesper/tools'

export type AgentMode = 'mock' | 'pi-core'

export type ServiceContainerOptions = {
  persistence: Persistence
  agentMode: AgentMode
  credentialCodec?: CredentialVaultCodec
  connectionTestFetch?: typeof fetch
  oauthGateway?: ProviderOAuthGateway
}

export type ServiceContainer = ReturnType<typeof createServiceContainer>

type ModelCredentialStatus = 'ready' | 'needs_api_key' | 'needs_oauth' | 'disabled'

function providerCredentialStatus(provider: ModelProviderConfig): ModelCredentialStatus {
  if (!provider.enabled) return 'disabled'
  if (provider.kind === 'mock' || provider.authType === 'none') return 'ready'
  if (provider.authType === 'oauth' && !provider.hasApiKey) return 'needs_oauth'
  if (!provider.hasApiKey) return 'needs_api_key'
  return 'ready'
}

function createAvailableModelCatalog(providers: ModelProviderConfig[], models: ModelConfig[]) {
  return {
    providers: providers.map((provider) => {
      const credentialStatus = providerCredentialStatus(provider)
      return {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        ...(provider.authType !== undefined ? { authType: provider.authType } : {}),
        enabled: provider.enabled,
        hasApiKey: provider.hasApiKey === true,
        credentialStatus,
        ...(provider.defaultModelId !== undefined ? { defaultModelId: provider.defaultModelId } : {}),
        models: models
          .filter((model) => model.providerId === provider.id)
          .map((model) => {
            const enabled = model.enabled !== false
            return {
              id: model.id,
              providerId: model.providerId,
              modelName: model.modelName,
              displayName: model.displayName,
              capabilities: model.capabilities,
              ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
              enabled,
              readyForRuntime: provider.enabled && enabled && credentialStatus === 'ready',
              modelRef: { providerId: provider.id, modelId: model.id }
            }
          })
      }
    })
  }
}

export function createServiceContainer(options: ServiceContainerOptions) {
  const sessionService = createSessionService(options.persistence)
  const conversationService = createConversationService(options.persistence)
  const settingsService = createSettingsService({ persistence: options.persistence })
  const roleService = createDefaultRoleService()
  const skillService = createDefaultSkillService()
  const toolDefinitions = createBuiltinToolDefinitions()
  const toolCatalogService = createToolCatalogService(toolDefinitions)
  const roleManagementService = createRoleManagementService({ persistence: options.persistence, toolCatalogService })
  const promptAssemblyService = createPromptAssemblyService()
  const credentialVaultService = createCredentialVaultService({
    persistence: options.persistence,
    ...(options.credentialCodec ? { codec: options.credentialCodec } : {})
  })
  const toolSettingsService = createToolSettingsService({ persistence: options.persistence, tools: toolDefinitions, credentialVaultService })
  const modelProviderService = createModelProviderService({
    persistence: options.persistence,
    credentialVaultService,
    ...(options.connectionTestFetch ? { fetch: options.connectionTestFetch } : {}),
    ...(options.oauthGateway ? { oauthGateway: options.oauthGateway } : { oauthGateway: createCodexOAuthGateway() })
  })
  void modelProviderService.ensureBuiltinProviders()
  const readResolvedProviderApiKey = async (providerId: string): Promise<string | undefined> => credentialVaultService.readProviderApiKey(providerId)
  const modelResolver = createRegistryModelResolver({
    registry: {
      ensureReady: () => modelProviderService.ensureBuiltinProviders(),
      getProvider: (id) => modelProviderService.getProvider(id),
      listModels: (providerId) => modelProviderService.listModels(providerId)
    },
    readProviderApiKey: readResolvedProviderApiKey
  })
  const allowlistPolicy = createAllowlistPermissionPolicy()
  let workerAgentService!: ReturnType<typeof createWorkerAgentService>
  const toolRunner = createToolRunner({
    policy: {
      async evaluate(tool, args, context) {
        const allowlistDecision = await allowlistPolicy.evaluate(tool, args, context)
        if (!allowlistDecision.allowed) return allowlistDecision
        if (!(await toolSettingsService.isToolEnabled(tool.id))) {
          return { allowed: false, reason: `Tool is globally disabled: ${tool.id}` }
        }
        return { allowed: true }
      }
    },
    executor: createBuiltinToolExecutor({
      readToolApiKey: (toolId) => credentialVaultService.readToolApiKey(toolId),
      showNotification: (message) => {
        if (!Notification.isSupported()) {
          throw new Error('Desktop notifications are not supported on this system')
        }
        new Notification({ title: 'hesper', body: message }).show()
      },
      roleTools: {
        listRoles: () => roleManagementService.listRoles(),
        createRole: (input) => roleManagementService.createRole(input),
        updateRole: (input) => roleManagementService.updateRole(input)
      },
      workerAgentTools: {
        spawn: (input, context) => workerAgentService.spawn(input, context),
        list: (input, context) => workerAgentService.list(input, context),
        get: (input, context) => workerAgentService.get(input, context),
        wait: (input, context) => workerAgentService.wait(input, context),
        cancel: (input, context) => workerAgentService.cancel(input, context)
      },
      modelTools: {
        listAvailableModels: async () => {
          await modelProviderService.ensureBuiltinProviders()
          const [providers, models] = await Promise.all([
            modelProviderService.listProviders(),
            modelProviderService.listModels()
          ])
          return createAvailableModelCatalog(providers, models)
        }
      }
    })
  })
  const sessionTitleGenerator = createSessionTitleGenerator({
    registry: {
      ensureReady: () => modelProviderService.ensureBuiltinProviders(),
      getProvider: (id) => modelProviderService.getProvider(id),
      listModels: (providerId) => modelProviderService.listModels(providerId)
    },
    modelResolver
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
  const listRuntimeRoles = async (): Promise<Role[]> => {
    const customRoles = await options.persistence.roles.list()
    const customRoleIds = new Set(customRoles.map((role) => role.id))
    return [
      ...roleService.listRoles().filter((role) => !customRoleIds.has(role.id)),
      ...customRoles
    ]
  }
  workerAgentService = createWorkerAgentService({
    persistence: options.persistence,
    adapter,
    promptAssembly: promptAssemblyService,
    roles: {
      listRoles: listRuntimeRoles,
      getRole: async (id) => roleService.getRole(id) ?? await options.persistence.roles.get(id)
    },
    skills: {
      list: () => skillService.listSkills()
    },
    tools: toolCatalogService,
    filterEnabledToolIds: (toolIds) => toolSettingsService.filterEnabledToolIds(toolIds)
  })

  return {
    persistence: options.persistence,
    sessionService,
    conversationService,
    settingsService,
    roleService,
    skillService,
    roleManagementService,
    toolCatalogService,
    toolSettingsService,
    promptAssemblyService,
    toolRunner,
    credentialVaultService,
    modelProviderService,
    sessionTitleGenerator,
    agentRuntime,
    workerAgentService
  }
}
