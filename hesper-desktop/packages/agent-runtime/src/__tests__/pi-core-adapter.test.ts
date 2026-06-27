import type { Api, Model } from '@earendil-works/pi-ai'
import { Agent } from '@earendil-works/pi-agent-core'
import type { MessageAttachment, ModelCapability } from '@hesper/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PiCoreAgentAdapter } from '../pi-core-adapter'

const agentPromptCalls = vi.hoisted(() => [] as Array<{ input: unknown; images: unknown }>)
const streamSimpleCalls = vi.hoisted(() => [] as Array<{ model: unknown; context: unknown; options: unknown }>)

vi.mock('@earendil-works/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai')>()
  return {
    ...actual,
    streamSimple: vi.fn((model: unknown, context: unknown, options: unknown) => {
      streamSimpleCalls.push({ model, context, options })
      return {} as ReturnType<typeof actual.streamSimple>
    })
  }
})

vi.mock('@earendil-works/pi-agent-core', () => {
  const AgentMock = vi.fn(function AgentMock() {
    return {
      subscribe: vi.fn(() => () => undefined),
      prompt: vi.fn(async (input: unknown, images: unknown) => {
        agentPromptCalls.push({ input, images })
      }),
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

function resolverFor(modelOverrides: Partial<Model<Api>> = {}, capabilities: ModelCapability[] = ['streaming']): ModelResolver {
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
        capabilities,
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
    agentPromptCalls.length = 0
    streamSimpleCalls.length = 0
  })

  it('sends image attachments to image-capable models', async () => {
    const imageBuffer = Buffer.from('fake-png')
    const attachment: MessageAttachment = {
      id: 'attachment-image-1',
      kind: 'image',
      name: 'screenshot.png',
      mimeType: 'image/png',
      bytes: imageBuffer.length,
      relativePath: 'attachments/screenshot.png'
    }
    const attachmentReader = {
      readImageAttachment: vi.fn(async () => imageBuffer),
      readTextAttachment: vi.fn(async () => 'unused')
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor({ input: ['text', 'image'] }) })

    await adapter.run({
      runId: 'run-image-attachment',
      sessionId: 'session-1',
      prompt: 'describe this',
      modelId: 'gpt-4o',
      attachments: [attachment],
      attachmentReader,
      signal: new AbortController().signal
    }, vi.fn())

    expect(attachmentReader.readImageAttachment).toHaveBeenCalledWith('attachments/screenshot.png')
    expect(agentPromptCalls).toEqual([
      {
        input: 'describe this',
        images: [{ type: 'image', data: imageBuffer.toString('base64'), mimeType: 'image/png' }]
      }
    ])
  })

  it('sends image attachments when registry capabilities include imageInput', async () => {
    const imageBuffer = Buffer.from('fake-png')
    const attachment: MessageAttachment = {
      id: 'attachment-image-capability',
      kind: 'image',
      name: 'screenshot.png',
      mimeType: 'image/png',
      bytes: imageBuffer.length,
      relativePath: 'attachments/screenshot.png'
    }
    const attachmentReader = {
      readImageAttachment: vi.fn(async () => imageBuffer),
      readTextAttachment: vi.fn(async () => 'unused')
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor({ input: ['text'] }, ['streaming', 'imageInput']) })

    await adapter.run({
      runId: 'run-image-capability-attachment',
      sessionId: 'session-1',
      prompt: 'describe this',
      modelId: 'gpt-4o',
      attachments: [attachment],
      attachmentReader,
      signal: new AbortController().signal
    }, vi.fn())

    expect(attachmentReader.readImageAttachment).toHaveBeenCalledWith('attachments/screenshot.png')
    expect(agentPromptCalls).toEqual([
      {
        input: 'describe this',
        images: [{ type: 'image', data: imageBuffer.toString('base64'), mimeType: 'image/png' }]
      }
    ])
  })

  it('does not read or send image attachments to text-only models', async () => {
    const attachment: MessageAttachment = {
      id: 'attachment-image-1',
      kind: 'image',
      name: 'screenshot.png',
      mimeType: 'image/png',
      bytes: 8,
      relativePath: 'attachments/screenshot.png'
    }
    const attachmentReader = {
      readImageAttachment: vi.fn(async () => Buffer.from('fake-png')),
      readTextAttachment: vi.fn(async () => 'unused')
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor({ input: ['text'] }) })

    await adapter.run({
      runId: 'run-text-only-image-attachment',
      sessionId: 'session-1',
      prompt: 'describe this',
      modelId: 'gpt-4o',
      attachments: [attachment],
      attachmentReader,
      signal: new AbortController().signal
    }, vi.fn())

    expect(attachmentReader.readImageAttachment).not.toHaveBeenCalled()
    expect(agentPromptCalls).toEqual([{ input: 'describe this', images: undefined }])
  })

  it('appends text attachments to the prompt', async () => {
    const attachment: MessageAttachment = {
      id: 'attachment-text-1',
      kind: 'text',
      name: 'notes.md',
      mimeType: 'text/markdown',
      bytes: 7,
      relativePath: 'attachments/notes.md'
    }
    const attachmentReader = {
      readImageAttachment: vi.fn(async () => Buffer.from('unused')),
      readTextAttachment: vi.fn(async () => '# Hello')
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor() })

    await adapter.run({
      runId: 'run-text-attachment',
      sessionId: 'session-1',
      prompt: 'summarize',
      modelId: 'gpt-4o',
      attachments: [attachment],
      attachmentReader,
      signal: new AbortController().signal
    }, vi.fn())

    expect(attachmentReader.readTextAttachment).toHaveBeenCalledWith('attachments/notes.md')
    expect(agentPromptCalls[0]?.input).toContain('<attachment name="notes.md" mimeType="text/markdown">\n# Hello\n</attachment>')
    expect(agentPromptCalls[0]?.images).toBeUndefined()
  })

  it('does not start pi core when the signal aborts while reading attachments', async () => {
    const controller = new AbortController()
    const attachment: MessageAttachment = {
      id: 'attachment-text-abort',
      kind: 'text',
      name: 'notes.md',
      mimeType: 'text/markdown',
      bytes: 7,
      relativePath: 'attachments/notes.md'
    }
    const attachmentReader = {
      readImageAttachment: vi.fn(async () => Buffer.from('unused')),
      readTextAttachment: vi.fn(async () => {
        controller.abort()
        await Promise.resolve()
        return '# Hello'
      })
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor() })

    await expect(adapter.run({
      runId: 'run-abort-attachment-read',
      sessionId: 'session-1',
      prompt: 'summarize',
      modelId: 'gpt-4o',
      attachments: [attachment],
      attachmentReader,
      signal: controller.signal
    }, vi.fn())).rejects.toMatchObject({ retryable: false })

    expect(Agent).not.toHaveBeenCalled()
    expect(agentPromptCalls).toEqual([])
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
  it('does not install a runtime streamFn when no runtime options are resolved', async () => {
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolverFor() })

    await adapter.run({
      runId: 'run-standard-model',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'gpt-4o',
      signal: new AbortController().signal
    }, vi.fn())

    const options = vi.mocked(Agent).mock.calls[0]?.[0] as { streamFn?: unknown }
    expect(options.streamFn).toBeUndefined()
  })

  it('injects priority service tier through a streamFn wrapper for fast Codex providers', async () => {
    const resolver: ModelResolver = {
      resolve: vi.fn(async () => ({
        model: { ...piModel(), id: 'gpt-5.5', api: 'openai-codex-responses', provider: 'chatgpt-codex', reasoning: true },
        provider: {
          id: 'chatgpt-codex',
          name: 'ChatGPT Codex',
          kind: 'pi' as const,
          authType: 'oauth' as const,
          piAuthProvider: 'openai-codex' as const,
          fastModeEnabled: true,
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        },
        modelConfig: {
          id: 'pi/gpt-5.5',
          providerId: 'chatgpt-codex',
          modelName: 'gpt-5.5',
          displayName: 'GPT-5.5',
          capabilities: ['streaming', 'toolCalls', 'reasoning'] as ModelCapability[],
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        },
        runtimeOptions: { serviceTier: 'priority' as const }
      }))
    }
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolver })

    await adapter.run({
      runId: 'run-fast-codex',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'pi/gpt-5.5',
      signal: new AbortController().signal
    }, vi.fn())

    const options = vi.mocked(Agent).mock.calls[0]?.[0] as { streamFn?: (model: unknown, context: unknown, options?: unknown) => unknown }
    expect(options.streamFn).toBeTypeOf('function')
    options.streamFn?.({ id: 'gpt-5.5' }, { messages: [] }, { maxTokens: 123 })
    expect(streamSimpleCalls[0]?.options).toMatchObject({ maxTokens: 123, serviceTier: 'priority' })
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
