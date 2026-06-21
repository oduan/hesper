import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AgentRuntimeEvent, MessageContentType, RunStep, RunStepStatus, RunStepType } from '@hesper/shared'

type StepEvent = Extract<AgentRuntimeEvent, { type: 'step.created' | 'step.updated' }>
type PiEventLike = Pick<AgentEvent, 'type'> & Record<string, unknown>

type MappingContext = {
  runId: string
  sessionId?: string
}

type ThinkingState = {
  stepId: string
  text: string
}

type RunState = {
  commentaryCounter: number
  anonymousToolCounter: number
  assistantMessageCounter: number
  currentAssistantMessageOrdinal: number | undefined
  toolCountsByKey: Map<string, number>
  pendingToolStepIdsByKey: Map<string, string[]>
  toolPurposeByStepId: Map<string, string>
  toolInputByStepId: Map<string, unknown>
  toolDisplayByStepId: Map<string, ToolDisplayInfo>
  thinkingByBlockKey: Map<string, ThinkingState>
}

type ToolDisplayInfo = {
  displayName: string
  resource?: string
  display?: Record<string, unknown>
}

type TextPhase = 'commentary' | 'final_answer'

type TextBlockInfo = {
  text: string
  phase: TextPhase | undefined
}

const runStates = new Map<string, RunState>()

function nowIso(): string {
  return new Date().toISOString()
}

function getRunState(runId: string): RunState {
  const existing = runStates.get(runId)
  if (existing) return existing
  const created: RunState = {
    commentaryCounter: 0,
    anonymousToolCounter: 0,
    assistantMessageCounter: 0,
    currentAssistantMessageOrdinal: undefined,
    toolCountsByKey: new Map(),
    pendingToolStepIdsByKey: new Map(),
    toolPurposeByStepId: new Map(),
    toolInputByStepId: new Map(),
    toolDisplayByStepId: new Map(),
    thinkingByBlockKey: new Map()
  }
  runStates.set(runId, created)
  return created
}

export function clearPiEventRunState(runId: string): void {
  runStates.delete(runId)
}

function safeStringifyJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (_key, candidate) => {
      if (candidate && typeof candidate === 'object') {
        if (seen.has(candidate)) return '[Circular]'
        seen.add(candidate)
      }
      return candidate
    }) ?? 'null'
  } catch {
    return JSON.stringify(String(value))
  }
}

