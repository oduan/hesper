import { describe, expect, it } from 'vitest'
import { checkContextBudget } from '../context-budget'

function renderTextAttachment(name: string, mimeType: string, content: string): string {
  return `<attachment name="${name}" mimeType="${mimeType}">\n${content}\n</attachment>`
}

describe('checkContextBudget', () => {
  it('estimates tokens across prompt, system prompt, history messages, and rendered attachments deterministically', () => {
    const renderedAttachment = renderTextAttachment('notes.txt', 'text/plain', '12345')
    const totalChars = 4 + 8 + 9 + 3 + renderedAttachment.length + 7
    const result = checkContextBudget({
      modelContextWindow: 1000,
      systemPrompt: '1234',
      prompt: '12345678',
      historyMessages: [
        { role: 'user', content: '123456789' },
        { role: 'assistant', content: '123' }
      ],
      renderedAttachmentTexts: [renderedAttachment],
      renderedAttachmentTextLengths: [7]
    })

    expect(result).toEqual({
      estimatedInputTokens: Math.ceil(totalChars / 4),
      maxInputTokens: 1000,
      overLimit: false
    })
  })

  it('produces the same estimate for the same total chars regardless of message fragmentation', () => {
    const fragmented = checkContextBudget({
      modelContextWindow: 100,
      historyMessages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' }
      ]
    })
    const combined = checkContextBudget({
      modelContextWindow: 100,
      historyMessages: [{ role: 'user', content: 'abcd' }]
    })

    expect(fragmented).toEqual({
      estimatedInputTokens: 1,
      maxInputTokens: 100,
      overLimit: false
    })
    expect(combined).toEqual(fragmented)
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

  it('marks invalid reserved and safety configuration instead of silently treating it as zero', () => {
    const result = checkContextBudget({
      modelContextWindow: 100,
      reservedOutputTokens: Number.POSITIVE_INFINITY,
      safetyMargin: Number.NaN,
      prompt: 'x'
    })

    expect(result).toEqual({
      estimatedInputTokens: 1,
      maxInputTokens: 0,
      overLimit: true,
      invalidConfig: true,
      reasons: [
        'reservedOutputTokens must be a finite non-negative number',
        'safetyMargin must be a finite non-negative number'
      ]
    })
  })

  it('surfaces an invalid model context window so callers can distinguish config errors from a normal zero-budget result', () => {
    const result = checkContextBudget({
      modelContextWindow: Number.NaN,
      prompt: 'x'
    })

    expect(result).toEqual({
      estimatedInputTokens: 1,
      maxInputTokens: 0,
      overLimit: true,
      invalidConfig: true,
      reasons: ['modelContextWindow must be a finite non-negative number']
    })
  })

  it('marks invalid configuration as over limit even when the estimated input is zero', () => {
    const result = checkContextBudget({
      modelContextWindow: Number.NaN
    })

    expect(result).toEqual({
      estimatedInputTokens: 0,
      maxInputTokens: 0,
      overLimit: true,
      invalidConfig: true,
      reasons: ['modelContextWindow must be a finite non-negative number']
    })
  })

  it('marks invalid rendered attachment lengths instead of silently skipping them', () => {
    const result = checkContextBudget({
      modelContextWindow: 100,
      renderedAttachmentTextLengths: [8, Number.NaN, 4]
    })

    expect(result).toEqual({
      estimatedInputTokens: 3,
      maxInputTokens: 0,
      overLimit: true,
      invalidConfig: true,
      reasons: ['renderedAttachmentTextLengths[1] must be a finite non-negative number']
    })
  })

  it('estimates rendered attachment text rather than bare attachment content', () => {
    const renderedAttachment = renderTextAttachment('report.md', 'text/markdown', 'hello')
    const result = checkContextBudget({
      modelContextWindow: 100,
      renderedAttachmentTexts: [renderedAttachment]
    })

    expect(result).toEqual({
      estimatedInputTokens: Math.ceil(renderedAttachment.length / 4),
      maxInputTokens: 100,
      overLimit: false
    })
    expect(result.estimatedInputTokens).toBeGreaterThan(Math.ceil('hello'.length / 4))
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
