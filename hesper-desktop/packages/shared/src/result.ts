export type AppError = {
  code: string
  message: string
  cause?: unknown
}

export type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E extends AppError>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok
}

export function isErr<T, E extends AppError>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok
}

export function unwrap<T, E extends AppError>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}
