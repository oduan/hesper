export type ContextBudgetMessageLike = {
  role?: string
  content: string
}

export type CheckContextBudgetInput = {
  modelContextWindow?: number
  reservedOutputTokens?: number
  safetyMargin?: number
  prompt?: string
  systemPrompt?: string
  historyMessages?: ContextBudgetMessageLike[]
  attachmentTexts?: string[]
  attachmentTextLengths?: number[]
}

export type ContextBudgetCheck = {
  estimatedInputTokens: number
  maxInputTokens: number
  overLimit: boolean
}

function normalizeWholeNonNegative(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function estimateTokensFromChars(charCount: number): number {
  const normalized = normalizeWholeNonNegative(charCount)
  if (normalized === 0) return 0
  return Math.ceil(normalized / 4)
}

function estimateTokensFromText(value: string | undefined): number {
  if (typeof value !== 'string' || value.length === 0) return 0
  return estimateTokensFromChars(value.length)
}

function estimateTokensFromMessages(messages: ContextBudgetMessageLike[] | undefined): number {
  if (!messages || messages.length === 0) return 0

  let total = 0
  for (const message of messages) {
    total += estimateTokensFromText(message?.content)
  }
  return total
}

function estimateTokensFromAttachmentTextLengths(lengths: number[] | undefined): number {
  if (!lengths || lengths.length === 0) return 0

  let total = 0
  for (const length of lengths) {
    total += estimateTokensFromChars(length)
  }
  return total
}

export function checkContextBudget(input: CheckContextBudgetInput): ContextBudgetCheck {
  const modelContextWindow = normalizeWholeNonNegative(input.modelContextWindow)
  const reservedOutputTokens = normalizeWholeNonNegative(input.reservedOutputTokens)
  const safetyMargin = normalizeWholeNonNegative(input.safetyMargin)

  const maxInputTokens = Math.max(0, modelContextWindow - reservedOutputTokens - safetyMargin)
  const estimatedInputTokens = estimateTokensFromText(input.systemPrompt)
    + estimateTokensFromText(input.prompt)
    + estimateTokensFromMessages(input.historyMessages)
    + (input.attachmentTexts?.reduce((total, text) => total + estimateTokensFromText(text), 0) ?? 0)
    + estimateTokensFromAttachmentTextLengths(input.attachmentTextLengths)

  return {
    estimatedInputTokens,
    maxInputTokens,
    overLimit: estimatedInputTokens > maxInputTokens
  }
}
