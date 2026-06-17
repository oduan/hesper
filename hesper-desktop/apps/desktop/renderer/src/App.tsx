import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { createId, nowIso, type Message, type OutputMode, type RunStep, type Session } from '@hesper/shared'
import { AppShell, ConversationView, type AppSection, type ConversationShortcutCommand } from '@hesper/ui'
import { AppStoreProvider, useAppStore } from './app-store'
import { hesperApi } from './ipc-client'
import { defaultFallbackModelId, fallbackSessionModelOptions, loadAvailableModelOptions, mergeModelOptions } from './model-options'
import { ProviderSettingsPanel } from './provider-settings-panel'
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

type SessionSettingsField = keyof SessionSettingsOverride

type RequestTokensBySession = Record<string, Partial<Record<SessionSettingsField, number>>>

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
  fields: SessionSettingsField[]
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

function pruneRequestTokens(tokens: RequestTokensBySession, visibleSessionIds: string[]): RequestTokensBySession {
  const visible = new Set(visibleSessionIds)
  const next = Object.fromEntries(Object.entries(tokens).filter(([sessionId]) => visible.has(sessionId)))
  return Object.keys(next).length === Object.keys(tokens).length ? tokens : next
}

function AppContent() {
  const { state, dispatch } = useAppStore()
  const [loadError, setLoadError] = useState<string>()
  const [sendErrorsBySession, setSendErrorsBySession] = useState<Record<string, string>>({})
  const [pendingSettingsBySession, setPendingSettingsBySession] = useState<Record<string, SessionSettingsOverride>>({})
  const [shortcutCommand, setShortcutCommand] = useState<ConversationShortcutCommand>()
  const [sessionModelOptions, setSessionModelOptions] = useState<string[]>(fallbackSessionModelOptions)
  const [historyErrorsBySession, setHistoryErrorsBySession] = useState<Record<string, string>>({})
  const loadedHistorySessionIdsRef = useRef<Set<string>>(new Set())
  const loadingHistorySessionIdsRef = useRef<Set<string>>(new Set())
  const nextSettingsRequestIdRef = useRef(0)
  const latestSettingsRequestIdRef = useRef<RequestTokensBySession>({})

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
    const sessionId = state.activeSessionId
    if (!sessionId || loadedHistorySessionIdsRef.current.has(sessionId) || loadingHistorySessionIdsRef.current.has(sessionId)) {
      return
    }

    const conversationApi = (hesperApi as typeof hesperApi & { conversation?: typeof hesperApi.conversation }).conversation
    if (!conversationApi) {
      return
    }

    let cancelled = false
    loadingHistorySessionIdsRef.current.add(sessionId)

    void (async () => {
      try {
        const [messages, runs] = await Promise.all([
          conversationApi.listMessages(sessionId),
          conversationApi.listRuns(sessionId)
        ])
        const stepEntries = await Promise.all(runs.map(async (run) => [run.id, await conversationApi.listSteps(run.id)] as const))
        const stepsByRun = Object.fromEntries(stepEntries) as Record<string, RunStep[]>

        if (!cancelled) {
          loadedHistorySessionIdsRef.current.add(sessionId)
          setHistoryErrorsBySession((current) => clearSessionSendError(current, sessionId))
          dispatch({ type: 'history.loaded', sessionId, messages, runs, stepsByRun })
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unknown conversation history load error'
          setHistoryErrorsBySession((current) => ({ ...current, [sessionId]: message }))
        }
      } finally {
        loadingHistorySessionIdsRef.current.delete(sessionId)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dispatch, state.activeSessionId])

  useEffect(() => {
    return hesperApi.agent.onEvent((event) => {
      dispatch({ type: 'agent.event', event })
    })
  }, [dispatch])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const options = await loadAvailableModelOptions()
        if (!cancelled) {
          setSessionModelOptions(options)
        }
      } catch {
        if (!cancelled) {
          setSessionModelOptions(fallbackSessionModelOptions)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const refreshSessionModelOptions = async () => {
    setSessionModelOptions(await loadAvailableModelOptions())
  }

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
    setHistoryErrorsBySession((current) => pruneSessionSendErrors(current, visibleSessionIds))
    const visible = new Set(visibleSessionIds)
    loadedHistorySessionIdsRef.current = new Set([...loadedHistorySessionIdsRef.current].filter((sessionId) => visible.has(sessionId)))
    loadingHistorySessionIdsRef.current = new Set([...loadingHistorySessionIdsRef.current].filter((sessionId) => visible.has(sessionId)))
    latestSettingsRequestIdRef.current = pruneRequestTokens(latestSettingsRequestIdRef.current, visibleSessionIds)
  }, [state.sessions])

  const createSettingsRequestToken = (sessionId: string, field: SessionSettingsField) => {
    nextSettingsRequestIdRef.current += 1
    const requestId = nextSettingsRequestIdRef.current
    latestSettingsRequestIdRef.current = {
      ...latestSettingsRequestIdRef.current,
      [sessionId]: {
        ...latestSettingsRequestIdRef.current[sessionId],
        [field]: requestId
      }
    }
    return requestId
  }

  const isLatestSettingsRequest = (sessionId: string, field: SessionSettingsField, requestId: number) =>
    latestSettingsRequestIdRef.current[sessionId]?.[field] === requestId

  const clearLatestSettingsRequest = (sessionId: string, field: SessionSettingsField, requestId: number) => {
    if (!isLatestSettingsRequest(sessionId, field, requestId)) {
      return
    }

    const sessionTokens = latestSettingsRequestIdRef.current[sessionId]
    if (!sessionTokens) {
      return
    }

    const nextSessionTokens = { ...sessionTokens }
    delete nextSessionTokens[field]

    if (Object.keys(nextSessionTokens).length === 0) {
      const nextTokens = { ...latestSettingsRequestIdRef.current }
      delete nextTokens[sessionId]
      latestSettingsRequestIdRef.current = nextTokens
      return
    }

    latestSettingsRequestIdRef.current = {
      ...latestSettingsRequestIdRef.current,
      [sessionId]: nextSessionTokens
    }
  }

  const effectiveSessions = useMemo(
    () => state.sessions.map((session) => applySessionSettingsOverride(session, pendingSettingsBySession[session.id])),
    [pendingSettingsBySession, state.sessions]
  )
  const activeSession = effectiveSessions.find((session) => session.id === state.activeSessionId)
  const activeSendError = activeSession ? sendErrorsBySession[activeSession.id] : undefined
  const activeHistoryError = activeSession ? historyErrorsBySession[activeSession.id] : undefined
  const isSessionsSection = state.activeSection === 'sessions'
  const activeRunId = activeSession ? state.latestRunIdBySession[activeSession.id] : undefined
  const activeSteps = activeRunId ? state.stepsByRun[activeRunId] ?? [] : []
  const activeStreamingText = activeRunId ? state.streamingByRun[activeRunId] ?? '' : ''
  const activeMessages = activeSession ? state.messagesBySession[activeSession.id] ?? [] : []
  const activeModelOptions = activeSession?.defaultModelId ? mergeModelOptions(sessionModelOptions, [activeSession.defaultModelId]) : sessionModelOptions

  return (
    <AppShell
      sessions={effectiveSessions}
      activeSection={state.activeSection}
      title={isSessionsSection ? activeSession?.title ?? '新建会话' : getSectionTitle(state.activeSection)}
      platform={hesperApi.window.platform}
      {...(state.activeSessionId ? { activeSessionId: state.activeSessionId } : {})}
      onCreateSession={async () => {
        dispatch({ type: 'section.selected', section: 'sessions' })
        await createSession(dispatch)
      }}
      onSelectSection={(section) => dispatch({ type: 'section.selected', section })}
      onSelectSession={(sessionId) => {
        dispatch({ type: 'section.selected', section: 'sessions' })
        dispatch({ type: 'session.selected', sessionId })
      }}
      onWindowMinimize={() => hesperApi.window.minimize()}
      onWindowToggleMaximize={() => hesperApi.window.toggleMaximize()}
      onWindowClose={() => hesperApi.window.close()}
    >
      {!isSessionsSection ? (
        state.activeSection === 'settings' ? <ProviderSettingsPanel onModelRegistryChanged={refreshSessionModelOptions} /> : <SectionPlaceholder section={state.activeSection} />
      ) : activeSession ? (
        <>
          {activeHistoryError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: '#fca5a5', padding: '0 12px' }}>
              历史加载失败：{activeHistoryError}
            </p>
          ) : null}
          {activeSendError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: '#fca5a5', padding: '0 12px' }}>
              发送失败：{activeSendError}
            </p>
          ) : null}
          <ConversationView
            session={activeSession}
            messages={activeMessages}
            steps={activeSteps}
            stepsByRun={state.stepsByRun}
            streamingText={activeStreamingText}
            streamingByRun={state.streamingByRun}
            modelId={activeSession.defaultModelId ?? defaultFallbackModelId}
            modelOptions={activeModelOptions}
            onSelectWorkspace={() => {
              void updateSessionWorkspace({
                session: activeSession,
                dispatch,
                setPendingSettingsBySession,
                createRequestToken: createSettingsRequestToken,
                isLatestRequest: isLatestSettingsRequest,
                clearLatestRequest: clearLatestSettingsRequest
              })
            }}
            onModelChange={(modelId) => {
              void updateSessionModel({
                session: activeSession,
                modelId,
                dispatch,
                setPendingSettingsBySession,
                createRequestToken: createSettingsRequestToken,
                isLatestRequest: isLatestSettingsRequest,
                clearLatestRequest: clearLatestSettingsRequest
              })
            }}
            onOutputModeChange={(outputMode) => {
              void updateSessionOutputMode({
                session: activeSession,
                outputMode,
                dispatch,
                setPendingSettingsBySession,
                createRequestToken: createSettingsRequestToken,
                isLatestRequest: isLatestSettingsRequest,
                clearLatestRequest: clearLatestSettingsRequest
              })
            }}
            onSend={(content) => {
              void sendMessage({
                session: activeSession,
                modelId: activeSession.defaultModelId ?? defaultFallbackModelId,
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

const sectionTitles: Record<AppSection, string> = {
  sessions: '所有会话',
  skills: 'Skills 即将支持',
  roles: 'Roles 即将支持',
  tools: 'Tools 即将支持',
  settings: '设置'
}

function getSectionTitle(section: AppSection): string {
  return sectionTitles[section]
}

function SectionPlaceholder({ section }: { section: AppSection }) {
  return (
    <section
      aria-label={`${getSectionTitle(section)} 占位区域`}
      style={{
        height: '100%',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        borderRadius: 14,
        background: 'rgba(15, 23, 42, 0.52)',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 24
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{getSectionTitle(section)}</h2>
        <p style={{ margin: 0, opacity: 0.72 }}>该扩展点已预留，后续会接入真实数据和交互。</p>
      </div>
    </section>
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

async function updateSessionWorkspace({
  session,
  dispatch,
  setPendingSettingsBySession,
  createRequestToken,
  isLatestRequest,
  clearLatestRequest
}: {
  session: Pick<Session, 'id' | 'workspacePath'>
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
  createRequestToken: (sessionId: string, field: SessionSettingsField) => number
  isLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => boolean
  clearLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => void
}) {
  const result = await hesperApi.dialog.selectDirectory()
  if (result.canceled || !result.path) {
    return
  }

  const requestId = createRequestToken(session.id, 'workspacePath')
  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { workspacePath: result.path! }))

  try {
    const updatedSession = await hesperApi.sessions.setWorkspace({ id: session.id, workspacePath: result.path })
    if (!isLatestRequest(session.id, 'workspacePath', requestId)) {
      return
    }
    dispatch({ type: 'session.updated', session: updatedSession })
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['workspacePath']))
    clearLatestRequest(session.id, 'workspacePath', requestId)
  } catch {
    if (!isLatestRequest(session.id, 'workspacePath', requestId)) {
      return
    }
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['workspacePath']))
    clearLatestRequest(session.id, 'workspacePath', requestId)
  }
}

async function updateSessionModel({
  session,
  modelId,
  dispatch,
  setPendingSettingsBySession,
  createRequestToken,
  isLatestRequest,
  clearLatestRequest
}: {
  session: Pick<Session, 'id' | 'defaultModelId'>
  modelId: string
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
  createRequestToken: (sessionId: string, field: SessionSettingsField) => number
  isLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => boolean
  clearLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => void
}) {
  const requestId = createRequestToken(session.id, 'defaultModelId')
  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { defaultModelId: modelId }))

  try {
    const updatedSession = await hesperApi.sessions.setModel({ id: session.id, defaultModelId: modelId })
    if (!isLatestRequest(session.id, 'defaultModelId', requestId)) {
      return
    }
    dispatch({ type: 'session.updated', session: updatedSession })
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['defaultModelId']))
    clearLatestRequest(session.id, 'defaultModelId', requestId)
  } catch {
    if (!isLatestRequest(session.id, 'defaultModelId', requestId)) {
      return
    }
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['defaultModelId']))
    clearLatestRequest(session.id, 'defaultModelId', requestId)
  }
}

