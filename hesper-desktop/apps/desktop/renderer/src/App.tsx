import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { createId, defaultAppThemeId, nowIso, type AgentRun, type Message, type MessageAttachment, type RunStep, type Session, type WorkerAgentInvocation } from '@hesper/shared'
import { AppShell, ConversationView, resolveThemeVariant, themeTokens, type AppSection, type ComposerDraftAttachment, type ComposerSendOptions, type ComposerSkillMention, type ConversationGitPanelProps, type ConversationShortcutCommand, type GitCommitDetailView, type GitGraphRowView, type SkillOption } from '@hesper/ui'
import { AppStoreProvider, useAppStore, type SessionSpecialView } from './app-store'
import { hesperApi } from './ipc-client'
import { defaultFallbackModelId, fallbackSessionModelCatalog, isLegacyFallbackModelId, loadAvailableModelCatalog, mergeModelOptions, type SessionModelCatalog } from './model-options'
import type { AppSettings, CreateSshKeyInput, CreateSshServerInput, DraftAttachment, GitCommitDetailDto, GitGraphRowDto, GitRefDto, GitRepositoryStateDto, ManagedRoleDto, SkillDto, SshKeyDto, SshServerDto, ToolCredentialStatus, ToolDto, UpdateSettingsInput, UpdateSshServerInput } from '../../electron/ipc-contract'
import { AppearanceSettingsPanel } from './appearance-settings-panel'
import { ProviderSettingsPanel } from './provider-settings-panel'
import { createShortcutHandler } from './shortcuts'
import { SoulSettingsPanel } from './soul-settings-panel'
import { SshSettingsPanel } from './ssh-settings-panel'
import { ToolDetailsPanel } from './tool-details-panel'
import { RolesPanel } from './roles-panel'
import { SkillsPanel } from './skills-panel'

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

type GitUiStateBySession = Record<string, {
  workspacePath?: string | undefined
  repository?: GitRepositoryStateDto | undefined
  rows?: GitGraphRowDto[] | undefined
  logLimit?: number | undefined
  hasMore?: boolean | undefined
  open?: boolean | undefined
  loadingState?: boolean | undefined
  loadingLog?: boolean | undefined
  loadingMore?: boolean | undefined
  loadingDetailByCommit?: Record<string, boolean> | undefined
  selectedCommit?: string | undefined
  detailsByCommit?: Record<string, GitCommitDetailDto> | undefined
  error?: string | undefined
}>

type SettingsCategory = 'ai' | 'appearance' | 'ssh' | 'soul'

const defaultAppSettings: AppSettings = {
  defaultModelId: '',
  defaultOutputMode: 'markdown',
  themeMode: 'system',
  themeId: defaultAppThemeId,
  fontSize: 14,
  soul: ''
}

const appBrandName = import.meta.env.MODE === 'development' ? 'Hesper-dev' : 'Hesper'
const gitLogPageSize = 60

export function clearSessionSendError(errors: Record<string, string>, sessionId: string): Record<string, string> {
  if (!(sessionId in errors)) {
    return errors
  }

  const next = { ...errors }
  delete next[sessionId]
  return next
}

export function pruneSessionRecord<T>(record: Record<string, T>, visibleSessionIds: string[]): Record<string, T> {
  const visible = new Set(visibleSessionIds)
  const next = Object.fromEntries(Object.entries(record).filter(([sessionId]) => visible.has(sessionId))) as Record<string, T>
  return Object.keys(next).length === Object.keys(record).length ? record : next
}

export function pruneSessionSendErrors(errors: Record<string, string>, visibleSessionIds: string[]): Record<string, string> {
  return pruneSessionRecord(errors, visibleSessionIds)
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function selectDefaultGitCommit(repository?: GitRepositoryStateDto, rows: GitGraphRowDto[] = [], currentSelection?: string): string | undefined {
  if (currentSelection && rows.some((row) => row.commitHash === currentSelection)) return currentSelection
  return repository?.headCommit ?? rows[0]?.commitHash
}

function appendUniqueGitRows(currentRows: GitGraphRowDto[], nextRows: GitGraphRowDto[]): GitGraphRowDto[] {
  if (currentRows.length === 0) return nextRows
  const seen = new Set(currentRows.map((row) => row.commitHash))
  return [...currentRows, ...nextRows.filter((row) => !seen.has(row.commitHash))]
}

function mergeGitUiState(
  current: GitUiStateBySession,
  sessionId: string,
  patch: Partial<GitUiStateBySession[string]>
): GitUiStateBySession {
  return {
    ...current,
    [sessionId]: {
      ...current[sessionId],
      ...patch
    }
  }
}

function clearGitDetailLoading(
  loadingDetailByCommit: Record<string, boolean> | undefined,
  commit: string
): Record<string, boolean> | undefined {
  if (!loadingDetailByCommit?.[commit]) return loadingDetailByCommit
  const next = { ...loadingDetailByCommit }
  delete next[commit]
  return Object.keys(next).length > 0 ? next : undefined
}

function toGitRefView(ref: GitRefDto): GitGraphRowView['refs'][number] {
  return {
    name: ref.name,
    shortName: ref.shortName,
    type: ref.type,
    ...(ref.targetCommit ? { targetCommit: ref.targetCommit } : {})
  }
}

function toGitGraphRowView(row: GitGraphRowDto): GitGraphRowView {
  return {
    commitHash: row.commitHash,
    shortHash: row.shortHash,
    parents: row.parents,
    subject: row.subject,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    authoredAt: row.authoredAt,
    refs: row.refs.map(toGitRefView),
    graph: {
      lanes: row.graph.lanes,
      ...(row.graph.nodeLaneId ? { nodeLaneId: row.graph.nodeLaneId } : {}),
      ...(row.graph.edges ? { edges: row.graph.edges } : {})
    }
  }
}

function toGitCommitDetailView(detail: GitCommitDetailDto): GitCommitDetailView {
  return {
    commitHash: detail.commitHash,
    shortHash: detail.shortHash,
    parents: detail.parents,
    subject: detail.subject,
    body: detail.body,
    authorName: detail.authorName,
    authorEmail: detail.authorEmail,
    authoredAt: detail.authoredAt,
    committerName: detail.committerName,
    committerEmail: detail.committerEmail,
    committedAt: detail.committedAt,
    refs: detail.refs.map(toGitRefView),
    files: detail.files.map((file) => ({
      path: file.path,
      status: file.status,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      ...(typeof file.additions === 'number' ? { additions: file.additions } : {}),
      ...(typeof file.deletions === 'number' ? { deletions: file.deletions } : {})
    }))
  }
}

function clearSessionUnreadCompletion(session: Session): Session {
  if (!session.unreadCompletedAt) return session
  const { unreadCompletedAt: _unreadCompletedAt, ...viewed } = session
  return viewed
}

function applySessionUnreadCompletion(session: Session, completedAt: string): Session {
  const updatedAt = session.updatedAt >= completedAt ? session.updatedAt : completedAt
  const unreadCompletedAt = session.unreadCompletedAt && session.unreadCompletedAt >= completedAt
    ? session.unreadCompletedAt
    : completedAt
  if (session.unreadCompletedAt === unreadCompletedAt && session.updatedAt === updatedAt) return session
  return { ...session, unreadCompletedAt, updatedAt }
}

function visibleSessionsForScope(sessions: Session[], categoryId: string | undefined, specialView: SessionSpecialView | undefined): Session[] {
  if (specialView === 'archived') return sessions.filter((session) => session.status === 'archived')
  if (specialView === 'marked') return sessions.filter((session) => session.status === 'active' && session.isMarked)
  if (categoryId) return sessions.filter((session) => session.status === 'active' && session.categoryId === categoryId)
  return sessions.filter((session) => session.status === 'active')
}

const recentWorkspaceStorageKey = 'hesper.recentWorkspacePaths'
const recentWorkspaceMigrationStorageKey = 'hesper.recentWorkspacePaths.initializedFromSessions.v2'
const dismissedRecentWorkspaceStorageKey = 'hesper.dismissedRecentWorkspacePathKeys'
const maxRecentWorkspacePaths = 8

function normalizeWorkspacePath(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeWorkspacePathKey(value: string): string {
  return value.trim().replace(/[\\/]+$/u, '').toLocaleLowerCase()
}

function normalizeRecentWorkspacePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  return paths.flatMap((path) => {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) return []
    const key = normalizeWorkspacePathKey(normalized)
    if (seen.has(key)) return []
    seen.add(key)
    return [normalized]
  }).slice(0, maxRecentWorkspacePaths)
}

function readRecentWorkspacePaths(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentWorkspaceStorageKey) ?? '[]')
    return Array.isArray(parsed) ? normalizeRecentWorkspacePaths(parsed.filter((item): item is string => typeof item === 'string')) : []
  } catch {
    return []
  }
}

function writeRecentWorkspacePaths(paths: readonly string[]): string[] {
  const normalized = normalizeRecentWorkspacePaths(paths)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(recentWorkspaceStorageKey, JSON.stringify(normalized))
    } catch {
      // Ignore storage failures so workspace selection remains usable.
    }
  }
  return normalized
}

function readDismissedRecentWorkspacePathKeys(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(dismissedRecentWorkspaceStorageKey) ?? '[]')
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === 'string').map(normalizeWorkspacePathKey).filter(Boolean))] : []
  } catch {
    return []
  }
}

function writeDismissedRecentWorkspacePathKeys(keys: readonly string[]): string[] {
  const normalized = [...new Set(keys.map(normalizeWorkspacePathKey).filter(Boolean))]
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(dismissedRecentWorkspaceStorageKey, JSON.stringify(normalized))
    } catch {
      // Ignore storage failures so workspace selection remains usable.
    }
  }
  return normalized
}

function addRecentWorkspacePath(paths: readonly string[], workspacePath: string): string[] {
  return writeRecentWorkspacePaths([workspacePath, ...paths])
}

function mergeRecentWorkspacePaths(paths: readonly string[], nextPaths: readonly string[]): string[] {
  return writeRecentWorkspacePaths([...paths, ...nextPaths])
}

function hasInitializedRecentWorkspacePathsFromSessions(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(recentWorkspaceMigrationStorageKey) === 'true'
  } catch {
    return true
  }
}

function markRecentWorkspacePathsInitializedFromSessions(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(recentWorkspaceMigrationStorageKey, 'true')
  } catch {
    // Ignore storage failures so workspace selection remains usable.
  }
}

function removeRecentWorkspacePath(paths: readonly string[], workspacePath: string): string[] {
  const removeKey = normalizeWorkspacePathKey(workspacePath)
  return writeRecentWorkspacePaths(paths.filter((path) => normalizeWorkspacePathKey(path) !== removeKey))
}

function addDismissedRecentWorkspacePathKey(keys: readonly string[], workspacePath: string): string[] {
  return writeDismissedRecentWorkspacePathKeys([...keys, normalizeWorkspacePathKey(workspacePath)])
}

function removeDismissedRecentWorkspacePathKey(keys: readonly string[], workspacePath: string): string[] {
  const removeKey = normalizeWorkspacePathKey(workspacePath)
  return writeDismissedRecentWorkspacePathKeys(keys.filter((key) => normalizeWorkspacePathKey(key) !== removeKey))
}