type ToolStepDetailPayload = {
  kind: 'tool_call'
  toolId?: string
  toolIcon?: string
  displayName?: string
  resource?: string
  display?: Record<string, unknown>
  input?: unknown
  output?: unknown
  isError?: boolean
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function displayNameFromDisplay(display: unknown): string | undefined {
  const record = recordValue(display)
  const name = recordValue(record?.name)
  const names = recordValue(record?.names)
  return normalizedString(name?.zhCN)
    ?? normalizedString(name?.['zh-CN'])
    ?? normalizedString(name?.default)
    ?? normalizedString(names?.['zh-CN'])
    ?? normalizedString(record?.name)
}

function extractToolResultMetadata(output: unknown): { toolId?: string; toolIcon?: string; displayName?: string; display?: Record<string, unknown> } {
  const details = recordValue(recordValue(output)?.details)
  const display = recordValue(details?.display)
  const displayName = normalizedString(details?.displayName) ?? displayNameFromDisplay(display)
  return {
    ...(typeof details?.toolId === 'string' ? { toolId: details.toolId } : {}),
    ...(typeof details?.toolIcon === 'string' ? { toolIcon: details.toolIcon } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(display ? { display } : {})
  }
}

function sanitizeToolInput(input: unknown): unknown {
  const record = recordValue(input)
  if (!record) return input
  const { _displayName: _displayName, ...rest } = record
  return rest
}

function createToolStepDetail(input: unknown, output?: unknown, isError?: boolean, displayInfo?: ToolDisplayInfo): string {
  const metadata = extractToolResultMetadata(output)
  const display = displayInfo?.display ?? metadata.display
  const displayName = displayInfo?.displayName ?? metadata.displayName ?? displayNameFromDisplay(display)
  const resource = displayInfo?.resource ?? extractToolResource(input, display)
  const payload: ToolStepDetailPayload = {
    kind: 'tool_call',
    ...metadata,
    ...(displayName !== undefined ? { displayName } : {}),
    ...(resource !== undefined ? { resource } : {}),
    ...(display !== undefined ? { display } : {}),
    ...(input !== undefined ? { input: sanitizeToolInput(input) } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(isError !== undefined ? { isError } : {})
  }
  return safeStringifyJson(payload)
}

function createStep(runId: string, stepId: string, type: RunStepType, status: RunStepStatus, title: string, summary?: string, detail?: string, completedAt?: string): RunStep {
  return {
    id: stepId,
    runId,
    type,
    status,
    title,
    createdAt: nowIso(),
    ...(summary !== undefined ? { summary } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(completedAt !== undefined ? { completedAt } : {})
  }
}

function parseTextPhase(signature: unknown): TextPhase | undefined {
  if (typeof signature !== 'string' || !signature.trim().startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(signature) as { phase?: unknown }
    return parsed.phase === 'commentary' || parsed.phase === 'final_answer' ? parsed.phase : undefined
  } catch {
    return undefined
  }
}

function extractTextBlocks(content: unknown): TextBlockInfo[] {
  if (typeof content === 'string') return [{ text: content, phase: undefined }]
  if (!Array.isArray(content)) return []

  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { type?: string; text?: unknown; textSignature?: unknown }
    if (record.type !== 'text' || typeof record.text !== 'string') return []
    return [{ text: record.text, phase: parseTextPhase(record.textSignature) }]
  })
}

function hasToolCallContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((item) => Boolean(item && typeof item === 'object' && (item as { type?: string }).type === 'toolCall'))
}

function normalizedFailureMessage(errorMessage: unknown): string | undefined {
  if (typeof errorMessage !== 'string') return undefined
  const normalized = errorMessage.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

function formatFailureMessage(errorMessage: unknown): string | undefined {
  const normalized = normalizedFailureMessage(errorMessage)
  return normalized ? `运行失败：${normalized}` : undefined
}

function inferContentType(message: { content?: unknown }): MessageContentType {
  if (typeof message.content === 'string') return 'plain'
  return 'markdown'
}

function normalizeContext(context: string | MappingContext): MappingContext {
  return typeof context === 'string' ? { runId: context } : context
}

function getToolCallId(event: PiEventLike): string | undefined {
  return typeof event.toolCallId === 'string' && event.toolCallId.trim() ? event.toolCallId : undefined
}

function toolCorrelationKey(event: PiEventLike): string {
  return getToolCallId(event) ?? `anonymous:${String(event.toolName ?? 'unknown')}`
}

function extractToolPurpose(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const purpose = (args as { purpose?: unknown }).purpose
  if (typeof purpose !== 'string') return undefined
  const normalized = purpose.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

function normalizedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

function formatToolNameWord(word: string): string {
  const lower = word.toLowerCase()
  const specialWords: Record<string, string> = {
    api: 'API',
    id: 'ID',
    url: 'URL',
    git: 'Git',
    ai: 'AI'
  }
  return specialWords[lower] ?? `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`
}

function humanizeToolName(toolName: unknown): string {
  const raw = normalizedString(typeof toolName === 'string' ? toolName : undefined) ?? 'Tool'
  const withoutNamespace = raw.replace(/^(filesystem|web|system|git|roles|agent|time)[._-]+/i, '')
  const words = withoutNamespace.split(/[._\s-]+/).filter(Boolean)
  const humanized = words.map(formatToolNameWord).join(' ')
  return humanized || 'Tool'
}

function stringifyResourceValue(value: unknown): string | undefined {
  if (typeof value === 'string') return normalizedString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return normalizedString(value.map((item) => typeof item === 'string' ? item : safeStringifyJson(item)).join(' '))
  if (value && typeof value === 'object') return safeStringifyJson(value)
  return undefined
}

function displayResourceFields(display: unknown): string[] {
  const fields = recordValue(display)?.resourceFields
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string' && Boolean(field.trim())) : []
}

function extractToolResource(args: unknown, display?: unknown): string | undefined {
  const record = recordValue(args)
  if (!record) return undefined
  const parameters = [
    ...displayResourceFields(display),
    'path',
    'url',
    'query',
    'command',
    'args',
    'pattern',
    'condition',
    'task',
    'invocationId',
    'parentRunId',
    'wakeAt',
    'seconds',
    'message',
    'name',
    'id'
  ]
  for (const parameter of parameters) {
    if (!Object.prototype.hasOwnProperty.call(record, parameter)) continue
    const resource = stringifyResourceValue(record[parameter])
    if (resource) return resource
  }
  return undefined
}

function createToolDisplayInfo(args: unknown, event: PiEventLike, fallback?: ToolDisplayInfo, metadata?: ReturnType<typeof extractToolResultMetadata>): ToolDisplayInfo {
  const record = recordValue(args)
  const display = metadata?.display ?? fallback?.display
  const displayName = normalizedString(record?._displayName)
    ?? metadata?.displayName
    ?? fallback?.displayName
    ?? displayNameFromDisplay(display)
    ?? humanizeToolName(event.toolName)
  const resource = extractToolResource(args, display) ?? fallback?.resource
  return {
    displayName,
    ...(resource !== undefined ? { resource } : {}),
    ...(display !== undefined ? { display } : {})
  }
}

function queuePendingToolStepId(state: RunState, key: string, stepId: string): void {
  const pending = state.pendingToolStepIdsByKey.get(key) ?? []
  pending.push(stepId)
  state.pendingToolStepIdsByKey.set(key, pending)
}

function takePendingToolStepId(state: RunState, key: string, runId: string, event: PiEventLike): string {
  const pending = state.pendingToolStepIdsByKey.get(key) ?? []
  const stepId = pending.shift()
  if (pending.length === 0) {
    state.pendingToolStepIdsByKey.delete(key)
  } else {
    state.pendingToolStepIdsByKey.set(key, pending)
  }
  if (stepId) return stepId

  const toolCallId = getToolCallId(event)
  return `step-${runId}-tool-${toolCallId ?? 'unknown'}`
}

function beginAssistantMessage(runId: string, event: PiEventLike): void {
  const message = event.message as { role?: unknown } | undefined
  if (message?.role !== 'assistant') return

  const state = getRunState(runId)
  state.assistantMessageCounter += 1
  state.currentAssistantMessageOrdinal = state.assistantMessageCounter
}

function endAssistantMessage(runId: string, event: PiEventLike): void {
  const message = event.message as { role?: unknown } | undefined
  if (message?.role !== 'assistant') return

  const state = getRunState(runId)
  state.currentAssistantMessageOrdinal = undefined
}

function assistantBlockKey(state: RunState, contentIndex: number): string {
  return `${state.currentAssistantMessageOrdinal ?? 0}:${contentIndex}`
}

function createThinkingStepId(runId: string, state: RunState, contentIndex: number): string {
  const ordinal = state.currentAssistantMessageOrdinal
  return ordinal === undefined
    ? `step-${runId}-thinking-${contentIndex}`
    : `step-${runId}-thinking-${ordinal}-${contentIndex}`
}

function createToolStepId(runId: string, event: PiEventLike, state: RunState, key: string): string {
  const toolCallId = getToolCallId(event)
  if (!toolCallId) {
    state.anonymousToolCounter += 1
    return `step-${runId}-tool-anonymous-${state.anonymousToolCounter}`
  }

  const nextCount = (state.toolCountsByKey.get(key) ?? 0) + 1
  state.toolCountsByKey.set(key, nextCount)
  return nextCount === 1 ? `step-${runId}-tool-${toolCallId}` : `step-${runId}-tool-${toolCallId}-${nextCount}`
}

function createToolStepEvent(kind: StepEvent['type'], runId: string, event: PiEventLike): StepEvent {
  const state = getRunState(runId)
  const key = toolCorrelationKey(event)

  if (kind === 'step.created') {
    const stepId = createToolStepId(runId, event, state, key)
    const input = event.args
    const purpose = extractToolPurpose(input)
    const displayInfo = createToolDisplayInfo(input, event)
    if (purpose) state.toolPurposeByStepId.set(stepId, purpose)
    if (input !== undefined) state.toolInputByStepId.set(stepId, input)
    state.toolDisplayByStepId.set(stepId, displayInfo)
    queuePendingToolStepId(state, key, stepId)
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'tool_call', 'running', displayInfo.displayName, purpose, createToolStepDetail(input, undefined, undefined, displayInfo))
    }
  }

  const stepId = takePendingToolStepId(state, key, runId, event)
  const input = event.args !== undefined ? event.args : state.toolInputByStepId.get(stepId)
  const purpose = extractToolPurpose(input) ?? state.toolPurposeByStepId.get(stepId)
  const displayInfo = createToolDisplayInfo(input, event, state.toolDisplayByStepId.get(stepId))
  state.toolPurposeByStepId.delete(stepId)
  state.toolInputByStepId.delete(stepId)
  state.toolDisplayByStepId.delete(stepId)
  const output = event.result
  const outputMetadata = extractToolResultMetadata(output)
  const finalDisplayInfo = createToolDisplayInfo(input, event, displayInfo, outputMetadata)
  const isError = event.isError === true
  return {
    type: 'step.updated',
    step: createStep(
      runId,
      stepId,
      'tool_call',
      isError ? 'failed' : 'succeeded',
      finalDisplayInfo.displayName,
      purpose,
      createToolStepDetail(input, output, isError, finalDisplayInfo),
      nowIso()
    )
  }
}
function createThinkingStepEvent(kind: StepEvent['type'], runId: string, event: PiEventLike): StepEvent | undefined {
  const assistantMessageEvent = event.assistantMessageEvent as { contentIndex?: number; delta?: string; content?: string } | undefined
  const contentIndex = assistantMessageEvent?.contentIndex ?? 0
  const state = getRunState(runId)
  const blockKey = assistantBlockKey(state, contentIndex)
  const stepId = createThinkingStepId(runId, state, contentIndex)

  if (kind === 'step.created') {
    state.thinkingByBlockKey.set(blockKey, { stepId, text: '' })
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'thought', 'running', '思考过程', '正在思考…')
    }
  }

  const existing = state.thinkingByBlockKey.get(blockKey) ?? { stepId, text: '' }
  const nextText = typeof assistantMessageEvent?.content === 'string'
    ? assistantMessageEvent.content
    : `${existing.text}${assistantMessageEvent?.delta ?? ''}`
  const finalText = nextText || '正在思考…'
  const isDone = typeof assistantMessageEvent?.content === 'string'

  if (isDone) {
    state.thinkingByBlockKey.delete(blockKey)
  } else {
    state.thinkingByBlockKey.set(blockKey, { stepId: existing.stepId, text: nextText })
  }

  return {
    type: 'step.updated',
    step: createStep(runId, existing.stepId, 'thought', isDone ? 'succeeded' : 'running', '思考过程', finalText, finalText, isDone ? nowIso() : undefined)
  }
}

