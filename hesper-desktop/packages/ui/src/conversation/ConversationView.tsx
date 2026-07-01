import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent as ReactWheelEvent } from 'react'
import type { AgentRun, LocalFilePreview, Message, MessageAttachment, ModelCapability, RunStep, Session } from '@hesper/shared'
import { themeTokens } from '../theme'
import { Composer, type ComposerDraftAttachment, type ComposerSendOptions, type ComposerSkillMention, type ModelOptionGroup, type SkillOption } from './Composer'
import { LocalFilePreviewDialog } from './LocalFilePreviewDialog'
import { GitGraphFullscreen } from '../git/GitGraphFullscreen'
import type { GitCommitDetailView, GitGraphRowView } from '../git/git-graph-types'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import type { NavigationItem } from './RightNavigation'
import { RunSteps, type WorkerAgentView } from './RunSteps'

export type ConversationShortcutCommand =
  | { type: 'send'; nonce: number }
  | { type: 'close-panels'; nonce: number }
  | { type: 'jump-message'; nonce: number; direction: 'previous' | 'next'; assistantOnly: boolean }

export type ConversationGitPanelProps = {
  visible: boolean
  open: boolean
  disabled?: boolean
  repositoryName?: string
  currentBranch?: string
  commitCount?: number
  loadedCount?: number
  hasMore?: boolean
  dirty?: boolean
  loading?: boolean
  loadingMore?: boolean
  error?: string
  rows: GitGraphRowView[]
  selectedCommit?: string
  detail?: GitCommitDetailView
  onOpen: () => void
  onClose: () => void
  onSelectCommit: (commitHash: string) => void
  onLoadCommitDetail: (commitHash: string) => void
  onLoadMore?: () => void
  onCreateBranch: (commitHash: string) => void
  onCreateTag: (commitHash: string) => void
  onCheckout: (ref: string) => void
  onCopyCommitId?: (commitHash: string) => void
}

export type ConversationViewProps = {
  session: Session
  messages: Message[]
  steps: RunStep[]
  stepsByRun?: Record<string, RunStep[]>
  runsById?: Record<string, AgentRun>
  streamingText: string
  streamingByRun?: Record<string, string>
  workerAgentView?: WorkerAgentView | undefined
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  modelCapabilities?: ModelCapability[]
  skillOptions?: SkillOption[]
  draftValue?: string
  draftSkillMentions?: ComposerSkillMention[]
  draftAttachments?: ComposerDraftAttachment[]
  running?: boolean
  sendDisabled?: boolean
  sendDisabledReason?: string
  onDraftChange?: (value: string) => void
  onDraftSkillMentionsChange?: (mentions: ComposerSkillMention[]) => void
  onDraftAttachmentsChange?: (attachments: ComposerDraftAttachment[]) => void
  onSend: (content: string, options?: ComposerSendOptions) => void
  onRetryRun?: (message: Message, run: AgentRun) => void
  onStop?: () => void
  onSelectWorkspace?: () => void
  recentWorkspacePaths?: string[]
  onSelectRecentWorkspace?: (path: string) => void
  onRemoveRecentWorkspace?: (path: string) => void
  onModelChange?: (modelId: string) => void
  loadLocalFilePreview?: (path: string) => Promise<LocalFilePreview>
  loadAttachmentDataUrl?: (attachment: MessageAttachment) => Promise<string>
  shortcutCommand?: ConversationShortcutCommand
  gitPanel?: ConversationGitPanelProps
}

type AnchorEntry = {
  id: string
  kind: NavigationItem['kind']
  label: string
}

type OutputWheelBoundaryLock = {
  outputScroller: HTMLElement
  direction: 'up' | 'down'
}

const outputWheelGestureIdleMs = 160

const userMessageAnchorSelector = '[data-hesper-user-message-anchor="true"]'

type LocalFilePreviewState =
  | { status: 'loading'; path: string }
  | { status: 'loaded'; path: string; preview: LocalFilePreview }
  | { status: 'error'; path: string; error: string }

let globalCtrlWheelListenerRefCount = 0
let globalCtrlWheelHandler: ((event: WheelEvent) => void) | undefined

function handleGlobalCtrlWheel(event: WheelEvent): void {
  if (!(event.ctrlKey || event.metaKey) || (event.deltaX === 0 && event.deltaY === 0)) {
    return
  }

  const target = getElementTarget(event.target)
  const fullscreenRoot = target?.closest('[data-hesper-fullscreen-output="true"]')
  if (fullscreenRoot instanceof HTMLElement) {
    const fullscreenScroller = fullscreenRoot.querySelector<HTMLElement>('[data-hesper-fullscreen-output-scroll="true"]')
    if (!fullscreenScroller) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    scrollElementByDelta(fullscreenScroller, event.deltaX, event.deltaY)
    return
  }

  const root = target?.closest('[data-hesper-conversation-root="true"]')
  if (!(root instanceof HTMLElement)) {
    return
  }

  const scroller = root.querySelector<HTMLElement>('[data-hesper-message-list="true"]')
  if (!scroller) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  jumpToUserMessageByWheel(scroller, event.deltaY !== 0 ? event.deltaY : event.deltaX)
  scroller.dispatchEvent(new Event('scroll', { bubbles: false }))
}

function retainGlobalCtrlWheelListener(): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  globalCtrlWheelListenerRefCount += 1
  if (!globalCtrlWheelHandler) {
    globalCtrlWheelHandler = handleGlobalCtrlWheel
    window.addEventListener('wheel', globalCtrlWheelHandler, { capture: true, passive: false })
  }

  return () => {
    globalCtrlWheelListenerRefCount = Math.max(0, globalCtrlWheelListenerRefCount - 1)
    if (globalCtrlWheelListenerRefCount === 0 && globalCtrlWheelHandler) {
      window.removeEventListener('wheel', globalCtrlWheelHandler, { capture: true })
      globalCtrlWheelHandler = undefined
    }
  }
}

