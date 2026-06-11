import type { Api, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { PiCoreAgentAdapter } from '../pi-core-adapter'
import type { ModelResolver } from '../model-resolver'

const agentMock = vi.hoisted(() => ({
  constructorInputs: [] as Array<{ initialState?: { systemPrompt?: string } }>,
  prompts: [] as string[]
}))

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: class MockPiAgent {
    constructor(input: { initialState?: { systemPrompt?: string } }) {
      agentMock.constructorInputs.push(input)
    }

    subscribe() {
      return () => {}
    }

    abort() {}

    async prompt(prompt: string) {
      agentMock.prompts.push(prompt)
    }

    async waitForIdle() {}
  }
}))

function piModel(): Model<Api> {
  return {
    id: 'mock-model',
    name: 'Mock Model',
    api: 'openai-responses',
    provider: 'mock',
    baseUrl: 'https://example.invalid/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192
  }
}

function resolver(): ModelResolver {
  return {
    async resolve() {
      return {
        model: piModel(),
        provider: {
          id: 'mock',
          name: 'Mock',
          kind: 'mock' as const,
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        },
        modelConfig: {
          id: 'mock/hesper-fast',
          providerId: 'mock',
          modelName: 'hesper-fast',
          displayName: 'Hesper Fast',
          capabilities: ['streaming' as const],
          enabled: true,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }
    }
  }
}

describe('PiCoreAgentAdapter system prompt', () => {
  it('passes a run-level assembled system prompt to pi core initial state', async () => {
    agentMock.constructorInputs.length = 0
    agentMock.prompts.length = 0
    const adapter = new PiCoreAgentAdapter({ modelResolver: resolver(), systemPrompt: 'fallback system prompt' })

    await adapter.run({
      runId: 'run-system-prompt',
      sessionId: 'session-1',
      prompt: 'hello',
      modelId: 'mock/hesper-fast',
      systemPrompt: 'assembled system prompt',
      signal: new AbortController().signal
    }, vi.fn())

    expect(agentMock.constructorInputs).toHaveLength(1)
    expect(agentMock.constructorInputs[0]?.initialState?.systemPrompt).toBe('assembled system prompt')
    expect(agentMock.prompts).toEqual(['hello'])
  })
})
