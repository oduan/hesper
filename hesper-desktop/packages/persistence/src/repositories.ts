import {
  agentRuntimeEventSchema,
  defaultAppThemeId,
  isAppThemeId,
  messageAttachmentSchema,
  modelRefSchema,
  roleSnapshotSchema,
  runErrorSchema,
  sshCommandResultSchema,
  sshExecutionSchema,
  sshKeySchema,
  sshServerSchema,
  themeModeValues,
  type AgentRun,
  type AgentRuntimeEvent,
  type AppThemeId,
  type Message,
  type ModelCapability,
  type ModelConfig,
  type ModelProviderConfig,
  type ModelRef,
  type Role,
  type RunContextItem,
  type RunStep,
  type Session,
  type SessionCategory,
  type Skill,
  type SshCommandResult,
  type SshExecution,
  type SshKey,
  type SshServer,
  type WorkerAgentInvocation,
  type ToolPermissionPolicy,
  type ToolPermissionScope,
  type ThemeMode
} from '@hesper/shared'
import type { SqliteAdapter } from './sqlite-adapter'

export type RuntimeEventRecord = AgentRuntimeEvent

export type CredentialRecord = {
  id: string
  kind: 'provider-api-key' | 'tool-api-key' | 'ssh-private-key' | 'ssh-passphrase'
  subjectId: string
  encryptedValueBase64: string
  createdAt: string
  updatedAt: string
}

export type AppSettingsRecord = {
  defaultModelId: string
  defaultOutputMode: 'markdown' | 'html'
  themeMode: ThemeMode
  themeId: AppThemeId
  fontSize: number
  soul: string
  updatedAt: string
}

export type SessionRepository = {
  save(session: Session): Promise<void>
  get(id: string): Promise<Session | undefined>
  listVisible(): Promise<Session[]>
}

export type SessionCategoryRepository = {
  save(category: SessionCategory): Promise<void>
  get(id: string): Promise<SessionCategory | undefined>
  list(): Promise<SessionCategory[]>
  delete(id: string): Promise<void>
}

export type MessageRepository = {
  save(message: Message): Promise<void>
  listBySession(sessionId: string): Promise<Message[]>
  listByRun(runId: string): Promise<Message[]>
}

export type RunRepository = {
  save(run: AgentRun): Promise<void>
  get(id: string): Promise<AgentRun | undefined>
  listBySession(sessionId: string): Promise<AgentRun[]>
}

export type RunStepRepository = {
  save(step: RunStep): Promise<void>
  listByRun(runId: string): Promise<RunStep[]>
}

export type RunContextItemRepository = {
  save(item: RunContextItem): Promise<void>
  get(id: string): Promise<RunContextItem | undefined>
  listByRun(runId: string): Promise<RunContextItem[]>
  listBySession(sessionId: string): Promise<RunContextItem[]>
}

export type RuntimeEventRepository = {
  append(event: RuntimeEventRecord): Promise<void>
  listByRun(runId: string): Promise<RuntimeEventRecord[]>
}

export type ModelProviderRepository = {
  save(provider: ModelProviderConfig): Promise<void>
  get(id: string): Promise<ModelProviderConfig | undefined>
  list(): Promise<ModelProviderConfig[]>
  delete(id: string): Promise<void>
}

export type ModelRepository = {
  save(model: ModelConfig): Promise<void>
  get(id: string): Promise<ModelConfig | undefined>
  list(): Promise<ModelConfig[]>
  listByProvider(providerId: string): Promise<ModelConfig[]>
  deleteByProvider(providerId: string): Promise<void>
}

export type SkillRepository = {
  save(skill: Skill): Promise<void>
  get(id: string): Promise<Skill | undefined>
  list(): Promise<Skill[]>
}

export type RoleRepository = {
  save(role: Role): Promise<void>
  get(id: string): Promise<Role | undefined>
  list(): Promise<Role[]>
  delete(id: string): Promise<void>
}

export type ToolPermissionPolicyRepository = {
  save(policy: ToolPermissionPolicy): Promise<void>
  get(id: string): Promise<ToolPermissionPolicy | undefined>
  list(): Promise<ToolPermissionPolicy[]>
  listByScope(scope: ToolPermissionScope, subjectId?: string): Promise<ToolPermissionPolicy[]>
}

export type WorkerAgentInvocationRepository = {
  save(invocation: WorkerAgentInvocation): Promise<void>
  get(id: string): Promise<WorkerAgentInvocation | undefined>
  listByParentRun(parentRunId: string): Promise<WorkerAgentInvocation[]>
  listByChildRun(childRunId: string): Promise<WorkerAgentInvocation[]>
}

export type SshKeyRepository = {
  save(key: SshKey): Promise<void>
  get(id: string): Promise<SshKey | undefined>
  list(): Promise<SshKey[]>
  delete(id: string): Promise<void>
}

