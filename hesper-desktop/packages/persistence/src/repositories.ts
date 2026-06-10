/// <reference path="./sqljs.d.ts" />
import {
  agentRuntimeEventSchema,
  runErrorSchema,
  type AgentRun,
  type AgentRuntimeEvent,
  type Message,
  type RunStep,
  type Session
} from '@hesper/shared'
import type { Database } from 'sql.js'

export type RuntimeEventRecord = AgentRuntimeEvent

export type SessionRepository = {
  save(session: Session): Promise<void>
  get(id: string): Promise<Session | undefined>
  listVisible(): Promise<Session[]>
}

export type MessageRepository = {
  save(message: Message): Promise<void>
  listBySession(sessionId: string): Promise<Message[]>
}

export type RunRepository = {
  save(run: AgentRun): Promise<void>
  listBySession(sessionId: string): Promise<AgentRun[]>
}

export type RunStepRepository = {
  save(step: RunStep): Promise<void>
  listByRun(runId: string): Promise<RunStep[]>
}

export type RuntimeEventRepository = {
  append(event: RuntimeEventRecord): Promise<void>
  listByRun(runId: string): Promise<RuntimeEventRecord[]>
}

export type Persistence = {
  sessions: SessionRepository
  messages: MessageRepository
  runs: RunRepository
  steps: RunStepRepository
  events: RuntimeEventRepository
  exportDatabaseBytes(): Uint8Array
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

function toSession(row: any): Session {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    workspacePath: row.workspace_path ?? undefined,
    defaultModelId: row.default_model_id ?? undefined,
    outputMode: row.output_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    contentType: row.content_type,
    runId: row.run_id ?? undefined,
    createdAt: row.created_at
  }
}

function toRun(row: any): AgentRun {
  const error = row.error_json ? runErrorSchema.parse(JSON.parse(String(row.error_json))) : undefined
  return {
    id: row.id,
    sessionId: row.session_id,
    parentRunId: row.parent_run_id ?? undefined,
    status: row.status,
    modelId: row.model_id,
    workspacePath: row.workspace_path ?? undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    ...(error ? { error } : {})
  }
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

function extractRunId(event: RuntimeEventRecord): string {
  switch (event.type) {
    case 'run.created':
      return event.run.id
    case 'run.started':
    case 'message.delta':
    case 'run.retrying':
    case 'run.failed':
    case 'run.succeeded':
      return event.runId
    case 'step.created':
    case 'step.updated':
      return event.step.runId
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

export function createRepositories(db: Database): Persistence {
  const maxSequence = ['sessions', 'messages', 'agent_runs', 'run_steps'].reduce((max, table) => {
    const stmt = db.prepare(`SELECT MAX(sort_seq) AS max_sort_seq FROM ${table}`)
    try {
      const value = stmt.step() ? Number((stmt.getAsObject() as { max_sort_seq?: unknown }).max_sort_seq ?? 0) : 0
      return Number.isFinite(value) ? Math.max(max, value) : max
    } finally {
      stmt.free()
    }
  }, 0)
  let sequence = maxSequence
  const nextSeq = () => ++sequence

  const bindValues = (values: unknown[]) => values.map((value) => (value === undefined ? null : value))
  const exec = (sql: string, params: unknown[] = []) => db.run(sql, bindValues(params))
  const fetchAll = (sql: string, params: unknown[] = []) => {
    const stmt = db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

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

  return {
    sessions: {
      async save(session) {
        upsert('sessions', ['id', 'title', 'status', 'workspace_path', 'default_model_id', 'output_mode', 'created_at', 'updated_at', 'sort_seq'], [
          session.id,
          session.title,
          session.status,
          session.workspacePath,
          session.defaultModelId,
          session.outputMode,
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
        return fetchAll("SELECT * FROM sessions WHERE status != 'deleted' ORDER BY sort_seq ASC, id ASC").map(toSession)
      }
    },
    messages: {
      async save(message) {
        upsert('messages', ['id', 'session_id', 'role', 'content', 'content_type', 'run_id', 'created_at', 'sort_seq'], [
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.contentType,
          message.runId,
          message.createdAt,
          nextSeq()
        ], message.id)
      },
      async listBySession(sessionId) {
        return fetchAll('SELECT * FROM messages WHERE session_id = ? ORDER BY sort_seq ASC, id ASC', [sessionId]).map(toMessage)
      }
    },
    runs: {
      async save(run) {
        upsert('agent_runs', ['id', 'session_id', 'parent_run_id', 'status', 'model_id', 'workspace_path', 'retry_count', 'max_retries', 'started_at', 'ended_at', 'error_json', 'sort_seq'], [
          run.id,
          run.sessionId,
          run.parentRunId,
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
    events: {
      async append(event) {
        const runId = extractRunId(event)
        exec('INSERT INTO runtime_events (run_id, event_json) VALUES (?, ?)', [runId, JSON.stringify(event)])
      },
      async listByRun(runId) {
        return fetchAll('SELECT event_json FROM runtime_events WHERE run_id = ? ORDER BY id ASC', [runId]).map((row) => parseRuntimeEvent(JSON.parse(String(row.event_json))))
      }
    },
    exportDatabaseBytes() {
      return db.export()
    }
  }
}
