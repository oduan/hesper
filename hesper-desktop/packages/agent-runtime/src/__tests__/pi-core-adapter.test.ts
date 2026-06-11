import type { Api, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { PiCoreAgentAdapter } from '../pi-core-adapter'
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

describe('PiCoreAgentAdapter', () => {
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
