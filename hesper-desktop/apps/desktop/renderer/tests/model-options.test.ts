import { describe, expect, it } from 'vitest'
import { hesperApi } from '../src/ipc-client'
import { createSessionModelCatalog, createSessionModelOptions, fallbackSessionModelOptions, loadAvailableModelOptions, modelNameFromNamespacedId, mergeModelOptions, namespaceModelId } from '../src/model-options'

describe('model-options', () => {
  it('namespaces and denamespaces model ids symmetrically', () => {
    expect(namespaceModelId('openai', 'gpt-4.1')).toBe('openai/gpt-4.1')
    expect(namespaceModelId('openai', 'openai/gpt-4.1')).toBe('openai/gpt-4.1')
    expect(namespaceModelId('openai', 'openai:gpt-4.1')).toBe('openai:gpt-4.1')
    expect(modelNameFromNamespacedId('openai', 'openai/gpt-4.1')).toBe('gpt-4.1')
    expect(modelNameFromNamespacedId('openai', 'openai:gpt-4.1')).toBe('gpt-4.1')
  })

  it('merges model options without duplicates or blank entries', () => {
    expect(mergeModelOptions(['', '  mock/hesper-fast  '], ['mock/hesper-fast', undefined, 'anthropic/claude'])).toEqual([
      'mock/hesper-fast',
      'anthropic/claude'
    ])
  })

  it('creates session model options from enabled models', () => {
    expect(createSessionModelOptions([
      { id: 'alpha', enabled: true },
      { id: 'beta', enabled: false },
      { id: 'gamma' }
    ] as any)).toEqual([
      fallbackSessionModelOptions[0],
      'alpha',
      'gamma'
    ])
  })

  it('creates grouped session model catalog from enabled providers and models', () => {
    const catalog = createSessionModelCatalog([
      { id: 'mock', name: 'Mock', kind: 'mock', enabled: true, hasApiKey: false },
      { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true, hasApiKey: true, defaultModelId: 'deepseek-chat' },
      { id: 'openai', name: 'OpenAI', kind: 'openai', enabled: true, hasApiKey: false },
      { id: 'disabled', name: 'Disabled', kind: 'custom', enabled: false, hasApiKey: true }
    ] as any, [
      { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', enabled: true },
      { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', enabled: true },
      { id: 'deepseek-reasoner', providerId: 'deepseek', modelName: 'deepseek-reasoner', enabled: false },
      { id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', enabled: true },
      { id: 'disabled-model', providerId: 'disabled', modelName: 'disabled-model', enabled: true }
    ] as any)

    expect(catalog.preferredModelId).toBe('deepseek-chat')
    expect(catalog.options).toEqual(['mock/hesper-fast', 'deepseek-chat', 'gpt-4o'])
    expect(catalog.optionGroups).toEqual([
      {
        id: 'mock',
        label: 'Mock',
        options: [{ value: 'mock/hesper-fast', label: 'Mock/mock/hesper-fast' }]
      },
      {
        id: 'deepseek',
        label: 'DeepSeek',
        options: [{ value: 'deepseek-chat', label: 'DeepSeek/deepseek-chat' }]
      },
      {
        id: 'openai',
        label: 'OpenAI',
        options: [{ value: 'gpt-4o', label: 'OpenAI/gpt-4o' }]
      }
    ])
  })

  it('falls back to the default session model when no models api is available', async () => {
    const originalModels = hesperApi.models
    ;(hesperApi as any).models = undefined

    try {
      await expect(loadAvailableModelOptions()).resolves.toEqual(fallbackSessionModelOptions)
    } finally {
      ;(hesperApi as any).models = originalModels
    }
  })
})
