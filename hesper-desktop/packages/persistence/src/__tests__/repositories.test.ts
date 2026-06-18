import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFilePersistence, createInMemoryPersistence, exportDatabaseBytes } from '../database'
import { schemaSql } from '../schema'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js') as () => Promise<{ Database: new (data?: Uint8Array) => any }>
const now = '2026-06-10T03:00:00.000Z'

async function createCorruptConfigDatabaseBytes(): Promise<Uint8Array> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(schemaSql)
  db.run(`
INSERT INTO models (id, provider_id, model_name, display_name, capabilities_json, context_window, enabled, created_at, updated_at, sort_seq)
VALUES ('bad-model-json', 'provider-1', 'bad', 'Bad Model JSON', '{not-json', NULL, 1, '${now}', '${now}', 1);
INSERT INTO models (id, provider_id, model_name, display_name, capabilities_json, context_window, enabled, created_at, updated_at, sort_seq)
VALUES ('bad-model-capability', 'provider-1', 'bad', 'Bad Capability', '["streaming", "unknownCapability"]', NULL, 1, '${now}', '${now}', 2);
INSERT INTO roles (id, name, description, default_model_id, default_model_ref_json, system_prompt, allowed_skill_ids_json, default_skill_ids_json, default_tool_ids_json, can_be_main_agent, can_be_subagent, can_be_assigned_to_subagent, subagent_guidance, sort_seq)
VALUES ('bad-role-array', 'Bad Role Array', NULL, NULL, NULL, NULL, '{"not":"an-array"}', NULL, NULL, 1, 1, 1, NULL, 3);
INSERT INTO roles (id, name, description, default_model_id, default_model_ref_json, system_prompt, allowed_skill_ids_json, default_skill_ids_json, default_tool_ids_json, can_be_main_agent, can_be_subagent, can_be_assigned_to_subagent, subagent_guidance, sort_seq)
VALUES ('bad-role-ref', 'Bad Role Ref', NULL, NULL, '{"providerId":"provider-1"}', NULL, '[]', NULL, NULL, 1, 1, 1, NULL, 4);
`)
  return db.export()
}

async function createLegacyDatabaseBytes(): Promise<Uint8Array> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(`
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT,
  default_model_id TEXT,
  output_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  model_id TEXT NOT NULL,
  workspace_path TEXT,
  retry_count INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  error_json TEXT,
  sort_seq INTEGER NOT NULL
);
CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  sort_seq INTEGER NOT NULL
);
CREATE TABLE runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO sessions (id, title, status, workspace_path, default_model_id, output_mode, created_at, updated_at, sort_seq)
VALUES ('legacy-session', 'Legacy', 'active', NULL, 'mock/hesper-fast', 'markdown', '${now}', '${now}', 1);
INSERT INTO agent_runs (id, session_id, parent_run_id, status, model_id, workspace_path, retry_count, max_retries, started_at, ended_at, error_json, sort_seq)
VALUES ('legacy-run', 'legacy-session', NULL, 'queued', 'mock/hesper-fast', NULL, 0, 3, NULL, NULL, NULL, 2);
`)
  return db.export()
}

