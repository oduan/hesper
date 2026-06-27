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
  /**
   * Pre-rendered text attachment prompt fragments, including the wrapper text
   * that will actually be sent to the model (for example <attachment ...>...</attachment>).
   */
  renderedAttachmentTexts?: string[]
  /**
   * Pre-rendered text attachment prompt fragment lengths for cases where only
   * the final rendered length is known.
   */
  renderedAttachmentTextLengths?: number[]
}

export type ContextBudgetCheck = {
  estimatedInputTokens: number
  maxInputTokens: number
  overLimit: boolean
  invalidConfig?: boolean
  reasons?: string[]
}

function isFiniteNonNegativeNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeOptionalBudgetField(value: number | undefined, fieldName: string, reasons: string[]): number {
  if (value === undefined) return 0
  if (!isFiniteNonNegativeNumber(value)) {
    reasons.push(`${fieldName} must be a finite non-negative number`)
    return 0
  }
  return Math.floor(value)
}

function normalizeRequiredBudgetField(value: number | undefined, fieldName: string, reasons: string[]): number {
  if (!isFiniteNonNegativeNumber(value)) {
    reasons.push(`${fieldName} must be a finite non-negative number`)
    return 0
  }
  return Math.floor(value)
}

function countTextChars(value: string | undefined): number {
  return typeof value === 'string' ? value.length : 0
}

function countMessageChars(messages: ContextBudgetMessageLike[] | undefined): number {
  if (!messages || messages.length === 0) return 0

  let total = 0
  for (const message of messages) {
    total += countTextChars(message?.content)
  }
  return total
}

function countRenderedAttachmentTextLengthChars(lengths: number[] | undefined): number {
  if (!lengths || lengths.length === 0) return 0

  let total = 0
  for (const length of lengths) {
    if (!isFiniteNonNegativeNumber(length)) continue
    total += Math.floor(length)
  }
  return total
}

function estimateTokensFromTotalChars(totalChars: number): number {
  if (!Number.isFinite(totalChars) || totalChars <= 0) return 0
  return Math.ceil(totalChars / 4)
}

export function checkContextBudget(input: CheckContextBudgetInput): ContextBudgetCheck {
  const reasons: string[] = []
  const modelContextWindow = normalizeRequiredBudgetField(input.modelContextWindow, 'modelContextWindow', reasons)
  const reservedOutputTokens = normalizeOptionalBudgetField(input.reservedOutputTokens, 'reservedOutputTokens', reasons)
  const safetyMargin = normalizeOptionalBudgetField(input.safetyMargin, 'safetyMargin', reasons)

  const totalChars = countTextChars(input.systemPrompt)
    + countTextChars(input.prompt)
    + countMessageChars(input.historyMessages)
    + (input.renderedAttachmentTexts?.reduce((total, text) => total + countTextChars(text), 0) ?? 0)
    + countRenderedAttachmentTextLengthChars(input.renderedAttachmentTextLengths)

  const estimatedInputTokens = estimateTokensFromTotalChars(totalChars)
  const invalidConfig = reasons.length > 0
  const maxInputTokens = invalidConfig
    ? 0
    : Math.max(0, modelContextWindow - reservedOutputTokens - safetyMargin)

  return {
    estimatedInputTokens,
    maxInputTokens,
    overLimit: estimatedInputTokens > maxInputTokens,
    ...(invalidConfig ? { invalidConfig: true, reasons } : {})
  }
}
