import { describe, expect, it } from 'vitest'
import type { ModelProviderKind } from '../domain'
import { inferModelCapabilitiesFromName, supportsImageInput } from '../model-capabilities'

describe('model image input capabilities', () => {
  const supportedCases: Array<{ modelName: string; providerKind?: ModelProviderKind }> = [
    { modelName: 'gpt-5.5', providerKind: 'openai' },
    { modelName: 'gpt-4o', providerKind: 'openai' },
    { modelName: 'gpt-4.1', providerKind: 'openai' },
    { modelName: 'gemini-3.5-flash' },
    { modelName: 'claude-sonnet-4-6', providerKind: 'anthropic' },
    { modelName: 'kimi-k2.6', providerKind: 'openai-compatible' },
    { modelName: 'kimi-k2p6', providerKind: 'openai-compatible' },
    { modelName: 'glm-4.7-vision', providerKind: 'openai-compatible' },
    { modelName: 'glm-4.7-vl', providerKind: 'openai-compatible' },
    { modelName: 'custom-vision', providerKind: 'custom' },
    { modelName: 'custom-vl', providerKind: 'custom' },
    { modelName: 'custom-image', providerKind: 'custom' },
    { modelName: 'custom-multimodal', providerKind: 'custom' },
    { modelName: 'custom-omni', providerKind: 'custom' }
  ]

  it.each(supportedCases)('infers image input for $modelName', ({ modelName, providerKind }) => {
    const capabilities = inferModelCapabilitiesFromName({
      modelId: modelName,
      modelName,
      ...(providerKind ? { providerKind } : {}),
      existingCapabilities: ['streaming', 'toolCalls']
    })
    expect(capabilities).toContain('imageInput')
    expect(supportsImageInput({ modelId: modelName, modelName, capabilities })).toBe(true)
  })

  const unsupportedCases: Array<{ modelName: string; providerKind?: ModelProviderKind }> = [
    { modelName: 'deepseek-v4-flash', providerKind: 'deepseek' },
    { modelName: 'deepseek-v4-pro', providerKind: 'deepseek' },
    { modelName: 'deepseek-chat', providerKind: 'deepseek' },
    { modelName: 'glm-4.7', providerKind: 'openai-compatible' },
    { modelName: 'glm-5', providerKind: 'openai-compatible' },
    { modelName: 'deepseek-reasoner', providerKind: 'deepseek' }
  ]

  it.each(unsupportedCases)('does not infer image input for $modelName', ({ modelName, providerKind }) => {
    const capabilities = inferModelCapabilitiesFromName({
      modelId: modelName,
      modelName,
      ...(providerKind ? { providerKind } : {}),
      existingCapabilities: ['streaming', 'toolCalls']
    })
    expect(capabilities).not.toContain('imageInput')
    expect(supportsImageInput({ modelId: modelName, modelName, capabilities })).toBe(false)
  })

  it('preserves explicit imageInput capability even when inference is negative', () => {
    expect(inferModelCapabilitiesFromName({ modelId: 'deepseek-chat', modelName: 'deepseek-chat', providerKind: 'deepseek', existingCapabilities: ['streaming', 'imageInput'] })).toContain('imageInput')
    expect(inferModelCapabilitiesFromName({ modelId: 'custom-text', modelName: 'custom-text', existingCapabilities: ['streaming', 'imageInput'] })).toContain('imageInput')
  })

  it('infers image input from providerId when the model name is generic', () => {
    const capabilities = inferModelCapabilitiesFromName({ modelId: 'flash', modelName: 'flash', providerId: 'gemini-3.5-flash' })
    expect(capabilities).toContain('imageInput')
  })

  it('accepts optional capability inputs', () => {
    expect(inferModelCapabilitiesFromName({ modelId: 'custom-vision', modelName: 'custom-vision' })).toContain('imageInput')
    expect(supportsImageInput({ modelId: 'custom-vision' })).toBe(false)
  })

  it('does not match short markers inside ordinary substrings', () => {
    expect(inferModelCapabilitiesFromName({ modelId: 'revlon-1', modelName: 'revlon-1' })).not.toContain('imageInput')
    expect(inferModelCapabilitiesFromName({ modelId: 'dominion-omnibus', modelName: 'dominion-omnibus' })).not.toContain('imageInput')
    expect(inferModelCapabilitiesFromName({ modelId: 'custom vl test', modelName: 'custom vl test' })).toContain('imageInput')
  })

  it('accepts provider metadata on supportsImageInput input', () => {
    expect(supportsImageInput({ modelId: 'gpt-5.5', providerId: 'openai', providerKind: 'openai', capabilities: ['imageInput'] })).toBe(true)
  })

  it('uses explicit imageInput capability as the final support signal', () => {
    expect(supportsImageInput({ modelId: 'custom/text-only', capabilities: ['streaming'] })).toBe(false)
    expect(supportsImageInput({ modelId: 'custom/vision', capabilities: ['streaming', 'imageInput'] })).toBe(true)
  })
})
