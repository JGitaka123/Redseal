import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, signIn, TEST_PASSWORD } from './harness.js'
import type { Harness } from './harness.js'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.close()
})

const login = (payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/api/auth/login', payload })

describe('authentication', () => {
  it('issues a session for valid credentials', async () => {
    const response = await login({ email: 'director@redseal.example', password: TEST_PASSWORD })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.token).toEqual(expect.any(String))
    expect(body.user).toMatchObject({ email: 'director@redseal.example', role: 'director' })
    expect(body.user.permissions).toContain('audit:read')
    // The password hash must never leave the server.
    expect(response.body).not.toContain('scrypt')
  })

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await login({ email: 'director@redseal.example', password: 'nope-nope-nope' })
    const unknownUser = await login({ email: 'ghost@redseal.example', password: 'nope-nope-nope' })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownUser.statusCode).toBe(401)
    expect(unknownUser.json().error.message).toBe(wrongPassword.json().error.message)
  })

  it('rejects malformed credentials with a validation error', async () => {
    const response = await login({ email: 'not-an-email', password: '' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('locks an account out after repeated failures, then recovers with time', async () => {
    for (let attempt = 0; attempt < h.config.LOGIN_MAX_ATTEMPTS; attempt += 1) {
      const response = await login({ email: 'director@redseal.example', password: 'wrong-password' })
      expect(response.statusCode).toBe(401)
    }

    const lockedOut = await login({ email: 'director@redseal.example', password: TEST_PASSWORD })
    expect(lockedOut.statusCode).toBe(429)
    expect(lockedOut.json().error.code).toBe('rate_limited')

    h.clock.advanceMinutes(h.config.LOGIN_LOCKOUT_MINUTES + 1)
    const afterWindow = await login({ email: 'director@redseal.example', password: TEST_PASSWORD })
    expect(afterWindow.statusCode).toBe(200)
  })
})

describe('sessions', () => {
  it('accepts a valid token and reports the caller', async () => {
    const auth = await signIn(h, 'sales')
    const response = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: auth } })
    expect(response.statusCode).toBe(200)
    expect(response.json().user.role).toBe('sales')
  })

  it.each([
    ['a missing header', undefined],
    ['a non-bearer header', 'Basic abc'],
    ['an unknown token', 'Bearer not-a-real-token'],
  ])('rejects %s', async (_label, header) => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: header ? { authorization: header } : {},
    })
    expect(response.statusCode).toBe(401)
  })

  it('revokes a token on logout', async () => {
    const auth = await signIn(h, 'director')
    const loggedOut = await h.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: auth },
    })
    expect(loggedOut.statusCode).toBe(204)

    const reused = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: auth } })
    expect(reused.statusCode).toBe(401)
    expect(reused.json().error.message).toMatch(/revoked/i)
  })

  it('expires a token once its lifetime elapses', async () => {
    const auth = await signIn(h, 'director')
    h.clock.advanceMinutes(h.config.SESSION_TTL_HOURS * 60 + 1)

    const response = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: auth } })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.message).toMatch(/expired/i)
  })

  it('stores only a hash of the token, never the token itself', async () => {
    const response = await login({ email: 'director@redseal.example', password: TEST_PASSWORD })
    const token = response.json().token as string
    const stored = h.db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>
    expect(stored.some((s) => s.token_hash === token)).toBe(false)
    expect(stored).not.toHaveLength(0)
  })
})

describe('role-based access control', () => {
  const cases: Array<{ role: 'director' | 'sales' | 'finance' | 'registry'; allowed: boolean; label: string }> = [
    { role: 'director', allowed: true, label: 'director may record payments' },
    { role: 'finance', allowed: true, label: 'finance may record payments' },
    { role: 'sales', allowed: false, label: 'sales may not record payments' },
    { role: 'registry', allowed: false, label: 'registry may not record payments' },
  ]

  it.each(cases)('$label', async ({ role, allowed }) => {
    const auth = await signIn(h, role)
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: auth },
      payload: {
        receipt: `RBAC-${role}`,
        channel: 'mpesa',
        payerName: 'Test Payer',
        amountCents: 100_000,
        receivedAt: '2026-08-20T08:00:00.000Z',
      },
    })
    expect(response.statusCode).toBe(allowed ? 201 : 403)
  })

  it('lets sales reserve plots but not finance', async () => {
    const salesAuth = await signIn(h, 'sales')
    const financeAuth = await signIn(h, 'finance')
    const plot = h.db.prepare(`SELECT id FROM plots WHERE status = 'available' LIMIT 1`).get() as { id: string }

    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/plots/${plot.id}/reservations`,
      headers: { authorization: financeAuth },
      payload: { buyerName: 'Test Buyer', buyerPhone: '0700111222' },
    })
    expect(refused.statusCode).toBe(403)

    const allowed = await h.app.inject({
      method: 'POST',
      url: `/api/plots/${plot.id}/reservations`,
      headers: { authorization: salesAuth },
      payload: { buyerName: 'Test Buyer', buyerPhone: '0700111222' },
    })
    expect(allowed.statusCode).toBe(201)
  })

  it('restricts the audit trail to the director', async () => {
    for (const role of ['sales', 'finance', 'registry'] as const) {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: { authorization: await signIn(h, role) },
      })
      expect(response.statusCode).toBe(403)
    }

    const director = await h.app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { authorization: await signIn(h, 'director') },
    })
    expect(director.statusCode).toBe(200)
  })
})

describe('health endpoints', () => {
  it('reports liveness and readiness without authentication', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    expect((await h.app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({ status: 'ready' })
  })

  it('returns a structured 404 for unknown routes', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })
})