function createCommentaryStepEvent(runId: string, text: string): StepEvent {
  const state = getRunState(runId)
  state.commentaryCounter += 1
  const stepId = `step-${runId}-commentary-${state.commentaryCounter}`
  const normalized = text.replace(/\s+/g, ' ').trim()
  return {
    type: 'step.created',
    step: createStep(runId, stepId, 'thought', 'succeeded', '执行说明', normalized, normalized, nowIso())
  }
}

function createModelFailureStepEvent(runId: string, errorMessage: string): StepEvent {
  return {
    type: 'step.created',
    step: createStep(runId, `step-${runId}-model-failure`, 'warning', 'failed', '运行失败', errorMessage, errorMessage, nowIso())
  }
}

function createMessageCompletedEvent(context: MappingContext, event: PiEventLike): AgentRuntimeEvent[] {
  if (!context.sessionId) return []

  const message = event.message as { role?: string; content?: unknown; timestamp?: number; errorMessage?: unknown; stopReason?: unknown } | undefined
  if (!message || message.role !== 'assistant') return []

  const failureContent = formatFailureMessage(message.errorMessage)
  if (failureContent) {
    return [{
      type: 'message.completed',
      message: {
        id: `message-${context.runId}-assistant`,
        sessionId: context.sessionId,
        role: 'assistant',
        content: failureContent,
        contentType: inferContentType(message),
        runId: context.runId,
        createdAt: typeof message.timestamp === 'number' ? new Date(message.timestamp).toISOString() : nowIso()
      }
    }]
  }

  const textBlocks = extractTextBlocks(message.content)
  const hasToolCall = hasToolCallContent(message.content)
  const commentary = textBlocks
    .filter((block) => block.phase === 'commentary' || (hasToolCall && block.phase !== 'final_answer'))
    .map((block) => block.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const finalContent = textBlocks
    .filter((block) => block.phase !== 'commentary' && !(hasToolCall && block.phase !== 'final_answer'))
    .map((block) => block.text)
    .join('')

  const events: AgentRuntimeEvent[] = []
  if (commentary) {
    events.push(createCommentaryStepEvent(context.runId, commentary))
  }
  if (finalContent) {
    events.push({
      type: 'message.completed',
      message: {
        id: `message-${context.runId}-assistant`,
        sessionId: context.sessionId,
        role: 'assistant',
        content: finalContent,
        contentType: inferContentType(message),
        runId: context.runId,
        createdAt: typeof message.timestamp === 'number' ? new Date(message.timestamp).toISOString() : nowIso()
      }
    })
  }
  return events
}

export function mapPiEventToHesperEvents(context: string | MappingContext, piEvent: AgentEvent | PiEventLike): AgentRuntimeEvent[] {
  const normalizedContext = normalizeContext(context)
  const event = piEvent as PiEventLike

  switch (event.type) {
    case 'message_start':
      beginAssistantMessage(normalizedContext.runId, event)
      return []
    case 'message_update': {
      const assistantMessageEvent = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
      if (assistantMessageEvent?.type === 'text_delta') {
        return []
      }
      if (assistantMessageEvent?.type === 'thinking_start') {
        return [createThinkingStepEvent('step.created', normalizedContext.runId, event)].filter((candidate): candidate is StepEvent => Boolean(candidate))
      }
      if (assistantMessageEvent?.type === 'thinking_delta' || assistantMessageEvent?.type === 'thinking_end') {
        return [createThinkingStepEvent('step.updated', normalizedContext.runId, event)].filter((candidate): candidate is StepEvent => Boolean(candidate))
      }
      return []
    }
    case 'message_end': {
      const events = createMessageCompletedEvent(normalizedContext, event)
      endAssistantMessage(normalizedContext.runId, event)
      return events
    }
    case 'tool_execution_start':
      return [createToolStepEvent('step.created', normalizedContext.runId, event)]
    case 'tool_execution_end':
      return [createToolStepEvent('step.updated', normalizedContext.runId, event)]
    case 'turn_start':
      return []
    case 'turn_end': {
      const message = event.message as { errorMessage?: unknown; stopReason?: unknown } | undefined
      const failureSummary = normalizedFailureMessage(message?.errorMessage)
      return failureSummary ? [createModelFailureStepEvent(normalizedContext.runId, failureSummary)] : []
    }
    default:
      return []
  }
}
