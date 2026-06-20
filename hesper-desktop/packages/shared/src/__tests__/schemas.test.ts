import { describe, expect, it } from 'vitest'
import {
  agentRuntimeEventSchema,
  agentRunSchema,
  modelConfigSchema,
  modelProviderConfigSchema,
  roleSchema,
  runStepSchema,
  sessionSchema,
  workerAgentInvocationSchema,
  toolPermissionPolicySchema
} from '../schemas'

const now = '2026-06-10T03:00:00.000Z'

describe('shared schemas', () => {
  it('validates an agent run', () => {
    const parsed = agentRunSchema.parse({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'running',
      modelId: 'model-1',
      retryCount: 0,
      maxRetries: 3,
      workerAgentInvocationId: 'worker-agent-1',
      depth: 1
    })

    expect(parsed.status).toBe('running')
    expect(parsed.workerAgentInvocationId).toBe('worker-agent-1')
  })

  it('validates a run step', () => {
    const parsed = runStepSchema.parse({
      id: 'step-1',
      runId: 'run-1',
      type: 'tool_call',
      status: 'pending',
      title: 'Call tool',
      createdAt: now
    })

    expect(parsed.type).toBe('tool_call')
  })

  it('parses run.failed events', () => {
    const parsed = agentRuntimeEventSchema.parse({
      type: 'run.failed',
      runId: 'run-1',
      error: { code: 'tool_error', message: 'boom', retryable: false },
      endedAt: now
    })

    expect(parsed.type).toBe('run.failed')
    expect(parsed).toMatchObject({ endedAt: now })
  })

  it('parses run lifecycle timestamps', () => {
    expect(agentRuntimeEventSchema.parse({
      type: 'run.started',
      runId: 'run-1',
      startedAt: now
    })).toMatchObject({ type: 'run.started', startedAt: now })

    expect(agentRuntimeEventSchema.parse({
      type: 'run.succeeded',
      runId: 'run-1',
      endedAt: now
    })).toMatchObject({ type: 'run.succeeded', endedAt: now })

    expect(agentRuntimeEventSchema.parse({
      type: 'run.cancelled',
      runId: 'run-1',
      endedAt: now
    })).toMatchObject({ type: 'run.cancelled', endedAt: now })
  })

  it('parses run.created events', () => {
    const parsed = agentRuntimeEventSchema.parse({
      type: 'run.created',
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        status: 'queued',
        modelId: 'model-1',
        retryCount: 0,
        maxRetries: 3
      }
    })

    expect(parsed.type).toBe('run.created')
  })

  it('normalizes explicit undefined optional fields', () => {
    const parsed = sessionSchema.parse({
      id: 'session-1',
      title: 'Build hesper',
      status: 'active',
      workspacePath: undefined,
      defaultModelId: undefined,
      providerId: undefined,
      unreadCompletedAt: undefined,
      outputMode: 'markdown',
      createdAt: now,
      updatedAt: now
    })

    expect('workspacePath' in parsed).toBe(false)
    expect('defaultModelId' in parsed).toBe(false)
    expect('providerId' in parsed).toBe(false)
    expect('unreadCompletedAt' in parsed).toBe(false)
  })

  it('validates session unread completion marker', () => {
    const parsed = sessionSchema.parse({
      id: 'session-unread',
      title: 'Build hesper',
      status: 'active',
      outputMode: 'markdown',
      unreadCompletedAt: now,
      createdAt: now,
      updatedAt: now
    })

    expect(parsed.unreadCompletedAt).toBe(now)
  })

  it('validates model providers without exposing raw API keys', () => {
    const parsed = modelProviderConfigSchema.parse({
      id: 'provider-deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKeyRef: 'vault:provider-deepseek',
      hasApiKey: true,
      enabled: true,
      defaultModelId: 'deepseek-chat',
      createdAt: now,
      updatedAt: now
    })

    expect(parsed.kind).toBe('deepseek')
    expect('apiKey' in parsed).toBe(false)
  })

  it('validates model capabilities and provider linkage', () => {
    const parsed = modelConfigSchema.parse({
      id: 'deepseek-chat',
      providerId: 'provider-deepseek',
      modelName: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilities: ['streaming', 'toolCalls'],
      contextWindow: 64000,
      enabled: true,
      createdAt: now,
      updatedAt: now
    })

    expect(parsed.capabilities).toEqual(['streaming', 'toolCalls'])
  })

  it('validates role prompt and Worker Agent assignment metadata', () => {
    const parsed = roleSchema.parse({
      id: 'reviewer',
      name: 'Reviewer',
      systemPrompt: 'Review for correctness and risk.',
      allowedSkillIds: ['skill-review'],
      defaultSkillIds: ['skill-review'],
      defaultToolIds: ['filesystem.read-file', 'git.status'],
      canBeMainAgent: true,
      canBeWorkerAgent: true,
      canBeAssignedToWorkerAgent: true,
      workerAgentGuidance: 'Return findings with evidence.'
    })

    expect(parsed.canBeAssignedToWorkerAgent).toBe(true)
  })

  it('validates tool permission policies', () => {
    const parsed = toolPermissionPolicySchema.parse({
      id: 'policy-1',
      toolId: 'filesystem.read-file',
      mode: 'allow',
      scope: 'worker-agent',
      subjectId: 'reviewer',
      riskLevel: 'low',
      createdAt: now,
      updatedAt: now
    })

    expect(parsed.scope).toBe('worker-agent')
  })

  it('validates Worker Agent invocations with role and tool constraints', () => {
    const parsed = workerAgentInvocationSchema.parse({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      modelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' },
      expectedOutput: 'Findings with evidence.',
      status: 'succeeded',
      createdAt: now,
      completedAt: now
    })

    expect(parsed.roleId).toBe('reviewer')
    expect(parsed.allowedToolIds).toEqual(['filesystem.read-file', 'git.status'])
  })

  it('validates Worker Agent invocation UI and diagnosis metadata', () => {
    const parsed = workerAgentInvocationSchema.parse({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      parentStepId: 'step-run-parent-tool-tool-1',
      parentToolCallId: 'tool-1',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      modelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' },
      expectedOutput: 'Findings with evidence.',
      contextSummary: 'The parent run is validating a refactor.',
      status: 'running',
      lastEventAt: now,
      createdAt: now
    })

    expect(parsed.parentStepId).toBe('step-run-parent-tool-tool-1')
    expect(parsed.parentToolCallId).toBe('tool-1')
    expect(parsed.contextSummary).toBe('The parent run is validating a refactor.')
    expect(parsed.lastEventAt).toBe(now)
  })

  it('parses Worker Agent invocation runtime events', () => {
    const invocation = workerAgentInvocationSchema.parse({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      parentStepId: 'step-run-parent-tool-tool-1',
      parentToolCallId: 'tool-1',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      status: 'running',
      createdAt: now,
      lastEventAt: now
    })

    expect(agentRuntimeEventSchema.parse({
      type: 'worker.invocation.created',
      invocation
    })).toMatchObject({ type: 'worker.invocation.created', invocation: { id: 'worker-agent-1' } })

    expect(agentRuntimeEventSchema.parse({
      type: 'worker.invocation.updated',
      invocation: { ...invocation, status: 'succeeded', completedAt: now }
    })).toMatchObject({ type: 'worker.invocation.updated', invocation: { status: 'succeeded' } })
  })
})