function trimLabel(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact ? compact.slice(0, 80) : fallback
}

function createStepNavigationKind(step: RunStep): NavigationItem['kind'] {
  if (step.type === 'warning' || step.status === 'failed') {
    return 'warning'
  }

  return step.type === 'tool_call' || step.type === 'tool_result' ? 'tool' : 'assistant'
}

function createMessageAnchorId(messageId: string): string {
  return `message-${messageId}`
}

function createStepAnchorId(stepId: string): string {
  return `step-${stepId}`
}

function compareCreatedAt<T extends { id: string; createdAt: string }>(left: T, right: T): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

function sortChronologically<T extends { id: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort(compareCreatedAt)
}

function createLayoutContentToken(value: string | undefined): string {
  if (!value) return '0'
  const length = value.length
  const middle = Math.floor(length / 2)
  return [
    length,
    value.charCodeAt(0),
    value.charCodeAt(Math.max(0, middle - 1)),
    value.charCodeAt(middle),
    value.charCodeAt(length - 1)
  ].join('.')
}

function createLocalFilePreviewError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `加载本地文件预览失败：${error.message}`
  }

  if (typeof error === 'string' && error.trim()) {
    return `加载本地文件预览失败：${error}`
  }

  return '加载本地文件预览失败，请稍后重试。'
}

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24
}

function getElementTarget(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

function getOutputScrollArea(target: EventTarget | null): HTMLElement | null {
  const outputScroller = getElementTarget(target)?.closest('[data-hesper-output-scroll="true"]')
  return outputScroller instanceof HTMLElement ? outputScroller : null
}

function isInsideFullscreenOutput(target: EventTarget | null): boolean {
  return Boolean(getElementTarget(target)?.closest('[data-hesper-fullscreen-output="true"]'))
}

function hasUsableScrollMetrics(element: HTMLElement): boolean {
  return element.clientHeight > 0 || element.scrollHeight > 0 || element.clientWidth > 0 || element.scrollWidth > 0
}

function isScrollableOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'overlay'
}

function getScrollableOverflow(element: HTMLElement, axis: 'x' | 'y'): string {
  const style = window.getComputedStyle(element)
  const axisOverflow = axis === 'x' ? style.overflowX : style.overflowY
  const inlineAxisOverflow = axis === 'x' ? element.style.overflowX : element.style.overflowY

  if (isScrollableOverflow(axisOverflow)) return axisOverflow
  if (isScrollableOverflow(inlineAxisOverflow)) return inlineAxisOverflow
  if (isScrollableOverflow(style.overflow)) return style.overflow
  if (isScrollableOverflow(element.style.overflow)) return element.style.overflow

  return axisOverflow || inlineAxisOverflow || style.overflow || element.style.overflow
}

function canScrollElementOnAxisByDelta(element: HTMLElement, axis: 'x' | 'y', delta: number): boolean {
  if (delta === 0 || !isScrollableOverflow(getScrollableOverflow(element, axis))) {
    return false
  }

  if (axis === 'x') {
    if (element.scrollWidth <= element.clientWidth + 1) return false
    return delta > 0
      ? element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      : element.scrollLeft > 0
  }

  if (element.scrollHeight <= element.clientHeight + 1) return false
  return delta > 0
    ? element.scrollTop + element.clientHeight < element.scrollHeight - 1
    : element.scrollTop > 0
}

function canScrollElementByDelta(element: HTMLElement, deltaX: number, deltaY: number): boolean {
  return canScrollElementOnAxisByDelta(element, 'x', deltaX) || canScrollElementOnAxisByDelta(element, 'y', deltaY)
}

function findNearestScrollConsumerWithinOutput(target: EventTarget | null, outputScroller: HTMLElement, deltaX: number, deltaY: number): HTMLElement | null {
  let current = getElementTarget(target)

  while (current && outputScroller.contains(current)) {
    if (current instanceof HTMLElement && canScrollElementByDelta(current, deltaX, deltaY)) {
      return current
    }

    if (current === outputScroller) {
      break
    }
    current = current.parentElement
  }

  return null
}

function scrollElementByDelta(element: HTMLElement, deltaX: number, deltaY: number): void {
  element.scrollTop += deltaY
  element.scrollLeft += deltaX
}

function getElementTopWithinScroller(scroller: HTMLElement, element: HTMLElement): number {
  if (element.offsetTop !== 0) return element.offsetTop

  const scrollerRect = scroller.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  return scroller.scrollTop + elementRect.top - scrollerRect.top
}

function scrollScrollerTo(scroller: HTMLElement, top: number): void {
  const nextTop = Math.max(0, top)
  if (typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ top: nextTop, behavior: 'auto' })
  } else {
    scroller.scrollTop = nextTop
  }
}

function createResizeObserver(callback: ResizeObserverCallback): ResizeObserver | undefined {
  const ResizeObserverConstructor = globalThis.ResizeObserver
  if (typeof ResizeObserverConstructor === 'undefined') {
    return undefined
  }

  try {
    return new ResizeObserverConstructor(callback)
  } catch {
    return (ResizeObserverConstructor as unknown as (observerCallback: ResizeObserverCallback) => ResizeObserver)(callback)
  }
}

