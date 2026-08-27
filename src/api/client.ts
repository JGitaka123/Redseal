import type {
  ApiActivity,
  ApiCase,
  ApiErrorBody,
  ApiOverview,
  ApiPayment,
  ApiPlot,
  ApiUser,
} from './types'

const TOKEN_KEY = 'redseal.token'

/**
 * The API base URL. When this is unset the app runs in self-contained demo
 * mode, which is what keeps the client demonstration working with no server.
 */
export function apiBaseUrl(): string | undefined {
  const configured = import.meta.env.VITE_API_URL as string | undefined
  return configured && configured.trim() ? configured.trim().replace(/\/$/, '') : undefined
}

export const isLiveMode = (): boolean => apiBaseUrl() !== undefined

/** Carries the API's error code so callers can branch without parsing text. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function readToken(): string | undefined {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? undefined
  } catch {
    // Private browsing modes can throw on storage access.
    return undefined
  }
}

export function writeToken(token: string | undefined): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Losing the token only means the user signs in again.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = apiBaseUrl()
  if (!base) throw new ApiError(0, 'not_configured', 'No API URL is configured')

  const token = readToken()
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (init.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the operations API')
  }

  if (response.status === 204) return undefined as T

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (!response.ok) {
    const error = (body as ApiErrorBody | undefined)?.error
    // A rejected token is dead: clear it so the user is sent back to sign-in.
    if (response.status === 401) writeToken(undefined)
    throw new ApiError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    )
  }

  return body as T
}

export interface LoginResult {
  token: string
  expiresAt: string
  user: ApiUser
}

export const api = {
  async login(email: string, password: string): Promise<ApiUser> {
    const result = await request<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    writeToken(result.token)
    return result.user
  },

  async logout(): Promise<void> {
    try {
      await request<void>('/api/auth/logout', { method: 'POST' })
    } finally {
      writeToken(undefined)
    }
  },

  me: () => request<{ user: ApiUser }>('/api/auth/me').then((r) => r.user),

  listPlots: () => request<{ plots: ApiPlot[] }>('/api/plots').then((r) => r.plots),

  reservePlot: (plotId: string, buyerName: string, buyerPhone: string, terms: 'cash' | 'instalment') =>
    request<{ reservationId: string; plot: ApiPlot }>(`/api/plots/${plotId}/reservations`, {
      method: 'POST',
      body: JSON.stringify({ buyerName, buyerPhone, terms }),
    }),

  listPayments: () => request<{ payments: ApiPayment[] }>('/api/payments').then((r) => r.payments),

  listExceptions: () =>
    request<{ exceptions: ApiPayment[] }>('/api/payments/exceptions').then((r) => r.exceptions),

  listCases: () => request<{ cases: ApiCase[] }>('/api/cases').then((r) => r.cases),

  overview: () => request<{ overview: ApiOverview }>('/api/overview').then((r) => r.overview),

  activity: (limit = 8) =>
    request<{ activity: ApiActivity[] }>(`/api/activity?limit=${limit}`).then((r) => r.activity),
}
