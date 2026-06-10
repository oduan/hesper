import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { createId, nowIso, type Message, type OutputMode, type Session } from '@hesper/shared'
import { AppShell, ConversationView, type ConversationShortcutCommand } from '@hesper/ui'
import { AppStoreProvider, useAppStore } from './app-store'
import { hesperApi } from './ipc-client'
import { createShortcutHandler } from './shortcuts'

export function App() {
  return (
    <AppStoreProvider>
      <AppContent />
    </AppStoreProvider>
  )
}

type SessionSettingsOverride = {
  workspacePath?: string
  defaultModelId?: string
  outputMode?: OutputMode
}

const sessionModelOptions = ['mock/hesper-fast', 'openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514']

export function clearSessionSendError(errors: Record<string, string>, sessionId: string): Record<string, string> {
  if (!(sessionId in errors)) {
    return errors
  }

  const next = { ...errors }
  delete next[sessionId]
  return next
}

export function pruneSessionSendErrors(errors: Record<string, string>, visibleSessionIds: string[]): Record<string, string> {
  const visible = new Set(visibleSessionIds)
  const next = Object.fromEntries(Object.entries(errors).filter(([sessionId]) => visible.has(sessionId)))
  return Object.keys(next).length === Object.keys(errors).length ? errors : next
}

function applySessionSettingsOverride(session: Session, override?: SessionSettingsOverride): Session {
  if (!override) {
    return session
  }

  return {
    ...session,
    ...(override.workspacePath !== undefined ? { workspacePath: override.workspacePath } : {}),
    ...(override.defaultModelId !== undefined ? { defaultModelId: override.defaultModelId } : {}),
    ...(override.outputMode !== undefined ? { outputMode: override.outputMode } : {})
  }
}

function mergeSessionOverride(
  overrides: Record<string, SessionSettingsOverride>,
  sessionId: string,
  partial: SessionSettingsOverride
): Record<string, SessionSettingsOverride> {
  return {
    ...overrides,
    [sessionId]: {
      ...overrides[sessionId],
      ...partial
    }
  }
}

function clearSessionOverrideFields(
  overrides: Record<string, SessionSettingsOverride>,
  sessionId: string,
  fields: (keyof SessionSettingsOverride)[]
): Record<string, SessionSettingsOverride> {
  const current = overrides[sessionId]
  if (!current) {
    return overrides
  }

  const nextOverride = { ...current }
  for (const field of fields) {
    delete nextOverride[field]
  }

  if (Object.keys(nextOverride).length === 0) {
    const next = { ...overrides }
    delete next[sessionId]
    return next
  }

  return {
    ...overrides,
    [sessionId]: nextOverride
  }
}

function AppContent() {
  const { state, dispatch } = useAppStore()
  const [loadError, setLoadError] = useState<string>()
  const [sendErrorsBySession, setSendErrorsBySession] = useState<Record<string, string>>({})
  const [pendingSettingsBySession, setPendingSettingsBySession] = useState<Record<string, SessionSettingsOverride>>({})
  const [shortcutCommand, setShortcutCommand] = useState<ConversationShortcutCommand>()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const sessions = await hesperApi.sessions.list()
        if (!cancelled) {
          setLoadError(undefined)
          dispatch({ type: 'sessions.loaded', sessions })
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unknown renderer load error'
          setLoadError(message)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dispatch])

  useEffect(() => {
    return hesperApi.agent.onEvent((event) => {
      dispatch({ type: 'agent.event', event })
    })
  }, [dispatch])

  useEffect(() => {
    let nonce = 0
    const nextNonce = () => {
      nonce += 1
      return nonce
    }

    const handler = createShortcutHandler({
      send: () => setShortcutCommand({ type: 'send', nonce: nextNonce() }),
      closePanels: () => setShortcutCommand({ type: 'close-panels', nonce: nextNonce() }),
      quickSwitch: () => undefined,
      jumpMessage: (direction, assistantOnly) =>
        setShortcutCommand({ type: 'jump-message', nonce: nextNonce(), direction, assistantOnly })
    })

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const visibleSessionIds = state.sessions.map((session) => session.id)
    setSendErrorsBySession((current) => pruneSessionSendErrors(current, visibleSessionIds))
    setPendingSettingsBySession((current) => {
      const visible = new Set(visibleSessionIds)
      const next = Object.fromEntries(Object.entries(current).filter(([sessionId]) => visible.has(sessionId)))
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [state.sessions])

  const effectiveSessions = useMemo(
    () => state.sessions.map((session) => applySessionSettingsOverride(session, pendingSettingsBySession[session.id])),
    [pendingSettingsBySession, state.sessions]
  )
  const activeSession = effectiveSessions.find((session) => session.id === state.activeSessionId)
  const activeSendError = activeSession ? sendErrorsBySession[activeSession.id] : undefined
  const activeRunId = activeSession ? state.latestRunIdBySession[activeSession.id] : undefined
  const activeSteps = activeRunId ? state.stepsByRun[activeRunId] ?? [] : []
  const activeStreamingText = activeRunId ? state.streamingByRun[activeRunId] ?? '' : ''
  const activeMessages = activeSession ? state.messagesBySession[activeSession.id] ?? [] : []

  return (
    <AppShell
      sessions={effectiveSessions}
      activeSection={state.activeSection}
      title={activeSession?.title ?? '新建会话'}
      {...(state.activeSessionId ? { activeSessionId: state.activeSessionId } : {})}
      onSelectSession={(sessionId) => dispatch({ type: 'session.selected', sessionId })}
    >
      {activeSession ? (
        <>
          {activeSendError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: '#fca5a5', padding: '0 12px' }}>
              发送失败：{activeSendError}
            </p>
          ) : null}
          <ConversationView
            session={activeSession}
            messages={activeMessages}
            steps={activeSteps}
            streamingText={activeStreamingText}
            modelId={activeSession.defaultModelId ?? 'mock/hesper-fast'}
            modelOptions={sessionModelOptions}
            onSelectWorkspace={() => {
              void updateSessionWorkspace(activeSession, dispatch, setPendingSettingsBySession)
            }}
            onModelChange={(modelId) => {
              void updateSessionModel(activeSession, modelId, dispatch, setPendingSettingsBySession)
            }}
            onOutputModeChange={(outputMode) => {
              void updateSessionOutputMode(activeSession, outputMode, dispatch, setPendingSettingsBySession)
            }}
            onSend={(content) => {
              void sendMessage({
                session: activeSession,
                modelId: activeSession.defaultModelId ?? 'mock/hesper-fast',
                content,
                dispatch,
                setSendErrorsBySession
              })
            }}
            {...(shortcutCommand ? { shortcutCommand } : {})}
          />
        </>
      ) : (
        <EmptyConversationState
          {...(loadError ? { loadError } : {})}
          onCreateSession={async () => createSession(dispatch)}
        />
      )}
    </AppShell>
  )
}