export type SshServerRepository = {
  save(server: SshServer): Promise<void>
  get(id: string): Promise<SshServer | undefined>
  list(): Promise<SshServer[]>
  listByKeyId(keyId: string): Promise<SshServer[]>
  delete(id: string): Promise<void>
}

export type SshExecutionRepository = {
  save(execution: SshExecution): Promise<void>
  get(id: string): Promise<SshExecution | undefined>
  listBySession(sessionId: string): Promise<SshExecution[]>
}

export type SshCommandResultRepository = {
  save(result: SshCommandResult): Promise<void>
  listByExecution(executionId: string): Promise<SshCommandResult[]>
}

export type CredentialRecordRepository = {
  save(record: CredentialRecord): Promise<void>
  get(id: string): Promise<CredentialRecord | undefined>
  list(): Promise<CredentialRecord[]>
  delete(id: string): Promise<void>
}

export type AppSettingsRepository = {
  save(settings: AppSettingsRecord): Promise<void>
  get(): Promise<AppSettingsRecord | undefined>
}

export type Persistence = {
  settings: AppSettingsRepository
  sessions: SessionRepository
  sessionCategories: SessionCategoryRepository
  messages: MessageRepository
  runs: RunRepository
  steps: RunStepRepository
  contextItems: RunContextItemRepository
  events: RuntimeEventRepository
  modelProviders: ModelProviderRepository
  models: ModelRepository
  skills: SkillRepository
  roles: RoleRepository
  toolPermissionPolicies: ToolPermissionPolicyRepository
  workerAgentInvocations: WorkerAgentInvocationRepository
  sshKeys: SshKeyRepository
  sshServers: SshServerRepository
  sshExecutions: SshExecutionRepository
  sshCommandResults: SshCommandResultRepository
  credentialRecords: CredentialRecordRepository
  transaction<T>(fn: () => Promise<T>): Promise<T>
  exportDatabaseBytes?: () => Uint8Array
  checkpoint?(): void
  close?(): void
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

function parseRequiredJson(value: unknown, field: string): unknown {
  try {
    return JSON.parse(String(value))
  } catch (error) {
    throw new Error(`Invalid JSON in ${field}`, { cause: error })
  }
}

function parseOptionalJson(value: unknown, field: string): unknown | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return parseRequiredJson(value, field)
}

