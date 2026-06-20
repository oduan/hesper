import type { AgentRun, Message, RunError, RunStep, WorkerAgentInvocation } from './domain'

export type AgentRuntimeEvent =
  | { type: 'run.created'; run: AgentRun }
  | { type: 'run.started'; runId: string; startedAt?: string }
  | { type: 'step.created'; step: RunStep }
  | { type: 'step.updated'; step: RunStep }
  | { type: 'message.delta'; runId: string; delta: string }
  | { type: 'message.completed'; message: Message }
  | { type: 'run.retrying'; runId: string; retryCount: number; nextRetryAt: string }
  | { type: 'run.failed'; runId: string; error: RunError; endedAt?: string }
  | { type: 'run.succeeded'; runId: string; endedAt?: string }
  | { type: 'run.cancelled'; runId: string; endedAt?: string }
  | { type: 'worker.invocation.created'; invocation: WorkerAgentInvocation }
  | { type: 'worker.invocation.updated'; invocation: WorkerAgentInvocation }
