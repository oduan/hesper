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
  createSessionCategoryService,
  createSessionService,
  createSettingsService,
  createSsh2ClientAdapter,
  createSshConfigurationService,
  createToolCatalogService,
  createToolSettingsService,
  type CredentialVaultCodec,
  type ProviderOAuthGateway,
  type SkillService
} from '@hesper/app-core'
import type { Persistence } from '@hesper/persistence'
import type { ModelConfig, ModelProviderConfig, Role, SshExecutionStatus } from '@hesper/shared'
import { Notification } from 'electron'
import { createAllowlistPermissionPolicy, createBuiltinToolDefinitions, createBuiltinToolExecutor, createToolRunner } from '@hesper/tools'
import { GitService } from './git-service'

export type AgentMode = 'mock' | 'pi-core'

export type ServiceContainerOptions = {
  persistence: Persistence
  agentMode: AgentMode
  credentialCodec?: CredentialVaultCodec
  connectionTestFetch?: typeof fetch
  oauthGateway?: ProviderOAuthGateway
  skillService?: SkillService
}

export type ServiceContainer = ReturnType<typeof createServiceContainer>

const sshExecutionStatuses = new Set<SshExecutionStatus>(['queued', 'running', 'succeeded', 'failed', 'cancelled'])

function toSshExecutionStatus(value: unknown): SshExecutionStatus | undefined {
  return typeof value === 'string' && sshExecutionStatuses.has(value as SshExecutionStatus) ? value as SshExecutionStatus : undefined
}

function optionalBooleanArg(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`Tool argument must be a boolean: ${key}`)
  return value
}

type ModelCredentialStatus = 'ready' | 'needs_api_key' | 'needs_oauth' | 'disabled'

type AvailableModelCatalogModel = {
  id: string
  providerId: string
  modelName: string
  displayName: string
  capabilities: ModelConfig['capabilities']
  contextWindow?: number
  enabled: boolean
  readyForRuntime: boolean
  modelRef: { providerId: string; modelId: string }
}

type AvailableModelCatalogProvider = {
  id: string
  name: string
  kind: ModelProviderConfig['kind']
  authType?: ModelProviderConfig['authType']
  enabled: boolean
  hasApiKey: boolean
  credentialStatus: ModelCredentialStatus
  defaultModelId?: string
  models: AvailableModelCatalogModel[]
}

type AvailableModelCatalog = {
  providers: AvailableModelCatalogProvider[]
}

function isCodexOAuthProvider(provider: ModelProviderConfig): boolean {
  return provider.kind === 'pi' && provider.authType === 'oauth' && provider.piAuthProvider === 'openai-codex'
}

function accessTokenFromCodexOAuthCredential(rawCredential: string | undefined, nowMs = Date.now()): string | undefined {
  const trimmed = rawCredential?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: unknown }).type !== 'codex_oauth') {
      return undefined
    }
    const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt
    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt <= nowMs) {
      return undefined
    }
    const accessToken = (parsed as { accessToken?: unknown }).accessToken
    return typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : undefined
  } catch {
    return trimmed
  }
}

function hasUsableCredential(provider: ModelProviderConfig, rawCredential: string | undefined): boolean {
  if (provider.kind === 'mock') return true
  if (isCodexOAuthProvider(provider)) {
    return accessTokenFromCodexOAuthCredential(rawCredential) !== undefined
  }
  return Boolean(rawCredential?.trim())
}

function providerCredentialStatus(provider: ModelProviderConfig, rawCredential: string | undefined): ModelCredentialStatus {
  if (!provider.enabled) return 'disabled'
  if (hasUsableCredential(provider, rawCredential)) return 'ready'
  if (provider.authType === 'oauth') return 'needs_oauth'
  return 'needs_api_key'
}

function hasRuntimeBaseUrl(provider: ModelProviderConfig): boolean {
  return Boolean(provider.baseUrl?.trim())
}

function hasSupportedPiAuthProvider(provider: ModelProviderConfig): boolean {
  return provider.piAuthProvider === 'openai-codex'
}

function modelReadyForRuntime(provider: ModelProviderConfig, model: ModelConfig, credentialStatus: ModelCredentialStatus): boolean {
  if (!provider.enabled || model.enabled === false) return false
  if (credentialStatus !== 'ready') return false
  if (provider.kind === 'custom' || provider.kind === 'openai-compatible') return hasRuntimeBaseUrl(provider)
  if (provider.kind === 'pi') return hasSupportedPiAuthProvider(provider)
  if (provider.kind === 'mock' || provider.kind === 'openai' || provider.kind === 'deepseek' || provider.kind === 'anthropic') return true
  return false
}

function createAvailableModelCatalog(providers: ModelProviderConfig[], models: ModelConfig[], credentialsByProviderId: ReadonlyMap<string, string | undefined>): AvailableModelCatalog {
  return {
    providers: providers.map((provider) => {
      const credentialStatus = providerCredentialStatus(provider, credentialsByProviderId.get(provider.id))
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
              readyForRuntime: modelReadyForRuntime(provider, model, credentialStatus),
              modelRef: { providerId: provider.id, modelId: model.id }
            }
          })
      }
    })
  }
}

const mainAgentSoulToolIds = ['soul.get', 'soul.update'] as const