function parseStringArrayJson(value: unknown, field: string): string[] {
  if (value === null || value === undefined || value === '') return []
  const parsed = parseRequiredJson(value, field)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid string array JSON in ${field}`)
  }
  return parsed
}

const modelCapabilities = new Set<ModelCapability>(['streaming', 'toolCalls', 'jsonOutput', 'reasoning', 'imageInput'])

function parseModelCapabilities(value: unknown): ModelCapability[] {
  const parsed = parseStringArrayJson(value, 'models.capabilities_json')
  for (const capability of parsed) {
    if (!modelCapabilities.has(capability as ModelCapability)) {
      throw new Error(`Invalid model capability in models.capabilities_json: ${capability}`)
    }
  }
  return parsed as ModelCapability[]
}

function parseOptionalModelRef(value: unknown, field: string): ModelRef | undefined {
  const parsed = parseOptionalJson(value, field)
  return parsed === undefined ? undefined : modelRefSchema.parse(parsed)
}

function parseOptionalRoleSnapshot(value: unknown, field: string) {
  const parsed = parseOptionalJson(value, field)
  return parsed === undefined ? undefined : roleSnapshotSchema.parse(parsed)
}

function parseOptionalMessageAttachments(value: unknown, field: string) {
  const parsed = parseOptionalJson(value, field)
  if (parsed === undefined) return undefined
  if (!Array.isArray(parsed)) throw new Error(`Invalid message attachments JSON in ${field}`)
  return parsed.map((item) => messageAttachmentSchema.parse(item))
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined
  return Number(value) === 1
}

function json(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value)
}

function toSession(row: any): Session {
  return stripUndefined({
    id: row.id,
    title: row.title,
    status: row.status,
    categoryId: optionalString(row.category_id),
    isMarked: Number(row.is_marked ?? 0) === 1 ? true : undefined,
    workspacePath: row.workspace_path ?? undefined,
    defaultModelId: row.default_model_id ?? undefined,
    providerId: optionalString(row.provider_id),
    modelId: optionalString(row.model_id),
    roleId: optionalString(row.role_id),
    enabledSkillIds: parseStringArrayJson(row.enabled_skill_ids_json, 'sessions.enabled_skill_ids_json'),
    enabledToolIds: parseStringArrayJson(row.enabled_tool_ids_json, 'sessions.enabled_tool_ids_json'),
    allowedWorkerAgentRoleIds: parseStringArrayJson(row.allowed_worker_agent_role_ids_json, 'sessions.allowed_worker_agent_role_ids_json'),
    maxWorkerAgentDepth: optionalNumber(row.max_worker_agent_depth) ?? 1,
    maxWorkerAgentsPerRun: optionalNumber(row.max_worker_agents_per_run) ?? 64,
    outputMode: row.output_mode,
    unreadCompletedAt: row.unread_completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }) as Session
}

function toSessionCategory(row: any): SessionCategory {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMessage(row: any): Message {
  return stripUndefined({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    contentType: row.content_type,
    runId: row.run_id ?? undefined,
    attachments: parseOptionalMessageAttachments(row.attachments_json, 'messages.attachments_json'),
    createdAt: row.created_at
  }) as Message
}

function toRun(row: any): AgentRun {
  const error = row.error_json ? runErrorSchema.parse(JSON.parse(String(row.error_json))) : undefined
  return stripUndefined({
    id: row.id,
    sessionId: row.session_id,
    parentRunId: row.parent_run_id ?? undefined,
    workerAgentInvocationId: row.worker_agent_invocation_id ?? undefined,
    depth: optionalNumber(row.depth),
    status: row.status,
    modelId: row.model_id,
    workspacePath: row.workspace_path ?? undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    ...(error ? { error } : {})
  }) as AgentRun
}

function toStep(row: any): RunStep {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type,
    status: row.status,
    title: row.title,
    summary: row.summary ?? undefined,
    detail: row.detail ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  }
}

function toRunContextItem(row: any): RunContextItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    kind: row.kind,
    version: row.version,
    content: row.content,
    tokenEstimate: row.token_estimate,
    sourceHash: row.source_hash,
    createdAt: row.created_at
  }
}

function toModelProvider(row: any): ModelProviderConfig {
  return stripUndefined({
    id: row.id,
    name: row.name,
    kind: row.kind,
    authType: row.auth_type ?? undefined,
    piAuthProvider: row.pi_auth_provider ?? undefined,
    baseUrl: row.base_url ?? undefined,
    apiKeyRef: row.api_key_ref ?? undefined,
    hasApiKey: optionalBoolean(row.has_api_key),
    enabled: Number(row.enabled) === 1,
    defaultModelId: row.default_model_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }) as ModelProviderConfig
}

function toModel(row: any): ModelConfig {
  return stripUndefined({
    id: row.id,
    providerId: row.provider_id,
    modelName: row.model_name,
    displayName: row.display_name,
    capabilities: parseModelCapabilities(row.capabilities_json),
    contextWindow: optionalNumber(row.context_window),
    enabled: optionalBoolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }) as ModelConfig
}

function toSkill(row: any): Skill {
  return stripUndefined({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    source: row.source,
    path: row.path ?? undefined,
    sourcePath: row.source_path ?? undefined,
    prompt: row.prompt ?? undefined,
    allowedToolIds: parseStringArrayJson(row.allowed_tool_ids_json, 'skills.allowed_tool_ids_json'),
    enabled: optionalBoolean(row.enabled)
  }) as Skill
}

function toRole(row: any): Role {
  return stripUndefined({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    defaultModelId: row.default_model_id ?? undefined,
    defaultModelRef: parseOptionalModelRef(row.default_model_ref_json, 'roles.default_model_ref_json'),
    systemPrompt: row.system_prompt ?? undefined,
    allowedSkillIds: parseStringArrayJson(row.allowed_skill_ids_json, 'roles.allowed_skill_ids_json'),
    defaultSkillIds: parseStringArrayJson(row.default_skill_ids_json, 'roles.default_skill_ids_json'),
    defaultToolIds: parseStringArrayJson(row.default_tool_ids_json, 'roles.default_tool_ids_json'),
    canBeMainAgent: Number(row.can_be_main_agent) === 1,
    canBeWorkerAgent: Number(row.can_be_worker_agent) === 1,
    canBeAssignedToWorkerAgent: optionalBoolean(row.can_be_assigned_to_worker_agent),
    workerAgentGuidance: row.worker_agent_guidance ?? undefined
  }) as Role
}

function toToolPermissionPolicy(row: any): ToolPermissionPolicy {
  return stripUndefined({
    id: row.id,
    toolId: row.tool_id,
    mode: row.mode,
    scope: row.scope,
    subjectId: row.subject_id ?? undefined,
    riskLevel: row.risk_level ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }) as ToolPermissionPolicy
}

function toWorkerAgentInvocation(row: any): WorkerAgentInvocation {
  const error = row.error_json ? runErrorSchema.parse(JSON.parse(String(row.error_json))) : undefined
  return stripUndefined({
    id: row.id,
    parentRunId: row.parent_run_id,
    childRunId: row.child_run_id ?? undefined,
    parentStepId: row.parent_step_id ?? undefined,
    parentToolCallId: row.parent_tool_call_id ?? undefined,
    task: row.task,
    roleId: row.role_id,
    allowedToolIds: parseStringArrayJson(row.allowed_tool_ids_json, 'worker_agent_invocations.allowed_tool_ids_json'),
    modelRef: parseOptionalModelRef(row.model_ref_json, 'worker_agent_invocations.model_ref_json'),
    roleSnapshot: parseOptionalRoleSnapshot(row.role_snapshot_json, 'worker_agent_invocations.role_snapshot_json'),
    expectedOutput: row.expected_output ?? undefined,
    contextSummary: row.context_summary ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    lastEventAt: row.last_event_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    error
  }) as WorkerAgentInvocation
}

function toSshKey(row: any): SshKey {
  return sshKeySchema.parse(stripUndefined({
    id: row.id,
    name: row.name,
    publicKey: row.public_key ?? undefined,
    note: row.note ?? undefined,
    hasPassphrase: Number(row.has_passphrase) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function toSshServer(row: any): SshServer {
  return sshServerSchema.parse(stripUndefined({
    id: row.id,
    name: row.name,
    host: row.host,
    port: Number(row.port),
    username: row.username,
    keyId: row.key_id,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function toSshExecution(row: any): SshExecution {
  const error = row.error_json ? runErrorSchema.parse(JSON.parse(String(row.error_json))) : undefined
  return sshExecutionSchema.parse(stripUndefined({
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    serverId: row.server_id,
    serverName: row.server_name,
    commands: parseStringArrayJson(row.commands_json, 'ssh_executions.commands_json'),
    stopOnError: Number(row.stop_on_error) === 1,
    timeoutMs: Number(row.timeout_ms),
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    error
  }))
}

function toSshCommandResult(row: any): SshCommandResult {
  return sshCommandResultSchema.parse(stripUndefined({
    executionId: row.execution_id,
    index: Number(row.command_index),
    command: row.command,
    status: row.status,
    stdout: row.stdout ?? '',
    stderr: row.stderr ?? '',
    exitCode: optionalNumber(row.exit_code),
    signal: row.signal ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: optionalNumber(row.duration_ms),
    skippedReason: row.skipped_reason ?? undefined
  }))
}

function toCredentialRecord(row: any): CredentialRecord {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    encryptedValueBase64: row.encrypted_value_base64,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const appSettingsOutputModes = new Set<AppSettingsRecord['defaultOutputMode']>(['markdown', 'html'])
const appSettingsThemeModes = new Set<ThemeMode>(themeModeValues)

function toAppSettingsRecord(row: any): AppSettingsRecord {
  const defaultOutputMode = String(row.default_output_mode)
  const themeMode = String(row.theme_mode)
  const themeId = String(row.theme_id ?? defaultAppThemeId)
  if (!appSettingsOutputModes.has(defaultOutputMode as AppSettingsRecord['defaultOutputMode'])) {
    throw new Error(`Invalid app settings output mode: ${defaultOutputMode}`)
  }
  if (!appSettingsThemeModes.has(themeMode as ThemeMode)) {
    throw new Error(`Invalid app settings theme mode: ${themeMode}`)
  }
  if (!isAppThemeId(themeId)) {
    throw new Error(`Invalid app settings theme id: ${themeId}`)
  }
  const parsedFontSize = Number(row.font_size ?? 14)
  const fontSize = Number.isInteger(parsedFontSize) && parsedFontSize >= 12 && parsedFontSize <= 18 ? parsedFontSize : 14
  return {
    defaultModelId: String(row.default_model_id),
    defaultOutputMode: defaultOutputMode as AppSettingsRecord['defaultOutputMode'],
    themeMode: themeMode as ThemeMode,
    themeId,
    fontSize,
    soul: typeof row.soul === 'string' ? row.soul : '',
    updatedAt: String(row.updated_at)
  }
}

function extractRunId(event: RuntimeEventRecord): string {
  switch (event.type) {
    case 'run.created':
      return event.run.id
    case 'run.started':
    case 'message.delta':
    case 'run.retrying':
    case 'run.failed':
    case 'run.succeeded':
    case 'run.cancelled':
      return event.runId
    case 'step.created':
    case 'step.updated':
      return event.step.runId
    case 'worker.invocation.created':
    case 'worker.invocation.updated':
      return event.invocation.childRunId ?? event.invocation.parentRunId
    case 'message.completed': {
      const runId = event.message.runId
      if (!runId) throw new Error('message.completed event must include message.runId')
      return runId
    }
  }
}

function parseRuntimeEvent(value: unknown): RuntimeEventRecord {
  return agentRuntimeEventSchema.parse(value)
}

export function createRepositories(db: SqliteAdapter): Persistence {
  const sequencedTables = [
    'sessions',
    'session_categories',
    'messages',
    'agent_runs',
    'run_steps',
    'run_context_items',
    'model_providers',
    'models',
    'skills',
    'roles',
    'tool_permission_policies',
    'worker_agent_invocations',
    'ssh_keys',
    'ssh_servers',
    'ssh_executions',
    'ssh_command_results',
    'credential_records'
  ]
  const exec = (sql: string, params: unknown[] = []) => db.run(sql, params)
  const fetchAll = (sql: string, params: unknown[] = []) => db.all(sql, params)
  const fetchOne = (sql: string, params: unknown[] = []) => db.get(sql, params)

  const maxSequence = sequencedTables.reduce((max, table) => {
    const value = Number((fetchOne(`SELECT MAX(sort_seq) AS max_sort_seq FROM ${table}`) as { max_sort_seq?: unknown } | undefined)?.max_sort_seq ?? 0)
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  let sequence = maxSequence
  const nextSeq = () => ++sequence

  const upsert = (table: string, columns: string[], values: unknown[], id: string) => {
    const placeholders = columns.map(() => '?').join(', ')
    const updateColumns = columns.filter((column) => column !== 'id' && column !== 'sort_seq').map((column) => `${column}=excluded.${column}`).join(', ')
    const existing = fetchAll(`SELECT sort_seq FROM ${table} WHERE id = ?`, [id])[0]
    const finalValues = values.slice()
    finalValues[finalValues.length - 1] = existing ? existing.sort_seq : finalValues[finalValues.length - 1]
    exec(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateColumns}`,
      finalValues
    )
  }
  const tableColumns = (table: string): Set<string> => {
    const columns = new Set<string>()
    for (const row of fetchAll(`PRAGMA table_info(${table})`)) {
      if (typeof row.name === 'string') columns.add(row.name)
    }
    return columns
  }
  const roleColumns = tableColumns('roles')
  const hasLegacyRoleSubagentColumn = roleColumns.has('can_be_subagent')

  const persistence: Persistence = {
    settings: {
      async save(settings) {
        exec('DELETE FROM app_settings')
        exec('INSERT INTO app_settings (default_model_id, default_output_mode, theme_mode, theme_id, font_size, soul, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          settings.defaultModelId,
          settings.defaultOutputMode,
          settings.themeMode,
          settings.themeId,
          settings.fontSize,
          settings.soul,
          settings.updatedAt
        ])
      },
      async get() {
        const row = fetchAll('SELECT * FROM app_settings LIMIT 1')[0]
        return row ? toAppSettingsRecord(row) : undefined
      }
    },
    sessions: {
      async save(session) {
        upsert('sessions', [
          'id',
          'title',
          'status',
          'category_id',
          'is_marked',
          'workspace_path',
          'default_model_id',
          'provider_id',
          'model_id',
          'role_id',
          'enabled_skill_ids_json',
          'enabled_tool_ids_json',
          'allowed_worker_agent_role_ids_json',
          'max_worker_agent_depth',
          'max_worker_agents_per_run',
          'output_mode',
          'unread_completed_at',
          'created_at',
          'updated_at',
          'sort_seq'
        ], [
          session.id,
          session.title,
          session.status,
          session.categoryId,
          session.isMarked ? 1 : 0,
          session.workspacePath,
          session.defaultModelId,
          session.providerId,
          session.modelId,
          session.roleId,
          json(session.enabledSkillIds),
          json(session.enabledToolIds),
          json(session.allowedWorkerAgentRoleIds),
          session.maxWorkerAgentDepth,
          session.maxWorkerAgentsPerRun,
          session.outputMode,
          session.unreadCompletedAt,
          session.createdAt,
          session.updatedAt,
          nextSeq()
        ], session.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM sessions WHERE id = ?', [id])[0]
        return row ? toSession(row) : undefined
      },
      async listVisible() {
        return fetchAll("SELECT * FROM sessions WHERE status != 'deleted' ORDER BY updated_at DESC, sort_seq ASC, id ASC").map(toSession)
      }
    },
    sessionCategories: {
      async save(category) {
        upsert('session_categories', [
          'id',
          'name',
          'created_at',
          'updated_at',
          'sort_seq'
        ], [
          category.id,
          category.name,
          category.createdAt,
          category.updatedAt,
          nextSeq()
        ], category.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM session_categories WHERE id = ?', [id])[0]
        return row ? toSessionCategory(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM session_categories ORDER BY sort_seq ASC, name ASC, id ASC').map(toSessionCategory)
      },
      async delete(id) {
        exec('UPDATE sessions SET category_id = NULL WHERE category_id = ?', [id])
        exec('DELETE FROM session_categories WHERE id = ?', [id])
      }
    },
    messages: {
      async save(message) {
        upsert('messages', ['id', 'session_id', 'role', 'content', 'content_type', 'run_id', 'attachments_json', 'created_at', 'sort_seq'], [
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.contentType,
          message.runId,
          json(message.attachments),
          message.createdAt,
          nextSeq()
        ], message.id)
      },
      async listBySession(sessionId) {
        return fetchAll(
          `SELECT messages.*
           FROM messages
           LEFT JOIN agent_runs ON agent_runs.id = messages.run_id
           WHERE messages.session_id = ?
             AND (
               messages.run_id IS NULL
               OR agent_runs.id IS NULL
               OR agent_runs.parent_run_id IS NULL
             )
           ORDER BY messages.sort_seq ASC, messages.id ASC`,
          [sessionId]
        ).map(toMessage)
      },
      async listByRun(runId) {
        return fetchAll('SELECT * FROM messages WHERE run_id = ? ORDER BY sort_seq ASC, id ASC', [runId]).map(toMessage)
      }
    },
    runs: {
      async save(run) {
        upsert('agent_runs', ['id', 'session_id', 'parent_run_id', 'worker_agent_invocation_id', 'depth', 'status', 'model_id', 'workspace_path', 'retry_count', 'max_retries', 'started_at', 'ended_at', 'error_json', 'sort_seq'], [
          run.id,
          run.sessionId,
          run.parentRunId,
          run.workerAgentInvocationId,
          run.depth,
          run.status,
          run.modelId,
          run.workspacePath,
          run.retryCount,
          run.maxRetries,
          run.startedAt,
          run.endedAt,
          run.error ? JSON.stringify(run.error) : undefined,
          nextSeq()
        ], run.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM agent_runs WHERE id = ?', [id])[0]
        return row ? toRun(row) : undefined
      },
      async listBySession(sessionId) {
        return fetchAll('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY sort_seq ASC, id ASC', [sessionId]).map(toRun)
      }
    },
    steps: {
      async save(step) {
        upsert('run_steps', ['id', 'run_id', 'type', 'status', 'title', 'summary', 'detail', 'created_at', 'completed_at', 'sort_seq'], [
          step.id,
          step.runId,
          step.type,
          step.status,
          step.title,
          step.summary,
          step.detail,
          step.createdAt,
          step.completedAt,
          nextSeq()
        ], step.id)
      },
      async listByRun(runId) {
        return fetchAll('SELECT * FROM run_steps WHERE run_id = ? ORDER BY sort_seq ASC, id ASC', [runId]).map(toStep)
      }
    },
    contextItems: {
      async save(item) {
        upsert('run_context_items', ['id', 'session_id', 'run_id', 'kind', 'version', 'content', 'token_estimate', 'source_hash', 'created_at', 'sort_seq'], [
          item.id,
          item.sessionId,
          item.runId,
          item.kind,
          item.version,
          item.content,
          item.tokenEstimate,
          item.sourceHash,
          item.createdAt,
          nextSeq()
        ], item.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM run_context_items WHERE id = ?', [id])[0]
        return row ? toRunContextItem(row) : undefined
      },
      async listByRun(runId) {
        return fetchAll('SELECT * FROM run_context_items WHERE run_id = ? ORDER BY sort_seq ASC, id ASC', [runId]).map(toRunContextItem)
      },
      async listBySession(sessionId) {
        return fetchAll('SELECT * FROM run_context_items WHERE session_id = ? ORDER BY sort_seq ASC, id ASC', [sessionId]).map(toRunContextItem)
      }
    },
    events: {
      async append(event) {
        const runId = extractRunId(event)
        exec('INSERT INTO runtime_events (run_id, event_json) VALUES (?, ?)', [runId, JSON.stringify(event)])
      },
      async listByRun(runId) {
        return fetchAll('SELECT event_json FROM runtime_events WHERE run_id = ? ORDER BY id ASC', [runId]).map((row) => parseRuntimeEvent(JSON.parse(String(row.event_json))))
      }
    },
    modelProviders: {
      async save(provider) {
        upsert('model_providers', ['id', 'name', 'kind', 'auth_type', 'pi_auth_provider', 'base_url', 'api_key_ref', 'has_api_key', 'enabled', 'default_model_id', 'created_at', 'updated_at', 'sort_seq'], [
          provider.id,
          provider.name,
          provider.kind,
          provider.authType,
          provider.piAuthProvider,
          provider.baseUrl,
          provider.apiKeyRef,
          provider.hasApiKey === undefined ? undefined : provider.hasApiKey ? 1 : 0,
          provider.enabled ? 1 : 0,
          provider.defaultModelId,
          provider.createdAt,
          provider.updatedAt,
          nextSeq()
        ], provider.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM model_providers WHERE id = ?', [id])[0]
        return row ? toModelProvider(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM model_providers ORDER BY sort_seq ASC, id ASC').map(toModelProvider)
      },
      async delete(id) {
        exec('DELETE FROM model_providers WHERE id = ?', [id])
      }
    },
    models: {
      async save(model) {
        upsert('models', ['id', 'provider_id', 'model_name', 'display_name', 'capabilities_json', 'context_window', 'enabled', 'created_at', 'updated_at', 'sort_seq'], [
          model.id,
          model.providerId,
          model.modelName,
          model.displayName,
          JSON.stringify(model.capabilities),
          model.contextWindow,
          model.enabled === undefined ? undefined : model.enabled ? 1 : 0,
          model.createdAt,
          model.updatedAt,
          nextSeq()
        ], model.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM models WHERE id = ?', [id])[0]
        return row ? toModel(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM models ORDER BY sort_seq ASC, id ASC').map(toModel)
      },
      async listByProvider(providerId) {
        return fetchAll('SELECT * FROM models WHERE provider_id = ? ORDER BY sort_seq ASC, id ASC', [providerId]).map(toModel)
      },
      async deleteByProvider(providerId) {
        exec('DELETE FROM models WHERE provider_id = ?', [providerId])
      }
    },
    skills: {
      async save(skill) {
        upsert('skills', ['id', 'name', 'description', 'source', 'path', 'source_path', 'prompt', 'allowed_tool_ids_json', 'enabled', 'sort_seq'], [
          skill.id,
          skill.name,
          skill.description,
          skill.source,
          skill.path,
          skill.sourcePath,
          skill.prompt,
          json(skill.allowedToolIds),
          skill.enabled === undefined ? undefined : skill.enabled ? 1 : 0,
          nextSeq()
        ], skill.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM skills WHERE id = ?', [id])[0]
        return row ? toSkill(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM skills ORDER BY sort_seq ASC, id ASC').map(toSkill)
      }
    },
    roles: {
      async save(role) {
        const columns = ['id', 'name', 'description', 'default_model_id', 'default_model_ref_json', 'system_prompt', 'allowed_skill_ids_json', 'default_skill_ids_json', 'default_tool_ids_json', 'can_be_main_agent', 'can_be_worker_agent', 'can_be_assigned_to_worker_agent', 'worker_agent_guidance']
        const values: unknown[] = [
          role.id,
          role.name,
          role.description,
          role.defaultModelId,
          json(role.defaultModelRef),
          role.systemPrompt,
          JSON.stringify(role.allowedSkillIds),
          json(role.defaultSkillIds),
          json(role.defaultToolIds),
          role.canBeMainAgent ? 1 : 0,
          role.canBeWorkerAgent ? 1 : 0,
          role.canBeAssignedToWorkerAgent === undefined ? undefined : role.canBeAssignedToWorkerAgent ? 1 : 0,
          role.workerAgentGuidance
        ]
        if (hasLegacyRoleSubagentColumn) {
          columns.push('can_be_subagent')
          values.push(role.canBeWorkerAgent ? 1 : 0)
        }
        columns.push('sort_seq')
        values.push(nextSeq())
        upsert('roles', columns, values, role.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM roles WHERE id = ?', [id])[0]
        return row ? toRole(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM roles ORDER BY sort_seq ASC, id ASC').map(toRole)
      },
      async delete(id) {
        exec('DELETE FROM roles WHERE id = ?', [id])
      }
    },
    toolPermissionPolicies: {
      async save(policy) {
        upsert('tool_permission_policies', ['id', 'tool_id', 'mode', 'scope', 'subject_id', 'risk_level', 'created_at', 'updated_at', 'sort_seq'], [
          policy.id,
          policy.toolId,
          policy.mode,
          policy.scope,
          policy.subjectId,
          policy.riskLevel,
          policy.createdAt,
          policy.updatedAt,
          nextSeq()
        ], policy.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM tool_permission_policies WHERE id = ?', [id])[0]
        return row ? toToolPermissionPolicy(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM tool_permission_policies ORDER BY sort_seq ASC, id ASC').map(toToolPermissionPolicy)
      },
      async listByScope(scope, subjectId) {
        const sql = subjectId === undefined
          ? 'SELECT * FROM tool_permission_policies WHERE scope = ? ORDER BY sort_seq ASC, id ASC'
          : 'SELECT * FROM tool_permission_policies WHERE scope = ? AND subject_id = ? ORDER BY sort_seq ASC, id ASC'
        const params = subjectId === undefined ? [scope] : [scope, subjectId]
        return fetchAll(sql, params).map(toToolPermissionPolicy)
      }
    },
    workerAgentInvocations: {
      async save(invocation) {
        upsert('worker_agent_invocations', ['id', 'parent_run_id', 'child_run_id', 'parent_step_id', 'parent_tool_call_id', 'task', 'role_id', 'allowed_tool_ids_json', 'model_ref_json', 'role_snapshot_json', 'expected_output', 'context_summary', 'status', 'created_at', 'last_event_at', 'completed_at', 'error_json', 'sort_seq'], [
          invocation.id,
          invocation.parentRunId,
          invocation.childRunId,
          invocation.parentStepId,
          invocation.parentToolCallId,
          invocation.task,
          invocation.roleId,
          JSON.stringify(invocation.allowedToolIds),
          json(invocation.modelRef),
          json(invocation.roleSnapshot),
          invocation.expectedOutput,
          invocation.contextSummary,
          invocation.status,
          invocation.createdAt,
          invocation.lastEventAt,
          invocation.completedAt,
          invocation.error ? JSON.stringify(invocation.error) : undefined,
          nextSeq()
        ], invocation.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM worker_agent_invocations WHERE id = ?', [id])[0]
        return row ? toWorkerAgentInvocation(row) : undefined
      },
      async listByParentRun(parentRunId) {
        return fetchAll('SELECT * FROM worker_agent_invocations WHERE parent_run_id = ? ORDER BY sort_seq ASC, id ASC', [parentRunId]).map(toWorkerAgentInvocation)
      },
      async listByChildRun(childRunId) {
        return fetchAll('SELECT * FROM worker_agent_invocations WHERE child_run_id = ? ORDER BY sort_seq ASC, id ASC', [childRunId]).map(toWorkerAgentInvocation)
      }
    },
    sshKeys: {
      async save(key) {
        upsert('ssh_keys', ['id', 'name', 'public_key', 'note', 'has_passphrase', 'created_at', 'updated_at', 'sort_seq'], [
          key.id,
          key.name,
          key.publicKey,
          key.note,
          key.hasPassphrase ? 1 : 0,
          key.createdAt,
          key.updatedAt,
          nextSeq()
        ], key.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM ssh_keys WHERE id = ?', [id])[0]
        return row ? toSshKey(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM ssh_keys ORDER BY sort_seq ASC, id ASC').map(toSshKey)
      },
      async delete(id) {
        exec('DELETE FROM ssh_keys WHERE id = ?', [id])
      }
    },
    sshServers: {
      async save(server) {
        upsert('ssh_servers', ['id', 'name', 'host', 'port', 'username', 'key_id', 'note', 'created_at', 'updated_at', 'sort_seq'], [
          server.id,
          server.name,
          server.host,
          server.port,
          server.username,
          server.keyId,
          server.note,
          server.createdAt,
          server.updatedAt,
          nextSeq()
        ], server.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM ssh_servers WHERE id = ?', [id])[0]
        return row ? toSshServer(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM ssh_servers ORDER BY sort_seq ASC, id ASC').map(toSshServer)
      },
      async listByKeyId(keyId) {
        return fetchAll('SELECT * FROM ssh_servers WHERE key_id = ? ORDER BY sort_seq ASC, id ASC', [keyId]).map(toSshServer)
      },
      async delete(id) {
        exec('DELETE FROM ssh_servers WHERE id = ?', [id])
      }
    },
    sshExecutions: {
      async save(execution) {
        upsert('ssh_executions', ['id', 'session_id', 'run_id', 'server_id', 'server_name', 'commands_json', 'stop_on_error', 'timeout_ms', 'status', 'started_at', 'updated_at', 'completed_at', 'error_json', 'sort_seq'], [
          execution.id,
          execution.sessionId,
          execution.runId,
          execution.serverId,
          execution.serverName,
          JSON.stringify(execution.commands),
          execution.stopOnError ? 1 : 0,
          execution.timeoutMs,
          execution.status,
          execution.startedAt,
          execution.updatedAt,
          execution.completedAt,
          execution.error ? JSON.stringify(execution.error) : undefined,
          nextSeq()
        ], execution.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM ssh_executions WHERE id = ?', [id])[0]
        return row ? toSshExecution(row) : undefined
      },
      async listBySession(sessionId) {
        return fetchAll('SELECT * FROM ssh_executions WHERE session_id = ? ORDER BY sort_seq ASC, id ASC', [sessionId]).map(toSshExecution)
      }
    },
    sshCommandResults: {
      async save(result) {
        const id = `${result.executionId}:${result.index}`
        upsert('ssh_command_results', ['id', 'execution_id', 'command_index', 'command', 'status', 'stdout', 'stderr', 'exit_code', 'signal', 'started_at', 'completed_at', 'duration_ms', 'skipped_reason', 'sort_seq'], [
          id,
          result.executionId,
          result.index,
          result.command,
          result.status,
          result.stdout,
          result.stderr,
          result.exitCode,
          result.signal,
          result.startedAt,
          result.completedAt,
          result.durationMs,
          result.skippedReason,
          nextSeq()
        ], id)
      },
      async listByExecution(executionId) {
        return fetchAll('SELECT * FROM ssh_command_results WHERE execution_id = ? ORDER BY command_index ASC, sort_seq ASC, id ASC', [executionId]).map(toSshCommandResult)
      }
    },
    credentialRecords: {
      async save(record) {
        upsert('credential_records', ['id', 'kind', 'subject_id', 'encrypted_value_base64', 'created_at', 'updated_at', 'sort_seq'], [
          record.id,
          record.kind,
          record.subjectId,
          record.encryptedValueBase64,
          record.createdAt,
          record.updatedAt,
          nextSeq()
        ], record.id)
      },
      async get(id) {
        const row = fetchAll('SELECT * FROM credential_records WHERE id = ?', [id])[0]
        return row ? toCredentialRecord(row) : undefined
      },
      async list() {
        return fetchAll('SELECT * FROM credential_records ORDER BY sort_seq ASC, id ASC').map(toCredentialRecord)
      },
      async delete(id) {
        exec('DELETE FROM credential_records WHERE id = ?', [id])
      }
    },
    transaction(fn) {
      return db.transaction(fn)
    },
    checkpoint() {
      db.checkpoint?.()
    },
    close() {
      db.close?.()
    }
  }

  if (db.exportDatabaseBytes) {
    persistence.exportDatabaseBytes = () => db.exportDatabaseBytes!()
  }

  return persistence
}