describe('persistence repositories', () => {
  it('creates and lists sessions without deleted sessions', async () => {
    const db = await createInMemoryPersistence()
    await db.sessions.save({ id: 'session-1', title: 'Build hesper', status: 'active', outputMode: 'markdown', createdAt: now, updatedAt: now })
    await db.sessions.save({ id: 'session-2', title: 'Deleted session', status: 'deleted', outputMode: 'html', createdAt: now, updatedAt: now })
    expect(await db.sessions.listVisible()).toHaveLength(1)
  })

  it('persists runtime events across all event shapes', async () => {
    const db = await createInMemoryPersistence()
    await db.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'queued', modelId: 'mock', retryCount: 0, maxRetries: 5 })
    await db.steps.save({ id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Thinking', createdAt: now })
    await db.messages.save({ id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'ok', contentType: 'plain', runId: 'run-1', createdAt: now })
    await db.events.append({ type: 'step.created', step: { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'running', title: 'Call', createdAt: now } })
    await db.events.append({ type: 'step.updated', step: { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'succeeded', title: 'Call', createdAt: now } })
    await db.events.append({ type: 'message.completed', message: { id: 'message-2', sessionId: 'session-1', role: 'assistant', content: 'done', contentType: 'plain', runId: 'run-1', createdAt: now } })
    await db.events.append({ type: 'run.failed', runId: 'run-1', error: { code: 'unknown', message: 'boom', retryable: false } })
    expect(await db.events.listByRun('run-1')).toHaveLength(4)
  })

  it('exports and reopens persisted application settings', async () => {
    const original = await createInMemoryPersistence()
    await original.settings.save({
      defaultModelId: 'deepseek-chat',
      defaultOutputMode: 'html',
      themeMode: 'dark',
      fontSize: 16,
      updatedAt: now
    })

    const tempFile = path.join(os.tmpdir(), `hesper-settings-${Date.now()}.sqlite`)
    fs.writeFileSync(tempFile, exportDatabaseBytes(original))

    try {
      const reopened = await createFilePersistence(tempFile)
      expect(await reopened.settings.get()).toEqual({
        defaultModelId: 'deepseek-chat',
        defaultOutputMode: 'html',
        themeMode: 'dark',
        fontSize: 16,
        updatedAt: now
      })
    } finally {
      fs.rmSync(tempFile, { force: true })
    }
  })

  it('exports and reopens real file persistence without breaking order', async () => {
    const original = await createInMemoryPersistence()
    await original.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'queued', modelId: 'm1', retryCount: 0, maxRetries: 5 })
    await original.runs.save({ id: 'run-2', sessionId: 'session-1', status: 'queued', modelId: 'm2', retryCount: 0, maxRetries: 5 })

    const tempFile = path.join(os.tmpdir(), `hesper-persistence-${Date.now()}.sqlite`)
    fs.writeFileSync(tempFile, exportDatabaseBytes(original))

    try {
      const reopened = await createFilePersistence(tempFile)
      await reopened.runs.save({ id: 'run-3', sessionId: 'session-1', status: 'queued', modelId: 'm3', retryCount: 0, maxRetries: 5 })
      expect((await reopened.runs.listBySession('session-1')).map((run) => run.id)).toEqual(['run-1', 'run-2', 'run-3'])
    } finally {
      fs.rmSync(tempFile, { force: true })
    }
  })

  it('keeps insertion order stable after updates', async () => {
    const db = await createInMemoryPersistence()
    await db.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'queued', modelId: 'm1', retryCount: 0, maxRetries: 5 })
    await db.runs.save({ id: 'run-2', sessionId: 'session-1', status: 'queued', modelId: 'm2', retryCount: 0, maxRetries: 5 })
    await db.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'running', modelId: 'm1', retryCount: 0, maxRetries: 5 })
    expect((await db.runs.listBySession('session-1')).map((run) => run.id)).toEqual(['run-1', 'run-2'])
  })

  it('round-trips model providers and models without raw API keys', async () => {
    const db = await createInMemoryPersistence()
    await db.modelProviders.save({
      id: 'provider-deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKeyRef: 'vault:provider-deepseek',
      hasApiKey: true,
      enabled: true,
      defaultModelId: 'deepseek-chat',
      createdAt: now,
      updatedAt: now
    })
    await db.models.save({
      id: 'deepseek-chat',
      providerId: 'provider-deepseek',
      modelName: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilities: ['streaming', 'toolCalls'],
      contextWindow: 64000,
      enabled: true,
      createdAt: now,
      updatedAt: now
    })

    expect(await db.modelProviders.get('provider-deepseek')).toMatchObject({
      kind: 'deepseek',
      apiKeyRef: 'vault:provider-deepseek',
      hasApiKey: true
    })
    expect(JSON.stringify(await db.modelProviders.list())).not.toContain('sk-')
    expect((await db.models.listByProvider('provider-deepseek')).map((model) => model.id)).toEqual(['deepseek-chat'])
  })

  it('round-trips skills, roles and tool permission policies', async () => {
    const db = await createInMemoryPersistence()
    await db.skills.save({
      id: 'skill-review',
      name: 'Review',
      source: 'workspace',
      sourcePath: 'skills/review/SKILL.md',
      prompt: 'Review carefully.',
      allowedToolIds: ['filesystem.read-file'],
      enabled: true
    })
    await db.roles.save({
      id: 'reviewer',
      name: 'Reviewer',
      systemPrompt: 'Review code.',
      allowedSkillIds: ['skill-review'],
      defaultSkillIds: ['skill-review'],
      defaultToolIds: ['filesystem.read-file', 'git.status'],
      canBeMainAgent: true,
      canBeSubagent: true,
      canBeAssignedToSubagent: true,
      subagentGuidance: 'Return findings with evidence.'
    })
    await db.toolPermissionPolicies.save({
      id: 'policy-1',
      toolId: 'filesystem.read-file',
      mode: 'allow',
      scope: 'subagent',
      subjectId: 'reviewer',
      riskLevel: 'low',
      createdAt: now,
      updatedAt: now
    })

    expect(await db.skills.get('skill-review')).toMatchObject({ allowedToolIds: ['filesystem.read-file'], enabled: true })
    expect(await db.roles.get('reviewer')).toMatchObject({ canBeAssignedToSubagent: true, defaultToolIds: ['filesystem.read-file', 'git.status'] })
    expect(await db.toolPermissionPolicies.listByScope('subagent', 'reviewer')).toHaveLength(1)
  })

  it('round-trips session agent configuration defaults and subagent invocations', async () => {
    const db = await createInMemoryPersistence()
    await db.sessions.save({
      id: 'session-1',
      title: 'Build hesper',
      status: 'active',
      outputMode: 'markdown',
      providerId: 'provider-deepseek',
      modelId: 'deepseek-chat',
      roleId: 'coding',
      enabledSkillIds: ['skill-review'],
      enabledToolIds: ['filesystem.read-file', 'agent.spawn-subagent'],
      allowedSubagentRoleIds: ['reviewer'],
      maxSubagentDepth: 1,
      maxSubagentsPerRun: 3,
      createdAt: now,
      updatedAt: now
    })
    await db.runs.save({ id: 'run-parent', sessionId: 'session-1', status: 'running', modelId: 'deepseek-chat', retryCount: 0, maxRetries: 3, depth: 0 })
    await db.subagentInvocations.save({
      id: 'subagent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      modelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' },
      expectedOutput: 'Findings with evidence.',
      status: 'running',
      createdAt: now
    })
    await db.runs.save({ id: 'run-child', sessionId: 'session-1', parentRunId: 'run-parent', subagentInvocationId: 'subagent-1', status: 'queued', modelId: 'deepseek-chat', retryCount: 0, maxRetries: 3, depth: 1 })

    expect(await db.sessions.get('session-1')).toMatchObject({
      providerId: 'provider-deepseek',
      modelId: 'deepseek-chat',
      roleId: 'coding',
      enabledSkillIds: ['skill-review'],
      allowedSubagentRoleIds: ['reviewer'],
      maxSubagentDepth: 1
    })
    expect(await db.runs.get('run-child')).toMatchObject({ parentRunId: 'run-parent', subagentInvocationId: 'subagent-1', depth: 1 })
    expect(await db.subagentInvocations.listByParentRun('run-parent')).toMatchObject([
      { id: 'subagent-1', childRunId: 'run-child', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file', 'git.status'] }
    ])
  })

  it('fails fast instead of silently rewriting corrupted JSON configuration fields', async () => {
    const tempFile = path.join(os.tmpdir(), `hesper-corrupt-config-${Date.now()}.sqlite`)
    fs.writeFileSync(tempFile, await createCorruptConfigDatabaseBytes())

    try {
      const corrupted = await createFilePersistence(tempFile)
      await expect(corrupted.models.get('bad-model-json')).rejects.toThrow(/models\.capabilities_json/)
      await expect(corrupted.models.get('bad-model-capability')).rejects.toThrow(/Invalid model capability/)
      await expect(corrupted.roles.get('bad-role-array')).rejects.toThrow(/roles\.allowed_skill_ids_json/)
      await expect(corrupted.roles.get('bad-role-ref')).rejects.toThrow()
    } finally {
      fs.rmSync(tempFile, { force: true })
    }
  })

  it('migrates legacy MVP1 databases and applies safe session defaults', async () => {
    const tempFile = path.join(os.tmpdir(), `hesper-legacy-${Date.now()}.sqlite`)
    fs.writeFileSync(tempFile, await createLegacyDatabaseBytes())

    try {
      const migrated = await createFilePersistence(tempFile)
      const session = await migrated.sessions.get('legacy-session')
      expect(session).toMatchObject({
        id: 'legacy-session',
        defaultModelId: 'mock/hesper-fast',
        enabledSkillIds: [],
        enabledToolIds: [],
        allowedSubagentRoleIds: [],
        maxSubagentDepth: 1,
        maxSubagentsPerRun: 3
      })

      await migrated.sessions.save({
        ...session!,
        providerId: 'provider-mock',
        modelId: 'mock/hesper-fast',
        roleId: 'default',
        enabledToolIds: ['workspace.info']
      })
      await migrated.runs.save({ id: 'legacy-child-run', sessionId: 'legacy-session', parentRunId: 'legacy-run', status: 'queued', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 3, depth: 1 })
      expect(await migrated.sessions.get('legacy-session')).toMatchObject({ providerId: 'provider-mock', enabledToolIds: ['workspace.info'] })
      expect(await migrated.runs.get('legacy-child-run')).toMatchObject({ parentRunId: 'legacy-run', depth: 1 })
    } finally {
      fs.rmSync(tempFile, { force: true })
    }
  })
})
