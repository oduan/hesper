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
const reasonerModel: ModelConfig = {
  id: 'deepseek-reasoner',
  providerId: 'deepseek',
  modelName: 'deepseek-reasoner',
  displayName: 'DeepSeek Reasoner',
  capabilities: ['streaming', 'reasoning'],
  enabled: true,
  createdAt: now,
  updatedAt: now
}

function assistantMessageWithContent(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-title',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.parse(now)
  }
}

function assistantMessage(text: string): AssistantMessage {
  return assistantMessageWithContent([{ type: 'text', text }])
}

function resolvedModel(id: string, reasoning = false) {
  return {
    id,
    name: id,
    api: 'openai-completions' as const,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    reasoning,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64000,
    maxTokens: 1024
  }
}

describe('session title generator', () => {
  it('uses the provider first enabled model and requests JSON output with prompt examples', async () => {
    const complete = vi.fn(async () => assistantMessage('{"title":"视频脚本规划"}'))
    const resolve = vi.fn(async () => ({
      model: resolvedModel('deepseek-reasoner', true),
      provider,
      modelConfig: reasonerModel
    }))
    const generator = createSessionTitleGenerator({
      registry: {
        ensureReady: vi.fn(async () => undefined),
        getProvider: vi.fn(async () => provider),
        listModels: vi.fn(async (providerId?: string) => providerId === 'deepseek' ? [reasonerModel, titleModel, chatModel] : [reasonerModel, titleModel, chatModel])
      },
      modelResolver: { resolve },
      complete
    })

    const result = await generator.generateTitle({
      usedModelId: 'deepseek-chat',
      userPrompt: '请帮我设计一个视频脚本',
      assistantOutput: '可以围绕开场钩子、三段式分镜和结尾行动号召来规划。'
    })

    expect(resolve).toHaveBeenCalledWith({ modelId: 'deepseek-reasoner', providerId: 'deepseek' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deepseek-reasoner', provider: 'deepseek' }),
      expect.objectContaining({
        messages: [expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('请帮我设计一个视频脚本')
        })]
      }),
      expect.objectContaining({ maxTokens: 512, temperature: 0 })
    )

    const context = (complete.mock.calls[0] as unknown[] | undefined)?.[1] as { systemPrompt?: string; messages: Array<{ content: string }> } | undefined
    const prompt = context?.messages[0]?.content ?? ''
    expect(context?.systemPrompt).toBeUndefined()
    expect(prompt).toContain('输入示例')
    expect(prompt).toContain('JSON 输出示例')
    expect(prompt).toContain('{"title":"修复登录按钮无响应"}')
    expect(prompt).toContain('Agent 最终输出：可以围绕开场钩子、三段式分镜和结尾行动号召来规划。')
    expect(prompt).not.toContain('中文标题建议 6-18 个汉字')
    expect(prompt).not.toContain('英文标题不超过 8 个词')

    const options = (complete.mock.calls[0] as unknown[] | undefined)?.[2] as { reasoning?: string; onPayload?: (payload: unknown, model: unknown) => unknown | Promise<unknown> } | undefined
    expect(options).not.toHaveProperty('reasoning')
    expect(options?.onPayload).toBeTypeOf('function')
    await expect(Promise.resolve(options?.onPayload?.({ messages: [] }, resolvedModel('deepseek-reasoner', true)))).resolves.toMatchObject({
      response_format: { type: 'json_object' }
    })
    await expect(Promise.resolve(options?.onPayload?.({ input: [] }, { ...resolvedModel('gpt-4o'), api: 'openai-responses' }))).resolves.toMatchObject({
      text: { format: { type: 'json_object' } }
    })
    expect(result).toEqual({ title: '视频脚本规划', modelId: 'deepseek-reasoner' })
  })

  it('does not retry when the model returns an invalid structured title', async () => {
    const complete = vi.fn(async () => assistantMessage('{"title":"新对话"}'))
    const resolve = vi.fn(async () => ({
      model: resolvedModel('deepseek-title'),
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

    await expect(generator.generateTitle({
      usedModelId: 'deepseek-chat',
      userPrompt: '帮我修复登录按钮点击无响应的问题'
    })).rejects.toThrow('Title generation returned invalid title')

    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('accepts long titles returned as complete JSON', async () => {
    const longTitle = '这是一个用于验证标题生成不再按字数限制截断或拒绝的完整长标题'
    const complete = vi.fn(async () => assistantMessage(JSON.stringify({ title: longTitle })))
    const resolve = vi.fn(async () => ({
      model: resolvedModel('deepseek-title'),
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

    await expect(generator.generateTitle({
      usedModelId: 'deepseek-chat',
      userPrompt: '帮我生成一个非常完整的标题'
    })).resolves.toEqual({ title: longTitle, modelId: 'deepseek-title' })
  })

  it('returns no title when the model returns no final text', async () => {
    const complete = vi.fn(async () => assistantMessageWithContent([{ type: 'thinking', thinking: 'I should create a JSON title.' }]))
    const resolve = vi.fn(async () => ({
      model: resolvedModel('deepseek-title', true),
      provider,
      modelConfig: titleModel
    }))
    const generator = createSessionTitleGenerator({
      registry: {
        ensureReady: vi.fn(async () => undefined),
        getProvider: vi.fn(async () => provider),
        listModels: vi.fn(async () => [titleModel])
      },
      modelResolver: { resolve },
      complete
    })

    await expect(generator.generateTitle({
      usedModelId: 'deepseek-chat',
      userPrompt: '标题生成失败返回 empty'
    })).resolves.toBeUndefined()
  })
})
