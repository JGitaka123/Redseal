import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { ApiPlot } from './api/types'

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })

const BASE = 'http://api.test'

const apiPlot = (number: number, overrides: Partial<ApiPlot> = {}): ApiPlot => ({
  id: `uuid-${number}`,
  projectId: 'proj-1',
  projectName: 'Pioneer Estate Phase 2',
  number,
  size: '50 × 100 ft',
  status: 'available',
  terms: null,
  cashPriceCents: 37_500_000,
  instalmentPriceCents: 45_000_000,
  totalDueCents: 37_500_000,
  paidCents: 0,
  outstandingCents: 37_500_000,
  client: null,
  reservedUntil: null,
  ...overrides,
})

/** Routes injected requests to canned API responses, recording each call. */
function installApi() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  let plots = [apiPlot(1), apiPlot(2, { status: 'fully_paid', client: { id: 'c1', name: 'Faith Wanjiku', phone: '0712680941' }, paidCents: 37_500_000 })]

  const respond = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 300, status, json: async () => body } as Response)

  const fetchSpy = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined })
    const path = url.replace(BASE, '')

    if (path === '/api/auth/login') {
      return respond({
        token: 'tok-live',
        expiresAt: '2026-08-21T00:00:00.000Z',
        user: { id: 'u1', email: 'sales@redseal.example', name: 'Agnes Mutiso', role: 'sales', permissions: [] },
      })
    }
    if (path === '/api/plots') return respond({ plots })
    if (path === '/api/cases') return respond({ cases: [] })
    if (path.startsWith('/api/activity')) return respond({ activity: [] })
    if (path === '/api/payments') return respond({ payments: [] })
    if (path === '/api/plots/uuid-1/reservations') {
      const reserved = apiPlot(1, {
        status: 'reserved',
        client: { id: 'c9', name: 'Mary Wanjiku', phone: '0712345678' },
        reservedUntil: '2026-08-27T09:00:00.000Z',
      })
      plots = [reserved, plots[1]!]
      return respond({ reservationId: 'r1', plot: reserved })
    }
    return respond({ error: { code: 'not_found', message: `No route for ${path}` } }, 404)
  })

  vi.stubGlobal('fetch', fetchSpy)
  return { calls }
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

describe('live mode', () => {
  it('requires a sign-in before showing any operational data', () => {
    installApi()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Red Seal Operations' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Good afternoon/ })).not.toBeInTheDocument()
  })

  it('signs in and renders plots served by the API', async () => {
    installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Email'), 'sales@redseal.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByText(/Signed in as Agnes Mutiso/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Projects & plots/i }))
    expect(await screen.findByRole('button', { name: /Plot 1, Available/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Plot 2, Fully paid/i })).toBeInTheDocument()
  })

  it('shows the signed-in user rather than a hardcoded name', async () => {
    installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Email'), 'sales@redseal.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByText(/Signed in as Agnes Mutiso/)).toBeInTheDocument())
    expect(screen.getByText('Sales agent')).toBeInTheDocument()
    expect(screen.queryByText('Mzee Nthiga')).not.toBeInTheDocument()
  })

  it('reserves a plot through the API rather than in memory', async () => {
    const { calls } = installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Email'), 'sales@redseal.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByText(/Signed in as/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Projects & plots/i }))
    await user.click(await screen.findByRole('button', { name: /Plot 1, Available/i }))
    await user.click(screen.getByRole('button', { name: /Reserve this plot/i }))
    await user.type(screen.getByLabelText('Buyer name'), 'Mary Wanjiku')
    await user.type(screen.getByLabelText('Mobile number'), '0712 345 678')
    await user.click(screen.getByRole('button', { name: 'Confirm reservation' }))

    const reservation = await waitFor(() => {
      const hit = calls.find((c) => c.url.endsWith('/api/plots/uuid-1/reservations'))
      expect(hit).toBeDefined()
      return hit!
    })

    expect(reservation.method).toBe('POST')
    expect(reservation.body).toEqual({
      buyerName: 'Mary Wanjiku',
      buyerPhone: '0712 345 678',
      terms: 'cash',
    })

    expect(await screen.findByText('Plot 1 reserved for Mary Wanjiku')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Plot 1, Reserved/i })).toBeInTheDocument()
  })

  it('surfaces a rejected reservation instead of showing it as saved', async () => {
    installApi()
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        const path = url.replace(BASE, '')
        const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
        if (path === '/api/auth/login') {
          return ok({
            token: 't',
            expiresAt: '2026-08-21T00:00:00.000Z',
            user: { id: 'u1', email: 'e', name: 'Agnes Mutiso', role: 'sales', permissions: [] },
          })
        }
        if (path === '/api/plots') return ok({ plots: [apiPlot(1)] })
        if (path === '/api/cases') return ok({ cases: [] })
        if (path.startsWith('/api/activity')) return ok({ activity: [] })
        if (path === '/api/payments') return ok({ payments: [] })
        if (init.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              error: { code: 'plot_unavailable', message: 'Plot 1 has just been reserved by someone else' },
            }),
          } as Response)
        }
        return ok({})
      }),
    )

    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Email'), 'sales@redseal.example')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByText(/Signed in as/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Projects & plots/i }))
    await user.click(await screen.findByRole('button', { name: /Plot 1, Available/i }))
    await user.click(screen.getByRole('button', { name: /Reserve this plot/i }))
    await user.type(screen.getByLabelText('Buyer name'), 'Mary Wanjiku')
    await user.type(screen.getByLabelText('Mobile number'), '0712 345 678')
    await user.click(screen.getByRole('button', { name: 'Confirm reservation' }))

    expect(await screen.findByText(/has just been reserved by someone else/)).toBeInTheDocument()
    // The plot must not appear reserved locally when the server refused.
    expect(screen.getByRole('button', { name: /Plot 1, Available/i })).toBeInTheDocument()
  })

  it('shows a sign-in error for bad credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ error: { code: 'unauthenticated', message: 'Invalid email or password' } }),
        } as Response),
      ),
    )

    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Email'), 'sales@redseal.example')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })
})
