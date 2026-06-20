import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react'
import type { AgentRun, AgentRuntimeEvent, Message, RunStep, Session } from '@hesper/shared'
import type { AppSection } from '@hesper/ui'

export type AppState = {
  sessions: Session[]
  activeSessionId?: string
  messagesBySession: Record<string, Message[]>
  stepsByRun: Record<string, RunStep[]>
  streamingByRun: Record<string, string>
  runsById: Record<string, AgentRun>
  activeSection: AppSection
  runSessionIds: Record<string, string>
  latestRunIdBySession: Record<string, string>
}

export type AppAction =
  | { type: 'sessions.loaded'; sessions: Session[] }
  | { type: 'session.created'; session: Session }
  | { type: 'session.updated'; session: Session }
  | { type: 'session.touched'; sessionId: string; updatedAt: string }
  | { type: 'session.touch-reverted'; sessionId: string; optimisticUpdatedAt: string; previousUpdatedAt: string }
  | { type: 'session.selected'; sessionId: string }
  | { type: 'history.loaded'; sessionId: string; messages: Message[]; runs: AgentRun[]; stepsByRun: Record<string, RunStep[]> }
  | { type: 'message.optimistic'; message: Message }
  | { type: 'message.run-linked'; sessionId: string; messageId: string; runId: string }
  | { type: 'message.removed'; sessionId: string; messageId: string }
  | { type: 'agent.event'; event: AgentRuntimeEvent }
  | { type: 'section.selected'; section: AppSection }

export const initialAppState: AppState = {
  sessions: [],
  messagesBySession: {},
  stepsByRun: {},
  streamingByRun: {},
  runsById: {},
  activeSection: 'sessions',
  runSessionIds: {},
  latestRunIdBySession: {}
}

const AppStoreContext = createContext<{ state: AppState; dispatch: Dispatch<AppAction> } | undefined>(undefined)

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function pickActiveSessionId(currentId: string | undefined, sessions: Session[]): string | undefined {
  if (currentId && sessions.some((session) => session.id === currentId)) {
    return currentId
  }

  return sessions.find((session) => session.status === 'active')?.id ?? sessions[0]?.id
}

function withSessionUpdatedAt(sessions: Session[], sessionId: string, updatedAt: string): Session[] {
  return sessions.map((session) => {
    if (session.id !== sessionId || session.updatedAt >= updatedAt) {
      return session
    }
    return { ...session, updatedAt }
  })
}

function revertSessionUpdatedAt(sessions: Session[], sessionId: string, optimisticUpdatedAt: string, previousUpdatedAt: string): Session[] {
  return sessions.map((session) => {
    if (session.id !== sessionId || session.updatedAt !== optimisticUpdatedAt) {
      return session
    }
    return { ...session, updatedAt: previousUpdatedAt }
  })
}

function mergeById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.id === nextItem.id)
  if (index === -1) {
    return [...items, nextItem]
  }

  const nextItems = [...items]
  nextItems[index] = nextItem
  return nextItems
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id)
}

function compareCreatedAt<T extends { id: string; createdAt: string }>(left: T, right: T): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

function sortByCreatedAt<T extends { id: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort(compareCreatedAt)
}

function mergeByIdChronologically<T extends { id: string; createdAt: string }>(items: T[], nextItem: T): T[] {
  return sortByCreatedAt(mergeById(items, nextItem))
}

function mergeManyByIdChronologically<T extends { id: string; createdAt: string }>(items: T[], nextItems: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(item.id, item)
  for (const item of nextItems) byId.set(item.id, item)
  return sortByCreatedAt([...byId.values()])
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record
  }

  const next = { ...record }
  delete next[key]
  return next
}

function withActiveSessionId(state: AppState, activeSessionId: string | undefined): AppState {
  const { activeSessionId: _previousActiveSessionId, ...rest } = state
  return activeSessionId ? { ...rest, activeSessionId } : rest
}

function clearStreamingByRun(streamingByRun: Record<string, string>, runId: string): Record<string, string> {
  if (!(runId in streamingByRun)) {
    return streamingByRun
  }

  const next = { ...streamingByRun }
  delete next[runId]
  return next
}

function linkLatestPendingUserMessage(messages: Message[], runId: string): Message[] {
  const pendingMessage = messages
    .filter((message) => message.role === 'user' && !message.runId)
    .sort((left, right) => compareCreatedAt(right, left))[0]

  if (!pendingMessage) {
    return messages
  }

  return sortByCreatedAt(messages.map((message) => (
    message.id === pendingMessage.id ? { ...message, runId } : message
  )))
}

function createRetryStep(event: Extract<AgentRuntimeEvent, { type: 'run.retrying' }>): RunStep {
  return {
    id: `retry-${event.runId}-${event.retryCount}`,
    runId: event.runId,
    type: 'retry',
    status: 'running',
    title: `准备重试 #${event.retryCount}`,
    summary: `下一次重试时间：${event.nextRetryAt}`,
    createdAt: event.nextRetryAt
  }
}

