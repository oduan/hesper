import type { Api, Model } from '@earendil-works/pi-ai'
import { Agent } from '@earendil-works/pi-agent-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PiCoreAgentAdapter } from '../pi-core-adapter'

vi.mock('@earendil-works/pi-agent-core', () => {
  const AgentMock = vi.fn(function AgentMock() {
    return {
      subscribe: vi.fn(() => () => undefined),
      prompt: vi.fn(async () => undefined),
      waitForIdle: vi.fn(async () => undefined),
      abort: vi.fn()
    }
  })
  return { Agent: AgentMock }
})
import type { ModelResolver } from '../model-resolver'

function piModel(): Model<Api> {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o',
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192
  }
}

function resolverFor(modelOverrides: Partial<Model<Api>> = {}): ModelResolver {
  return {
    resolve: vi.fn(async () => ({
      model: { ...piModel(), ...modelOverrides },
      provider: {
        id: 'openai',
        name: 'OpenAI',
        kind: 'openai' as const,
        enabled: true,
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z'
      },
      modelConfig: {
        id: 'gpt-4o',
        providerId: 'openai',
        modelName: 'gpt-4o',
        displayName: 'GPT-4o',
        capabilities: ['streaming' as const],
        enabled: true,
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z'
      }
    }))
  }
}

describe('PiCoreAgentAdapter', () => {
  beforeEach(() => {
    vi.mocked(Agent).mockClear()
  })

  it('removes the abort listener after a pi core run completes', async () => {
    const controller = new AbortController()
    const addEventListenerSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor() })

    await adapter.run({
      runId: 'run-clean-abort-listener',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      signal: controller.signal
    }, vi.fn())

    const abortRegistration = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'abort')
    expect(abortRegistration).toEqual(['abort', expect.any(Function), { once: true }])
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', abortRegistration?.[1])
  })
  it('passes provider-aware modelRef to the model resolver when present', async () => {
    const resolver = resolverFor()
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolver })

    await adapter.run({
      runId: 'run-model-ref',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'legacy-fallback-model',
      modelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' },
      signal: new AbortController().signal
    }, vi.fn())

    expect(resolver.resolve).toHaveBeenCalledWith({ providerId: 'provider-deepseek', modelId: 'deepseek-chat' })
  })

  it('passes only modelId to the model resolver when modelRef is absent', async () => {
    const resolver = resolverFor()
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolver })

    await adapter.run({
      runId: 'run-model-id',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      signal: new AbortController().signal
    }, vi.fn())

    expect(resolver.resolve).toHaveBeenCalledWith({ modelId: 'gpt-4o' })
  })

  it('passes previous Hesper messages into the pi core transcript', async () => {
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor() })

    await adapter.run({
      runId: 'run-with-history',
      sessionId: 'session-1',
      prompt: 'what was my first question?',
      modelId: 'gpt-4o',
      historyMessages: [
        {
          id: 'message-user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'first question',
          contentType: 'plain',
          runId: 'run-1',
          createdAt: '2026-06-10T06:00:00.000Z'
        },
        {
          id: 'message-assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'first answer',
          contentType: 'markdown',
          runId: 'run-1',
          createdAt: '2026-06-10T06:00:01.000Z'
        }
      ],
      signal: new AbortController().signal
    }, vi.fn())

    expect(Agent).toHaveBeenCalledWith(expect.objectContaining({
      initialState: expect.objectContaining({
        messages: [
          { role: 'user', content: 'first question', timestamp: Date.parse('2026-06-10T06:00:00.000Z') },
          expect.objectContaining({
            role: 'assistant',
            content: [{ type: 'text', text: 'first answer' }],
            api: 'openai-responses',
            provider: 'openai',
            model: 'gpt-4o',
            stopReason: 'stop',
            timestamp: Date.parse('2026-06-10T06:00:01.000Z')
          })
        ]
      })
    }))
  })

  it('passes synthetic run context messages as user-role transcript entries', async () => {
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor() })

    await adapter.run({
      runId: 'run-with-context-summary',
      sessionId: 'session-1',
      prompt: 'continue',
      modelId: 'gpt-4o',
      historyMessages: [
        {
          id: 'context-summary-run-1',
          sessionId: 'session-1',
          role: 'user',
          content: '<hesper_run_context run_id="run-1">\ntool_activity:\n{"detail":{"output":"hello"},"status":"succeeded","title":"Read File","type":"tool_call"}\n</hesper_run_context>',
          contentType: 'plain',
          runId: 'run-1',
          createdAt: '2026-06-25T04:00:00.000Z'
        }
      ],
      signal: new AbortController().signal
    }, vi.fn())

    expect(Agent).toHaveBeenCalledWith(expect.objectContaining({
      initialState: expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('<hesper_run_context run_id="run-1">')
          })
        ]
      })
    }))
  })

  it('requests medium thinking for reasoning-capable real models', async () => {
    const resolver: ModelResolver = {
      resolve: vi.fn(async () => ({
        model: { ...piModel(), reasoning: true },
        provider: {
          id: 'openai',
          name: 'OpenAI',
          kind: 'openai' as const,
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        },
        modelConfig: {
          id: 'gpt-4o',
          providerId: 'openai',
          modelName: 'gpt-4o',
          displayName: 'GPT-4o',
          capabilities: ['streaming' as const, 'reasoning' as const],
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }))
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolver })

    await adapter.run({
      runId: 'run-thinking',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      signal: new AbortController().signal
    }, vi.fn())

    expect(Agent).toHaveBeenCalledWith(expect.objectContaining({
      initialState: expect.objectContaining({
        thinkingLevel: 'medium'
      })
    }))
  })

  it('uses requested ultra-high thinking when the resolved model supports xhigh', async () => {
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor({ reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } }) })

    await adapter.run({
      runId: 'run-thinking-xhigh',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      thinkingLevel: 'xhigh',
      signal: new AbortController().signal
    }, vi.fn())

    expect(Agent).toHaveBeenCalledWith(expect.objectContaining({
      initialState: expect.objectContaining({
        thinkingLevel: 'xhigh'
      })
    }))
  })

  it('falls ultra-high thinking back to high when the resolved model lacks xhigh support', async () => {
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor({ reasoning: true }) })

    await adapter.run({
      runId: 'run-thinking-xhigh-fallback',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      thinkingLevel: 'xhigh',
      signal: new AbortController().signal
    }, vi.fn())

    expect(Agent).toHaveBeenCalledWith(expect.objectContaining({
      initialState: expect.objectContaining({
        thinkingLevel: 'high'
      })
    }))
  })

  it('does not resolve a model or start pi core when the signal is already aborted', async () => {
    const resolver: ModelResolver = {
      resolve: vi.fn(async () => ({
        model: piModel(),
        provider: {
          id: 'openai',
          name: 'OpenAI',
          kind: 'openai' as const,
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        },
        modelConfig: {
          id: 'gpt-4o',
          providerId: 'openai',
          modelName: 'gpt-4o',
          displayName: 'GPT-4o',
          capabilities: ['streaming' as const],
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }))
    }
    const controller = new AbortController()
    controller.abort()
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolver })

    await expect(adapter.run({
      runId: 'run-aborted',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      signal: controller.signal
    }, vi.fn())).rejects.toMatchObject({ retryable: false })

    expect(resolver.resolve).not.toHaveBeenCalled()
  })
})
