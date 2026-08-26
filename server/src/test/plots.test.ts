import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, plotByNumber, signIn } from './harness.js'
import type { Harness } from './harness.js'
import { newId } from '../domain/ids.js'
import { iso } from '../domain/time.js'

let h: Harness
let sales: string

beforeEach(async () => {
  h = await createHarness()
  sales = await signIn(h, 'sales')
})
afterEach(async () => {
  await h.close()
})

const reserve = (plotId: string, payload: Record<string, unknown> = {}) =>
  h.app.inject({
    method: 'POST',
    url: `/api/plots/${plotId}/reservations`,
    headers: { authorization: sales },
    payload: { buyerName: 'Mary Wanjiku', buyerPhone: '0712 345 678', ...payload },
  })

/**
 * Sessions are short-lived by design, so any test that advances the clock by
 * days must sign in again afterwards — exactly as a real user would.
 */
async function timeTravelDays(days: number): Promise<void> {
  h.clock.advanceDays(days)
  sales = await signIn(h, 'sales')
}

describe('plot inventory', () => {
  it('lists all 34 Pioneer plots with derived pricing', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/plots', headers: { authorization: sales } })
    expect(response.statusCode).toBe(200)

    const plots = response.json().plots
    expect(plots).toHaveLength(34)

    const regular = plots.find((p: { number: number }) => p.number === 1)
    expect(regular).toMatchObject({ status: 'available', cashPriceCents: 37_500_000, size: '50 × 100 ft' })

    const large = plots.find((p: { number: number }) => p.number === 34)
    expect(large).toMatchObject({ size: '2.1 acres', cashPriceCents: 520_000_000 })
  })

  it('filters by status', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/plots?status=fully_paid',
      headers: { authorization: sales },
    })
    const plots = response.json().plots
    expect(plots.length).toBeGreaterThan(0)
    expect(plots.every((p: { status: string }) => p.status === 'fully_paid')).toBe(true)
  })

  it('rejects an unknown status filter', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/plots?status=imaginary',
      headers: { authorization: sales },
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 404 for an unknown plot', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/plots/${newId()}`,
      headers: { authorization: sales },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('reserving a plot', () => {
  it('holds an available plot for the configured period', async () => {
    const plot = await plotByNumber(h, sales, 1)
    const response = await reserve(plot.id)

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.plot.status).toBe('reserved')
    expect(body.plot.client).toMatchObject({ name: 'Mary Wanjiku', phone: '0712345678' })

    const expiry = new Date(body.plot.reservedUntil)
    const expected = new Date(h.clock.now().getTime() + h.config.RESERVATION_HOLD_DAYS * 86_400_000)
    expect(expiry.toISOString()).toBe(expected.toISOString())
  })

  it('registers a new buyer once and reuses them by phone number', async () => {
    const first = await plotByNumber(h, sales, 1)
    const second = await plotByNumber(h, sales, 3)

    const a = await reserve(first.id, { buyerPhone: '0733 000 111' })
    const b = await reserve(second.id, { buyerPhone: '+254733000111' })

    expect(a.json().plot.client.id).toBe(b.json().plot.client.id)
  })

  it('refuses to reserve a plot that is already held', async () => {
    const plot = await plotByNumber(h, sales, 1)
    expect((await reserve(plot.id)).statusCode).toBe(201)

    const second = await reserve(plot.id, { buyerName: 'Other Buyer', buyerPhone: '0799 888 777' })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('plot_unavailable')
  })

  it('refuses to reserve a plot that is already sold', async () => {
    const sold = await plotByNumber(h, sales, 2)
    const response = await reserve(sold.id)
    expect(response.statusCode).toBe(409)
  })

  it('validates the buyer details', async () => {
    const plot = await plotByNumber(h, sales, 1)
    const response = await reserve(plot.id, { buyerName: 'X', buyerPhone: '123' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'buyerName' })]),
    )
  })

  it('charges the instalment price when instalment terms are chosen', async () => {
    const plot = await plotByNumber(h, sales, 1)
    const response = await reserve(plot.id, { terms: 'instalment' })
    expect(response.json().plot.totalDueCents).toBe(45_000_000)
  })
})

