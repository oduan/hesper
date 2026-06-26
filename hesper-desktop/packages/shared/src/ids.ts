export type IdPrefix = 'session' | 'message' | 'run' | 'step' | 'skill' | 'role' | 'tool' | 'session-category'

export function createId(prefix: IdPrefix): string {
  const random = crypto.randomUUID()
  return `${prefix}-${random}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
