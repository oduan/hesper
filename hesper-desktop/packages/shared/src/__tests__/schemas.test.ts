import { describe, expect, it } from 'vitest'
import {
  agentRuntimeEventSchema,
  agentRunSchema,
  messageSchema,
  modelConfigSchema,
  modelProviderConfigSchema,
  modelThinkingLevelSchema,
  roleSchema,
  runStepSchema,
  sessionCategorySchema,
  sessionSchema,
  skillSchema,
  sshCommandResultSchema,
  sshExecutionSchema,
  sshKeySchema,
  sshServerAgentSummarySchema,
  sshServerSchema,
  toolDefinitionSchema,
  toolPermissionPolicySchema,
  workerAgentInvocationSchema
} from '../schemas'

const now = '2026-06-10T03:00:00.000Z'

describe('shared schemas', () => {
  it('accepts maximum thinking level for model-aware runtime mapping', () => {
    expect(modelThinkingLevelSchema.parse('max')).toBe('max')
  })

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

  it('parses session marked state', () => {
    const parsed = sessionSchema.parse({
      id: 'session-marked',
      title: 'Marked chat',
      status: 'active',
      isMarked: true,
      outputMode: 'markdown',
      createdAt: now,
      updatedAt: now
    })

    expect(parsed.isMarked).toBe(true)
  })

  it('parses session categories and session category ids', () => {
    const parsedCategory = sessionCategorySchema.parse({
      id: 'category-product',
      name: '产品图',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z'
    })

    expect(parsedCategory).toEqual({
      id: 'category-product',
      name: '产品图',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z'
    })

    const parsedSession = sessionSchema.parse({
      id: 'session-product',
      title: '产品图会话',
      status: 'active',
      categoryId: 'category-product',
      outputMode: 'markdown',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z'
    })

    expect(parsedSession.categoryId).toBe('category-product')
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

  it('accepts Codex OAuth Pi provider metadata without an API endpoint', () => {
    const parsed = modelProviderConfigSchema.parse({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      hasApiKey: true,
      enabled: true,
      defaultModelId: 'pi/gpt-5.5',
      fastModeEnabled: true,
      createdAt: '2026-06-20T15:20:00.000Z',
      updatedAt: '2026-06-20T15:20:00.000Z'
    })

    expect(parsed).toMatchObject({
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      hasApiKey: true,
      fastModeEnabled: true
    })
  })

  it('rejects unsupported Pi OAuth provider names', () => {
    expect(() => modelProviderConfigSchema.parse({
      id: 'bad-oauth',
      name: 'Bad OAuth',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'not-codex',
      enabled: true,
      createdAt: '2026-06-20T15:20:00.000Z',
      updatedAt: '2026-06-20T15:20:00.000Z'
    })).toThrow()
  })

  it('rejects Pi OAuth provider metadata without an auth provider', () => {
    expect(() => modelProviderConfigSchema.parse({
      id: 'missing-codex-oauth',
      name: 'Missing Codex OAuth',
      kind: 'pi',
      authType: 'oauth',
      enabled: true,
      createdAt: '2026-06-20T15:20:00.000Z',
      updatedAt: '2026-06-20T15:20:00.000Z'
    })).toThrow()
  })

  it('rejects Pi auth provider metadata on non-Pi providers', () => {
    expect(() => modelProviderConfigSchema.parse({
      id: 'openai-codex-oauth',
      name: 'OpenAI with Codex OAuth',
      kind: 'openai',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      enabled: true,
      createdAt: '2026-06-20T15:20:00.000Z',
      updatedAt: '2026-06-20T15:20:00.000Z'
    })).toThrow()
  })

  it('rejects Pi auth provider metadata without OAuth auth type', () => {
    expect(() => modelProviderConfigSchema.parse({
      id: 'codex-api-key',
      name: 'Codex API Key',
      kind: 'pi',
      authType: 'api_key',
      piAuthProvider: 'openai-codex',
      enabled: true,
      createdAt: '2026-06-20T15:20:00.000Z',
      updatedAt: '2026-06-20T15:20:00.000Z'
    })).toThrow()
  })

  it('parses user messages with file-backed attachments', () => {
    const message = messageSchema.parse({
      id: 'message-attachment-1',
      sessionId: 'session-1',
      role: 'user',
      content: '看这张图',
      contentType: 'plain',
      createdAt: '2026-06-26T00:00:00.000Z',
      attachments: [
        { id: 'attachment-image-1', kind: 'image', name: 'pasted-image.png', mimeType: 'image/png', bytes: 128, relativePath: 'attachments/session-1/message-attachment-1/attachment-image-1.png' },
        { id: 'attachment-text-1', kind: 'text', name: 'notes.md', mimeType: 'text/markdown', bytes: 64, relativePath: 'attachments/session-1/message-attachment-1/attachment-text-1.md' }
      ]
    })
    expect(message.attachments).toHaveLength(2)
    expect(message.attachments?.[0]?.kind).toBe('image')
  })

  it('rejects unsupported file attachment kinds', () => {
    expect(() => messageSchema.parse({
      id: 'message-attachment-2',
      sessionId: 'session-1',
      role: 'user',
      content: '附件类型不对',
      contentType: 'plain',
      createdAt: '2026-06-26T00:00:00.000Z',
      attachments: [
        { id: 'attachment-file-1', kind: 'file', name: 'archive.bin', mimeType: 'application/octet-stream', bytes: 1, relativePath: 'attachments/session-1/message-attachment-2/attachment-file-1.bin' }
      ]
    })).toThrow()
  })

  it('accepts imageInput as a model capability', () => {
    const model = modelConfigSchema.parse({
      id: 'gpt-5.5', providerId: 'openai', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning', 'imageInput'], createdAt: '2026-06-26T00:00:00.000Z', updatedAt: '2026-06-26T00:00:00.000Z'
    })
    expect(model.capabilities).toContain('imageInput')
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

  it('validates user skill source metadata', () => {
    const parsed = skillSchema.parse({
      id: 'Research',
      name: 'Research',
      description: 'Find references',
      source: 'user',
      sourcePath: '~/.hesper/skills/research/SKILL.md',
      prompt: 'Use citations.'
    })

    expect(parsed.source).toBe('user')
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

  it('validates tool definition display metadata', () => {
    const parsed = toolDefinitionSchema.parse({
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      icon: '📖',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      display: {
        name: 'Read File',
        names: { 'zh-CN': '读取文件' },
        resourceFields: ['path']
      }
    })

    expect(parsed.display).toEqual({
      name: 'Read File',
      names: { 'zh-CN': '读取文件' },
      resourceFields: ['path']
    })
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

  it('validates Worker Agent invocations with role snapshots and tool constraints', () => {
    const parsed = workerAgentInvocationSchema.parse({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      modelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' },
      roleSnapshot: {
        id: 'reviewer',
        name: 'Reviewer',
        description: 'Reviews code for correctness.',
        systemPrompt: 'Review carefully.',
        defaultToolIds: ['filesystem.read-file'],
        defaultModelId: 'deepseek-chat',
        defaultModelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' }
      },
      expectedOutput: 'Findings with evidence.',
      status: 'succeeded',
      createdAt: now,
      completedAt: now
    })

    expect(parsed.roleId).toBe('reviewer')
    expect(parsed.allowedToolIds).toEqual(['filesystem.read-file', 'git.status'])
    expect(parsed.roleSnapshot).toMatchObject({
      id: 'reviewer',
      defaultModelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' }
    })
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

  it('validates SSH key, server, execution, and command result schemas without secrets', () => {
    const key = sshKeySchema.parse({
      id: 'ssh-key-1',
      name: 'Production key',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example',
      note: 'deploy only',
      hasPassphrase: true,
      createdAt: now,
      updatedAt: now
    })
    expect(key).toMatchObject({ id: 'ssh-key-1', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example', hasPassphrase: true })
    expect(JSON.stringify(key)).not.toContain('PRIVATE KEY')

    const server = sshServerSchema.parse({
      id: 'ssh-server-1',
      name: 'Production',
      host: '10.0.0.8',
      port: 22,
      username: 'deploy',
      keyId: 'ssh-key-1',
      note: 'log access',
      createdAt: now,
      updatedAt: now
    })
    expect(server).toMatchObject({ host: '10.0.0.8', port: 22, username: 'deploy', keyId: 'ssh-key-1' })

    const execution = sshExecutionSchema.parse({
      id: 'ssh-exec-1',
      sessionId: 'session-1',
      runId: 'run-1',
      serverId: 'ssh-server-1',
      serverName: 'Production',
      commands: ['pwd', 'whoami'],
      stopOnError: true,
      timeoutMs: 0,
      status: 'running',
      startedAt: now,
      updatedAt: now
    })
    expect(execution.timeoutMs).toBe(0)

    const result = sshCommandResultSchema.parse({
      executionId: 'ssh-exec-1',
      index: 0,
      command: 'pwd',
      status: 'succeeded',
      stdout: '/home/deploy\n',
      stderr: '',
      exitCode: 0,
      startedAt: now,
      completedAt: now,
      durationMs: 12
    })
    expect(result.stdout).toBe('/home/deploy\n')
  })

  it('keeps SSH server agent summaries free of connection details', () => {
    const summary = sshServerAgentSummarySchema.parse({
      id: 'ssh-server-1',
      name: 'Production',
      note: 'safe summary'
    })
    expect(summary).toEqual({ id: 'ssh-server-1', name: 'Production', note: 'safe summary' })

    expect(() => sshServerAgentSummarySchema.parse({
      id: 'ssh-server-1',
      name: 'Production',
      host: '10.0.0.8',
      port: 22,
      username: 'deploy',
      keyId: 'ssh-key-1'
    })).toThrow()
  })
})
