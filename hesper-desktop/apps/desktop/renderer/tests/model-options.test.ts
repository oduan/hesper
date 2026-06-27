import { describe, expect, it } from 'vitest'
import { hesperApi } from '../src/ipc-client'
import { createSessionModelCatalog, createSessionModelOptions, defaultFallbackModelId, fallbackSessionModelCatalog, fallbackSessionModelOptions, loadAvailableModelCatalog, loadAvailableModelOptions, modelNameFromNamespacedId, mergeModelOptions, namespaceModelId } from '../src/model-options'

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

  it('creates session model options from enabled non-legacy models', () => {
    expect(createSessionModelOptions([
      { id: 'alpha', enabled: true },
      { id: 'mock/hesper-fast', enabled: true },
      { id: 'beta', enabled: false },
      { id: 'gamma' }
    ] as any)).toEqual([
      'alpha',
      'gamma'
    ])
  })

  it('creates grouped session model catalog from enabled providers and models', () => {
    const catalog = createSessionModelCatalog([
      { id: 'mock', name: 'Mock', kind: 'mock', enabled: true, hasApiKey: false },
      { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true, hasApiKey: true, defaultModelId: 'deepseek-v4-flash' },
      { id: 'openai', name: 'OpenAI', kind: 'openai', enabled: true, hasApiKey: false },
      { id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, hasApiKey: true, fastModeEnabled: true },
      { id: 'disabled', name: 'Disabled', kind: 'custom', enabled: false, hasApiKey: true }
    ] as any, [
      { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', enabled: true },
      { id: 'deepseek-v4-flash', providerId: 'deepseek', modelName: 'deepseek-v4-flash', enabled: true },
      { id: 'deepseek-v4-pro', providerId: 'deepseek', modelName: 'deepseek-v4-pro', enabled: false },
      { id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', enabled: true },
      { id: 'pi/gpt-5.5', providerId: 'chatgpt-codex', modelName: 'gpt-5.5', enabled: true },
      { id: 'disabled-model', providerId: 'disabled', modelName: 'disabled-model', enabled: true }
    ] as any)

    expect(catalog.preferredModelId).toBe('deepseek-v4-flash')
    expect(catalog.options).toEqual(['deepseek-v4-flash', 'gpt-4o', 'pi/gpt-5.5'])
    expect(catalog.optionGroups).toEqual([
      {
        id: 'deepseek',
        label: 'DeepSeek',
        options: [{ value: 'deepseek-v4-flash', label: 'DeepSeek/deepseek-v4-flash' }]
      },
      {
        id: 'openai',
        label: 'OpenAI',
        options: [{ value: 'gpt-4o', label: 'OpenAI/gpt-4o' }]
      },
      {
        id: 'chatgpt-codex',
        label: 'ChatGPT Codex ⚡',
        options: [{ value: 'pi/gpt-5.5', label: 'ChatGPT Codex ⚡/gpt-5.5' }]
      }
    ])
    expect(Object.keys(catalog.modelsById)).toEqual(catalog.options)
    expect(catalog.modelsById['gpt-4o']).toMatchObject({ id: 'gpt-4o', providerId: 'openai' })
  })

  it('keeps fallback catalog modelsById consistent with options', () => {
    expect(Object.keys(fallbackSessionModelCatalog.modelsById)).toEqual(fallbackSessionModelCatalog.options)
    expect(defaultFallbackModelId).toBe('')
    expect(fallbackSessionModelOptions).toEqual([])
    expect(fallbackSessionModelCatalog.preferredModelId).toBe('')
  })

  it('keeps modelsById consistent when the provider catalog is empty or missing matching models', () => {
    const customModels = [
      { id: 'custom-vision', providerId: 'custom', modelName: 'custom-vision', enabled: true }
    ] as any

    for (const catalog of [
      createSessionModelCatalog([], customModels),
      createSessionModelCatalog([{ id: 'custom', name: 'Custom', kind: 'custom', enabled: true, hasApiKey: true }] as any, []),
      createSessionModelCatalog([{ id: 'other', name: 'Other', kind: 'custom', enabled: true, hasApiKey: true }] as any, customModels)
    ]) {
      expect(catalog).toEqual(fallbackSessionModelCatalog)
      expect(Object.keys(catalog.modelsById)).toEqual(catalog.options)
    }
  })

  it('keeps modelsById consistent when providers api is unavailable', async () => {
    const originalProviders = (hesperApi as any).providers
    const originalModels = hesperApi.models
    ;(hesperApi as any).providers = undefined
    ;(hesperApi as any).models = {
      list: async () => [
        { id: 'alpha', providerId: 'custom', modelName: 'alpha', capabilities: ['streaming'], enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'beta', providerId: 'custom', modelName: 'beta', capabilities: ['streaming'], enabled: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
      ]
    }

    try {
      const catalog = await loadAvailableModelCatalog()
      expect(catalog.options).toEqual(['alpha'])
      expect(Object.keys(catalog.modelsById)).toEqual(catalog.options)
      expect(catalog.preferredModelId).toBe('alpha')
      expect(catalog.modelsById.alpha).toMatchObject({ id: 'alpha' })
      expect(catalog.modelsById.beta).toBeUndefined()
    } finally {
      ;(hesperApi as any).providers = originalProviders
      ;(hesperApi as any).models = originalModels
    }
  })

  it('returns an empty catalog when no models api is available', async () => {
    const originalModels = hesperApi.models
    ;(hesperApi as any).models = undefined

    try {
      await expect(loadAvailableModelOptions()).resolves.toEqual([])
    } finally {
      ;(hesperApi as any).models = originalModels
    }
  })
})
