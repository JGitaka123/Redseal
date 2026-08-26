/**
 * Domain error taxonomy. Every error carries a stable machine-readable code so
 * that API clients can branch on `code` rather than parsing message strings.
 */
export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'plot_unavailable'
  | 'reservation_expired'
  | 'over_allocation'
  | 'immutable_record'
  | 'rate_limited'
  | 'internal_error'

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  plot_unavailable: 409,
  reservation_expired: 409,
  over_allocation: 422,
  immutable_record: 409,
  rate_limited: 429,
  internal_error: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('validation_failed', m, d)
export const unauthenticated = (m = 'Authentication required') => new AppError('unauthenticated', m)
export const forbidden = (m = 'You do not have permission to perform this action') => new AppError('forbidden', m)
export const notFound = (m: string) => new AppError('not_found', m)
export const conflict = (m: string, d?: unknown) => new AppError('conflict', m, d)
