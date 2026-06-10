import type { AgentRun, Message, RunStep, Session } from '@hesper/shared'
import type { AgentRuntimeEvent } from '@hesper/shared/src/events'
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
    error: row.error_json ? JSON.parse(row.error_json) : undefined
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

export function createRepositories(db: Database): Persistence {
  return {
    sessions: {
      async save(session) {
        const data = stripUndefined({
          id: session.id,
          title: session.title,
          status: session.status,
          workspace_path: session.workspacePath,
          default_model_id: session.defaultModelId,
          output_mode: session.outputMode,
          created_at: session.createdAt,
          updated_at: session.updatedAt
        })
        db.run(
          `INSERT OR REPLACE INTO sessions (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data)
            .map(() => '?')
            .join(', ')})`,
          Object.values(data)
        )
      },
      async get(id) {
        const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?')
        try {
          stmt.bind([id])
          return stmt.step() ? toSession(stmt.getAsObject()) : undefined
        } finally {
          stmt.free()
        }
      },
      async listVisible() {
        const stmt = db.prepare("SELECT * FROM sessions WHERE status != 'deleted' ORDER BY created_at ASC")
        try {
          const rows: Session[] = []
          while (stmt.step()) rows.push(toSession(stmt.getAsObject()))
          return rows
        } finally {
          stmt.free()
        }
      }
    },
    messages: {
      async save(message) {
        const data = stripUndefined({
          id: message.id,
          session_id: message.sessionId,
          role: message.role,
          content: message.content,
          content_type: message.contentType,
          run_id: message.runId,
          created_at: message.createdAt
        })
        db.run(
          `INSERT OR REPLACE INTO messages (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data)
            .map(() => '?')
            .join(', ')})`,
          Object.values(data)
        )
      },
      async listBySession(sessionId) {
        const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
        try {
          stmt.bind([sessionId])
          const rows: Message[] = []
          while (stmt.step()) rows.push(toMessage(stmt.getAsObject()))
          return rows
        } finally {
          stmt.free()
        }
      }
    },
    runs: {
      async save(run) {
        const data = stripUndefined({
          id: run.id,
          session_id: run.sessionId,
          parent_run_id: run.parentRunId,
          status: run.status,
          model_id: run.modelId,
          workspace_path: run.workspacePath,
          retry_count: run.retryCount,
          max_retries: run.maxRetries,
          started_at: run.startedAt,
          ended_at: run.endedAt,
          error_json: run.error ? JSON.stringify(run.error) : undefined
        })
        db.run(
          `INSERT OR REPLACE INTO agent_runs (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data)
            .map(() => '?')
            .join(', ')})`,
          Object.values(data)
        )
      },
      async listBySession(sessionId) {
        const stmt = db.prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY rowid ASC')
        try {
          stmt.bind([sessionId])
          const rows: AgentRun[] = []
          while (stmt.step()) rows.push(toRun(stmt.getAsObject()))
          return rows
        } finally {
          stmt.free()
        }
      }
    },
    steps: {
      async save(step) {
        const data = stripUndefined({
          id: step.id,
          run_id: step.runId,
          type: step.type,
          status: step.status,
          title: step.title,
          summary: step.summary,
          detail: step.detail,
          created_at: step.createdAt,
          completed_at: step.completedAt
        })
        db.run(
          `INSERT OR REPLACE INTO run_steps (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data)
            .map(() => '?')
            .join(', ')})`,
          Object.values(data)
        )
      },
      async listByRun(runId) {
        const stmt = db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY created_at ASC, id ASC')
        try {
          stmt.bind([runId])
          const rows: RunStep[] = []
          while (stmt.step()) rows.push(toStep(stmt.getAsObject()))
          return rows
        } finally {
          stmt.free()
        }
      }
    },
    events: {
      async append(event) {
        const runtimeEvent = event as any
        const runId = runtimeEvent.type === 'run.created' ? runtimeEvent.run.id : runtimeEvent.runId
        db.run('INSERT INTO runtime_events (run_id, event_json) VALUES (?, ?)', [runId, JSON.stringify(event)])
      },
      async listByRun(runId) {
        const stmt = db.prepare('SELECT event_json FROM runtime_events WHERE run_id = ? ORDER BY id ASC')
        try {
          stmt.bind([runId])
          const rows: RuntimeEventRecord[] = []
          while (stmt.step()) {
            const event = JSON.parse(String(stmt.getAsObject().event_json)) as any
            if (event.type === 'run.created') {
              if (event.run?.id === runId) rows.push(event as RuntimeEventRecord)
            } else if (event.runId === runId) {
              rows.push(event as RuntimeEventRecord)
            }
          }
          return rows
        } finally {
          stmt.free()
        }
      }
    }
  }
}