function withMainAgentSoulTools(role: Role | undefined): Role | undefined {
  if (!role) return undefined
  if (role.id !== 'main-agent') return role

  const defaultToolIds = (role.defaultToolIds ?? []).filter((toolId) => !mainAgentSoulToolIds.includes(toolId as typeof mainAgentSoulToolIds[number]))
  const insertAt = defaultToolIds.indexOf('models.list-available')
  const insertionIndex = insertAt >= 0 ? insertAt + 1 : defaultToolIds.length

  return {
    ...role,
    defaultToolIds: [
      ...defaultToolIds.slice(0, insertionIndex),
      ...mainAgentSoulToolIds,
      ...defaultToolIds.slice(insertionIndex)
    ]
  }
}

export function createServiceContainer(options: ServiceContainerOptions) {
  const sessionService = createSessionService(options.persistence)
  const sessionCategoryService = createSessionCategoryService(options.persistence)
  const gitService = new GitService({ sessionService })
  const conversationService = createConversationService(options.persistence)
  const settingsService = createSettingsService({ persistence: options.persistence })
  const baseRoleService = createDefaultRoleService()
  const roleService = {
    listRoles: () => baseRoleService.listRoles().map((role) => withMainAgentSoulTools(role)!),
    getRole: (id: string) => withMainAgentSoulTools(baseRoleService.getRole(id))
  }
  const skillService = options.skillService ?? createDefaultSkillService()
  const toolDefinitions = createBuiltinToolDefinitions()
  const toolCatalogService = createToolCatalogService(toolDefinitions)
  const roleManagementService = createRoleManagementService({ persistence: options.persistence, toolCatalogService })
  const promptAssemblyService = createPromptAssemblyService()
  const credentialVaultService = createCredentialVaultService({
    persistence: options.persistence,
    ...(options.credentialCodec ? { codec: options.credentialCodec } : {})
  })
  const sshConfigurationService = createSshConfigurationService({
    persistence: options.persistence,
    credentialVault: credentialVaultService,
    adapter: createSsh2ClientAdapter()
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
  const listRuntimeRoles = async (): Promise<Role[]> => {
    const customRoles = await options.persistence.roles.list()
    const customRoleIds = new Set(customRoles.map((role) => role.id))
    return [
      ...roleService.listRoles().filter((role) => !customRoleIds.has(role.id)),
      ...customRoles
    ]
  }
  const roleToToolRecord = (role: Role) => {
    const defaultModelId = role.defaultModelId !== undefined
      ? role.defaultModelId
      : role.defaultModelRef?.modelId ?? ''
    const defaultModelRef = role.defaultModelId === ''
      ? undefined
      : role.defaultModelRef ? { providerId: role.defaultModelRef.providerId, modelId: role.defaultModelRef.modelId } : undefined
    return {
      id: role.id,
      name: role.name,
      description: role.description ?? '',
      systemPrompt: role.systemPrompt ?? '',
      defaultToolIds: [...(role.defaultToolIds ?? [])],
      defaultModelId,
      ...(defaultModelRef ? { defaultModelRef } : {})
    }
  }
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
        listRoles: async () => (await listRuntimeRoles()).map(roleToToolRecord),
        createRole: (input) => roleManagementService.createRole(input),
        updateRole: (input) => roleManagementService.updateRole(input)
      },
      skillTools: {
        listSkills: async () => skillService.listSkills(),
        getSkill: async (id) => skillService.getSkill(id)
      },
      workerAgentTools: {
        spawn: (input, context) => workerAgentService.spawn(input, context),
        list: (input, context) => workerAgentService.list(input, context),
        get: (input, context) => workerAgentService.get(input, context),
        wait: (input, context) => workerAgentService.wait(input, context),
        cancel: (input, context) => workerAgentService.cancel(input, context)
      },
      sshTools: {
        listServers: async () => {
          const servers = await sshConfigurationService.listServersForAgent()
          return { servers, count: servers.length }
        },
        runCommands: (input, context) => {
          const stopOnError = optionalBooleanArg(input, 'stopOnError')
          const wait = optionalBooleanArg(input, 'wait')
          return sshConfigurationService.runCommands({
            sessionId: context.sessionId,
            runId: context.runId,
            serverId: input.serverId as string,
            commands: input.commands as string[],
            ...(stopOnError !== undefined ? { stopOnError } : {}),
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs as number } : {}),
            ...(wait !== undefined ? { wait } : {})
          })
        },
        listExecutions: (input, context) => {
          const status = toSshExecutionStatus(input.status)
          return sshConfigurationService.listExecutions({
            sessionId: context.sessionId,
            ...(status !== undefined ? { status } : {})
          })
        },
        getExecutionOutput: (input, context) => sshConfigurationService.getExecutionOutput({
          sessionId: context.sessionId,
          executionId: input.executionId as string
        })
      },
      modelTools: {
        listAvailableModels: async () => {
          await modelProviderService.ensureBuiltinProviders()
          const [providers, models] = await Promise.all([
            modelProviderService.listProviders(),
            modelProviderService.listModels()
          ])
          const credentialEntries = await Promise.all(providers.map(async (provider) => [
            provider.id,
            await credentialVaultService.readProviderApiKey(provider.id)
          ] as const))
          return createAvailableModelCatalog(providers, models, new Map(credentialEntries))
        }
      },
      soulTools: {
        getSoul: async () => (await settingsService.getSettings()).soul,
        updateSoul: async (soul) => (await settingsService.updateSettings({ soul })).soul
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
    sessionCategoryService,
    gitService,
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
    sshConfigurationService,
    modelProviderService,
    sessionTitleGenerator,
    agentRuntime,
    workerAgentService
  }
}