describe('reservation concurrency', () => {
  it('permits only one active reservation per plot at the database level', () => {
    const plot = h.db.prepare(`SELECT id FROM plots WHERE status = 'available' LIMIT 1`).get() as { id: string }
    const client = h.db.prepare('SELECT id FROM clients LIMIT 1').get() as { id: string }
    const user = h.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }
    const now = iso(h.clock.now())

    const insert = (id: string) =>
      h.db
        .prepare(
          `INSERT INTO reservations (id, plot_id, client_id, terms, status, created_at, expires_at, created_by)
           VALUES (?, ?, ?, 'cash', 'active', ?, ?, ?)`,
        )
        .run(id, plot.id, client.id, now, now, user.id)

    insert(newId())
    // The partial unique index is the last line of defence against a race
    // between two agents reserving the same plot at the same moment.
    expect(() => insert(newId())).toThrow(/UNIQUE constraint failed/i)
  })

  it('lets a second agent reserve once the first hold is cancelled', async () => {
    const plot = await plotByNumber(h, sales, 1)
    await reserve(plot.id)

    await h.app.inject({
      method: 'DELETE',
      url: `/api/plots/${plot.id}/reservations`,
      headers: { authorization: sales },
      payload: { reason: 'Buyer withdrew' },
    })

    const second = await reserve(plot.id, { buyerName: 'Second Buyer', buyerPhone: '0700 555 444' })
    expect(second.statusCode).toBe(201)
  })
})

describe('reservation expiry', () => {
  it('releases an unpaid hold once the period lapses', async () => {
    const plot = await plotByNumber(h, sales, 1)
    await reserve(plot.id)
    expect((await plotByNumber(h, sales, 1)).status).toBe('reserved')

    await timeTravelDays(h.config.RESERVATION_HOLD_DAYS + 1)

    const after = await plotByNumber(h, sales, 1)
    expect(after.status).toBe('available')
    expect(after.client).toBeNull()
  })

  it('does not release a hold that still has time left', async () => {
    const plot = await plotByNumber(h, sales, 1)
    await reserve(plot.id)

    await timeTravelDays(h.config.RESERVATION_HOLD_DAYS - 1)
    expect((await plotByNumber(h, sales, 1)).status).toBe('reserved')
  })

  it('never releases a plot that has been paid for', async () => {
    const finance = await signIn(h, 'finance')
    const plot = await plotByNumber(h, sales, 1)
    await reserve(plot.id)

    await h.app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: finance },
      payload: {
        receipt: 'HOLD-1',
        channel: 'mpesa',
        payerName: 'Mary Wanjiku',
        payerPhone: '0712345678',
        accountRef: 'PLOT1',
        amountCents: 5_000_000,
        receivedAt: iso(h.clock.now()),
      },
    })

    await timeTravelDays(h.config.RESERVATION_HOLD_DAYS + 30)
    const after = await plotByNumber(h, sales, 1)
    expect(after.status).toBe('deposit_paid')
    expect(after.client).not.toBeNull()
  })

  it('records the release in the audit trail', async () => {
    const plot = await plotByNumber(h, sales, 1)
    await reserve(plot.id)
    await timeTravelDays(h.config.RESERVATION_HOLD_DAYS + 1)
    await plotByNumber(h, sales, 1)

    const director = await signIn(h, 'director')
    const audit = await h.app.inject({
      method: 'GET',
      url: '/api/audit?limit=200',
      headers: { authorization: director },
    })
    const actions = audit.json().entries.map((e: { action: string }) => e.action)
    expect(actions).toContain('reservation.expired')
  })
})

describe('cancelling a reservation', () => {
  it('returns the plot to the available pool', async () => {
    const plot = await plotByNumber(h, sales, 1)
    await reserve(plot.id)

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/plots/${plot.id}/reservations`,
      headers: { authorization: sales },
      payload: { reason: 'Buyer changed their mind' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().plot).toMatchObject({ status: 'available', client: null })
  })

  it('404s when there is nothing to cancel', async () => {
    const plot = await plotByNumber(h, sales, 1)
    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/plots/${plot.id}/reservations`,
      headers: { authorization: sales },
      payload: {},
    })
    expect(response.statusCode).toBe(404)
  })
})
