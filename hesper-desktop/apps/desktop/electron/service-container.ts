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
  createSsh2ClientAdapter,
  createSshConfigurationService,
  createToolCatalogService,
  createToolSettingsService,
  type CredentialVaultCodec,
  type ProviderOAuthGateway
} from '@hesper/app-core'
import type { Persistence } from '@hesper/persistence'
import type { Role, SshExecutionStatus } from '@hesper/shared'
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
    sshConfigurationService,
    modelProviderService,
    sessionTitleGenerator,
    agentRuntime,
    workerAgentService
  }
}