async function updateSessionOutputMode({
  session,
  outputMode,
  dispatch,
  setPendingSettingsBySession,
  createRequestToken,
  isLatestRequest,
  clearLatestRequest
}: {
  session: Pick<Session, 'id' | 'outputMode'>
  outputMode: OutputMode
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
  createRequestToken: (sessionId: string, field: SessionSettingsField) => number
  isLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => boolean
  clearLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => void
}) {
  const requestId = createRequestToken(session.id, 'outputMode')
  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { outputMode }))

  try {
    const updatedSession = await hesperApi.sessions.setOutputMode({ id: session.id, outputMode })
    if (!isLatestRequest(session.id, 'outputMode', requestId)) {
      return
    }
    dispatch({ type: 'session.updated', session: updatedSession })
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['outputMode']))
    clearLatestRequest(session.id, 'outputMode', requestId)
  } catch {
    if (!isLatestRequest(session.id, 'outputMode', requestId)) {
      return
    }
    setPendingSettingsBySession((current) => clearSessionOverrideFields(current, session.id, ['outputMode']))
    clearLatestRequest(session.id, 'outputMode', requestId)
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
    const result = await hesperApi.agent.enqueue({
      sessionId: session.id,
      prompt: content,
      modelId,
      messageId: message.id,
      ...(session.workspacePath ? { workspacePath: session.workspacePath } : {})
    })
    dispatch({ type: 'message.run-linked', sessionId: session.id, messageId: message.id, runId: result.runId })
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