function createTimestamp(): string {
  return new Date().toISOString()
}

function createFailureStep(event: Extract<AgentRuntimeEvent, { type: 'run.failed' }>): RunStep {
  const now = event.endedAt ?? createTimestamp()
  return {
    id: `failed-${event.runId}`,
    runId: event.runId,
    type: 'warning',
    status: 'failed',
    title: `运行失败：${event.error.code}`,
    detail: event.error.message,
    createdAt: now,
    completedAt: now
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'sessions.loaded': {
      const sessions = sortSessions(action.sessions)
      const activeSessionId = pickActiveSessionId(state.activeSessionId, sessions)
      return withActiveSessionId({ ...state, sessions }, activeSessionId)
    }
    case 'session.created': {
      const sessions = sortSessions([action.session, ...state.sessions.filter((session) => session.id !== action.session.id)])
      return {
        ...state,
        sessions,
        activeSessionId: action.session.id,
        messagesBySession: {
          ...state.messagesBySession,
          [action.session.id]: state.messagesBySession[action.session.id] ?? []
        }
      }
    }
    case 'session.updated': {
      if (action.session.status === 'deleted') {
        const sessions = sortSessions(removeById(state.sessions, action.session.id))
        return withActiveSessionId({ ...state, sessions }, pickActiveSessionId(state.activeSessionId === action.session.id ? undefined : state.activeSessionId, sessions))
      }

      const sessions = sortSessions(mergeById(state.sessions, action.session))
      return {
        ...state,
        sessions,
        messagesBySession: {
          ...state.messagesBySession,
          [action.session.id]: state.messagesBySession[action.session.id] ?? []
        }
      }
    }
    case 'session.touched': {
      return {
        ...state,
        sessions: sortSessions(withSessionUpdatedAt(state.sessions, action.sessionId, action.updatedAt))
      }
    }
    case 'session.touch-reverted': {
      return {
        ...state,
        sessions: sortSessions(revertSessionUpdatedAt(state.sessions, action.sessionId, action.optimisticUpdatedAt, action.previousUpdatedAt))
      }
    }
    case 'session.selected':
      return { ...state, activeSessionId: action.sessionId }
    case 'history.loaded': {
      const nextMessagesBySession = {
        ...state.messagesBySession,
        [action.sessionId]: mergeManyByIdChronologically(action.messages, state.messagesBySession[action.sessionId] ?? [])
      }
      const nextStepsByRun = { ...state.stepsByRun }
      const nextRunSessionIds = { ...state.runSessionIds }
      const nextRunsById = { ...state.runsById }

      for (const run of action.runs) {
        nextRunSessionIds[run.id] = run.sessionId
        nextRunsById[run.id] = run
        nextStepsByRun[run.id] = mergeManyByIdChronologically(action.stepsByRun[run.id] ?? [], nextStepsByRun[run.id] ?? [])
      }

      for (const [runId, steps] of Object.entries(action.stepsByRun)) {
        nextStepsByRun[runId] = mergeManyByIdChronologically(steps, nextStepsByRun[runId] ?? [])
      }

      const latestPersistedRunId = action.runs.at(-1)?.id
      const currentLatestRunId = state.latestRunIdBySession[action.sessionId]
      const shouldKeepCurrentLatest = currentLatestRunId ? state.streamingByRun[currentLatestRunId] !== undefined : false
      const nextLatestRunIdBySession = shouldKeepCurrentLatest || !latestPersistedRunId
        ? state.latestRunIdBySession
        : { ...state.latestRunIdBySession, [action.sessionId]: latestPersistedRunId }

      return {
        ...state,
        messagesBySession: nextMessagesBySession,
        stepsByRun: nextStepsByRun,
        runSessionIds: nextRunSessionIds,
        runsById: nextRunsById,
        latestRunIdBySession: nextLatestRunIdBySession
      }
    }
    case 'message.optimistic': {
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.message.sessionId]: mergeByIdChronologically(state.messagesBySession[action.message.sessionId] ?? [], action.message)
        },
        latestRunIdBySession: omitRecordKey(state.latestRunIdBySession, action.message.sessionId)
      }
    }
    case 'message.run-linked': {
      const messages = state.messagesBySession[action.sessionId] ?? []
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: sortByCreatedAt(messages.map((message) => (
            message.id === action.messageId ? { ...message, runId: action.runId } : message
          )))
        }
      }
    }
    case 'message.removed': {
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: removeById(state.messagesBySession[action.sessionId] ?? [], action.messageId)
        }
      }
    }
    case 'section.selected':
      return { ...state, activeSection: action.section }
    case 'agent.event': {
      const { event } = action
      switch (event.type) {
        case 'run.created': {
          const currentMessages = state.messagesBySession[event.run.sessionId] ?? []
          const linkedMessages = linkLatestPendingUserMessage(currentMessages, event.run.id)
          const nextMessagesBySession = linkedMessages === currentMessages
            ? state.messagesBySession
            : { ...state.messagesBySession, [event.run.sessionId]: linkedMessages }

          return {
            ...state,
            messagesBySession: nextMessagesBySession,
            runSessionIds: { ...state.runSessionIds, [event.run.id]: event.run.sessionId },
            runsById: { ...state.runsById, [event.run.id]: event.run },
            latestRunIdBySession: { ...state.latestRunIdBySession, [event.run.sessionId]: event.run.id },
            stepsByRun: { ...state.stepsByRun, [event.run.id]: state.stepsByRun[event.run.id] ?? [] },
            streamingByRun: { ...state.streamingByRun, [event.run.id]: state.streamingByRun[event.run.id] ?? '' }
          }
        }
        case 'step.created':
        case 'step.updated': {
          return {
            ...state,
            stepsByRun: {
              ...state.stepsByRun,
              [event.step.runId]: mergeByIdChronologically(state.stepsByRun[event.step.runId] ?? [], event.step)
            }
          }
        }
        case 'message.delta': {
          return {
            ...state,
            streamingByRun: {
              ...state.streamingByRun,
              [event.runId]: `${state.streamingByRun[event.runId] ?? ''}${event.delta}`
            }
          }
        }
        case 'message.completed': {
          const nextStreamingByRun = { ...state.streamingByRun }
          if (event.message.runId) {
            delete nextStreamingByRun[event.message.runId]
          }

          return {
            ...state,
            messagesBySession: {
              ...state.messagesBySession,
              [event.message.sessionId]: mergeByIdChronologically(state.messagesBySession[event.message.sessionId] ?? [], event.message)
            },
            streamingByRun: nextStreamingByRun
          }
        }
        case 'run.retrying': {
          const retryStep = createRetryStep(event)
          const currentRun = state.runsById[event.runId]
          return {
            ...state,
            runsById: currentRun
              ? { ...state.runsById, [event.runId]: { ...currentRun, retryCount: event.retryCount } }
              : state.runsById,
            stepsByRun: {
              ...state.stepsByRun,
              [event.runId]: mergeByIdChronologically(state.stepsByRun[event.runId] ?? [], retryStep)
            },
            streamingByRun: clearStreamingByRun(state.streamingByRun, event.runId)
          }
        }
        case 'run.failed': {
          const failureStep = createFailureStep(event)
          const currentRun = state.runsById[event.runId]
          const endedAt = event.endedAt ?? failureStep.completedAt ?? currentRun?.endedAt
          return {
            ...state,
            runsById: currentRun
              ? { ...state.runsById, [event.runId]: { ...currentRun, status: 'failed', ...(endedAt ? { endedAt } : {}), error: event.error } }
              : state.runsById,
            stepsByRun: {
              ...state.stepsByRun,
              [event.runId]: mergeByIdChronologically(state.stepsByRun[event.runId] ?? [], failureStep)
            },
            streamingByRun: clearStreamingByRun(state.streamingByRun, event.runId)
          }
        }
        case 'run.started': {
          const currentRun = state.runsById[event.runId]
          if (!currentRun || currentRun.status === 'cancelled' || currentRun.status === 'failed' || currentRun.status === 'succeeded') return state
          return {
            ...state,
            runsById: {
              ...state.runsById,
              [event.runId]: { ...currentRun, status: 'running', startedAt: event.startedAt ?? currentRun.startedAt ?? createTimestamp() }
            }
          }
        }
        case 'run.succeeded': {
          const currentRun = state.runsById[event.runId]
          if (!currentRun) return state
          return {
            ...state,
            runsById: {
              ...state.runsById,
              [event.runId]: { ...currentRun, status: 'succeeded', ...(event.endedAt ? { endedAt: event.endedAt } : currentRun.endedAt ? { endedAt: currentRun.endedAt } : {}) }
            },
            streamingByRun: clearStreamingByRun(state.streamingByRun, event.runId)
          }
        }
        case 'run.cancelled': {
          const currentRun = state.runsById[event.runId]
          if (!currentRun) return state
          return {
            ...state,
            runsById: {
              ...state.runsById,
              [event.runId]: { ...currentRun, status: 'cancelled', ...(event.endedAt ? { endedAt: event.endedAt } : currentRun.endedAt ? { endedAt: currentRun.endedAt } : {}) }
            },
            streamingByRun: clearStreamingByRun(state.streamingByRun, event.runId)
          }
        }
      }
    }
    default:
      return state
  }
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore() {
  const value = useContext(AppStoreContext)

  if (!value) {
    throw new Error('useAppStore must be used within AppStoreProvider')
  }

  return value
}
