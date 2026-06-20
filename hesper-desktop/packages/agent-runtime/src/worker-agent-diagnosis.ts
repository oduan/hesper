import type { RunStep, RunStepStatus, RunStepType } from '@hesper/shared'

export type WorkerAgentDiagnosis = {
  progressState: 'active' | 'quiet' | 'possibly_stalled'
  lastEventAt?: string
  runningForMs: number
  idleForMs?: number
  activeStep?: {
    id: string
    type: RunStepType
    title: string
    status: RunStepStatus
    runningForMs?: number
  }
  recommendation: 'continue_waiting' | 'inspect' | 'cancel_and_retry'
}

type DiagnoseInput = {
  startedAt?: string
  lastEventAt?: string
  now?: string
  activeStep?: RunStep
}

function parseMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function diagnoseWorkerAgent(input: DiagnoseInput): WorkerAgentDiagnosis {
  const nowMs = parseMs(input.now, Date.now())
  const startedMs = parseMs(input.startedAt, nowMs)
  const lastEventMs = parseMs(input.lastEventAt, startedMs)
  const runningForMs = Math.max(0, nowMs - startedMs)
  const idleForMs = Math.max(0, nowMs - lastEventMs)
  const progressState = idleForMs < 30_000 ? 'active' : idleForMs < 120_000 ? 'quiet' : 'possibly_stalled'
  const recommendation = progressState === 'active' ? 'continue_waiting' : progressState === 'quiet' ? 'inspect' : 'cancel_and_retry'

  return {
    progressState,
    ...(input.lastEventAt ? { lastEventAt: input.lastEventAt } : {}),
    runningForMs,
    idleForMs,
    ...(input.activeStep
      ? {
          activeStep: {
            id: input.activeStep.id,
            type: input.activeStep.type,
            title: input.activeStep.title,
            status: input.activeStep.status,
            runningForMs: Math.max(0, nowMs - parseMs(input.activeStep.createdAt, nowMs))
          }
        }
      : {}),
    recommendation
  }
}
