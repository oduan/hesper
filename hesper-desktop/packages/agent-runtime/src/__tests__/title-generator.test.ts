import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { ModelConfig, ModelProviderConfig } from '@hesper/shared'
import { describe, expect, it, vi } from 'vitest'
import { createSessionTitleGenerator } from '../title-generator'

const now = '2026-06-10T03:00:00.000Z'
const provider: ModelProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'deepseek',
  enabled: true,
  createdAt: now,
  updatedAt: now
}
const titleModel: ModelConfig = {
  id: 'deepseek-title',
  providerId: 'deepseek',
  modelName: 'deepseek-title',
  displayName: 'DeepSeek Title',
  capabilities: ['streaming'],
  enabled: true,
  createdAt: now,
  updatedAt: now
}
const chatModel: ModelConfig = {
  id: 'deepseek-chat',
  providerId: 'deepseek',
  modelName: 'deepseek-chat',
  displayName: 'DeepSeek Chat',
  capabilities: ['streaming'],
  enabled: true,
  createdAt: now,
  updatedAt: now
}

function assistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-title',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.parse(now)
  }
}

describe('session title generator', () => {
  it('uses the first enabled model from the same provider connection and sends a title-only prompt', async () => {
    const complete = vi.fn(async () => assistantMessage('「视频脚本规划」'))
    const resolve = vi.fn(async () => ({
      model: { id: 'deepseek-title', name: 'DeepSeek Title', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', reasoning: false, input: ['text' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 1024 },
      provider,
      modelConfig: titleModel
    }))
    const generator = createSessionTitleGenerator({
      registry: {
        ensureReady: vi.fn(async () => undefined),
        getProvider: vi.fn(async () => provider),
        listModels: vi.fn(async (providerId?: string) => providerId === 'deepseek' ? [titleModel, chatModel] : [titleModel, chatModel])
      },
      modelResolver: { resolve },
      complete
    })

    const result = await generator.generateTitle({
      usedModelId: 'deepseek-chat',
      userPrompt: '请帮我设计一个视频脚本',
      assistantResponse: '可以，先确定主题、受众和分镜。'
    })

    expect(resolve).toHaveBeenCalledWith({ modelId: 'deepseek-title', providerId: 'deepseek' })
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deepseek-title', provider: 'deepseek' }),
      expect.objectContaining({
        systemPrompt: expect.stringContaining('只输出标题'),
        messages: [expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('请帮我设计一个视频脚本')
        })]
      }),
      expect.objectContaining({ maxTokens: 32, reasoning: 'minimal' })
    )
    expect(result).toEqual({ title: '视频脚本规划', modelId: 'deepseek-title' })
  })

  it('rejects generic model titles and falls back to the latest user request', async () => {
    const complete = vi.fn(async () => assistantMessage('新对话'))
    const resolve = vi.fn(async () => ({
      model: { id: 'deepseek-title', name: 'DeepSeek Title', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', reasoning: false, input: ['text' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 1024 },
      provider,
      modelConfig: titleModel
    }))
    const generator = createSessionTitleGenerator({
      registry: {
        ensureReady: vi.fn(async () => undefined),
        getProvider: vi.fn(async () => provider),
        listModels: vi.fn(async (providerId?: string) => providerId === 'deepseek' ? [titleModel, chatModel] : [titleModel, chatModel])
      },
      modelResolver: { resolve },
      complete
    })

    const result = await generator.generateTitle({
      usedModelId: 'deepseek-chat',
      userPrompt: '帮我修复登录按钮点击无响应的问题',
      assistantResponse: '可以，从事件绑定、禁用状态和请求错误三个方向排查。'
    })

    expect(result).toEqual({ title: '修复登录按钮点击无响应', modelId: 'deepseek-title' })
  })
})
