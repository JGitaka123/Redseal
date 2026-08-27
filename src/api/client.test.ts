import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, apiBaseUrl, isLiveMode, readToken, writeToken } from './client'

const BASE = 'http://api.test'

function mockFetch(status: number, body?: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
  } as Response)
  vi.stubGlobal('fetch', spy)
  return spy
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', BASE)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('mode detection', () => {
  it('is live when an API URL is configured', () => {
    expect(apiBaseUrl()).toBe(BASE)
    expect(isLiveMode()).toBe(true)
  })

  it('is demo mode when the URL is unset or blank', () => {
    vi.stubEnv('VITE_API_URL', '')
    expect(apiBaseUrl()).toBeUndefined()
    expect(isLiveMode()).toBe(false)

    vi.stubEnv('VITE_API_URL', '   ')
    expect(isLiveMode()).toBe(false)
  })

  it('trims a trailing slash so paths do not double up', () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test/')
    expect(apiBaseUrl()).toBe('http://api.test')
  })
})

describe('login', () => {
  it('stores the returned token and returns the user', async () => {
    const fetchSpy = mockFetch(200, {
      token: 'tok-123',
      expiresAt: '2026-08-21T00:00:00.000Z',
      user: { id: 'u1', email: 'a@b.c', name: 'Ann', role: 'sales', permissions: ['plots:read'] },
    })

    const user = await api.login('a@b.c', 'secret')

    expect(user.role).toBe('sales')
    expect(readToken()).toBe('tok-123')
    expect(fetchSpy).toHaveBeenCalledWith(
      `${BASE}/api/auth/login`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces the API error code and message', async () => {
    mockFetch(401, { error: { code: 'unauthenticated', message: 'Invalid email or password' } })

    await expect(api.login('a@b.c', 'wrong')).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
      message: 'Invalid email or password',
    })
  })
})

describe('authenticated requests', () => {
  it('sends the stored token as a Bearer header', async () => {
    writeToken('tok-abc')
    const fetchSpy = mockFetch(200, { plots: [] })

    await api.listPlots()

    expect(fetchSpy).toHaveBeenCalledWith(
      `${BASE}/api/plots`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }),
      }),
    )
  })

  it('clears a rejected token so the user is returned to sign-in', async () => {
    writeToken('stale-token')
    mockFetch(401, { error: { code: 'unauthenticated', message: 'Session has expired' } })

    await expect(api.listPlots()).rejects.toBeInstanceOf(ApiError)
    expect(readToken()).toBeUndefined()
  })

  it('keeps the token on a non-auth failure', async () => {
    writeToken('good-token')
    mockFetch(409, { error: { code: 'plot_unavailable', message: 'Plot 1 is reserved' } })

    await expect(api.reservePlot('uuid-1', 'Mary', '0712345678', 'cash')).rejects.toMatchObject({
      code: 'plot_unavailable',
    })
    expect(readToken()).toBe('good-token')
  })

  it('handles a 204 with no body', async () => {
    writeToken('tok')
    mockFetch(204)
    await expect(api.logout()).resolves.toBeUndefined()
    expect(readToken()).toBeUndefined()
  })

  it('reports a network failure as a reachability problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.listPlots()).rejects.toMatchObject({ code: 'network_error' })
  })

  it('falls back to a generic message when the error body is unreadable', async () => {
    mockFetch(500)
    await expect(api.listPlots()).rejects.toMatchObject({
      code: 'internal_error',
      status: 500,
    })
  })

  it('refuses to call anything when no API URL is configured', async () => {
    vi.stubEnv('VITE_API_URL', '')
    await expect(api.listPlots()).rejects.toMatchObject({ code: 'not_configured' })
  })
})

describe('token storage', () => {
  it('round-trips and clears', () => {
    expect(readToken()).toBeUndefined()
    writeToken('abc')
    expect(readToken()).toBe('abc')
    writeToken(undefined)
    expect(readToken()).toBeUndefined()
  })
})
