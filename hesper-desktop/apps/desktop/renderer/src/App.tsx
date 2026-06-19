import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { createId, nowIso, type Message, type RunStep, type Session } from '@hesper/shared'
import { AppShell, ConversationView, type AppSection, type ConversationShortcutCommand } from '@hesper/ui'
import { AppStoreProvider, useAppStore } from './app-store'
import { hesperApi } from './ipc-client'
import { defaultFallbackModelId, fallbackSessionModelCatalog, loadAvailableModelCatalog, mergeModelOptions, type SessionModelCatalog } from './model-options'
import type { AppSettings, ToolDto, UpdateSettingsInput } from '../../electron/ipc-contract'
import { AppearanceSettingsPanel } from './appearance-settings-panel'
import { ProviderSettingsPanel } from './provider-settings-panel'
import { createShortcutHandler } from './shortcuts'
import { ToolDetailsPanel } from './tool-details-panel'

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
}

type SessionSettingsField = keyof SessionSettingsOverride

type RequestTokensBySession = Record<string, Partial<Record<SessionSettingsField, number>>>

type SettingsCategory = 'ai' | 'appearance'

const defaultAppSettings: AppSettings = {
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'system',
  fontSize: 14
}

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
    ...(override.defaultModelId !== undefined ? { defaultModelId: override.defaultModelId } : {})
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

function clearSessionUnreadCompletion(session: Session): Session {
  if (!session.unreadCompletedAt) return session
  const { unreadCompletedAt: _unreadCompletedAt, ...viewed } = session
  return viewed
}

function applySessionUnreadCompletion(session: Session, completedAt: string): Session {
  if (session.unreadCompletedAt && session.unreadCompletedAt >= completedAt) return session
  return { ...session, unreadCompletedAt: completedAt }
}

