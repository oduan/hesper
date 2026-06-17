import { describe, expect, it } from 'vitest'
import { hesperApi } from '../src/ipc-client'
import { createSessionModelOptions, fallbackSessionModelOptions, loadAvailableModelOptions, modelNameFromNamespacedId, mergeModelOptions, namespaceModelId } from '../src/model-options'

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
