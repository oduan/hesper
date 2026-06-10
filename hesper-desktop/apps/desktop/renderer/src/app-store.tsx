import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react'
import type { AgentRuntimeEvent, Message, RunStep, Session } from '@hesper/shared'
import type { AppSection } from '@hesper/ui'

export type AppState = {
  sessions: Session[]
  activeSessionId?: string
  messagesBySession: Record<string, Message[]>
  stepsByRun: Record<string, RunStep[]>
  streamingByRun: Record<string, string>
  activeSection: AppSection
  runSessionIds: Record<string, string>
  latestRunIdBySession: Record<string, string>
}

export type AppAction =
  | { type: 'sessions.loaded'; sessions: Session[] }
  | { type: 'session.created'; session: Session }
  | { type: 'session.selected'; sessionId: string }
  | { type: 'message.optimistic'; message: Message }
  | { type: 'message.removed'; sessionId: string; messageId: string }
  | { type: 'agent.event'; event: AgentRuntimeEvent }
  | { type: 'section.selected'; section: AppSection }

export const initialAppState: AppState = {
  sessions: [],
  messagesBySession: {},
  stepsByRun: {},
  streamingByRun: {},
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

  return sessions[0]?.id
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

function createFailureStep(event: Extract<AgentRuntimeEvent, { type: 'run.failed' }>): RunStep {
  const now = new Date().toISOString()
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
    case 'session.selected':
      return { ...state, activeSessionId: action.sessionId }
    case 'message.optimistic': {
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.message.sessionId]: mergeById(state.messagesBySession[action.message.sessionId] ?? [], action.message)
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
          return {
            ...state,
            runSessionIds: { ...state.runSessionIds, [event.run.id]: event.run.sessionId },
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
              [event.step.runId]: mergeById(state.stepsByRun[event.step.runId] ?? [], event.step)
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
              [event.message.sessionId]: mergeById(state.messagesBySession[event.message.sessionId] ?? [], event.message)
            },
            streamingByRun: nextStreamingByRun
          }
        }
        case 'run.retrying': {
          const retryStep = createRetryStep(event)
          return {
            ...state,
            stepsByRun: {
              ...state.stepsByRun,
              [event.runId]: mergeById(state.stepsByRun[event.runId] ?? [], retryStep)
            },
            streamingByRun: clearStreamingByRun(state.streamingByRun, event.runId)
          }
        }
        case 'run.failed': {
          const failureStep = createFailureStep(event)
          return {
            ...state,
            stepsByRun: {
              ...state.stepsByRun,
              [event.runId]: mergeById(state.stepsByRun[event.runId] ?? [], failureStep)
            },
            streamingByRun: clearStreamingByRun(state.streamingByRun, event.runId)
          }
        }
        case 'run.started':
        case 'run.succeeded':
          return state
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