function AppContent() {
  const { state, dispatch } = useAppStore()
  const [loadError, setLoadError] = useState<string>()
  const [titleGenerationError, setTitleGenerationError] = useState<string>()
  const [sendErrorsBySession, setSendErrorsBySession] = useState<Record<string, string>>({})
  const [draftsBySession, setDraftsBySession] = useState<Record<string, string>>({})
  const [draftSkillMentionsBySession, setDraftSkillMentionsBySession] = useState<Record<string, ComposerSkillMention[]>>({})
  const [draftAttachmentsBySession, setDraftAttachmentsBySession] = useState<Record<string, ComposerDraftAttachment[]>>({})
  const [pendingSettingsBySession, setPendingSettingsBySession] = useState<Record<string, SessionSettingsOverride>>({})
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState<string[]>(() => readRecentWorkspacePaths())
  const [dismissedRecentWorkspacePathKeys, setDismissedRecentWorkspacePathKeys] = useState<string[]>(() => readDismissedRecentWorkspacePathKeys())
  const [shortcutCommand, setShortcutCommand] = useState<ConversationShortcutCommand>()
  const [sessionModelCatalog, setSessionModelCatalog] = useState<SessionModelCatalog>(fallbackSessionModelCatalog)
  const [historyErrorsBySession, setHistoryErrorsBySession] = useState<Record<string, string>>({})
  const [gitUiStateBySession, setGitUiStateBySession] = useState<GitUiStateBySession>({})
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings)
  const [settingsError, setSettingsError] = useState<string>()
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<SettingsCategory>('ai')
  const [tools, setTools] = useState<ToolDto[]>([])
  const [activeToolId, setActiveToolId] = useState<string>()
  const [pendingToolIds, setPendingToolIds] = useState<Set<string>>(new Set())
  const [toolCredentialStatuses, setToolCredentialStatuses] = useState<Record<string, ToolCredentialStatus>>({})
  const [pendingToolCredentialIds, setPendingToolCredentialIds] = useState<Set<string>>(new Set())
  const [toolsError, setToolsError] = useState<string>()
  const [sshError, setSshError] = useState<string>()
  const [sshKeys, setSshKeys] = useState<SshKeyDto[]>([])
  const [sshServers, setSshServers] = useState<SshServerDto[]>([])
  const [sshPending, setSshPending] = useState(false)
  const [roles, setRoles] = useState<ManagedRoleDto[]>([])
  const [rolesError, setRolesError] = useState<string>()
  const [activeRoleId, setActiveRoleId] = useState<string>()
  const [rolesPending, setRolesPending] = useState(false)
  const [rolesLoading, setRolesLoading] = useState(true)
  const [skills, setSkills] = useState<SkillDto[]>([])
  const [skillsError, setSkillsError] = useState<string>()
  const [activeSkillId, setActiveSkillId] = useState<string>()
  const [skillsLoading, setSkillsLoading] = useState(false)
  const requestedThemeMode = useResolvedThemeMode(appSettings.themeMode)
  const effectiveThemeMode = resolveThemeVariant(appSettings.themeId, requestedThemeMode).colorScheme
  const loadedHistorySessionIdsRef = useRef<Set<string>>(new Set())
  const loadingHistorySessionIdsRef = useRef<Set<string>>(new Set())
  const gitUiStateRef = useRef(gitUiStateBySession)
  const createdNewSessionIdsRef = useRef<Set<string>>(new Set())
  const explicitModelSelectionSessionIdsRef = useRef<Set<string>>(new Set())
  const runModelIdsRef = useRef<Record<string, string>>({})
  const pendingTitlePromptsBySessionRef = useRef<Record<string, string>>({})
  const titleGeneratedRunIdsRef = useRef<Set<string>>(new Set())
  const sessionModelCatalogRef = useRef(sessionModelCatalog)
  const stateRef = useRef(state)
  gitUiStateRef.current = gitUiStateBySession
  sessionModelCatalogRef.current = sessionModelCatalog
  const nextRenameRequestIdRef = useRef(0)
  const latestRenameRequestIdBySessionRef = useRef<Record<string, number>>({})
  const nextSettingsRequestIdRef = useRef(0)
  const latestSettingsRequestIdRef = useRef<RequestTokensBySession>({})
  const latestGitStateRequestIdRef = useRef<Record<string, number>>({})
  const latestGitLogRequestIdRef = useRef<Record<string, number>>({})
  const latestGitDetailRequestIdRef = useRef<Record<string, Record<string, number>>>({})
  const latestAppSettingsRequestIdRef = useRef(0)
  const nextRolesRequestIdRef = useRef(0)
  const latestRolesRequestIdRef = useRef(0)
  const activeSessionUnreadCompletedAt = state.activeSessionId
    ? state.sessions.find((session) => session.id === state.activeSessionId)?.unreadCompletedAt
    : undefined
  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? tools[0]
  const activeRole = roles.find((role) => role.id === activeRoleId) ?? roles[0]
  const activeSkill = skills.find((skill) => skill.id === activeSkillId) ?? skills[0]
  const activeToolCredentialStatus = activeTool ? toolCredentialStatuses[activeTool.id] : undefined
  const pendingToolIdList = useMemo(() => [...pendingToolIds], [pendingToolIds])
  const loadAttachmentDataUrl = useCallback((attachment: MessageAttachment) => (
    hesperApi.attachments!.readDataUrl({ relativePath: attachment.relativePath, mimeType: attachment.mimeType }).then((result) => result.dataUrl)
  ), [])

  const createRolesRequestId = () => {
    nextRolesRequestIdRef.current += 1
    latestRolesRequestIdRef.current = nextRolesRequestIdRef.current
    return latestRolesRequestIdRef.current
  }

  const invalidateRolesRequests = () => {
    nextRolesRequestIdRef.current += 1
    latestRolesRequestIdRef.current = nextRolesRequestIdRef.current
  }

  const isLatestRolesRequest = (requestId: number) => latestRolesRequestIdRef.current === requestId

  const loadRoles = async (options: { isCancelled?: () => boolean } = {}) => {
    const requestId = createRolesRequestId()
    try {
      const loadedRoles = await hesperApi.roles.list()
      const applied = !options.isCancelled?.() && isLatestRolesRequest(requestId)
      if (applied) {
        setRoles(loadedRoles)
        setRolesError(undefined)
      }
      return { requestId, loadedRoles, applied }
    } catch (error) {
      const applied = !options.isCancelled?.() && isLatestRolesRequest(requestId)
      if (applied) {
        setRolesError(error instanceof Error ? error.message : '未知角色加载错误')
      }
      return { requestId, error, applied }
    }
  }

  const loadSkills = async (options: { isCancelled?: () => boolean } = {}) => {
    try {
      const refreshedSkills = await hesperApi.skills.refresh()
      if (!options.isCancelled?.()) {
        setSkills(refreshedSkills)
        setSkillsError(undefined)
      }
      return refreshedSkills
    } catch (error) {
      if (!options.isCancelled?.()) {
        setSkillsError(error instanceof Error ? error.message : '未知技能加载错误')
      }
      return undefined
    }
  }

  const loadSshConfiguration = async (options: { isCancelled?: () => boolean } = {}) => {
    try {
      const [loadedKeys, loadedServers] = await Promise.all([
        hesperApi.sshKeys.list(),
        hesperApi.sshServers.list()
      ])
      if (!options.isCancelled?.()) {
        setSshKeys(loadedKeys)
        setSshServers(loadedServers)
        setSshError(undefined)
      }
      return { loadedKeys, loadedServers }
    } catch (error) {
      if (!options.isCancelled?.()) {
        setSshError(error instanceof Error ? error.message : '未知 SSH 配置加载错误')
      }
      return undefined
    }
  }

  const loadSshKeys = async () => {
    try {
      const loadedKeys = await hesperApi.sshKeys.list()
      setSshKeys(loadedKeys)
      setSshError(undefined)
      return loadedKeys
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 密钥加载错误')
      return undefined
    }
  }

  const loadSshServers = async () => {
    try {
      const loadedServers = await hesperApi.sshServers.list()
      setSshServers(loadedServers)
      setSshError(undefined)
      return loadedServers
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 服务器加载错误')
      return undefined
    }
  }

  const markSessionUnreadCompletedLocally = (sessionId: string, completedAt: string) => {
    dispatch({ type: 'session.unread-completion-marked', sessionId, completedAt })
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
    document.documentElement.dataset.theme = effectiveThemeMode
  }, [effectiveThemeMode])

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
    setRolesLoading(true)

    void loadRoles({ isCancelled: () => cancelled }).then(({ requestId }) => {
      if (!cancelled && isLatestRolesRequest(requestId)) {
        setRolesLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state.activeSection !== 'roles' || rolesLoading) return undefined

    let cancelled = false
    setRolesLoading(true)

    void loadRoles({ isCancelled: () => cancelled }).then(({ requestId }) => {
      if (!cancelled && isLatestRolesRequest(requestId)) {
        setRolesLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [state.activeSection])

  useEffect(() => {
    if (roles.length === 0) {
      setActiveRoleId(undefined)
      return
    }
    if (!activeRoleId || !roles.some((role) => role.id === activeRoleId)) {
      setActiveRoleId(roles[0]!.id)
    }
  }, [activeRoleId, roles])

  useEffect(() => {
    let cancelled = false
    void hesperApi.skills.list().then((cachedSkills) => {
      if (!cancelled) {
        setSkills(cachedSkills)
        setSkillsError(undefined)
      }
    }).catch((error) => {
      if (!cancelled) {
        setSkillsError(error instanceof Error ? error.message : '未知技能加载错误')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state.activeSection !== 'skills') return undefined

    let cancelled = false
    const refresh = async (showLoading: boolean) => {
      if (showLoading) setSkillsLoading(true)
      await loadSkills({ isCancelled: () => cancelled })
      if (!cancelled && showLoading) setSkillsLoading(false)
    }

    void refresh(skills.length === 0)
    const interval = window.setInterval(() => {
      void refresh(false)
    }, 5_000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [state.activeSection])

  useEffect(() => {
    if (skills.length === 0) {
      setActiveSkillId(undefined)
      return
    }
    if (!activeSkillId || !skills.some((skill) => skill.id === activeSkillId)) {
      setActiveSkillId(skills[0]!.id)
    }
  }, [activeSkillId, skills])

  useEffect(() => {
    const tool = activeTool
    if (!tool?.requiresApiKey) return undefined
    let cancelled = false
    setPendingToolCredentialIds((current) => new Set(current).add(tool.id))
    void hesperApi.tools.credentialStatus({ toolId: tool.id }).then((status) => {
      if (!cancelled) {
        setToolCredentialStatuses((current) => ({ ...current, [tool.id]: status }))
      }
    }).catch((error) => {
      if (!cancelled) {
        setToolsError(error instanceof Error ? error.message : '未知工具凭据状态错误')
      }
    }).finally(() => {
      if (!cancelled) {
        setPendingToolCredentialIds((current) => {
          const next = new Set(current)
          next.delete(tool.id)
          return next
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeTool])

  useEffect(() => {
    if (state.activeSection !== 'settings' || activeSettingsCategory !== 'ssh') return undefined
    let cancelled = false
    setSshPending(true)
    void loadSshConfiguration({ isCancelled: () => cancelled }).finally(() => {
      if (!cancelled) {
        setSshPending(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [state.activeSection, activeSettingsCategory])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const sessionCategoriesApi = (hesperApi as typeof hesperApi & { sessionCategories?: { list: typeof hesperApi.sessionCategories.list } }).sessionCategories
        const [sessions, categories] = await Promise.all([
          hesperApi.sessions.list(),
          sessionCategoriesApi?.list() ?? Promise.resolve([])
        ])
        if (!cancelled) {
          setLoadError(undefined)
          dispatch({ type: 'sessions.loaded', sessions })
          if (!hasInitializedRecentWorkspacePathsFromSessions()) {
            setRecentWorkspacePaths((current) => mergeRecentWorkspacePaths(current, sessions.flatMap((session) => session.workspacePath ? [session.workspacePath] : [])))
            markRecentWorkspacePathsInitializedFromSessions()
          }
          dispatch({ type: 'sessionCategories.loaded', categories })
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

        if (cancelled) {
          return
        }

        dispatch({ type: 'history.loaded', sessionId, messages, runs, stepsByRun })

        const rootRuns = runs.filter((run) => !run.parentRunId)
        if (rootRuns.length > 0) {
          const workerHistoryResults = await Promise.all(rootRuns.map(async (run) => {
            const invocations = await hesperApi.workerAgents.listByParentRun({ sessionId, parentRunId: run.id })
            const childRunEntries = await Promise.all(invocations
              .filter((invocation) => invocation.childRunId)
              .map(async (invocation) => {
                const childRunId = invocation.childRunId!
                const childRun = runs.find((run) => run.id === childRunId)
                const [childSteps, childMessages] = await Promise.all([
                  conversationApi.listSteps(childRunId),
                  conversationApi.listMessagesByRun({ sessionId, runId: childRunId })
                ])
                return [childRunId, { invocation, childRun, childSteps, childMessages }] as const
              }))

            return {
              invocations,
              runs: childRunEntries.flatMap(([, entry]) => entry.childRun ? [entry.childRun] : []),
              stepsByRun: Object.fromEntries(childRunEntries.map(([childRunId, entry]) => [childRunId, entry.childSteps])) as Record<string, RunStep[]>,
              messagesByRun: Object.fromEntries(childRunEntries.map(([childRunId, entry]) => [childRunId, entry.childMessages])) as Record<string, Message[]>
            }
          }))

          if (cancelled) {
            return
          }

          const invocations = workerHistoryResults.flatMap((result) => result.invocations)
          const childRuns = workerHistoryResults.flatMap((result) => result.runs)
          const childStepsByRun = Object.fromEntries(workerHistoryResults.flatMap((result) => Object.entries(result.stepsByRun))) as Record<string, RunStep[]>
          const childMessagesByRun = Object.fromEntries(workerHistoryResults.flatMap((result) => Object.entries(result.messagesByRun))) as Record<string, Message[]>

          dispatch({ type: 'worker.history.loaded', invocations, runs: childRuns, stepsByRun: childStepsByRun, messagesByRun: childMessagesByRun })
        }
        if (cancelled) {
          return
        }

        loadedHistorySessionIdsRef.current.add(sessionId)
        setHistoryErrorsBySession((current) => clearSessionSendError(current, sessionId))
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load worker history for session', sessionId, error)
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
        const completedRun = event.message.runId ? stateRef.current.runsById[event.message.runId] : undefined
        const isChildRun = Boolean(completedRun?.parentRunId)
        if (!isChildRun) {
          dispatch({ type: 'session.touched', sessionId: event.message.sessionId, updatedAt: event.message.createdAt })
          handleSessionCompletionUnread(event.message.sessionId, event.message.createdAt)
        }
      }

      if (event.type === 'run.failed') {
        const run = stateRef.current.runsById[event.runId]
        if (run && !run.parentRunId) {
          const failedAt = event.endedAt ?? run.endedAt ?? new Date().toISOString()
          dispatch({ type: 'session.touched', sessionId: run.sessionId, updatedAt: failedAt })
          handleSessionCompletionUnread(run.sessionId, failedAt)
        }
      }

      if (event.type === 'message.completed' && event.message.role === 'assistant' && event.message.runId) {
        const completedRun = stateRef.current.runsById[event.message.runId]
        if (!completedRun?.parentRunId) {
          const session = stateRef.current.sessions.find((candidate) => candidate.id === event.message.sessionId)
          const messages = stateRef.current.messagesBySession[event.message.sessionId] ?? []
          const fallbackPrompt = pendingTitlePromptsBySessionRef.current[event.message.sessionId]
          const source = session && isDefaultSessionTitle(session.title)
            ? firstUserTitleSource(messages, event.message.content) ?? (fallbackPrompt ? { userPrompt: fallbackPrompt, assistantOutput: event.message.content } : undefined)
            : undefined
          const modelId = runModelIdsRef.current[event.message.runId] ?? session?.defaultModelId ?? defaultFallbackModelId

          if (session && source?.userPrompt && !titleGeneratedRunIdsRef.current.has(event.message.runId)) {
            const modelError = titleGenerationModelError(modelId, sessionModelCatalogRef.current)
            if (modelError) {
              setTitleGenerationError(`标题生成失败：${modelError}`)
              delete pendingTitlePromptsBySessionRef.current[event.message.sessionId]
            } else {
              setTitleGenerationError(undefined)
              titleGeneratedRunIdsRef.current.add(event.message.runId)
              void hesperApi.sessions.generateTitle({
                id: session.id,
                modelId,
                userPrompt: source.userPrompt,
                ...(source.assistantOutput ? { assistantOutput: source.assistantOutput } : {})
              }).then((updatedSession) => {
                dispatch({ type: 'session.updated', session: updatedSession })
                titleGeneratedRunIdsRef.current.delete(event.message.runId!)
              }).catch((error) => {
                titleGeneratedRunIdsRef.current.delete(event.message.runId!)
                console.warn('Failed to generate session title', error)
                setTitleGenerationError(`标题生成失败：${error instanceof Error ? error.message : '未知错误'}`)
              }).finally(() => {
                delete pendingTitlePromptsBySessionRef.current[event.message.sessionId]
              })
            }
          }
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
    setSendErrorsBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    setDraftsBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    setDraftSkillMentionsBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    setDraftAttachmentsBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    setPendingSettingsBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    setHistoryErrorsBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    setGitUiStateBySession((current) => pruneSessionRecord(current, visibleSessionIds))
    const visible = new Set(visibleSessionIds)
    loadedHistorySessionIdsRef.current = new Set([...loadedHistorySessionIdsRef.current].filter((sessionId) => visible.has(sessionId)))
    loadingHistorySessionIdsRef.current = new Set([...loadingHistorySessionIdsRef.current].filter((sessionId) => visible.has(sessionId)))
    createdNewSessionIdsRef.current = new Set([...createdNewSessionIdsRef.current].filter((sessionId) => visible.has(sessionId)))
    latestSettingsRequestIdRef.current = pruneRequestTokens(latestSettingsRequestIdRef.current, visibleSessionIds)
    latestGitStateRequestIdRef.current = Object.fromEntries(
      Object.entries(latestGitStateRequestIdRef.current).filter(([sessionId]) => visible.has(sessionId))
    )
    latestGitLogRequestIdRef.current = Object.fromEntries(
      Object.entries(latestGitLogRequestIdRef.current).filter(([sessionId]) => visible.has(sessionId))
    )
    latestGitDetailRequestIdRef.current = Object.fromEntries(
      Object.entries(latestGitDetailRequestIdRef.current).filter(([sessionId]) => visible.has(sessionId))
    )
    pendingTitlePromptsBySessionRef.current = Object.fromEntries(
      Object.entries(pendingTitlePromptsBySessionRef.current).filter(([sessionId]) => visible.has(sessionId))
    )

    const visibleRunIds = new Set(Object.values(state.runsById)
      .filter((run) => visible.has(run.sessionId))
      .map((run) => run.id))
    runModelIdsRef.current = Object.fromEntries(
      Object.entries(runModelIdsRef.current).filter(([runId]) => visibleRunIds.has(runId))
    )
    titleGeneratedRunIdsRef.current = new Set([...titleGeneratedRunIdsRef.current].filter((runId) => visibleRunIds.has(runId)))
  }, [state.runsById, state.sessions])

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
  const visibleSessions = useMemo(
    () => visibleSessionsForScope(effectiveSessions, state.activeSessionCategoryId, state.activeSessionSpecialView),
    [effectiveSessions, state.activeSessionCategoryId, state.activeSessionSpecialView]
  )
  const activeSession = effectiveSessions.find((session) => session.id === state.activeSessionId)
  const activeSessionCategory = state.activeSessionCategoryId
    ? state.sessionCategories.find((category) => category.id === state.activeSessionCategoryId)
    : undefined
  const activeSessionListTitle = state.activeSessionSpecialView === 'marked'
    ? '已标记'
    : state.activeSessionSpecialView === 'archived'
      ? '归档'
      : activeSessionCategory?.name ?? '所有会话'
  const activeSendError = activeSession ? sendErrorsBySession[activeSession.id] : undefined
  const visibleRecentWorkspacePaths = useMemo(() => {
    const dismissedKeys = new Set(dismissedRecentWorkspacePathKeys)
    return normalizeRecentWorkspacePaths([
      ...recentWorkspacePaths,
      ...effectiveSessions.flatMap((session) => session.workspacePath ? [session.workspacePath] : [])
    ]).filter((path) => !dismissedKeys.has(normalizeWorkspacePathKey(path)))
  }, [dismissedRecentWorkspacePathKeys, effectiveSessions, recentWorkspacePaths])
  const activeHistoryError = activeSession ? historyErrorsBySession[activeSession.id] : undefined
  const isSessionsSection = state.activeSection === 'sessions'
  const runningSessionIds = useMemo(() => {
    const visibleSessionIds = new Set(visibleSessions.map((session) => session.id))
    return [...new Set(Object.values(state.runsById)
      .filter((run) => run.status === 'running' && visibleSessionIds.has(run.sessionId))
      .map((run) => run.sessionId))]
  }, [state.runsById, visibleSessions])
  const activeRunId = activeSession ? state.latestRunIdBySession[activeSession.id] : undefined
  const activeRunningRunId = activeSession
    ? Object.values(state.runsById).find((run) => run.sessionId === activeSession.id && run.status === 'running')?.id
    : undefined
  const activeSteps = activeRunId ? state.stepsByRun[activeRunId] ?? [] : []
  const activeStreamingText = activeRunId ? state.streamingByRun[activeRunId] ?? '' : ''
  const activeMessages = activeSession ? state.messagesBySession[activeSession.id] ?? [] : []
  const workerAgentView = useMemo(() => ({
    invocationsByParentStepId: Object.fromEntries(
      Object.entries(state.workerInvocationIdByParentStepId).flatMap(([stepId, invocationId]) => {
        const invocation = state.workerInvocationsById[invocationId]
        return invocation ? [[stepId, invocation] as const] : []
      })
    ) as Record<string, WorkerAgentInvocation>,
    runsById: state.runsById,
    stepsByRun: state.stepsByRun,
    messagesByRun: state.childMessagesByRun,
    streamingByRun: state.streamingByRun
  }), [state.childMessagesByRun, state.runsById, state.stepsByRun, state.streamingByRun, state.workerInvocationIdByParentStepId, state.workerInvocationsById])
  const activeModelId = activeSession ? resolveAvailableSessionModelId(activeSession.defaultModelId, sessionModelCatalog, explicitModelSelectionSessionIdsRef.current.has(activeSession.id)) : resolveAvailableSessionModelId(undefined, sessionModelCatalog)
  const activeModelConfig = sessionModelCatalog.modelsById[activeModelId]
  const activeModelCapabilities = activeModelConfig?.capabilities ?? []
  const activeModelOptions = isAvailableSessionModel(activeModelId, sessionModelCatalog) ? mergeModelOptions(sessionModelCatalog.options, [activeModelId]) : sessionModelCatalog.options
  const activeModelMissing = !isAvailableSessionModel(activeModelId, sessionModelCatalog)

  const loadGitRepositoryState = useCallback(async (sessionId: string, workspacePath: string): Promise<GitRepositoryStateDto | undefined> => {
    const requestId = (latestGitStateRequestIdRef.current[sessionId] ?? 0) + 1
    latestGitStateRequestIdRef.current = { ...latestGitStateRequestIdRef.current, [sessionId]: requestId }
    setGitUiStateBySession((current) => mergeGitUiState(current, sessionId, {
      workspacePath,
      ...(current[sessionId]?.workspacePath === workspacePath ? {} : {
        repository: undefined,
        rows: undefined,
        hasMore: undefined,
        logLimit: undefined,
        open: false,
        loadingLog: false,
        loadingMore: false,
        loadingDetailByCommit: undefined,
        selectedCommit: undefined,
        detailsByCommit: undefined
      }),
      loadingState: true,
      error: undefined
    }))

    try {
      const repository = await hesperApi.git.getState({ sessionId })
      if (latestGitStateRequestIdRef.current[sessionId] === requestId && repository.workspacePath === workspacePath) {
        setGitUiStateBySession((current) => {
          if (current[sessionId]?.workspacePath !== workspacePath) return current
          return mergeGitUiState(current, sessionId, repository.isGitRepository
            ? { repository, loadingState: false, error: undefined }
            : {
                repository,
                rows: undefined,
                hasMore: undefined,
                logLimit: undefined,
                open: false,
                loadingState: false,
                loadingLog: false,
                loadingMore: false,
                loadingDetailByCommit: undefined,
                selectedCommit: undefined,
                detailsByCommit: undefined,
                error: undefined
              })
        })
      }
      return repository.workspacePath === workspacePath ? repository : undefined
    } catch (error) {
      if (latestGitStateRequestIdRef.current[sessionId] === requestId) {
        setGitUiStateBySession((current) => {
          if (current[sessionId]?.workspacePath !== workspacePath) return current
          return mergeGitUiState(current, sessionId, {
            loadingState: false,
            error: getErrorMessage(error, 'Git 状态加载失败')
          })
        })
      }
      return undefined
    }
  }, [])

  const loadGitLog = useCallback(async (
    sessionId: string,
    limit = gitLogPageSize,
    repositoryOverride?: GitRepositoryStateDto,
    workspacePath?: string,
    options: { offset?: number; append?: boolean } = {}
  ): Promise<GitGraphRowDto[] | undefined> => {
    const expectedWorkspacePath = workspacePath ?? repositoryOverride?.workspacePath
    if (!expectedWorkspacePath) return undefined

    const offset = options.offset ?? 0
    const append = options.append === true
    const requestId = (latestGitLogRequestIdRef.current[sessionId] ?? 0) + 1
    latestGitLogRequestIdRef.current = { ...latestGitLogRequestIdRef.current, [sessionId]: requestId }
    setGitUiStateBySession((current) => {
      if (current[sessionId]?.workspacePath !== expectedWorkspacePath) return current
      return mergeGitUiState(current, sessionId, { loadingLog: !append, loadingMore: append, error: undefined })
    })

    try {
      const result = await hesperApi.git.listLog({ sessionId, limit, offset })
      if (latestGitLogRequestIdRef.current[sessionId] === requestId) {
        let mergedRows: GitGraphRowDto[] | undefined
        setGitUiStateBySession((current) => {
          const currentSessionState = current[sessionId]
          if (currentSessionState?.workspacePath !== expectedWorkspacePath) return current
          const repository = repositoryOverride ?? currentSessionState.repository
          if (repository?.workspacePath !== expectedWorkspacePath) return current
          mergedRows = append ? appendUniqueGitRows(currentSessionState.rows ?? [], result.rows) : result.rows
          return mergeGitUiState(current, sessionId, {
            rows: mergedRows,
            logLimit: result.limit,
            hasMore: result.hasMore,
            loadingLog: false,
            loadingMore: false,
            selectedCommit: selectDefaultGitCommit(repository, mergedRows, currentSessionState.selectedCommit),
            error: undefined
          })
        })
        return mergedRows
      }
      return undefined
    } catch (error) {
      if (latestGitLogRequestIdRef.current[sessionId] === requestId) {
        setGitUiStateBySession((current) => {
          if (current[sessionId]?.workspacePath !== expectedWorkspacePath) return current
          return mergeGitUiState(current, sessionId, {
            loadingLog: false,
            loadingMore: false,
            error: getErrorMessage(error, 'Git 日志加载失败')
          })
        })
      }
      return undefined
    }
  }, [])

  const refreshGitPanel = useCallback(async (sessionId: string, workspacePath: string) => {
    const repository = await loadGitRepositoryState(sessionId, workspacePath)
    if (repository?.isGitRepository && repository.workspacePath === workspacePath) {
      await loadGitLog(sessionId, gitLogPageSize, repository, workspacePath)
    }
  }, [loadGitLog, loadGitRepositoryState])

  useEffect(() => {
    const sessionId = activeSession?.id
    if (!sessionId) return

    if (!activeSession.workspacePath) {
      setGitUiStateBySession((current) => mergeGitUiState(current, sessionId, {
        workspacePath: undefined,
        repository: undefined,
        rows: undefined,
        hasMore: undefined,
        logLimit: undefined,
        open: false,
        loadingState: false,
        loadingLog: false,
        loadingMore: false,
        loadingDetailByCommit: undefined,
        selectedCommit: undefined,
        detailsByCommit: undefined,
        error: undefined
      }))
      return
    }

    setGitUiStateBySession((current) => {
      if (current[sessionId]?.workspacePath === activeSession.workspacePath) return current
      return mergeGitUiState(current, sessionId, {
        workspacePath: activeSession.workspacePath,
        repository: undefined,
        rows: undefined,
        hasMore: undefined,
        logLimit: undefined,
        open: false,
        loadingState: false,
        loadingLog: false,
        loadingMore: false,
        loadingDetailByCommit: undefined,
        selectedCommit: undefined,
        detailsByCommit: undefined,
        error: undefined
      })
    })
    void loadGitRepositoryState(sessionId, activeSession.workspacePath)
  }, [activeSession?.id, activeSession?.workspacePath, loadGitRepositoryState])

  const activeGitUiState = activeSession ? gitUiStateBySession[activeSession.id] : undefined
  const activeWorkspacePath = activeSession?.workspacePath
  const activeGitRepositoryMatches = Boolean(
    activeWorkspacePath &&
    activeGitUiState?.workspacePath === activeWorkspacePath &&
    activeGitUiState.repository?.isGitRepository &&
    activeGitUiState.repository.workspacePath === activeWorkspacePath
  )
  const activeGitSelectedCommit = activeGitRepositoryMatches ? activeGitUiState?.selectedCommit : undefined
  const activeGitDetail = activeGitSelectedCommit ? activeGitUiState?.detailsByCommit?.[activeGitSelectedCommit] : undefined
  const activeGitPanel = activeSession && activeWorkspacePath && activeGitUiState?.repository && activeGitRepositoryMatches
    ? {
        visible: true,
        open: Boolean(activeGitUiState.open),
        ...(activeGitUiState.repository.repositoryName ? { repositoryName: activeGitUiState.repository.repositoryName } : {}),
        ...(activeGitUiState.repository.currentBranch ? { currentBranch: activeGitUiState.repository.currentBranch } : {}),
        ...(activeGitUiState.repository.commitCount !== undefined ? { commitCount: activeGitUiState.repository.commitCount } : {}),
        loadedCount: activeGitUiState.rows?.length ?? 0,
        hasMore: Boolean(activeGitUiState.hasMore),
        dirty: activeGitUiState.repository.dirty,
        loading: Boolean(activeGitUiState.loadingState || (activeGitUiState.loadingLog && !(activeGitUiState.rows?.length)) || (activeGitSelectedCommit ? activeGitUiState.loadingDetailByCommit?.[activeGitSelectedCommit] : false)),
        loadingMore: Boolean(activeGitUiState.loadingMore),
        ...(activeGitUiState.error ? { error: activeGitUiState.error } : {}),
        rows: (activeGitUiState.rows ?? []).map(toGitGraphRowView),
        ...(activeGitSelectedCommit ? { selectedCommit: activeGitSelectedCommit } : {}),
        ...(activeGitDetail ? { detail: toGitCommitDetailView(activeGitDetail) } : {}),
        onOpen: () => {
          const sessionId = activeSession.id
          const workspacePath = activeWorkspacePath
          setGitUiStateBySession((current) => mergeGitUiState(current, sessionId, { workspacePath, open: true }))
          void refreshGitPanel(sessionId, workspacePath)
        },
        onClose: () => {
          const sessionId = activeSession.id
          setGitUiStateBySession((current) => mergeGitUiState(current, sessionId, { open: false }))
        },
        onSelectCommit: (commitHash: string) => {
          const sessionId = activeSession.id
          setGitUiStateBySession((current) => mergeGitUiState(current, sessionId, { selectedCommit: commitHash }))
        },
        onLoadCommitDetail: (commit: string) => {
          const sessionId = activeSession.id
          const workspacePath = activeWorkspacePath
          const currentDetail = gitUiStateBySession[sessionId]?.workspacePath === workspacePath
            ? gitUiStateBySession[sessionId]?.detailsByCommit?.[commit]
            : undefined
          setGitUiStateBySession((current) => {
            if (current[sessionId]?.workspacePath !== workspacePath) return current
            const existingDetail = current[sessionId]?.detailsByCommit?.[commit]
            return mergeGitUiState(current, sessionId, {
              selectedCommit: commit,
              ...(existingDetail ? {} : { loadingDetailByCommit: { ...current[sessionId]?.loadingDetailByCommit, [commit]: true }, error: undefined })
            })
          })
          if (currentDetail) return

          const detailRequestId = ((latestGitDetailRequestIdRef.current[sessionId]?.[commit] ?? 0) + 1)
          latestGitDetailRequestIdRef.current = {
            ...latestGitDetailRequestIdRef.current,
            [sessionId]: {
              ...latestGitDetailRequestIdRef.current[sessionId],
              [commit]: detailRequestId
            }
          }

          void hesperApi.git.getCommit({ sessionId, commit }).then((detail) => {
            if (latestGitDetailRequestIdRef.current[sessionId]?.[commit] !== detailRequestId) return
            setGitUiStateBySession((current) => {
              const currentSessionState = current[sessionId]
              if (currentSessionState?.workspacePath !== workspacePath || currentSessionState.repository?.workspacePath !== workspacePath) return current
              return mergeGitUiState(current, sessionId, {
                detailsByCommit: { ...currentSessionState.detailsByCommit, [commit]: detail },
                loadingDetailByCommit: clearGitDetailLoading(currentSessionState.loadingDetailByCommit, commit),
                error: undefined
              })
            })
          }).catch((error) => {
            if (latestGitDetailRequestIdRef.current[sessionId]?.[commit] !== detailRequestId) return
            setGitUiStateBySession((current) => {
              const currentSessionState = current[sessionId]
              if (currentSessionState?.workspacePath !== workspacePath || currentSessionState.repository?.workspacePath !== workspacePath) return current
              return mergeGitUiState(current, sessionId, {
                loadingDetailByCommit: clearGitDetailLoading(currentSessionState.loadingDetailByCommit, commit),
                error: getErrorMessage(error, 'Git 提交详情加载失败')
              })
            })
          })
        },
        onLoadMore: () => {
          const sessionId = activeSession.id
          const workspacePath = activeWorkspacePath
          const currentGitState = gitUiStateRef.current[sessionId]
          if (
            currentGitState?.workspacePath !== workspacePath ||
            currentGitState.repository?.workspacePath !== workspacePath ||
            !currentGitState.hasMore ||
            currentGitState.loadingLog ||
            currentGitState.loadingMore
          ) {
            return
          }
          void loadGitLog(sessionId, gitLogPageSize, currentGitState.repository, workspacePath, {
            offset: currentGitState.rows?.length ?? 0,
            append: true
          })
        },
        onCreateBranch: (commit: string) => {
          const sessionId = activeSession.id
          const workspacePath = activeWorkspacePath
          const branchName = window.prompt?.('输入新分支名称', '')?.trim()
          if (!branchName) return
          void hesperApi.git.createBranch({ sessionId, commit, branchName }).then(async (result) => {
            if (!result.success) {
              setGitUiStateBySession((current) => current[sessionId]?.workspacePath === workspacePath
                ? mergeGitUiState(current, sessionId, { error: result.message ?? 'Git 分支创建失败' })
                : current)
              return
            }
            if (gitUiStateRef.current[sessionId]?.workspacePath === workspacePath) {
              await refreshGitPanel(sessionId, workspacePath)
            }
          }).catch((error) => {
            setGitUiStateBySession((current) => current[sessionId]?.workspacePath === workspacePath
              ? mergeGitUiState(current, sessionId, { error: getErrorMessage(error, 'Git 分支创建失败') })
              : current)
          })
        },
        onCreateTag: (commit: string) => {
          const sessionId = activeSession.id
          const workspacePath = activeWorkspacePath
          const tagName = window.prompt?.('输入标签名称', '')?.trim()
          if (!tagName) return
          void hesperApi.git.createTag({ sessionId, commit, tagName }).then(async (result) => {
            if (!result.success) {
              setGitUiStateBySession((current) => current[sessionId]?.workspacePath === workspacePath
                ? mergeGitUiState(current, sessionId, { error: result.message ?? 'Git 标签创建失败' })
                : current)
              return
            }
            if (gitUiStateRef.current[sessionId]?.workspacePath === workspacePath) {
              await refreshGitPanel(sessionId, workspacePath)
            }
          }).catch((error) => {
            setGitUiStateBySession((current) => current[sessionId]?.workspacePath === workspacePath
              ? mergeGitUiState(current, sessionId, { error: getErrorMessage(error, 'Git 标签创建失败') })
              : current)
          })
        },
        onCheckout: (ref: string) => {
          const sessionId = activeSession.id
          const workspacePath = activeWorkspacePath
          const promptValue = window.prompt?.('输入要检出的 ref', ref)
          if (promptValue == null) return
          const checkoutRef = promptValue.trim()
          if (!checkoutRef) return
          void hesperApi.git.checkout({ sessionId, ref: checkoutRef }).then(async (result) => {
            if (!result.success) {
              setGitUiStateBySession((current) => current[sessionId]?.workspacePath === workspacePath
                ? mergeGitUiState(current, sessionId, { error: result.message ?? 'Git 检出失败' })
                : current)
              return
            }
            if (gitUiStateRef.current[sessionId]?.workspacePath === workspacePath) {
              await refreshGitPanel(sessionId, workspacePath)
            }
          }).catch((error) => {
            setGitUiStateBySession((current) => current[sessionId]?.workspacePath === workspacePath
              ? mergeGitUiState(current, sessionId, { error: getErrorMessage(error, 'Git 检出失败') })
              : current)
          })
        },
        onCopyCommitId: (commitHash: string) => {
          void navigator.clipboard?.writeText?.(commitHash).catch(() => undefined)
        }
      } satisfies ConversationGitPanelProps
    : undefined

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

  const mergeSavedRole = (roleList: ManagedRoleDto[], savedRole: ManagedRoleDto) => {
    const hasRole = roleList.some((candidate) => candidate.id === savedRole.id)
    return hasRole
      ? roleList.map((candidate) => candidate.id === savedRole.id ? savedRole : candidate)
      : [savedRole, ...roleList]
  }

  const saveRole = async (role: ManagedRoleDto) => {
    setRolesPending(true)
    invalidateRolesRequests()
    setRolesError(undefined)
    try {
      const savedRole = await hesperApi.roles.update({
        id: role.id,
        name: role.name,
        description: role.description,
        systemPrompt: role.systemPrompt,
        defaultToolIds: role.defaultToolIds,
        defaultModelId: role.defaultModelId,
        ...(role.defaultModelRef ? { defaultModelRef: { ...role.defaultModelRef } } : {})
      })
      const result = await loadRoles()
      if (result.applied && !('error' in result)) {
        setRoles(mergeSavedRole(result.loadedRoles, savedRole))
      } else {
        setRoles((current) => mergeSavedRole(current, savedRole))
      }
      setActiveRoleId(savedRole.id)
    } catch (error) {
      setRolesError(error instanceof Error ? error.message : '未知角色保存错误')
    } finally {
      setRolesPending(false)
    }
  }

  const normalizeRoleActionIds = (roleId: string, roleIds?: string[]): string[] => {
    const requestedIds = roleIds?.length ? roleIds : [roleId]
    const requestedIdSet = new Set(requestedIds)
    const orderedIds = roles.flatMap((role) => requestedIdSet.has(role.id) ? [role.id] : [])
    return orderedIds.length > 0 ? orderedIds : [roleId]
  }

  const confirmRoleDeletion = (roleIds: string[]): boolean => {
    if (roleIds.length === 1) {
      const roleName = roles.find((role) => role.id === roleIds[0])?.name ?? roleIds[0]
      return window.confirm(`确定要删除角色“${roleName}”吗？`)
    }

    return window.confirm(`确定要删除选中的 ${roleIds.length} 个角色吗？`)
  }

  const resolveActiveRoleIdAfterDelete = (nextRoles: ManagedRoleDto[], deletedRoleIdSet: Set<string>, previousActiveRoleId?: string) => (
    previousActiveRoleId && !deletedRoleIdSet.has(previousActiveRoleId) && nextRoles.some((role) => role.id === previousActiveRoleId)
      ? previousActiveRoleId
      : nextRoles[0]?.id
  )

  const deleteRoleIds = async (roleIds: string[]) => {
    if (roleIds.length === 0) return

    const successfullyDeletedIds: string[] = []
    const previousActiveRoleId = activeRoleId
    const applyDeletedRoleState = (nextRoles: ManagedRoleDto[], deletedRoleIdSet: Set<string>) => {
      setRoles(nextRoles)
      setActiveRoleId(resolveActiveRoleIdAfterDelete(nextRoles, deletedRoleIdSet, previousActiveRoleId))
    }

    setRolesPending(true)
    invalidateRolesRequests()
    setRolesError(undefined)
    try {
      for (const roleId of roleIds) {
        await hesperApi.roles.delete(roleId)
        successfullyDeletedIds.push(roleId)
      }
      const deletedRoleIdSet = new Set(successfullyDeletedIds)
      const result = await loadRoles()
      const nextRoles = result.applied && !('error' in result)
        ? result.loadedRoles
        : roles.filter((role) => !deletedRoleIdSet.has(role.id))
      applyDeletedRoleState(nextRoles, deletedRoleIdSet)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知角色删除错误'
      const deletedRoleIdSet = new Set(successfullyDeletedIds)
      setRolesError(message)

      const result = await loadRoles()
      const nextRoles = result.applied && !('error' in result)
        ? result.loadedRoles
        : roles.filter((role) => !deletedRoleIdSet.has(role.id))
      applyDeletedRoleState(nextRoles, deletedRoleIdSet)
      setRolesError(message)
    } finally {
      setRolesPending(false)
    }
  }

  const deleteRole = async (roleId: string) => {
    await deleteRoleIds(normalizeRoleActionIds(roleId, [roleId]))
  }

  const deleteRoles = async (roleId: string, roleIds?: string[]) => {
    if (rolesLoading || rolesPending) return

    const targetRoleIds = normalizeRoleActionIds(roleId, roleIds)
    if (!confirmRoleDeletion(targetRoleIds)) return

    await deleteRoleIds(targetRoleIds)
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

  const saveToolApiKey = async (toolId: string, apiKey: string) => {
    setToolsError(undefined)
    setPendingToolCredentialIds((current) => new Set(current).add(toolId))
    try {
      const status = await hesperApi.tools.saveApiKey({ toolId, apiKey })
      const loadedTools = await hesperApi.tools.list()
      setToolCredentialStatuses((current) => ({ ...current, [toolId]: status }))
      setTools(loadedTools)
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : '未知工具 API key 保存错误')
    } finally {
      setPendingToolCredentialIds((current) => {
        const next = new Set(current)
        next.delete(toolId)
        return next
      })
    }
  }

  const deleteToolApiKey = async (toolId: string) => {
    setToolsError(undefined)
    setPendingToolCredentialIds((current) => new Set(current).add(toolId))
    try {
      const status = await hesperApi.tools.deleteApiKey({ toolId })
      const loadedTools = await hesperApi.tools.list()
      setToolCredentialStatuses((current) => ({ ...current, [toolId]: status }))
      setTools(loadedTools)
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : '未知工具 API key 删除错误')
    } finally {
      setPendingToolCredentialIds((current) => {
        const next = new Set(current)
        next.delete(toolId)
        return next
      })
    }
  }

  const createSshKey = async (input: CreateSshKeyInput) => {
    setSshError(undefined)
    setSshPending(true)
    try {
      await hesperApi.sshKeys.create(input)
      await loadSshKeys()
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 密钥保存错误')
    } finally {
      setSshPending(false)
    }
  }

  const deleteSshKey = async (keyId: string) => {
    const key = sshKeys.find((candidate) => candidate.id === keyId)
    if (!window.confirm(`删除 SSH 密钥 ${key?.name ?? keyId}？`)) return
    setSshError(undefined)
    setSshPending(true)
    try {
      await hesperApi.sshKeys.delete(keyId)
      await loadSshConfiguration()
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 密钥删除错误')
    } finally {
      setSshPending(false)
    }
  }

  const createSshServer = async (input: CreateSshServerInput) => {
    setSshError(undefined)
    setSshPending(true)
    try {
      await hesperApi.sshServers.create(input)
      await loadSshServers()
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 服务器保存错误')
    } finally {
      setSshPending(false)
    }
  }

  const updateSshServer = async (input: UpdateSshServerInput) => {
    setSshError(undefined)
    setSshPending(true)
    try {
      await hesperApi.sshServers.update(input)
      await loadSshServers()
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 服务器更新错误')
    } finally {
      setSshPending(false)
    }
  }

  const deleteSshServer = async (serverId: string) => {
    const server = sshServers.find((candidate) => candidate.id === serverId)
    if (!window.confirm(`删除 SSH 服务器 ${server?.name ?? serverId}？`)) return
    setSshError(undefined)
    setSshPending(true)
    try {
      await hesperApi.sshServers.delete(serverId)
      await loadSshServers()
    } catch (error) {
      setSshError(error instanceof Error ? error.message : '未知 SSH 服务器删除错误')
    } finally {
      setSshPending(false)
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

    const [messages, runs] = await Promise.all([
      hesperApi.conversation.listMessages(sessionId),
      hesperApi.conversation.listRuns(sessionId)
    ])
    dispatch({ type: 'history.loaded', sessionId, messages, runs, stepsByRun: {} })
    const childRunIds = new Set(runs.filter((run) => run.parentRunId).map((run) => run.id))
    const mainMessages = messages.filter((message) => !message.runId || !childRunIds.has(message.runId))
    return latestTitleSource(mainMessages)
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
      const sessionModelId = resolveTitleGenerationModelId(session.defaultModelId, sessionModelCatalog, explicitModelSelectionSessionIdsRef.current.has(session.id))
      const modelId = latestRunId ? runModelIdsRef.current[latestRunId] ?? sessionModelId : sessionModelId
      const modelError = titleGenerationModelError(modelId, sessionModelCatalog)
      if (modelError) {
        setTitleGenerationError(`标题生成失败：${modelError}`)
        return
      }
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

    dispatch({ type: 'session.updated', session: { ...session, status: 'deleted', updatedAt: new Date().toISOString() } })

    try {
      const updatedSession = await hesperApi.sessions.delete(session.id)
      dispatch({ type: 'session.updated', session: updatedSession })
    } catch (error) {
      console.warn('Failed to delete session', session.id, error)
      try {
        const sessions = await hesperApi.sessions.list()
        dispatch({ type: 'sessions.loaded', sessions })
      } catch (reloadError) {
        console.warn('Failed to reload sessions after delete failure', session.id, reloadError)
        dispatch({ type: 'session.updated', session })
      }
    }
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
    const targetSessionIds = normalizeSessionActionIds(sessionId, sessionIds)
    if (targetSessionIds.length === 1) {
      await deleteSession(targetSessionIds[0]!)
      return
    }

    const targetIdSet = new Set(targetSessionIds)
    const failedSessionSnapshots = stateRef.current.sessions.filter((session) => targetIdSet.has(session.id))
    dispatch({ type: 'sessions.deleted', sessionIds: targetSessionIds })

    const results = await Promise.allSettled(targetSessionIds.map((targetSessionId) => hesperApi.sessions.delete(targetSessionId)))
    const failedSessionIds: string[] = []
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        const targetSessionId = targetSessionIds[index]!
        failedSessionIds.push(targetSessionId)
        console.warn('Failed to delete session', targetSessionId, result.reason)
      }
    }

    if (failedSessionIds.length === 0) return

    try {
      const sessions = await hesperApi.sessions.list()
      dispatch({ type: 'sessions.loaded', sessions })
    } catch (reloadError) {
      console.warn('Failed to reload sessions after delete failure', failedSessionIds, reloadError)
      const failedIdSet = new Set(failedSessionIds)
      for (const session of failedSessionSnapshots) {
        if (failedIdSet.has(session.id)) dispatch({ type: 'session.updated', session })
      }
    }
  }

  const createSessionCategory = async () => {
    try {
      const category = await hesperApi.sessionCategories.create({ name: '新分类' })
      dispatch({ type: 'sessionCategory.created', category, select: false })
      return category
    } catch (error) {
      console.warn('Failed to create session category', error)
      return undefined
    }
  }

  const renameSessionCategory = async (categoryId: string, name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) return

    try {
      const category = await hesperApi.sessionCategories.update({ id: categoryId, name: trimmedName })
      dispatch({ type: 'sessionCategory.updated', category })
    } catch (error) {
      console.warn('Failed to rename session category', error)
    }
  }

  const deleteSessionCategory = async (categoryId: string) => {
    const category = stateRef.current.sessionCategories.find((candidate) => candidate.id === categoryId)
    if (!category) return

    const sessionCount = stateRef.current.sessions.filter((session) => session.categoryId === categoryId).length
    const confirmed = window.confirm(`删除分类“${category.name}”？该分类下的 ${sessionCount} 个会话也会被删除，此操作不可撤销。`)
    if (!confirmed) return

    try {
      const result = await hesperApi.sessionCategories.delete(categoryId)
      dispatch({ type: 'sessionCategory.deleted', categoryId, deletedSessionIds: result.deletedSessionIds })
    } catch (error) {
      console.warn('Failed to delete session category', error)
    }
  }

  const discardSessionCategory = async (categoryId: string) => {
    try {
      const result = await hesperApi.sessionCategories.delete(categoryId)
      dispatch({ type: 'sessionCategory.deleted', categoryId, deletedSessionIds: result.deletedSessionIds })
    } catch (error) {
      console.warn('Failed to discard session category', error)
    }
  }

  const setSessionCategory = async (_sessionId: string, sessionIds: string[] | undefined, categoryId?: string) => {
    const ids = sessionIds?.length ? sessionIds : [_sessionId]

    try {
      const updatedSessions = await hesperApi.sessions.setCategory({ ids, categoryId })
      for (const session of updatedSessions) {
        dispatch({ type: 'session.updated', session })
      }
    } catch (error) {
      console.warn('Failed to set session category', error)
    }
  }

  const archiveSessions = async (sessionId: string, sessionIds?: string[]) => {
    const targetSessionIds = normalizeSessionActionIds(sessionId, sessionIds)
    for (const targetSessionId of targetSessionIds) {
      try {
        const updatedSession = await hesperApi.sessions.archive(targetSessionId)
        dispatch({ type: 'session.updated', session: updatedSession })
      } catch (error) {
        console.warn('Failed to archive session', targetSessionId, error)
      }
    }
  }

  const restoreSessions = async (sessionId: string, sessionIds?: string[]) => {
    const targetSessionIds = normalizeSessionActionIds(sessionId, sessionIds)
    for (const targetSessionId of targetSessionIds) {
      try {
        const updatedSession = await hesperApi.sessions.restore(targetSessionId)
        dispatch({ type: 'session.updated', session: updatedSession })
      } catch (error) {
        console.warn('Failed to restore session', targetSessionId, error)
      }
    }
  }

  const setSessionsMarked = async (_sessionId: string, sessionIds: string[] | undefined, isMarked: boolean) => {
    const ids = sessionIds?.length ? sessionIds : [_sessionId]
    try {
      const updatedSessions = await hesperApi.sessions.setMarked({ ids, isMarked })
      for (const session of updatedSessions) {
        dispatch({ type: 'session.updated', session })
      }
    } catch (error) {
      console.warn('Failed to set session marked state', error)
    }
  }

  const createTrackedSession = async () => {
    const categoryId = stateRef.current.activeSessionSpecialView ? undefined : stateRef.current.activeSessionCategoryId
    const session = await createSession(dispatch, defaultFallbackModelId, categoryId)
    createdNewSessionIdsRef.current.add(session.id)
  }

  const shouldDeleteEmptyNewSession = (sessionId: string, nextSessionId: string): boolean => {
    if (sessionId === nextSessionId || !createdNewSessionIdsRef.current.has(sessionId)) return false
    const session = stateRef.current.sessions.find((candidate) => candidate.id === sessionId)
    if (!session || session.title !== 'New chat') return false
    const hasMessages = (stateRef.current.messagesBySession[sessionId] ?? []).length > 0
    const hasDraft = (draftsBySession[sessionId] ?? '').trim().length > 0
    const hasDraftSkillMentions = (draftSkillMentionsBySession[sessionId] ?? []).length > 0
    const hasDraftAttachments = (draftAttachmentsBySession[sessionId] ?? []).length > 0
    const hasLatestRun = Boolean(stateRef.current.latestRunIdBySession[sessionId])
    const hasRun = Object.values(stateRef.current.runsById).some((run) => run.sessionId === sessionId)
    return !hasMessages && !hasDraft && !hasDraftSkillMentions && !hasDraftAttachments && !hasLatestRun && !hasRun
  }

  const deleteEmptyNewSessionBeforeSwitch = async (nextSessionId: string) => {
    const previousSessionId = stateRef.current.activeSessionId
    if (!previousSessionId || !shouldDeleteEmptyNewSession(previousSessionId, nextSessionId)) return

    try {
      await deleteSession(previousSessionId)
      createdNewSessionIdsRef.current.delete(previousSessionId)
    } catch (error) {
      console.warn('Failed to delete empty new session', error)
    }
  }

  const selectSession = async (sessionId: string) => {
    await deleteEmptyNewSessionBeforeSwitch(sessionId)
    dispatch({ type: 'section.selected', section: 'sessions' })
    dispatch({ type: 'session.selected', sessionId })
    void markSessionViewed(sessionId)
  }

  return (
    <AppShell
      sessions={visibleSessions}
      sessionScopeSourceSessions={effectiveSessions}
      activeSection={state.activeSection}
      title={isSessionsSection ? activeSessionListTitle === '所有会话' ? activeSession?.title ?? '新建会话' : activeSessionListTitle : getSectionTitle(state.activeSection)}
      brandName={appBrandName}
      {...(isSessionsSection ? { entityListTitle: activeSessionListTitle } : {})}
      platform={hesperApi.window.platform}
      appearance={{ themeId: appSettings.themeId, themeMode: requestedThemeMode, fontSize: appSettings.fontSize }}
      activeSettingsCategory={activeSettingsCategory}
      runningSessionIds={runningSessionIds}
      sessionCategories={state.sessionCategories}
      sessionsExpanded
      tools={tools}
      pendingToolIds={pendingToolIdList}
      roles={roles.map((role) => ({ id: role.id, name: role.name, description: role.description }))}
      skills={skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        ...(skill.description !== undefined ? { description: skill.description } : {})
      }))}
      roleSelectionDisabled={rolesLoading || rolesPending}
      {...(activeTool ? { activeToolId: activeTool.id } : {})}
      {...(activeRoleId ? { activeRoleId } : {})}
      {...(activeSkillId ? { activeSkillId } : {})}
      {...(state.activeSessionId ? { activeSessionId: state.activeSessionId } : {})}
      {...(state.activeSessionCategoryId ? { activeSessionCategoryId: state.activeSessionCategoryId } : {})}
      {...(state.activeSessionSpecialView ? { activeSessionSpecialView: state.activeSessionSpecialView } : {})}
      onCreateSession={async () => {
        dispatch({ type: 'section.selected', section: 'sessions' })
        if (stateRef.current.activeSessionSpecialView) {
          dispatch({ type: 'sessionCategory.selected' })
        }
        await createTrackedSession()
      }}
      onSelectSection={(section) => dispatch({ type: 'section.selected', section })}
      onSelectSessionCategory={(categoryId) => dispatch(categoryId ? { type: 'sessionCategory.selected', categoryId } : { type: 'sessionCategory.selected' })}
      onSelectSessionSpecialView={(view) => dispatch({ type: 'sessionSpecialView.selected', view })}
      onCreateSessionCategory={createSessionCategory}
      onRenameSessionCategory={renameSessionCategory}
      onDeleteSessionCategory={(categoryId) => {
        void deleteSessionCategory(categoryId)
      }}
      onDiscardSessionCategory={(categoryId) => {
        void discardSessionCategory(categoryId)
      }}
      onSetSessionCategory={(sessionId, sessionIds, categoryId) => {
        void setSessionCategory(sessionId, sessionIds, categoryId)
      }}
      onArchiveSession={(sessionId, sessionIds) => {
        void archiveSessions(sessionId, sessionIds)
      }}
      onRestoreSession={(sessionId, sessionIds) => {
        void restoreSessions(sessionId, sessionIds)
      }}
      onSetSessionMarked={(sessionId, sessionIds, isMarked) => {
        void setSessionsMarked(sessionId, sessionIds, isMarked)
      }}
      onSelectSettingsCategory={setActiveSettingsCategory}
      onSelectTool={setActiveToolId}
      onToggleToolEnabled={(toolId, enabled) => {
        void updateToolEnabled(toolId, enabled)
      }}
      onSelectRole={(roleId) => {
        if (rolesLoading || rolesPending) return
        setRolesError(undefined)
        setActiveRoleId(roleId)
      }}
      onSelectSkill={(skillId) => {
        setSkillsError(undefined)
        setActiveSkillId(skillId)
      }}
      onSelectSession={(sessionId) => {
        void selectSession(sessionId)
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
      onDeleteRole={(roleId, roleIds) => {
        void deleteRoles(roleId, roleIds)
      }}
      onWindowMinimize={() => hesperApi.window.minimize()}
      onWindowToggleMaximize={() => hesperApi.window.toggleMaximize()}
      onWindowClose={() => hesperApi.window.close()}
    >
      {!isSessionsSection ? (
        state.activeSection === 'settings' ? (
          activeSettingsCategory === 'appearance' ? (
            <AppearanceSettingsPanel settings={appSettings} {...(settingsError ? { error: settingsError } : {})} onUpdate={updateAppSettings} />
          ) : activeSettingsCategory === 'ssh' ? (
            <SshSettingsPanel
              keys={sshKeys}
              servers={sshServers}
              pending={sshPending}
              {...(sshError ? { error: sshError } : {})}
              onCreateKey={createSshKey}
              onDeleteKey={deleteSshKey}
              onCreateServer={createSshServer}
              onUpdateServer={updateSshServer}
              onDeleteServer={deleteSshServer}
            />
          ) : activeSettingsCategory === 'soul' ? (
            <SoulSettingsPanel settings={appSettings} {...(settingsError ? { error: settingsError } : {})} onUpdate={updateAppSettings} />
          ) : (
            <ProviderSettingsPanel onModelRegistryChanged={refreshSessionModelOptions} />
          )
        ) : state.activeSection === 'skills' ? (
          <SkillsPanel
            skills={skills}
            {...(activeSkill ? { selectedSkill: activeSkill } : {})}
            loading={skillsLoading}
            {...(skillsError ? { error: skillsError } : {})}
          />
        ) : state.activeSection === 'roles' ? (
          <RolesPanel
            roles={roles}
            {...(activeRole ? { selectedRole: activeRole } : {})}
            tools={tools}
            modelOptions={sessionModelCatalog.options}
            modelOptionGroups={sessionModelCatalog.optionGroups}
            pending={rolesPending || rolesLoading}
            loading={rolesLoading}
            {...(rolesError ? { error: rolesError } : {})}
            onSave={(role) => { void saveRole(role) }}
            onDelete={(roleId) => { void deleteRole(roleId) }}
          />
        ) : state.activeSection === 'tools' ? (
          <ToolDetailsPanel
            {...(activeTool ? { tool: activeTool } : {})}
            pending={activeTool ? pendingToolIds.has(activeTool.id) : false}
            credentialPending={activeTool ? pendingToolCredentialIds.has(activeTool.id) : false}
            {...(activeToolCredentialStatus ? { credentialStatus: activeToolCredentialStatus } : {})}
            {...(toolsError ? { error: toolsError } : {})}
            onToggle={(enabled) => {
              if (activeTool) void updateToolEnabled(activeTool.id, enabled)
            }}
            onSaveApiKey={(apiKey) => {
              if (activeTool) void saveToolApiKey(activeTool.id, apiKey)
            }}
            onDeleteApiKey={() => {
              if (activeTool) void deleteToolApiKey(activeTool.id)
            }}
          />
        ) : <SectionPlaceholder section={state.activeSection} />
      ) : activeSession ? (
        <>
          {titleGenerationError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: themeTokens.color.danger, padding: '0 12px' }}>
              {titleGenerationError}
            </p>
          ) : null}
          {activeHistoryError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: themeTokens.color.danger, padding: '0 12px' }}>
              历史加载失败：{activeHistoryError}
            </p>
          ) : null}
          {activeSendError ? (
            <p role="alert" style={{ margin: '0 0 12px', color: themeTokens.color.danger, padding: '0 12px' }}>
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
            workerAgentView={workerAgentView}
            modelId={activeModelId}
            modelOptions={activeModelOptions}
            modelOptionGroups={sessionModelCatalog.optionGroups}
            modelCapabilities={activeModelCapabilities}
            skillOptions={skills.map(toSkillOption)}
            sendDisabled={activeModelMissing}
            sendDisabledReason="未配置模型"
            draftValue={draftsBySession[activeSession.id] ?? ''}
            draftSkillMentions={draftSkillMentionsBySession[activeSession.id] ?? []}
            draftAttachments={draftAttachmentsBySession[activeSession.id] ?? []}
            running={Boolean(activeRunningRunId)}
            loadLocalFilePreview={(path) => hesperApi.files.preview({ sessionId: activeSession.id, path })}
            loadAttachmentDataUrl={loadAttachmentDataUrl}
            onDraftChange={(value) => {
              setDraftsBySession((current) => ({ ...current, [activeSession.id]: value }))
            }}
            onDraftSkillMentionsChange={(mentions) => {
              setDraftSkillMentionsBySession((current) => {
                if (mentions.length === 0) {
                  const next = { ...current }
                  delete next[activeSession.id]
                  return next
                }
                return { ...current, [activeSession.id]: mentions }
              })
            }}
            onDraftAttachmentsChange={(attachments) => {
              setDraftAttachmentsBySession((current) => {
                if (attachments.length === 0) {
                  const next = { ...current }
                  delete next[activeSession.id]
                  return next
                }
                return { ...current, [activeSession.id]: attachments }
              })
            }}
            onStop={() => {
              if (!activeRunningRunId) return
              void stopActiveRun({ sessionId: activeSession.id, runId: activeRunningRunId, setSendErrorsBySession })
            }}
            recentWorkspacePaths={visibleRecentWorkspacePaths}
            onSelectWorkspace={() => {
              void updateSessionWorkspace({
                session: activeSession,
                dispatch,
                setPendingSettingsBySession,
                createRequestToken: createSettingsRequestToken,
                isLatestRequest: isLatestSettingsRequest,
                clearLatestRequest: clearLatestSettingsRequest,
                onWorkspaceSaved: (workspacePath) => {
                  setRecentWorkspacePaths((current) => addRecentWorkspacePath(current, workspacePath))
                  setDismissedRecentWorkspacePathKeys((current) => removeDismissedRecentWorkspacePathKey(current, workspacePath))
                }
              })
            }}
            onSelectRecentWorkspace={(workspacePath) => {
              void setSessionWorkspace({
                session: activeSession,
                workspacePath,
                dispatch,
                setPendingSettingsBySession,
                createRequestToken: createSettingsRequestToken,
                isLatestRequest: isLatestSettingsRequest,
                clearLatestRequest: clearLatestSettingsRequest,
                onWorkspaceSaved: (savedPath) => {
                  setRecentWorkspacePaths((current) => addRecentWorkspacePath(current, savedPath))
                  setDismissedRecentWorkspacePathKeys((current) => removeDismissedRecentWorkspacePathKey(current, savedPath))
                }
              })
            }}
            onRemoveRecentWorkspace={(workspacePath) => {
              setRecentWorkspacePaths((current) => removeRecentWorkspacePath(current, workspacePath))
              setDismissedRecentWorkspacePathKeys((current) => addDismissedRecentWorkspacePathKey(current, workspacePath))
            }}
            onModelChange={(modelId) => {
              if (!isAvailableSessionModel(modelId, sessionModelCatalog)) {
                setSendErrorsBySession((current) => ({
                  ...current,
                  [activeSession.id]: unavailableModelMessage(modelId)
                }))
                return
              }
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
            onSend={(content, sendOptions) => {
              if (activeModelMissing) {
                setSendErrorsBySession((current) => ({ ...current, [activeSession.id]: '未配置模型' }))
                return
              }
              pendingTitlePromptsBySessionRef.current[activeSession.id] = content
              void sendMessage({
                session: activeSession,
                modelId: activeModelId,
                content,
                modelCapabilities: activeModelCapabilities,
                modelCatalog: sessionModelCatalog,
                ...(sendOptions ? { sendOptions } : {}),
                dispatch,
                setSendErrorsBySession,
                setDraftAttachmentsBySession
              })
            }}
            onRetryRun={(message, run) => {
              retryFailedRun({
                session: activeSession,
                message,
                run,
                pendingTitlePromptsBySessionRef,
                modelCatalog: sessionModelCatalog,
                dispatch,
                setSendErrorsBySession
              })
            }}
            {...(activeGitPanel ? { gitPanel: activeGitPanel } : {})}
            {...(shortcutCommand ? { shortcutCommand } : {})}
          />
        </>
      ) : (
        <EmptyConversationState
          {...(loadError ? { loadError } : {})}
          onCreateSession={async () => {
            if (stateRef.current.activeSessionSpecialView) {
              dispatch({ type: 'sessionCategory.selected' })
            }
            await createTrackedSession()
          }}
        />
      )}
    </AppShell>
  )
}

const sectionTitles: Record<AppSection, string> = {
  sessions: '所有会话',
  skills: '技能',
  roles: '角色',
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
    ...(patch.themeId !== undefined ? { themeId: patch.themeId } : {}),
    ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
    ...(patch.soul !== undefined ? { soul: patch.soul } : {})
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

function isAvailableSessionModel(modelId: string | undefined, catalog: SessionModelCatalog): boolean {
  const normalizedModelId = modelId?.trim() ?? ''
  return Boolean(normalizedModelId && !isLegacyFallbackModelId(normalizedModelId) && catalog.modelsById[normalizedModelId])
}

function unavailableModelMessage(modelId: string | undefined): string {
  const normalizedModelId = modelId?.trim() ?? ''
  return normalizedModelId ? `模型不可用：${normalizedModelId}` : '未配置模型'
}

function titleGenerationModelError(modelId: string | undefined, catalog: SessionModelCatalog): string | undefined {
  const normalizedModelId = modelId?.trim() ?? ''
  if (!normalizedModelId || isLegacyFallbackModelId(normalizedModelId)) {
    return '未配置模型'
  }
  return catalog.modelsById[normalizedModelId] ? undefined : `模型不可用：${normalizedModelId}`
}

function resolveTitleGenerationModelId(sessionModelId: string | undefined, catalog: SessionModelCatalog, useSessionModelId = false): string {
  const normalizedSessionModelId = sessionModelId?.trim() ?? ''
  const preferredModelId = isAvailableSessionModel(catalog.preferredModelId, catalog) ? catalog.preferredModelId.trim() : defaultFallbackModelId

  if (useSessionModelId) {
    return normalizedSessionModelId
  }

  if (!normalizedSessionModelId || normalizedSessionModelId === defaultFallbackModelId || isLegacyFallbackModelId(normalizedSessionModelId)) {
    return preferredModelId
  }

  return normalizedSessionModelId
}

function resolveAvailableSessionModelId(sessionModelId: string | undefined, catalog: SessionModelCatalog, useSessionModelId = false): string {
  const normalizedSessionModelId = sessionModelId?.trim() ?? ''
  const preferredModelId = isAvailableSessionModel(catalog.preferredModelId, catalog) ? catalog.preferredModelId.trim() : defaultFallbackModelId

  if (useSessionModelId) {
    return isAvailableSessionModel(normalizedSessionModelId, catalog) ? normalizedSessionModelId : defaultFallbackModelId
  }

  if (!normalizedSessionModelId || normalizedSessionModelId === defaultFallbackModelId || isLegacyFallbackModelId(normalizedSessionModelId)) {
    return preferredModelId
  }

  return isAvailableSessionModel(normalizedSessionModelId, catalog) ? normalizedSessionModelId : defaultFallbackModelId
}

function resolveSessionModelId(sessionModelId: string | undefined, preferredModelId: string, useSessionModelId = false): string {
  if (useSessionModelId && sessionModelId) {
    return sessionModelId
  }
  if (!sessionModelId || sessionModelId === defaultFallbackModelId || isLegacyFallbackModelId(sessionModelId)) {
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
        border: `1px solid ${themeTokens.color.border}`,
        borderRadius: 14,
        background: themeTokens.color.surfaceMuted,
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
          <p role="alert" style={{ margin: '12px 0 0', color: themeTokens.color.danger }}>
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

async function createSession(dispatch: ReturnType<typeof useAppStore>['dispatch'], defaultModelId = defaultFallbackModelId, categoryId?: string): Promise<Session> {
  const session = await hesperApi.sessions.create({
    title: 'New chat',
    ...(defaultModelId !== defaultFallbackModelId ? { defaultModelId } : {}),
    ...(categoryId ? { categoryId } : {})
  })
  dispatch({ type: 'session.created', session })
  return session
}

async function updateSessionWorkspace({
  session,
  dispatch,
  setPendingSettingsBySession,
  createRequestToken,
  isLatestRequest,
  clearLatestRequest,
  onWorkspaceSaved
}: {
  session: Pick<Session, 'id' | 'workspacePath'>
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
  createRequestToken: (sessionId: string, field: SessionSettingsField) => number
  isLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => boolean
  clearLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => void
  onWorkspaceSaved?: (workspacePath: string) => void
}) {
  const result = await hesperApi.dialog.selectDirectory()
  if (result.canceled || !result.path) {
    return
  }

  await setSessionWorkspace({
    session,
    workspacePath: result.path,
    dispatch,
    setPendingSettingsBySession,
    createRequestToken,
    isLatestRequest,
    clearLatestRequest,
    ...(onWorkspaceSaved ? { onWorkspaceSaved } : {})
  })
}

async function setSessionWorkspace({
  session,
  workspacePath,
  dispatch,
  setPendingSettingsBySession,
  createRequestToken,
  isLatestRequest,
  clearLatestRequest,
  onWorkspaceSaved
}: {
  session: Pick<Session, 'id' | 'workspacePath'>
  workspacePath: string
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setPendingSettingsBySession: Dispatch<SetStateAction<Record<string, SessionSettingsOverride>>>
  createRequestToken: (sessionId: string, field: SessionSettingsField) => number
  isLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => boolean
  clearLatestRequest: (sessionId: string, field: SessionSettingsField, requestId: number) => void
  onWorkspaceSaved?: (workspacePath: string) => void
}) {
  const requestId = createRequestToken(session.id, 'workspacePath')
  setPendingSettingsBySession((current) => mergeSessionOverride(current, session.id, { workspacePath }))

  try {
    const updatedSession = await hesperApi.sessions.setWorkspace({ id: session.id, workspacePath })
    if (!isLatestRequest(session.id, 'workspacePath', requestId)) {
      return
    }
    dispatch({ type: 'session.updated', session: updatedSession })
    onWorkspaceSaved?.(updatedSession.workspacePath ?? workspacePath)
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

async function stopActiveRun({
  sessionId,
  runId,
  setSendErrorsBySession
}: {
  sessionId: string
  runId: string
  setSendErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>
}) {
  setSendErrorsBySession((current) => clearSessionSendError(current, sessionId))
  try {
    await hesperApi.agent.stop(runId)
  } catch (error) {
    setSendErrorsBySession((current) => ({
      ...current,
      [sessionId]: `停止失败：${error instanceof Error ? error.message : 'unknown stop error'}`
    }))
  }
}

function retryFailedRun({
  session,
  message,
  run,
  pendingTitlePromptsBySessionRef,
  modelCatalog,
  dispatch,
  setSendErrorsBySession
}: {
  session: Pick<Session, 'id' | 'workspacePath' | 'updatedAt'>
  message: Message
  run: AgentRun
  pendingTitlePromptsBySessionRef: { current: Record<string, string> }
  modelCatalog: SessionModelCatalog
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setSendErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>
}) {
  pendingTitlePromptsBySessionRef.current[session.id] = message.content
  void sendMessage({
    session,
    modelId: run.modelId,
    content: message.content,
    modelCatalog,
    dispatch,
    setSendErrorsBySession
  })
}

const persistedMessageRefreshRetryDelaysMs = [0, 25, 100] as const

function waitForRetryDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function replaceOptimisticMessageWithPersistedMessage({
  sessionId,
  messageId,
  dispatch
}: {
  sessionId: string
  messageId: string
  dispatch: ReturnType<typeof useAppStore>['dispatch']
}) {
  let lastError: unknown

  for (const delayMs of persistedMessageRefreshRetryDelaysMs) {
    if (delayMs > 0) {
      await waitForRetryDelay(delayMs)
    }

    try {
      const messages = await hesperApi.conversation.listMessages(sessionId)
      const persistedMessage = messages.find((candidate) => candidate.id === messageId)
      if (persistedMessage) {
        dispatch({ type: 'message.optimistic', message: persistedMessage })
        return
      }
    } catch (error) {
      lastError = error
    }
  }

  console.warn('Failed to refresh persisted message after attachment send', lastError ?? { sessionId, messageId })
}

async function sendMessage({
  session,
  modelId,
  content,
  modelCapabilities = [],
  modelCatalog,
  dispatch,
  sendOptions,
  setSendErrorsBySession,
  setDraftAttachmentsBySession
}: {
  session: Pick<Session, 'id' | 'workspacePath' | 'updatedAt'>
  modelId: string
  content: string
  modelCapabilities?: readonly string[]
  modelCatalog?: SessionModelCatalog
  sendOptions?: ComposerSendOptions
  dispatch: ReturnType<typeof useAppStore>['dispatch']
  setSendErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>
  setDraftAttachmentsBySession?: Dispatch<SetStateAction<Record<string, ComposerDraftAttachment[]>>>
}) {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId || (modelCatalog && !isAvailableSessionModel(normalizedModelId, modelCatalog))) {
    setSendErrorsBySession((current) => ({
      ...current,
      [session.id]: unavailableModelMessage(normalizedModelId)
    }))
    return
  }

  setSendErrorsBySession((current) => clearSessionSendError(current, session.id))
  const draftAttachments = filterDraftAttachmentsForModel(sendOptions?.draftAttachments, modelCapabilities)
  const enqueueDraftAttachments = draftAttachments.map(toAgentEnqueueDraftAttachment)
  const message = createOptimisticUserMessage({ session, content })
  dispatch({ type: 'message.optimistic', message })
  dispatch({ type: 'session.touched', sessionId: session.id, updatedAt: message.createdAt })

  try {
    const result = await hesperApi.agent.enqueue({
      sessionId: session.id,
      prompt: sendOptions?.prompt ?? content,
      ...(sendOptions?.displayPrompt ? { displayPrompt: sendOptions.displayPrompt } : {}),
      modelId: normalizedModelId,
      ...(sendOptions?.thinkingLevel ? { thinkingLevel: sendOptions.thinkingLevel } : {}),
      ...(enqueueDraftAttachments.length > 0 ? { draftAttachments: enqueueDraftAttachments } : {}),
      messageId: message.id,
      messageCreatedAt: message.createdAt,
      ...(session.workspacePath ? { workspacePath: session.workspacePath } : {})
    })
    dispatch({ type: 'message.run-linked', sessionId: session.id, messageId: message.id, runId: result.runId })
    if (draftAttachments.length > 0) {
      await replaceOptimisticMessageWithPersistedMessage({
        sessionId: session.id,
        messageId: message.id,
        dispatch
      })
    }
    clearSentDraftAttachments(session.id, draftAttachments, setDraftAttachmentsBySession)
  } catch (error) {
    dispatch({ type: 'message.removed', sessionId: session.id, messageId: message.id })
    dispatch({ type: 'session.touch-reverted', sessionId: session.id, optimisticUpdatedAt: message.createdAt, previousUpdatedAt: session.updatedAt })
    setSendErrorsBySession((current) => ({
      ...current,
      [session.id]: error instanceof Error ? error.message : 'unknown enqueue error'
    }))
  }
}

function toAgentEnqueueDraftAttachment(attachment: ComposerDraftAttachment): DraftAttachment {
  if (attachment.kind === 'image') {
    return {
      kind: 'image',
      name: attachment.name,
      mimeType: attachment.mimeType,
      bytes: attachment.bytes,
      dataUrl: attachment.dataUrl
    }
  }
  return {
    kind: 'text',
    name: attachment.name,
    mimeType: attachment.mimeType,
    bytes: attachment.bytes,
    content: attachment.content
  }
}

function filterDraftAttachmentsForModel(attachments: ComposerDraftAttachment[] | undefined, modelCapabilities: readonly string[]): ComposerDraftAttachment[] {
  if (!attachments?.length) {
    return []
  }

  const supportsImageInput = modelCapabilities.includes('imageInput')
  return attachments.filter((attachment) => attachment.kind !== 'image' || supportsImageInput)
}

function clearSentDraftAttachments(
  sessionId: string,
  sentAttachments: ComposerDraftAttachment[],
  setDraftAttachmentsBySession?: Dispatch<SetStateAction<Record<string, ComposerDraftAttachment[]>>>
) {
  if (!setDraftAttachmentsBySession || sentAttachments.length === 0) {
    return
  }

  const sentAttachmentIds = new Set(sentAttachments.map((attachment) => attachment.id))
  setDraftAttachmentsBySession((current) => {
    const remaining = (current[sessionId] ?? []).filter((attachment) => !sentAttachmentIds.has(attachment.id))
    if (remaining.length === (current[sessionId]?.length ?? 0)) {
      return current
    }

    const next = { ...current }
    if (remaining.length === 0) {
      delete next[sessionId]
    } else {
      next[sessionId] = remaining
    }
    return next
  })
}

function toSkillOption(skill: SkillOption): SkillOption {
  return {
    id: skill.id,
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {})
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
  background: themeTokens.color.accent,
  color: themeTokens.color.accentContrast,
  fontWeight: 700,
  cursor: 'pointer'
}
