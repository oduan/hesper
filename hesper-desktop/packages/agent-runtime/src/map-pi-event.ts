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
  toolCountsByKey: Map<string, number>
  pendingToolStepIdsByKey: Map<string, string[]>
  thinkingByContentIndex: Map<number, ThinkingState>
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
    toolCountsByKey: new Map(),
    pendingToolStepIdsByKey: new Map(),
    thinkingByContentIndex: new Map()
  }
  runStates.set(runId, created)
  return created
}

export function clearPiEventRunState(runId: string): void {
  runStates.delete(runId)
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

function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
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
  const title = `工具：${String(event.toolName ?? 'unknown')}`
  const argsText = stringify(event.args)

  if (kind === 'step.created') {
    const stepId = createToolStepId(runId, event, state, key)
    queuePendingToolStepId(state, key, stepId)
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'tool_call', 'running', title, argsText, argsText)
    }
  }

  const stepId = takePendingToolStepId(state, key, runId, event)
  const resultText = stringify(event.result)
  const isError = event.isError === true
  return {
    type: 'step.updated',
    step: createStep(
      runId,
      stepId,
      'tool_call',
      isError ? 'failed' : 'succeeded',
      title,
      resultText,
      resultText,
      nowIso()
    )
  }
}

function createThinkingStepEvent(kind: StepEvent['type'], runId: string, event: PiEventLike): StepEvent | undefined {
  const assistantMessageEvent = event.assistantMessageEvent as { contentIndex?: number; delta?: string; content?: string } | undefined
  const contentIndex = assistantMessageEvent?.contentIndex ?? 0
  const stepId = `step-${runId}-thinking-${contentIndex}`
  const state = getRunState(runId)

  if (kind === 'step.created') {
    state.thinkingByContentIndex.set(contentIndex, { stepId, text: '' })
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'thought', 'running', '思考过程', '正在思考…')
    }
  }

  const existing = state.thinkingByContentIndex.get(contentIndex) ?? { stepId, text: '' }
  const nextText = typeof assistantMessageEvent?.content === 'string'
    ? assistantMessageEvent.content
    : `${existing.text}${assistantMessageEvent?.delta ?? ''}`
  const finalText = nextText || '正在思考…'
  const isDone = typeof assistantMessageEvent?.content === 'string'

  if (isDone) {
    state.thinkingByContentIndex.delete(contentIndex)
  } else {
    state.thinkingByContentIndex.set(contentIndex, { stepId: existing.stepId, text: nextText })
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
    case 'message_end':
      return createMessageCompletedEvent(normalizedContext, event)
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
