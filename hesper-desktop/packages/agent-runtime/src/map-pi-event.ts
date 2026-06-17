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
  turnCounter: number
  activeTurnIds: string[]
  thinkingByContentIndex: Map<number, ThinkingState>
}

const runStates = new Map<string, RunState>()

function nowIso(): string {
  return new Date().toISOString()
}

function getRunState(runId: string): RunState {
  const existing = runStates.get(runId)
  if (existing) return existing
  const created: RunState = { turnCounter: 0, activeTurnIds: [], thinkingByContentIndex: new Map() }
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

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      if ((item as { type?: string }).type === 'text' && typeof (item as { text?: unknown }).text === 'string') {
        return [(item as { text: string }).text]
      }
      return []
    })
    .join('')
}

function inferContentType(message: { content?: unknown }): MessageContentType {
  if (typeof message.content === 'string') return 'plain'
  return 'markdown'
}

function normalizeContext(context: string | MappingContext): MappingContext {
  return typeof context === 'string' ? { runId: context } : context
}

function createToolStepEvent(kind: StepEvent['type'], runId: string, event: PiEventLike): StepEvent {
  const stepId = `step-${runId}-tool-${String(event.toolCallId ?? 'unknown')}`
  const title = `Tool: ${String(event.toolName ?? 'unknown')}`
  const argsText = stringify(event.args)

  if (kind === 'step.created') {
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'tool_call', 'running', title, argsText, argsText)
    }
  }

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

function createModelStepEvent(kind: StepEvent['type'], runId: string, summary?: string): StepEvent {
  const state = getRunState(runId)

  if (kind === 'step.created') {
    state.turnCounter += 1
    const stepId = `step-${runId}-model-call-${state.turnCounter}`
    state.activeTurnIds.push(stepId)
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'model_call', 'running', 'Model turn', summary)
    }
  }

  const stepId = state.activeTurnIds.shift() ?? `step-${runId}-model-call-${state.turnCounter + 1}`
  return {
    type: 'step.updated',
    step: createStep(runId, stepId, 'model_call', 'succeeded', 'Model turn', summary, undefined, nowIso())
  }
}

function createMessageCompletedEvent(context: MappingContext, event: PiEventLike): AgentRuntimeEvent[] {
  if (!context.sessionId) return []

  const message = event.message as { role?: string; content?: unknown; timestamp?: number } | undefined
  if (!message || message.role !== 'assistant') return []

  const content = extractTextFromContent(message.content)
  return [{
    type: 'message.completed',
    message: {
      id: `message-${context.runId}-assistant`,
      sessionId: context.sessionId,
      role: 'assistant',
      content,
      contentType: inferContentType(message),
      runId: context.runId,
      createdAt: typeof message.timestamp === 'number' ? new Date(message.timestamp).toISOString() : nowIso()
    }
  }]
}

export function mapPiEventToHesperEvents(context: string | MappingContext, piEvent: AgentEvent | PiEventLike): AgentRuntimeEvent[] {
  const normalizedContext = normalizeContext(context)
  const event = piEvent as PiEventLike

  switch (event.type) {
    case 'message_update': {
      const assistantMessageEvent = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
      if (assistantMessageEvent?.type === 'text_delta') {
        return [{ type: 'message.delta', runId: normalizedContext.runId, delta: assistantMessageEvent.delta ?? '' }]
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
      return [createModelStepEvent('step.created', normalizedContext.runId)]
    case 'turn_end':
      return [createModelStepEvent('step.updated', normalizedContext.runId)]
    default:
      return []
  }
}