function jumpToUserMessageByWheel(scroller: HTMLElement, delta: number): boolean {
  if (delta === 0) return false

  const anchors = Array.from(scroller.querySelectorAll<HTMLElement>(userMessageAnchorSelector))
    .map((element) => ({ element, top: getElementTopWithinScroller(scroller, element) }))
    .sort((left, right) => left.top - right.top)

  if (anchors.length === 0) return false

  const currentTop = scroller.scrollTop
  const tolerance = 1
  const target = delta < 0
    ? [...anchors].reverse().find((anchor) => anchor.top < currentTop - tolerance)
    : anchors.find((anchor) => anchor.top > currentTop + tolerance)

  if (!target) return false

  scrollScrollerTo(scroller, target.top)
  return true
}

export function ConversationView({
  session,
  messages,
  steps,
  stepsByRun,
  runsById,
  streamingText,
  streamingByRun,
  workerAgentView,
  modelId,
  modelOptions,
  modelOptionGroups,
  modelCapabilities,
  skillOptions,
  draftValue,
  draftSkillMentions,
  draftAttachments,
  running = false,
  sendDisabled,
  sendDisabledReason,
  onDraftChange,
  onDraftSkillMentionsChange,
  onDraftAttachmentsChange,
  onSend,
  onRetryRun,
  onStop,
  onSelectWorkspace,
  recentWorkspacePaths,
  onSelectRecentWorkspace,
  onRemoveRecentWorkspace,
  onModelChange,
  loadLocalFilePreview,
  loadAttachmentDataUrl,
  shortcutCommand,
  gitPanel
}: ConversationViewProps) {
  const [closeFullscreenSignal, setCloseFullscreenSignal] = useState(0)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [localFilePreviewState, setLocalFilePreviewState] = useState<LocalFilePreviewState>()
  const [gitPanelEntryFocused, setGitPanelEntryFocused] = useState(false)
  const gitPanelEntryPointerFocusRef = useRef(false)
  const shouldShowGitPanel = gitPanel?.visible === true
  const gitPanelDisabled = Boolean(gitPanel?.disabled)
  const gitPanelBranchLabel = gitPanel?.currentBranch ? `，当前分支 ${gitPanel.currentBranch}` : ''
  const gitPanelBusyLabel = gitPanel?.loading ? '，正在加载' : ''
  const gitPanelErrorLabel = gitPanel?.error ? `，错误：${gitPanel.error}` : ''
  const gitPanelEntryLabel = `打开 Git 图谱${gitPanelBranchLabel}${gitPanelBusyLabel}${gitPanelErrorLabel}`
  const gitPanelDirtyDescriptionId = `conversation-git-panel-dirty-${session.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const anchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const messagesContentRef = useRef<HTMLDivElement | null>(null)
  const localFilePreviewRequestRef = useRef(0)
  const pinnedToBottomRef = useRef(true)
  const didMeasureContentRef = useRef(false)
  const outputWheelBoundaryLockRef = useRef<OutputWheelBoundaryLock | null>(null)
  const outputWheelBoundaryLockTimerRef = useRef<number | undefined>(undefined)
  const orderedMessages = useMemo(() => sortChronologically(messages), [messages])
  const orderedSteps = useMemo(() => sortChronologically(steps), [steps])
  const orderedStepsByRun = useMemo(() => {
    if (!stepsByRun) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(stepsByRun).map(([runId, runSteps]) => [runId, sortChronologically(runSteps)])
    )
  }, [stepsByRun])
  const finalOutputByRun = useMemo(() => new Map(
    orderedMessages.flatMap((message) => (
      message.role === 'assistant' && message.runId && message.content.trim() ? [[message.runId, message] as const] : []
    ))
  ), [orderedMessages])
  const finalOutputRunIds = useMemo(() => new Set(finalOutputByRun.keys()), [finalOutputByRun])
  const latestUserMessageId = [...orderedMessages].reverse().find((message) => message.role === 'user')?.id
  const fallbackStepsRun = orderedSteps[0]?.runId ? runsById?.[orderedSteps[0].runId] : undefined
  const getMessageSteps = (message: Message): RunStep[] => {
    if (message.role !== 'user') {
      return []
    }

    if (message.runId) {
      return orderedStepsByRun[message.runId] ?? []
    }

    return message.id === latestUserMessageId ? orderedSteps : []
  }
  const getMessageStreamingText = (message: Message): string => {
    if (message.role !== 'user' || !message.runId) {
      return ''
    }

    return streamingByRun?.[message.runId] ?? ''
  }
  const getMessageRun = (message: Message): AgentRun | undefined => (
    message.runId ? runsById?.[message.runId] : undefined
  )
  const shouldShowRetryRun = (message: Message): boolean => {
    const run = getMessageRun(message)
    return Boolean(message.role === 'user' && run?.status === 'failed' && onRetryRun)
  }
  const getMessageRunEndedAt = (message: Message): string | undefined => {
    const run = getMessageRun(message)
    if (run?.endedAt) return run.endedAt
    if (run?.status === 'running') return undefined
    return message.runId ? finalOutputByRun.get(message.runId)?.createdAt : undefined
  }
  const hasAssistantOutputAfter = (message: Message): boolean => orderedMessages.some((candidate) => (
    candidate.role === 'assistant' && candidate.content.trim() && candidate.createdAt.localeCompare(message.createdAt) >= 0
  ))
  const shouldShowMessageRunSteps = (message: Message, messageSteps: RunStep[]): boolean => {
    if (message.role !== 'user') return false
    if (messageSteps.length > 0) return true
    if (message.runId && !finalOutputRunIds.has(message.runId)) return true
    return !message.runId && message.id === latestUserMessageId && !hasAssistantOutputAfter(message)
  }
  const anchorOrder = useMemo<AnchorEntry[]>(() => {
    const entries: AnchorEntry[] = []

    for (const message of orderedMessages) {
      entries.push({
        id: createMessageAnchorId(message.id),
        kind: message.role === 'user' ? 'user' : 'assistant',
        label: trimLabel(message.content, message.role === 'user' ? '用户消息' : '助手输出')
      })

      const messageSteps = getMessageSteps(message)
      if (shouldShowMessageRunSteps(message, messageSteps) && messageSteps.length > 0) {
        for (const step of messageSteps) {
          entries.push({
            id: createStepAnchorId(step.id),
            kind: createStepNavigationKind(step),
            label: trimLabel(step.summary ?? step.title, step.title)
          })
        }
      }

      const messageStreamingText = getMessageStreamingText(message)
      if (messageStreamingText) {
        entries.push({
          id: `streaming-output-${message.runId}`,
          kind: 'assistant',
          label: trimLabel(messageStreamingText, '流式输出')
        })
      }
    }

    if (orderedMessages.length === 0 && orderedSteps.length > 0) {
      for (const step of orderedSteps) {
        entries.push({
          id: createStepAnchorId(step.id),
          kind: createStepNavigationKind(step),
          label: trimLabel(step.summary ?? step.title, step.title)
        })
      }
    }

    if (streamingText && !Object.values(streamingByRun ?? {}).includes(streamingText)) {
      entries.push({
        id: 'streaming-output',
        kind: 'assistant',
        label: trimLabel(streamingText, '流式输出')
      })
    }

    return entries
  }, [orderedMessages, orderedSteps, orderedStepsByRun, streamingByRun, streamingText])
  const jumpTargets = useMemo(
    () => anchorOrder.filter((entry) => entry.kind === 'user' || entry.kind === 'assistant'),
    [anchorOrder]
  )
  const contentLayoutSignature = useMemo(() => [
    orderedMessages.map((message) => [message.id, message.role, message.runId ?? '', message.createdAt, createLayoutContentToken(message.content)].join(':')).join('|'),
    orderedSteps.map((step) => [step.id, step.status, step.createdAt, step.completedAt ?? '', createLayoutContentToken(step.summary), createLayoutContentToken(step.title)].join(':')).join('|'),
    Object.entries(orderedStepsByRun).map(([runId, runSteps]) => `${runId}:${runSteps.map((step) => [step.id, step.status, step.createdAt, step.completedAt ?? '', createLayoutContentToken(step.summary), createLayoutContentToken(step.title)].join(':')).join(',')}`).join('|'),
    Object.entries(runsById ?? {}).map(([runId, run]) => [runId, run.status, run.startedAt ?? '', run.endedAt ?? ''].join(':')).join('|'),
    createLayoutContentToken(streamingText),
    Object.entries(streamingByRun ?? {}).map(([runId, text]) => `${runId}:${createLayoutContentToken(text)}`).join('|')
  ].join('\n'), [orderedMessages, orderedSteps, orderedStepsByRun, runsById, streamingByRun, streamingText])

  const focusAnchor = (id: string) => {
    const element = anchorRefs.current[id]
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = messagesScrollRef.current
    if (!element) {
      return
    }

    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior })
    } else {
      element.scrollTop = element.scrollHeight
    }
    pinnedToBottomRef.current = true
    setShowJumpToBottom(false)
  }, [])

  const updateMessagesScrollState = useCallback(() => {
    const element = messagesScrollRef.current
    if (!element) {
      return
    }

    const atBottom = isNearScrollBottom(element)
    pinnedToBottomRef.current = atBottom
    if (atBottom) {
      setShowJumpToBottom(false)
    }
  }, [])

  const scrollMessagesByDelta = useCallback((deltaX: number, deltaY: number) => {
    const element = messagesScrollRef.current
    if (!element || (deltaX === 0 && deltaY === 0)) {
      return
    }

    scrollElementByDelta(element, deltaX, deltaY)
    updateMessagesScrollState()
  }, [updateMessagesScrollState])

  const resetOutputWheelBoundaryLock = useCallback(() => {
    outputWheelBoundaryLockRef.current = null
    if (outputWheelBoundaryLockTimerRef.current !== undefined) {
      window.clearTimeout(outputWheelBoundaryLockTimerRef.current)
      outputWheelBoundaryLockTimerRef.current = undefined
    }
  }, [])

  const refreshOutputWheelBoundaryLock = useCallback((outputScroller: HTMLElement, direction: OutputWheelBoundaryLock['direction']) => {
    outputWheelBoundaryLockRef.current = { outputScroller, direction }
    if (outputWheelBoundaryLockTimerRef.current !== undefined) {
      window.clearTimeout(outputWheelBoundaryLockTimerRef.current)
    }
    outputWheelBoundaryLockTimerRef.current = window.setTimeout(() => {
      outputWheelBoundaryLockRef.current = null
      outputWheelBoundaryLockTimerRef.current = undefined
    }, outputWheelGestureIdleMs)
  }, [])

  const handleMessagesScroll = () => {
    updateMessagesScrollState()
  }

  const handleConversationWheelCapture = (event: ReactWheelEvent<HTMLElement>) => {
    if (isInsideFullscreenOutput(event.target) || (event.deltaX === 0 && event.deltaY === 0)) {
      return
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      const scroller = messagesScrollRef.current
      if (scroller) {
        jumpToUserMessageByWheel(scroller, event.deltaY !== 0 ? event.deltaY : event.deltaX)
        updateMessagesScrollState()
      }
      return
    }

    const outputScroller = getOutputScrollArea(event.target)
    if (outputScroller) {
      const verticalDirection = event.deltaY < 0 ? 'up' : event.deltaY > 0 ? 'down' : undefined
      const scrollConsumer = findNearestScrollConsumerWithinOutput(event.target, outputScroller, event.deltaX, event.deltaY)
      if (scrollConsumer || !hasUsableScrollMetrics(outputScroller)) {
        if (scrollConsumer && verticalDirection) {
          refreshOutputWheelBoundaryLock(outputScroller, verticalDirection)
        } else {
          resetOutputWheelBoundaryLock()
        }
        return
      }

      if (verticalDirection) {
        const activeLock = outputWheelBoundaryLockRef.current
        if (activeLock?.outputScroller === outputScroller && activeLock.direction === verticalDirection) {
          event.preventDefault()
          event.stopPropagation()
          refreshOutputWheelBoundaryLock(outputScroller, verticalDirection)
          return
        }

        refreshOutputWheelBoundaryLock(outputScroller, verticalDirection)
      } else {
        resetOutputWheelBoundaryLock()
      }
    } else {
      resetOutputWheelBoundaryLock()
    }

    event.preventDefault()
    event.stopPropagation()
    scrollMessagesByDelta(event.deltaX, event.deltaY)
  }

  const closeLocalFilePreview = useCallback(() => {
    localFilePreviewRequestRef.current += 1
    setLocalFilePreviewState(undefined)
  }, [])

  const handleLocalFileClick = useCallback((path: string) => {
    const requestId = localFilePreviewRequestRef.current + 1
    localFilePreviewRequestRef.current = requestId
    setLocalFilePreviewState({ status: 'loading', path })

    if (!loadLocalFilePreview) {
      setLocalFilePreviewState({ status: 'error', path, error: '加载本地文件预览失败：未配置本地文件预览加载器。' })
      return
    }

    let previewPromise: Promise<LocalFilePreview>
    try {
      previewPromise = loadLocalFilePreview(path)
    } catch (error) {
      setLocalFilePreviewState({ status: 'error', path, error: createLocalFilePreviewError(error) })
      return
    }

    void previewPromise.then(
      (preview) => {
        if (localFilePreviewRequestRef.current !== requestId) return
        setLocalFilePreviewState({ status: 'loaded', path: preview.path || path, preview })
      },
      (error: unknown) => {
        if (localFilePreviewRequestRef.current !== requestId) return
        setLocalFilePreviewState({ status: 'error', path, error: createLocalFilePreviewError(error) })
      }
    )
  }, [loadLocalFilePreview])

  useEffect(() => retainGlobalCtrlWheelListener(), [])

  useEffect(() => () => {
    resetOutputWheelBoundaryLock()
  }, [resetOutputWheelBoundaryLock])

  useEffect(() => () => {
    localFilePreviewRequestRef.current += 1
  }, [])

  useEffect(() => {
    if (!shortcutCommand) {
      return
    }

    if (shortcutCommand.type === 'close-panels') {
      setCloseFullscreenSignal((value) => value + 1)
      closeLocalFilePreview()
      return
    }

    if (shortcutCommand.type === 'jump-message') {
      const targets = jumpTargets.filter((entry) => (shortcutCommand.assistantOnly ? entry.kind === 'assistant' : true))
      if (targets.length === 0) {
        return
      }

      const activeId = targets.find((entry) => {
        const element = anchorRefs.current[entry.id]
        return element?.contains(document.activeElement) || document.activeElement === element
      })?.id
      const currentIndex = activeId ? targets.findIndex((entry) => entry.id === activeId) : -1
      const nextIndex = shortcutCommand.direction === 'previous'
        ? (currentIndex <= 0 ? targets.length - 1 : currentIndex - 1)
        : (currentIndex === -1 || currentIndex >= targets.length - 1 ? 0 : currentIndex + 1)

      const next = targets[nextIndex]
      if (next) {
        focusAnchor(next.id)
      }
    }
  }, [closeLocalFilePreview, jumpTargets, shortcutCommand])

  useEffect(() => {
    const element = messagesScrollRef.current
    if (!element) {
      return
    }

    if (!didMeasureContentRef.current) {
      didMeasureContentRef.current = true
      pinnedToBottomRef.current = isNearScrollBottom(element)
      return
    }

    if (pinnedToBottomRef.current) {
      scrollMessagesToBottom('auto')
    } else {
      setShowJumpToBottom(true)
    }
  }, [contentLayoutSignature, scrollMessagesToBottom])

  useEffect(() => {
    const scrollElement = messagesScrollRef.current
    const contentElement = messagesContentRef.current
    if (!scrollElement || !contentElement) {
      return undefined
    }

    const resizeObserver = createResizeObserver(() => {
      if (pinnedToBottomRef.current) {
        scrollMessagesToBottom('auto')
      } else if (!isNearScrollBottom(scrollElement)) {
        setShowJumpToBottom(true)
      }
    })

    if (!resizeObserver) {
      return undefined
    }

    resizeObserver.observe(contentElement)
    return () => resizeObserver.disconnect()
  }, [scrollMessagesToBottom])

  return (
    <div data-hesper-conversation-root="true" style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', fontSize: themeTokens.typography.body }}>
      <section
        aria-label="会话详情"
        style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', minWidth: 0, minHeight: 0 }}
      >
        <header
          onWheelCapture={handleConversationWheelCapture}
          style={{
            position: 'relative',
            minHeight: 32,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'center',
            columnGap: themeTokens.spacing.md,
            padding: `${themeTokens.spacing.lg} ${themeTokens.spacing.lg} ${themeTokens.spacing.sm}`
          }}
        >
          <div aria-hidden="true" style={gitPanelHeaderSideStyle} />
          <h2 style={{ margin: 0, maxWidth: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: themeTokens.typography.body, lineHeight: 1.2, textAlign: 'center', fontWeight: 500, justifySelf: 'center' }}>{session.title}</h2>
          <div data-hesper-git-entry-slot="true" style={gitPanelEntrySlotStyle}>
            {shouldShowGitPanel && gitPanel ? (
              <button
                type="button"
                aria-label={gitPanelEntryLabel}
                aria-busy={gitPanel.loading ? 'true' : undefined}
                aria-describedby={gitPanel.dirty ? gitPanelDirtyDescriptionId : undefined}
                disabled={gitPanelDisabled}
                onPointerDown={() => {
                  gitPanelEntryPointerFocusRef.current = true
                  setGitPanelEntryFocused(false)
                }}
                onFocus={(event) => {
                  const isNativeFocusVisible = typeof event.currentTarget.matches === 'function' && event.currentTarget.matches(':focus-visible')
                  setGitPanelEntryFocused(!gitPanelEntryPointerFocusRef.current || isNativeFocusVisible)
                  gitPanelEntryPointerFocusRef.current = false
                }}
                onBlur={() => {
                  gitPanelEntryPointerFocusRef.current = false
                  setGitPanelEntryFocused(false)
                }}
                onClick={() => {
                  if (gitPanelDisabled) return
                  gitPanel.onOpen()
                }}
                style={{
                  ...gitPanelEntryButtonStyle,
                  ...(gitPanel.open ? gitPanelEntryButtonActiveStyle : {}),
                  ...(gitPanelEntryFocused ? gitPanelEntryButtonFocusStyle : {}),
                  ...(gitPanelDisabled ? gitPanelEntryButtonDisabledStyle : {})
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" style={gitPanelEntryIconStyle}>
                  <path d="M7 4v8a4 4 0 0 0 4 4h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M7 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M7 8v2a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {gitPanel.currentBranch ? <span style={gitPanelEntryBranchStyle}>{gitPanel.currentBranch}</span> : null}
                {gitPanel.loading ? <span style={gitPanelEntryStateTextStyle}>加载中</span> : null}
                {gitPanel.error ? <span aria-hidden="true" style={gitPanelEntryErrorDotStyle} /> : null}
                {gitPanel.dirty ? (
                  <>
                    <span aria-hidden="true" style={gitPanelDirtyDotStyle} />
                    <span id={gitPanelDirtyDescriptionId} style={visuallyHiddenStyle}>工作区有未提交更改</span>
                  </>
                ) : null}
              </button>
            ) : null}
          </div>
        </header>
        <div style={messagesAreaStyle} onWheelCapture={handleConversationWheelCapture}>
          <div
            ref={messagesScrollRef}
            aria-label="消息列表"
            className="hesper-theme-scrollbar"
            data-hesper-message-list="true"
            onScroll={handleMessagesScroll}
            style={{
              height: '100%',
              minHeight: 0,
              minWidth: 0,
              overflowX: 'hidden',
              overflowY: 'auto',
              paddingRight: themeTokens.spacing.xs
            }}
          >
            <div
              ref={messagesContentRef}
              style={{
                display: 'grid',
                alignContent: 'start',
                gap: themeTokens.spacing.md,
                padding: `0 ${themeTokens.spacing.lg} ${themeTokens.spacing.md} ${themeTokens.spacing.lg}`
              }}
            >
            {orderedMessages.map((message) => {
            const anchorId = createMessageAnchorId(message.id)
            const messageSteps = getMessageSteps(message)
            const messageStreamingText = getMessageStreamingText(message)
            const streamingAnchorId = message.runId ? `streaming-output-${message.runId}` : 'streaming-output'

            return (
              <div
                key={message.id}
                id={anchorId}
                data-anchor-id={anchorId}
                data-hesper-user-message-anchor={message.role === 'user' ? 'true' : undefined}
                ref={(node) => {
                  anchorRefs.current[anchorId] = node
                }}
                tabIndex={-1}
                style={{ outline: 'none', minWidth: 0 }}
              >
                {message.role === 'assistant' ? (
                  <OutputBlock
                    content={message.content}
                    contentType={message.contentType}
                    closeFullscreenSignal={closeFullscreenSignal}
                    onLocalFileClick={handleLocalFileClick}
                  />
                ) : (
                  <MessageBubble
                    message={message}
                    {...(loadAttachmentDataUrl ? { loadAttachmentDataUrl } : {})}
                  />
                )}
                {shouldShowMessageRunSteps(message, messageSteps) ? (
                  <div style={{ marginTop: themeTokens.spacing.sm }}>
                    <RunSteps
                      steps={messageSteps}
                      autoExpanded={message.role === 'user' && (!message.runId || !finalOutputRunIds.has(message.runId))}
                      runStartedAt={message.createdAt}
                      runEndedAt={getMessageRunEndedAt(message)}
                      workerAgentView={workerAgentView}
                      onLocalFileClick={handleLocalFileClick}
                      getStepProps={(step) => {
                        const stepAnchorId = createStepAnchorId(step.id)
                        return {
                          id: stepAnchorId,
                          tabIndex: -1,
                          'data-anchor-id': stepAnchorId,
                          ref: (node) => {
                            anchorRefs.current[stepAnchorId] = node
                          }
                        }
                      }}
                    />
                  </div>
                ) : null}
                {shouldShowRetryRun(message) ? (() => {
                  const run = getMessageRun(message)
                  return run ? (
                    <div role="alert" aria-label="失败运行摘要" style={retryRunPanelStyle}>
                      <div style={retryRunSummaryStyle}>
                        <strong style={retryRunTitleStyle}>运行失败：{run.error?.code ?? 'unknown'}</strong>
                        <span>{run.error?.message ?? '未知错误'}</span>
                        <span>已自动重试 {run.retryCount}/{run.maxRetries} 次</span>
                      </div>
                      <button
                        type="button"
                        aria-label="重试失败运行"
                        disabled={running}
                        onClick={() => {
                          if (running) return
                          onRetryRun?.(message, run)
                        }}
                        style={{
                          ...retryRunButtonStyle,
                          ...(running ? retryRunButtonDisabledStyle : {})
                        }}
                      >
                        重试
                      </button>
                    </div>
                  ) : null
                })() : null}
                {messageStreamingText ? (
                  <div
                    id={streamingAnchorId}
                    data-anchor-id={streamingAnchorId}
                    ref={(node) => {
                      anchorRefs.current[streamingAnchorId] = node
                    }}
                    tabIndex={-1}
                    style={{ marginTop: themeTokens.spacing.sm, outline: 'none', minWidth: 0 }}
                  >
                    <OutputBlock
                      content={messageStreamingText}
                      contentType={session.outputMode}
                      closeFullscreenSignal={closeFullscreenSignal}
                      onLocalFileClick={handleLocalFileClick}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
          {orderedMessages.length === 0 && orderedSteps.length > 0 ? (
            <RunSteps
              steps={orderedSteps}
              autoExpanded
              runStartedAt={fallbackStepsRun?.startedAt ?? orderedSteps[0]?.createdAt}
              runEndedAt={fallbackStepsRun?.endedAt}
              workerAgentView={workerAgentView}
              onLocalFileClick={handleLocalFileClick}
              getStepProps={(step) => {
                const stepAnchorId = createStepAnchorId(step.id)
                return {
                  id: stepAnchorId,
                  tabIndex: -1,
                  'data-anchor-id': stepAnchorId,
                  ref: (node) => {
                    anchorRefs.current[stepAnchorId] = node
                  }
                }
              }}
            />
          ) : null}
            {streamingText && !Object.values(streamingByRun ?? {}).includes(streamingText) ? (
              <div
                id="streaming-output"
                data-anchor-id="streaming-output"
                ref={(node) => {
                  anchorRefs.current['streaming-output'] = node
                }}
                tabIndex={-1}
                style={{ outline: 'none', minWidth: 0 }}
              >
                <OutputBlock
                  content={streamingText}
                  contentType={session.outputMode}
                  closeFullscreenSignal={closeFullscreenSignal}
                  onLocalFileClick={handleLocalFileClick}
                />
              </div>
            ) : null}
            </div>
          </div>
          {showJumpToBottom ? (
            <button type="button" aria-label="滚动到底部" onClick={() => scrollMessagesToBottom('smooth')} style={jumpToBottomButtonStyle}>
              <svg aria-hidden="true" viewBox="0 0 24 24" style={jumpToBottomIconStyle}>
                <path d="M12 5v12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="m6.5 11.5 5.5 5.5 5.5-5.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
        <div data-hesper-composer-area="true" style={composerAreaStyle}>
          <Composer
            {...(session.workspacePath ? { workspacePath: session.workspacePath } : {})}
            modelId={modelId}
            {...(modelOptions ? { modelOptions } : {})}
            {...(modelOptionGroups ? { modelOptionGroups } : {})}
            {...(modelCapabilities ? { modelCapabilities } : {})}
            {...(skillOptions ? { skillOptions } : {})}
            {...(draftSkillMentions ? { skillMentions: draftSkillMentions } : {})}
            {...(draftAttachments ? { attachments: draftAttachments } : {})}
            {...(draftValue !== undefined ? { value: draftValue } : {})}
            running={running}
            {...(sendDisabled !== undefined ? { sendDisabled } : {})}
            {...(sendDisabledReason ? { sendDisabledReason } : {})}
            {...(onDraftChange ? { onDraftChange } : {})}
            {...(onDraftSkillMentionsChange ? { onSkillMentionsChange: onDraftSkillMentionsChange } : {})}
            {...(onDraftAttachmentsChange ? { onAttachmentsChange: onDraftAttachmentsChange } : {})}
            {...(onStop ? { onStop } : {})}
            {...(onSelectWorkspace ? { onSelectWorkspace } : {})}
            {...(recentWorkspacePaths ? { recentWorkspacePaths } : {})}
            {...(onSelectRecentWorkspace ? { onSelectRecentWorkspace } : {})}
            {...(onRemoveRecentWorkspace ? { onRemoveRecentWorkspace } : {})}
            {...(onModelChange ? { onModelChange } : {})}
            onSend={onSend}
            sendSignal={shortcutCommand?.type === 'send' ? shortcutCommand.nonce : 0}
          />
        </div>
      </section>
      {shouldShowGitPanel && gitPanel ? (
        <GitGraphFullscreen
          open={gitPanel.open}
          rows={gitPanel.rows}
          onClose={gitPanel.onClose}
          onSelectCommit={gitPanel.onSelectCommit}
          onLoadCommitDetail={gitPanel.onLoadCommitDetail}
          onCreateBranch={gitPanel.onCreateBranch}
          onCreateTag={gitPanel.onCreateTag}
          onCheckout={gitPanel.onCheckout}
          {...(gitPanel.repositoryName !== undefined ? { repositoryName: gitPanel.repositoryName } : {})}
          {...(gitPanel.currentBranch !== undefined ? { currentBranch: gitPanel.currentBranch } : {})}
          {...(gitPanel.commitCount !== undefined ? { commitCount: gitPanel.commitCount } : {})}
          {...(gitPanel.loadedCount !== undefined ? { loadedCount: gitPanel.loadedCount } : {})}
          {...(gitPanel.hasMore !== undefined ? { hasMore: gitPanel.hasMore } : {})}
          {...(gitPanel.dirty !== undefined ? { dirty: gitPanel.dirty } : {})}
          {...(gitPanel.loadingMore !== undefined ? { loadingMore: gitPanel.loadingMore } : {})}
          {...(gitPanel.onLoadMore ? { onLoadMore: gitPanel.onLoadMore } : {})}
          {...(gitPanel.selectedCommit !== undefined ? { selectedCommit: gitPanel.selectedCommit } : {})}
          {...(gitPanel.detail !== undefined ? { detail: gitPanel.detail } : {})}
          {...(gitPanel.loading !== undefined ? { loading: gitPanel.loading } : {})}
          {...(gitPanel.error !== undefined ? { error: gitPanel.error } : {})}
          {...(gitPanel.onCopyCommitId ? { onCopyCommitId: gitPanel.onCopyCommitId } : {})}
        />
      ) : null}
      {localFilePreviewState ? (
        <LocalFilePreviewDialog
          path={localFilePreviewState.path}
          loading={localFilePreviewState.status === 'loading'}
          onClose={closeLocalFilePreview}
          onLocalFileClick={handleLocalFileClick}
          {...(localFilePreviewState.status === 'loaded' ? { preview: localFilePreviewState.preview } : {})}
          {...(localFilePreviewState.status === 'error' ? { error: localFilePreviewState.error } : {})}
        />
      ) : null}
    </div>
  )
}

const gitPanelHeaderSideStyle = {
  minWidth: 0,
  minHeight: 1
} satisfies CSSProperties

const gitPanelEntrySlotStyle = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  justifySelf: 'stretch'
} satisfies CSSProperties

const gitPanelEntryButtonStyle = {
  minWidth: 34,
  height: 30,
  borderColor: themeTokens.color.border,
  borderStyle: 'solid',
  borderWidth: '1px',
  outline: '2px solid transparent',
  outlineOffset: 2,
  borderRadius: 999,
  background: themeTokens.color.softControl,
  color: themeTokens.color.textMuted,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 10px',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  maxWidth: '100%',
  boxShadow: `0 2px 6px -3px ${themeTokens.color.shadow}`
} satisfies CSSProperties

const gitPanelEntryButtonActiveStyle = {
  color: themeTokens.color.accent,
  background: themeTokens.color.hover
} satisfies CSSProperties

const gitPanelEntryButtonFocusStyle = {
  outline: `2px solid ${themeTokens.color.accent}`,
  boxShadow: `0 0 0 4px ${themeTokens.color.softControl}`
} satisfies CSSProperties

const gitPanelEntryButtonDisabledStyle = {
  cursor: 'not-allowed',
  opacity: 0.45,
  boxShadow: 'none'
} satisfies CSSProperties

const gitPanelEntryIconStyle = {
  width: 16,
  height: 16,
  display: 'block',
  flex: '0 0 auto'
} satisfies CSSProperties

const gitPanelEntryBranchStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 180,
  color: 'inherit',
  fontWeight: 650
} satisfies CSSProperties

const gitPanelEntryStateTextStyle = {
  color: 'inherit',
  fontWeight: 650,
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const gitPanelEntryErrorDotStyle = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: themeTokens.color.danger,
  boxShadow: `0 0 0 3px ${themeTokens.color.dangerSoft}`,
  flex: '0 0 auto'
} satisfies CSSProperties

const gitPanelDirtyDotStyle = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: themeTokens.color.warning,
  boxShadow: `0 0 0 3px ${themeTokens.color.warningSoft}`,
  flex: '0 0 auto'
} satisfies CSSProperties

const visuallyHiddenStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0
} satisfies CSSProperties

const messagesAreaStyle = {
  position: 'relative',
  minHeight: 0,
  overflow: 'hidden'
} satisfies CSSProperties

const composerAreaStyle = {
  boxSizing: 'border-box',
  minHeight: 0,
  maxHeight: 'min(45vh, 420px)',
  overflowX: 'hidden',
  overflowY: 'auto',
  padding: `${themeTokens.spacing.md} ${themeTokens.spacing.lg} ${themeTokens.spacing.lg}`
} satisfies CSSProperties

const jumpToBottomButtonStyle = {
  position: 'absolute',
  right: 16,
  bottom: 16,
  width: 38,
  height: 38,
  borderColor: themeTokens.color.border,
  borderStyle: 'solid',
  borderWidth: '1px',
  outline: 0,
  borderRadius: 999,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
  display: 'inline-grid',
  placeItems: 'center',
  boxShadow: `0 2px 6px -3px ${themeTokens.color.shadow}`,
  cursor: 'pointer',
  zIndex: 2
} satisfies CSSProperties

const jumpToBottomIconStyle = {
  width: 21,
  height: 21,
  display: 'block'
} satisfies CSSProperties

const retryRunPanelStyle = {
  display: 'grid',
  justifyItems: 'start',
  gap: themeTokens.spacing.sm,
  marginTop: themeTokens.spacing.sm,
  marginLeft: themeTokens.spacing.md,
  padding: themeTokens.spacing.sm,
  borderRadius: 14,
  background: themeTokens.color.dangerSoft,
  color: themeTokens.color.text,
  maxWidth: 520
} satisfies CSSProperties

const retryRunSummaryStyle = {
  display: 'grid',
  gap: 4,
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body,
  lineHeight: 1.4
} satisfies CSSProperties

const retryRunTitleStyle = {
  color: themeTokens.color.danger,
  fontWeight: 700
} satisfies CSSProperties

const retryRunButtonStyle = {
  border: 0,
  borderRadius: 999,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
  cursor: 'pointer',
  padding: '6px 12px',
  fontSize: themeTokens.typography.body,
  lineHeight: 1.2
} satisfies CSSProperties

const retryRunButtonDisabledStyle = {
  cursor: 'not-allowed',
  opacity: 0.45
} satisfies CSSProperties