function AppContent() {
  const { state, dispatch } = useAppStore()
  const [loadError, setLoadError] = useState<string>()
  const [titleGenerationError, setTitleGenerationError] = useState<string>()
  const [sendErrorsBySession, setSendErrorsBySession] = useState<Record<string, string>>({})
  const [pendingSettingsBySession, setPendingSettingsBySession] = useState<Record<string, SessionSettingsOverride>>({})
  const [shortcutCommand, setShortcutCommand] = useState<ConversationShortcutCommand>()
  const [sessionModelCatalog, setSessionModelCatalog] = useState<SessionModelCatalog>(fallbackSessionModelCatalog)
  const [historyErrorsBySession, setHistoryErrorsBySession] = useState<Record<string, string>>({})
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings)
  const [settingsError, setSettingsError] = useState<string>()
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<SettingsCategory>('ai')
  const [tools, setTools] = useState<ToolDto[]>([])
  const [activeToolId, setActiveToolId] = useState<string>()
  const [pendingToolIds, setPendingToolIds] = useState<Set<string>>(new Set())
  const [toolsError, setToolsError] = useState<string>()
  const resolvedThemeMode = useResolvedThemeMode(appSettings.themeMode)
  const loadedHistorySessionIdsRef = useRef<Set<string>>(new Set())
  const loadingHistorySessionIdsRef = useRef<Set<string>>(new Set())
  const explicitModelSelectionSessionIdsRef = useRef<Set<string>>(new Set())
  const runModelIdsRef = useRef<Record<string, string>>({})
  const pendingTitlePromptsBySessionRef = useRef<Record<string, string>>({})
  const titleGeneratedRunIdsRef = useRef<Set<string>>(new Set())
  const stateRef = useRef(state)
  const nextRenameRequestIdRef = useRef(0)
  const latestRenameRequestIdBySessionRef = useRef<Record<string, number>>({})
  const nextSettingsRequestIdRef = useRef(0)
  const latestSettingsRequestIdRef = useRef<RequestTokensBySession>({})
  const latestAppSettingsRequestIdRef = useRef(0)
  const activeSessionUnreadCompletedAt = state.activeSessionId
    ? state.sessions.find((session) => session.id === state.activeSessionId)?.unreadCompletedAt
    : undefined
  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? tools[0]
  const pendingToolIdList = useMemo(() => [...pendingToolIds], [pendingToolIds])

  const markSessionUnreadCompletedLocally = (sessionId: string, completedAt: string) => {
    const session = stateRef.current.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const updated = applySessionUnreadCompletion(session, completedAt)
    if (updated !== session) {
      dispatch({ type: 'session.updated', session: updated })
    }
  }

  const markSessionViewed = async (sessionId: string, options: { force?: boolean } = {}) => {
    const session = stateRef.current.sessions.find((candidate) => candidate.id === sessionId)
    if (!options.force && !session?.unreadCompletedAt) return

    if (session?.unreadCompletedAt) {
      dispatch({ type: 'session.updated', session: clearSessionUnreadCompletion(session) })
    }

    try {
      const updatedSession = await hesperApi.sessions.markViewed(sessionId)
      dispatch({ type: 'session.updated', session: updatedSession })
    } catch (error) {
      if (session?.unreadCompletedAt) {
        dispatch({ type: 'session.updated', session })
      }
      console.warn('Failed to mark session as viewed', error)
    }
  }

  const handleSessionCompletionUnread = (sessionId: string, completedAt: string) => {
    if (stateRef.current.activeSessionId === sessionId) {
      void markSessionViewed(sessionId, { force: true })
      return
    }
    markSessionUnreadCompletedLocally(sessionId, completedAt)
  }

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (state.activeSessionId && activeSessionUnreadCompletedAt) {
      void markSessionViewed(state.activeSessionId)
    }
  }, [state.activeSessionId, activeSessionUnreadCompletedAt])

  useEffect(() => {
    let cancelled = false

    void hesperApi.settings.get().then((settings) => {
      if (!cancelled) {
        setAppSettings(settings)
        setSettingsError(undefined)
      }
    }).catch((error) => {
      if (!cancelled) {
        setSettingsError(error instanceof Error ? error.message : '未知设置加载错误')
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedThemeMode
  }, [resolvedThemeMode])

  useEffect(() => {
    let cancelled = false

    void hesperApi.tools.list().then((loadedTools) => {
      if (!cancelled) {
        setTools(loadedTools)
        setToolsError(undefined)
      }
    }).catch((error) => {
      if (!cancelled) {
        setToolsError(error instanceof Error ? error.message : '未知工具加载错误')
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (tools.length === 0) {
      setActiveToolId(undefined)
      return
    }

    if (!activeToolId || !tools.some((tool) => tool.id === activeToolId)) {
      setActiveToolId(tools[0]!.id)
    }
  }, [activeToolId, tools])

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
      if (event.type === 'run.created') {
        runModelIdsRef.current[event.run.id] = event.run.modelId
      }

      if (event.type === 'message.completed' && event.message.role === 'assistant') {
        handleSessionCompletionUnread(event.message.sessionId, event.message.createdAt)
      }

      if (event.type === 'run.failed') {
        const run = stateRef.current.runsById[event.runId]
        if (run) {
          handleSessionCompletionUnread(run.sessionId, event.endedAt ?? run.endedAt ?? new Date().toISOString())
        }
      }

      if (event.type === 'message.completed' && event.message.role === 'assistant' && event.message.runId) {
        const session = stateRef.current.sessions.find((candidate) => candidate.id === event.message.sessionId)
        const messages = stateRef.current.messagesBySession[event.message.sessionId] ?? []
        const fallbackPrompt = pendingTitlePromptsBySessionRef.current[event.message.sessionId]
        const source = session && isDefaultSessionTitle(session.title)
          ? firstUserTitleSource(messages, event.message.content) ?? (fallbackPrompt ? { userPrompt: fallbackPrompt, assistantOutput: event.message.content } : undefined)
          : undefined
        const modelId = runModelIdsRef.current[event.message.runId] ?? session?.defaultModelId ?? defaultFallbackModelId

        if (session && source?.userPrompt && !titleGeneratedRunIdsRef.current.has(event.message.runId)) {
          titleGeneratedRunIdsRef.current.add(event.message.runId)
          void hesperApi.sessions.generateTitle({
            id: session.id,
            modelId,
            userPrompt: source.userPrompt,
            ...(source.assistantOutput ? { assistantOutput: source.assistantOutput } : {})
          }).then((updatedSession) => {
            dispatch({ type: 'session.updated', session: updatedSession })
          }).catch((error) => {
            titleGeneratedRunIdsRef.current.delete(event.message.runId!)
            console.warn('Failed to generate session title', error)
          }).finally(() => {
            delete pendingTitlePromptsBySessionRef.current[event.message.sessionId]
          })
        }
      }

      dispatch({ type: 'agent.event', event })
    })
  }, [dispatch])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const catalog = await loadAvailableModelCatalog()
        if (!cancelled) {
          setSessionModelCatalog(catalog)
        }
      } catch {
        if (!cancelled) {
          setSessionModelCatalog(fallbackSessionModelCatalog)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const refreshSessionModelOptions = async () => {
    setSessionModelCatalog(await loadAvailableModelCatalog())
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
  const runningSessionIds = useMemo(() => {
    const visibleSessionIds = new Set(effectiveSessions.map((session) => session.id))
    return [...new Set(Object.values(state.runsById)
      .filter((run) => run.status === 'running' && visibleSessionIds.has(run.sessionId))
      .map((run) => run.sessionId))]
  }, [effectiveSessions, state.runsById])
  const activeRunId = activeSession ? state.latestRunIdBySession[activeSession.id] : undefined
  const activeSteps = activeRunId ? state.stepsByRun[activeRunId] ?? [] : []
  const activeStreamingText = activeRunId ? state.streamingByRun[activeRunId] ?? '' : ''
  const activeMessages = activeSession ? state.messagesBySession[activeSession.id] ?? [] : []
  const activeModelId = activeSession ? resolveSessionModelId(activeSession.defaultModelId, sessionModelCatalog.preferredModelId, explicitModelSelectionSessionIdsRef.current.has(activeSession.id)) : sessionModelCatalog.preferredModelId
  const activeModelOptions = activeSession?.defaultModelId ? mergeModelOptions(sessionModelCatalog.options, [activeModelId, activeSession.defaultModelId]) : mergeModelOptions(sessionModelCatalog.options, [activeModelId])

  const updateAppSettings = async (patch: UpdateSettingsInput) => {
    const requestId = latestAppSettingsRequestIdRef.current + 1
    latestAppSettingsRequestIdRef.current = requestId
    setSettingsError(undefined)
    setAppSettings((current) => applySettingsPatch(current, patch))

    try {
      const updated = await hesperApi.settings.update(patch)
      if (latestAppSettingsRequestIdRef.current === requestId) {
        setAppSettings(updated)
      }
      return updated
    } catch (error) {
      if (latestAppSettingsRequestIdRef.current !== requestId) {
        return appSettings
      }

      const message = error instanceof Error ? error.message : '未知设置保存错误'
      setSettingsError(message)
      try {
        const current = await hesperApi.settings.get()
        if (latestAppSettingsRequestIdRef.current === requestId) {
          setAppSettings(current)
        }
        return current
      } catch {
        if (latestAppSettingsRequestIdRef.current === requestId) {
          setAppSettings(defaultAppSettings)
        }
        return defaultAppSettings
      }
    }
  }

  const updateToolEnabled = async (toolId: string, enabled: boolean) => {
    setToolsError(undefined)
    setPendingToolIds((current) => new Set(current).add(toolId))
    try {
      const updatedTool = await hesperApi.tools.setEnabled({ id: toolId, enabled })
      setTools((current) => current.map((tool) => tool.id === updatedTool.id ? updatedTool : tool))
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : '未知工具保存错误')
    } finally {
      setPendingToolIds((current) => {
        const next = new Set(current)
        next.delete(toolId)
        return next
      })
    }
  }

  const renameSession = async (sessionId: string, title: string) => {
    const session = stateRef.current.sessions.find((candidate) => candidate.id === sessionId)
    const nextTitle = title.trim()
    if (!session || !nextTitle || nextTitle === session.title) return

    const requestId = nextRenameRequestIdRef.current + 1
    nextRenameRequestIdRef.current = requestId
    latestRenameRequestIdBySessionRef.current = {
      ...latestRenameRequestIdBySessionRef.current,
      [session.id]: requestId
    }

    setTitleGenerationError(undefined)
    const optimisticSession: Session = { ...session, title: nextTitle }
    dispatch({ type: 'session.updated', session: optimisticSession })

    try {
      const updatedSession = await hesperApi.sessions.updateTitle({ id: session.id, title: nextTitle })
      if (latestRenameRequestIdBySessionRef.current[session.id] !== requestId) return

      const { [session.id]: _completedRequest, ...remainingRequests } = latestRenameRequestIdBySessionRef.current
      latestRenameRequestIdBySessionRef.current = remainingRequests
      dispatch({ type: 'session.updated', session: updatedSession })
    } catch (error) {
      if (latestRenameRequestIdBySessionRef.current[session.id] !== requestId) return

      const { [session.id]: _failedRequest, ...remainingRequests } = latestRenameRequestIdBySessionRef.current
      latestRenameRequestIdBySessionRef.current = remainingRequests
      const currentSession = stateRef.current.sessions.find((candidate) => candidate.id === session.id)
      if (currentSession?.title === nextTitle) {
        dispatch({ type: 'session.updated', session })
      }
      setTitleGenerationError(`重命名失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const loadTitleSource = async (sessionId: string) => {
    const loadedSource = latestTitleSource(stateRef.current.messagesBySession[sessionId] ?? [])
    if (loadedSource) return loadedSource

    const messages = await hesperApi.conversation.listMessages(sessionId)
    dispatch({ type: 'history.loaded', sessionId, messages, runs: [], stepsByRun: {} })
    return latestTitleSource(messages)
  }

  const regenerateSessionTitle = async (sessionId: string) => {
    const session = stateRef.current.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return

    setTitleGenerationError(undefined)

    try {
      const source = await loadTitleSource(sessionId)
      if (!source) {
        setTitleGenerationError('标题生成失败：没有可用于生成标题的用户消息')
        return
      }

      const latestRunId = stateRef.current.latestRunIdBySession[sessionId]
      const sessionModelId = resolveSessionModelId(session.defaultModelId, sessionModelCatalog.preferredModelId, explicitModelSelectionSessionIdsRef.current.has(session.id))
      const modelId = latestRunId ? runModelIdsRef.current[latestRunId] ?? sessionModelId : sessionModelId
      const updatedSession = await hesperApi.sessions.generateTitle({
        id: session.id,
        modelId,
        userPrompt: source.userPrompt,
        ...(source.assistantOutput ? { assistantOutput: source.assistantOutput } : {})
      })
      dispatch({ type: 'session.updated', session: updatedSession })
    } catch (error) {
      setTitleGenerationError(`标题生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const deleteSession = async (sessionId: string) => {
    const session = stateRef.current.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return

    const updatedSession = await hesperApi.sessions.delete(session.id)
    dispatch({ type: 'session.updated', session: updatedSession })
  }

  const normalizeSessionActionIds = (sessionId: string, sessionIds?: string[]): string[] => {
    const requestedIds = sessionIds?.length ? sessionIds : [sessionId]
    const requestedIdSet = new Set(requestedIds)
    const orderedIds = stateRef.current.sessions.flatMap((session) => requestedIdSet.has(session.id) ? [session.id] : [])
    return orderedIds.length > 0 ? orderedIds : [sessionId]
  }

  const regenerateSessionTitles = async (sessionId: string, sessionIds?: string[]) => {
    for (const targetSessionId of normalizeSessionActionIds(sessionId, sessionIds)) {
      await regenerateSessionTitle(targetSessionId)
    }
  }

  const deleteSessions = async (sessionId: string, sessionIds?: string[]) => {
    for (const targetSessionId of normalizeSessionActionIds(sessionId, sessionIds)) {
      await deleteSession(targetSessionId)
    }
  }

  return (
    <AppShell
      sessions={effectiveSessions}
      activeSection={state.activeSection}
      title={isSessionsSection ? activeSession?.title ?? '新建会话' : getSectionTitle(state.activeSection)}
      platform={hesperApi.window.platform}
      appearance={{ themeMode: resolvedThemeMode, fontSize: appSettings.fontSize }}
      activeSettingsCategory={activeSettingsCategory}
      runningSessionIds={runningSessionIds}
      tools={tools}
      pendingToolIds={pendingToolIdList}
      {...(activeTool ? { activeToolId: activeTool.id } : {})}
      {...(state.activeSessionId ? { activeSessionId: state.activeSessionId } : {})}
      onCreateSession={async () => {
        dispatch({ type: 'section.selected', section: 'sessions' })
        await createSession(dispatch, sessionModelCatalog.preferredModelId)
      }}
      onSelectSection={(section) => dispatch({ type: 'section.selected', section })}
      onSelectSettingsCategory={setActiveSettingsCategory}
      onSelectTool={setActiveToolId}
      onToggleToolEnabled={(toolId, enabled) => {
        void updateToolEnabled(toolId, enabled)
      }}
      onSelectSession={(sessionId) => {
        dispatch({ type: 'section.selected', section: 'sessions' })
        dispatch({ type: 'session.selected', sessionId })
        void markSessionViewed(sessionId)
      }}
      onRenameSession={(sessionId, title) => {
        void renameSession(sessionId, title)
      }}
      onRegenerateSessionTitle={(sessionId, sessionIds) => {
        void regenerateSessionTitles(sessionId, sessionIds)
      }}
      onDeleteSession={(sessionId, sessionIds) => {
        void deleteSessions(sessionId, sessionIds)
      }}
      onWindowMinimize={() => hesperApi.window.minimize()}
      onWindowToggleMaximize={() => hesperApi.window.toggleMaximize()}
      onWindowClose={() => hesperApi.window.close()}
    >
      {!isSessionsSection ? (
        state.activeSection === 'settings' ? (
          activeSettingsCategory === 'appearance' ? (
            <AppearanceSettingsPanel settings={appSettings} {...(settingsError ? { error: settingsError } : {})} onUpdate={updateAppSettings} />
          ) : (
            <ProviderSettingsPanel onModelRegistryChanged={refreshSessionModelOptions} />
          )
        ) : state.activeSection === 'tools' ? (
          <ToolDetailsPanel
            {...(activeTool ? { tool: activeTool } : {})}
            pending={activeTool ? pendingToolIds.has(activeTool.id) : false}
            {...(toolsError ? { error: toolsError } : {})}
            onToggle={(enabled) => {
              if (activeTool) void updateToolEnabled(activeTool.id, enabled)
            }}
          />
        ) : <SectionPlaceholder section={state.activeSection} />
      ) : activeSession ? (
        <>
          {titleGenerationError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: '#fca5a5', padding: '0 12px' }}>
              {titleGenerationError}
            </p>
          ) : null}
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
            runsById={state.runsById}
            streamingText={activeStreamingText}
            streamingByRun={state.streamingByRun}
            modelId={activeModelId}
            modelOptions={activeModelOptions}
            modelOptionGroups={sessionModelCatalog.optionGroups}
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
              explicitModelSelectionSessionIdsRef.current.add(activeSession.id)
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
            onSend={(content) => {
              pendingTitlePromptsBySessionRef.current[activeSession.id] = content
              void sendMessage({
                session: activeSession,
                modelId: activeModelId,
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
          onCreateSession={async () => createSession(dispatch, sessionModelCatalog.preferredModelId)}
        />
      )}
    </AppShell>
  )
}

const sectionTitles: Record<AppSection, string> = {
  sessions: '所有会话',
  skills: 'Skills 即将支持',
  roles: 'Roles 即将支持',
  tools: '工具',
  settings: '设置'
}

function getSectionTitle(section: AppSection): string {
  return sectionTitles[section]
}

function applySettingsPatch(settings: AppSettings, patch: UpdateSettingsInput): AppSettings {
  return {
    ...settings,
    ...(patch.defaultModelId !== undefined ? { defaultModelId: patch.defaultModelId } : {}),
    ...(patch.defaultOutputMode !== undefined ? { defaultOutputMode: patch.defaultOutputMode } : {}),
    ...(patch.themeMode !== undefined ? { themeMode: patch.themeMode } : {}),
    ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {})
  }
}

function getSystemThemeMode(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function useResolvedThemeMode(themeMode: AppSettings['themeMode']): 'light' | 'dark' {
  const [systemThemeMode, setSystemThemeMode] = useState<'light' | 'dark'>(() => getSystemThemeMode())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const updateSystemThemeMode = () => setSystemThemeMode(mediaQuery.matches ? 'light' : 'dark')
    updateSystemThemeMode()
    mediaQuery.addEventListener?.('change', updateSystemThemeMode)
    return () => mediaQuery.removeEventListener?.('change', updateSystemThemeMode)
  }, [])

  return themeMode === 'system' ? systemThemeMode : themeMode
}

function resolveSessionModelId(sessionModelId: string | undefined, preferredModelId: string, useSessionModelId = false): string {
  if (useSessionModelId && sessionModelId) {
    return sessionModelId
  }
  if (!sessionModelId || sessionModelId === defaultFallbackModelId) {
    return preferredModelId
  }
  return sessionModelId
}

function isDefaultSessionTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, ' ').trim().toLowerCase()
  return normalized === 'new chat' || normalized === '新建会话' || normalized === 'untitled' || normalized === '无标题'
}

type TitleSource = {
  userPrompt: string
  assistantOutput?: string
}

function latestAssistantOutputAfter(messages: Message[], userMessage: Message): string | undefined {
  const latestAssistant = [...messages]
    .filter((message) => message.role === 'assistant' && message.content.trim() && message.createdAt.localeCompare(userMessage.createdAt) >= 0)
    .sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt)
      return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt
    })[0]

  return latestAssistant?.content.trim() || undefined
}

