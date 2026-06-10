import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AgentRuntimeEvent, RunStep, RunStepStatus, RunStepType } from '@hesper/shared'

type StepEvent = Extract<AgentRuntimeEvent, { type: 'step.created' | 'step.updated' }>

type PiEventLike = Pick<AgentEvent, 'type'> & Record<string, unknown>

function nowIso(): string {
  return new Date().toISOString()
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
      'tool_result',
      isError ? 'failed' : 'succeeded',
      title,
      resultText,
      resultText,
      nowIso()
    )
  }
}

function createModelStepEvent(kind: StepEvent['type'], runId: string, summary?: string): StepEvent {
  const stepId = `step-${runId}-model-call`
  if (kind === 'step.created') {
    return {
      type: 'step.created',
      step: createStep(runId, stepId, 'model_call', 'running', 'Model turn', summary)
    }
  }

  return {
    type: 'step.updated',
    step: createStep(runId, stepId, 'model_call', 'succeeded', 'Model turn', summary, undefined, nowIso())
  }
}

export function mapPiEventToHesperEvents(runId: string, piEvent: AgentEvent | PiEventLike): AgentRuntimeEvent[] {
  const event = piEvent as PiEventLike

  switch (event.type) {
    case 'message_update': {
      const assistantMessageEvent = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
      if (assistantMessageEvent?.type === 'text_delta') {
        return [{ type: 'message.delta', runId, delta: assistantMessageEvent.delta ?? '' }]
      }
      return []
    }
    case 'tool_execution_start':
      return [createToolStepEvent('step.created', runId, event)]
    case 'tool_execution_end':
      return [createToolStepEvent('step.updated', runId, event)]
    case 'turn_start':
      return [createModelStepEvent('step.created', runId)]
    case 'turn_end':
      return [createModelStepEvent('step.updated', runId)]
    default:
      return []
  }
}
