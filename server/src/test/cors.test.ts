import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness } from './harness.js'
import type { Harness } from './harness.js'

let h: Harness

beforeEach(async () => {
  h = await createHarness({ CORS_ORIGINS: 'http://127.0.0.1:4173' } as NodeJS.ProcessEnv)
})
afterEach(async () => {
  await h.close()
})

const preflight = (method: string, url = '/api/auth/login') =>
  h.app.inject({
    method: 'OPTIONS',
    url,
    headers: {
      origin: 'http://127.0.0.1:4173',
      'access-control-request-method': method,
    },
  })

describe('CORS', () => {
  it('allows the configured browser origin', async () => {
    const response = await preflight('POST')
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4173')
    expect(String(response.headers['access-control-allow-credentials'])).toBe('true')
  })

  // A browser refuses any method missing from this header, so every verb the
  // API actually exposes has to be advertised.
  it.each(['GET', 'POST', 'PATCH', 'DELETE'])('advertises %s as an allowed method', async (method) => {
    const response = await preflight(method)
    expect(String(response.headers['access-control-allow-methods'])).toContain(method)
  })

  it('does not reflect an unknown origin', async () => {
    const response = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/auth/login',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(response.headers['access-control-allow-origin']).not.toBe('http://evil.example')
  })
})