function firstUserTitleSource(messages: Message[], assistantOutput?: string): TitleSource | undefined {
  const userMessages = messages.filter((message) => message.role === 'user')
  if (userMessages.length !== 1) {
    return undefined
  }

  const userPrompt = userMessages[0]?.content.trim()
  return userPrompt ? { userPrompt, ...(assistantOutput?.trim() ? { assistantOutput: assistantOutput.trim() } : {}) } : undefined
}

function latestTitleSource(messages: Message[]): TitleSource | undefined {
  const latestUser = [...messages]
    .filter((message) => message.role === 'user' && message.content.trim())
    .sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt)
      return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt
    })[0]

  if (!latestUser) return undefined

  const userPrompt = latestUser.content.trim()
  if (!userPrompt) return undefined

  const assistantOutput = latestAssistantOutputAfter(messages, latestUser)
  return {
    userPrompt,
    ...(assistantOutput ? { assistantOutput } : {})
  }
}

function SectionPlaceholder({ section }: { section: AppSection }) {
  return (
    <section
      aria-label={`${getSectionTitle(section)} 占位区域`}
      style={{
        height: '100%',
        border: '1px solid var(--hesper-color-border, #414868)',
        borderRadius: 14,
        background: 'var(--hesper-color-surface-muted, #24283b)',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 24
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>{getSectionTitle(section)}</h2>
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
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>准备开始新的 hesper 会话</h2>
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

async function createSession(dispatch: ReturnType<typeof useAppStore>['dispatch'], defaultModelId = defaultFallbackModelId) {
  const session = await hesperApi.sessions.create({
    title: 'New chat',
    ...(defaultModelId !== defaultFallbackModelId ? { defaultModelId } : {})
  })
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
      messageCreatedAt: message.createdAt,
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