function EmptyConversationState({
  loadError,
  onCreateSession
}: {
  loadError?: string
  onCreateSession: () => Promise<void>
}) {
  return (
    <section
      aria-label="空会话状态"
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: 16,
        padding: 24
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px' }}>准备开始新的 hesper 会话</h2>
        <p style={{ margin: 0, opacity: 0.72 }}>当前还没有会话。先创建一个主界面会话壳，后续任务再接入完整交互。</p>
        {loadError ? (
          <p role="alert" style={{ margin: '12px 0 0', color: '#fca5a5' }}>
            会话加载失败：{loadError}
          </p>
        ) : null}
      </div>
      <button type="button" onClick={onCreateSession} style={primaryButtonStyle}>
        新建会话
      </button>
    </section>
  )
}

async function createSession(dispatch: ReturnType<typeof useAppStore>['dispatch']) {
  const session = await hesperApi.sessions.create({ title: 'New chat' })
  dispatch({ type: 'session.created', session })
}

async function updateSessionWorkspace(
  session: Pick<Session, 'id' | 'workspacePath'>,
  dispatch: ReturnType<typeof useAppStore>['dispatch'],
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
) {
  const result = await hesperApi.dialog.selectDirectory()
  if (result.canceled || !result.path) {
    return
  }

  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { workspacePath: result.path! }))

  try {
    const updatedSession = await hesperApi.sessions.setWorkspace({ id: session.id, workspacePath: result.path })
    dispatch({ type: 'session.updated', session: updatedSession })
  } finally {
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['workspacePath']))
  }
}

async function updateSessionModel(
  session: Pick<Session, 'id' | 'defaultModelId'>,
  modelId: string,
  dispatch: ReturnType<typeof useAppStore>['dispatch'],
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
) {
  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { defaultModelId: modelId }))

  try {
    const updatedSession = await hesperApi.sessions.setModel({ id: session.id, defaultModelId: modelId })
    dispatch({ type: 'session.updated', session: updatedSession })
  } finally {
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['defaultModelId']))
  }
}

async function updateSessionOutputMode(
  session: Pick<Session, 'id' | 'outputMode'>,
  outputMode: OutputMode,
  dispatch: ReturnType<typeof useAppStore>['dispatch'],
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
) {
  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { outputMode }))

  try {
    const updatedSession = await hesperApi.sessions.setOutputMode({ id: session.id, outputMode })
    dispatch({ type: 'session.updated', session: updatedSession })
  } finally {
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['outputMode']))
  }
}

async function sendMessage({
  session,
  modelId,
  content,
  dispatch,
  setSendErrorsBySession
}: {
  session: Parameters<typeof createOptimisticUserMessage>[0]['session']
  modelId: string
  content: string
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setSendErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>
}) {
  setSendErrorsBySession((current) => clearSessionSendError(current, session.id))
  const message = createOptimisticUserMessage({ session, content })
  dispatch({ type: 'message.optimistic', message })

  try {
    await hesperApi.agent.enqueue({
      sessionId: session.id,
      prompt: content,
      modelId,
      messageId: message.id,
      ...(session.workspacePath ? { workspacePath: session.workspacePath } : {})
    })
  } catch (error) {
    dispatch({ type: 'message.removed', sessionId: session.id, messageId: message.id })
    setSendErrorsBySession((current) => ({
      ...current,
      [session.id]: error instanceof Error ? error.message : 'unknown enqueue error'
    }))
  }
}

function createOptimisticUserMessage({ session, content }: { session: { id: string; workspacePath?: string }; content: string }): Message {
  return {
    id: createId('message'),
    sessionId: session.id,
    role: 'user',
    content,
    contentType: 'plain',
    createdAt: nowIso()
  }
}

const primaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 10,
  padding: '10px 18px',
  background: '#7c6cff',
  color: '#ffffff',
  fontWeight: 700,
  cursor: 'pointer'
}
