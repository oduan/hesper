import { describe, expect, it } from 'vitest'
import { checkContextBudget } from '../context-budget'

describe('checkContextBudget', () => {
  it('estimates tokens across prompt, system prompt, history messages, and attachments deterministically', () => {
    const result = checkContextBudget({
      modelContextWindow: 1000,
      systemPrompt: '1234',
      prompt: '12345678',
      historyMessages: [
        { role: 'user', content: '123456789' },
        { role: 'assistant', content: '123' }
      ],
      attachmentTexts: ['12345'],
      attachmentTextLengths: [7]
    })

    expect(result).toEqual({
      estimatedInputTokens: 11,
      maxInputTokens: 1000,
      overLimit: false
    })
  })

  it('treats the exact boundary as within budget', () => {
    const result = checkContextBudget({
      modelContextWindow: 100,
      prompt: 'x'.repeat(400)
    })

    expect(result).toEqual({
      estimatedInputTokens: 100,
      maxInputTokens: 100,
      overLimit: false
    })
  })

  it('marks the budget as overflow once the estimate exceeds the boundary by one token', () => {
    const result = checkContextBudget({
      modelContextWindow: 100,
      prompt: 'x'.repeat(401)
    })

    expect(result).toEqual({
      estimatedInputTokens: 101,
      maxInputTokens: 100,
      overLimit: true
    })
  })

  it('reduces the max input budget by reserved output tokens and safety margin', () => {
    const result = checkContextBudget({
      modelContextWindow: 100,
      reservedOutputTokens: 20,
      safetyMargin: 5,
      prompt: 'x'.repeat(300)
    })

    expect(result).toEqual({
      estimatedInputTokens: 75,
      maxInputTokens: 75,
      overLimit: false
    })
  })

  it('clamps the max input budget to zero when reserved tokens and safety margin exceed the model window', () => {
    const emptyResult = checkContextBudget({
      modelContextWindow: 50,
      reservedOutputTokens: 30,
      safetyMargin: 40
    })
    const overflowResult = checkContextBudget({
      modelContextWindow: 50,
      reservedOutputTokens: 30,
      safetyMargin: 40,
      prompt: 'x'
    })

    expect(emptyResult).toEqual({
      estimatedInputTokens: 0,
      maxInputTokens: 0,
      overLimit: false
    })
    expect(overflowResult).toEqual({
      estimatedInputTokens: 1,
      maxInputTokens: 0,
      overLimit: true
    })
  })

  it('normalizes invalid numeric inputs safely without producing NaN or Infinity', () => {
    const result = checkContextBudget({
      modelContextWindow: Number.NaN,
      reservedOutputTokens: Number.POSITIVE_INFINITY,
      safetyMargin: -5,
      prompt: ''
    })

    expect(result).toEqual({
      estimatedInputTokens: 0,
      maxInputTokens: 0,
      overLimit: false
    })
  })

  it('does not mutate or reorder history messages', () => {
    const historyMessages = [
      { role: 'assistant', content: 'bbbb' },
      { role: 'user', content: 'aaaa' }
    ]

    const first = checkContextBudget({
      modelContextWindow: 20,
      historyMessages
    })
    const second = checkContextBudget({
      modelContextWindow: 20,
      historyMessages
    })

    expect(first).toEqual(second)
    expect(historyMessages).toEqual([
      { role: 'assistant', content: 'bbbb' },
      { role: 'user', content: 'aaaa' }
    ])
    expect(Object.keys(first).sort()).toEqual(['estimatedInputTokens', 'maxInputTokens', 'overLimit'])
  })
})
