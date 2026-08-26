import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, plotByNumber, signIn } from './harness.js'
import type { Harness } from './harness.js'
import { newId } from '../domain/ids.js'
import { iso } from '../domain/time.js'

let h: Harness
let finance: string
let sales: string

beforeEach(async () => {
  h = await createHarness()
  finance = await signIn(h, 'finance')
  sales = await signIn(h, 'sales')
})
afterEach(async () => {
  await h.close()
})

const pay = (payload: Record<string, unknown>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/payments',
    headers: { authorization: finance },
    payload: {
      channel: 'mpesa',
      payerName: 'Test Payer',
      receivedAt: iso(h.clock.now()),
      ...payload,
    },
  })

const reserveFreshPlot = async (number: number, terms: 'cash' | 'instalment' = 'instalment') => {
  const plot = await plotByNumber(h, sales, number)
  await h.app.inject({
    method: 'POST',
    url: `/api/plots/${plot.id}/reservations`,
    headers: { authorization: sales },
    payload: { buyerName: 'Mary Wanjiku', buyerPhone: '0712 345 678', terms },
  })
  return plot
}

describe('recording receipts', () => {
  it('auto-matches a receipt carrying a plot reference', async () => {
    const plot = await reserveFreshPlot(1)
    const response = await pay({ receipt: 'RCP-1', accountRef: 'PLOT1', amountCents: 10_000_000 })

    expect(response.statusCode).toBe(201)
    const payment = response.json().payment
    expect(payment.status).toBe('matched')
    expect(payment.allocations).toEqual([
      expect.objectContaining({ plotId: plot.id, amountCents: 10_000_000, automatic: true }),
    ])

    expect((await plotByNumber(h, sales, 1)).paidCents).toBe(10_000_000)
  })

  it('auto-matches on payer phone when only one plot owes money', async () => {
    await reserveFreshPlot(1)
    const response = await pay({ receipt: 'RCP-2', payerPhone: '0712 345 678', amountCents: 5_000_000 })
    expect(response.json().payment.status).toBe('matched')
  })

  it('queues a receipt with no usable reference as an exception', async () => {
    const response = await pay({ receipt: 'RCP-3', accountRef: 'RENT', amountCents: 2_500_000 })
    expect(response.json().payment.status).toBe('unmatched')

    const exceptions = await h.app.inject({
      method: 'GET',
      url: '/api/payments/exceptions',
      headers: { authorization: finance },
    })
    expect(exceptions.json().exceptions.map((e: { receipt: string }) => e.receipt)).toContain('RCP-3')
  })

  it('queues a receipt naming an unknown plot', async () => {
    const response = await pay({ receipt: 'RCP-4', accountRef: 'PLOT999', amountCents: 1_000_000 })
    expect(response.json().payment.status).toBe('unmatched')
  })

  it('allocates only what is owed and queues the surplus', async () => {
    const plot = await reserveFreshPlot(1, 'cash')
    const overpayment = plot.totalDueCents + 5_000_000

    const response = await pay({ receipt: 'RCP-5', accountRef: 'PLOT1', amountCents: overpayment })
    const payment = response.json().payment

    expect(payment.status).toBe('partially_allocated')
    expect(payment.allocatedCents).toBe(plot.totalDueCents)
    expect(payment.unallocatedCents).toBe(5_000_000)

    // The plot is settled exactly, never overpaid.
    const after = await plotByNumber(h, sales, 1)
    expect(after.outstandingCents).toBe(0)
    expect(after.status).toBe('fully_paid')
  })

  it('rejects a duplicate receipt number', async () => {
    await pay({ receipt: 'DUP-1', accountRef: 'PLOT1', amountCents: 1_000_000 })
    const second = await pay({ receipt: 'DUP-1', accountRef: 'PLOT1', amountCents: 1_000_000 })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('conflict')
  })

  it.each([
    ['a zero amount', { amountCents: 0 }],
    ['a negative amount', { amountCents: -100 }],
    ['a fractional amount', { amountCents: 10.5 }],
    ['a bad timestamp', { receivedAt: 'yesterday' }],
    ['an unknown channel', { channel: 'barter' }],
  ])('rejects %s', async (_label, override) => {
    const response = await pay({ receipt: `BAD-${newId()}`, amountCents: 1_000, ...override })
    expect(response.statusCode).toBe(400)
  })
})

describe('statement import', () => {
  it('imports a batch and skips receipts already on file', async () => {
    const entries = [
      { receipt: 'IMP-1', channel: 'mpesa', payerName: 'Ann Kilonzo', accountRef: 'PLOT1', amountCents: 1_000_000, receivedAt: iso(h.clock.now()) },
      { receipt: 'IMP-2', channel: 'bank', payerName: 'Ben Odhiambo', accountRef: 'PLOT3', amountCents: 2_000_000, receivedAt: iso(h.clock.now()) },
    ]

    const first = await h.app.inject({
      method: 'POST',
      url: '/api/payments/import',
      headers: { authorization: finance },
      payload: { entries },
    })
    expect(first.json().importedCount).toBe(2)

    // Re-importing an overlapping statement must be a no-op, not a duplicate.
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/payments/import',
      headers: { authorization: finance },
      payload: { entries },
    })
    expect(second.json().importedCount).toBe(0)
    expect(second.json().skippedReceipts).toEqual(['IMP-1', 'IMP-2'])
  })
})

describe('manual allocation', () => {
  it('assigns a queued receipt to a plot account', async () => {
    const plot = await reserveFreshPlot(1)
    const queued = await pay({ receipt: 'MAN-1', accountRef: 'RENT', amountCents: 3_000_000 })
    const paymentId = queued.json().payment.id

    const response = await h.app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/allocations`,
      headers: { authorization: finance },
      payload: { plotId: plot.id, amountCents: 3_000_000 },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().payment.status).toBe('matched')
    expect((await plotByNumber(h, sales, 1)).paidCents).toBe(3_000_000)
  })

  it('refuses to allocate more than the receipt holds', async () => {
    const plot = await reserveFreshPlot(1)
    const queued = await pay({ receipt: 'MAN-2', accountRef: 'RENT', amountCents: 1_000_000 })

    const response = await h.app.inject({
      method: 'POST',
      url: `/api/payments/${queued.json().payment.id}/allocations`,
      headers: { authorization: finance },
      payload: { plotId: plot.id, amountCents: 2_000_000 },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('over_allocation')
  })

  it('refuses to allocate more than the plot still owes', async () => {
    const plot = await reserveFreshPlot(1, 'cash')
    const queued = await pay({ receipt: 'MAN-3', accountRef: 'RENT', amountCents: plot.totalDueCents * 2 })

    const response = await h.app.inject({
      method: 'POST',
      url: `/api/payments/${queued.json().payment.id}/allocations`,
      headers: { authorization: finance },
      payload: { plotId: plot.id, amountCents: plot.totalDueCents + 1 },
    })

    expect(response.statusCode).toBe(422)
  })

  it('supports splitting one receipt across two plots', async () => {
    const first = await reserveFreshPlot(1)
    const second = await reserveFreshPlot(3)
    const queued = await pay({ receipt: 'SPLIT-1', accountRef: 'RENT', amountCents: 4_000_000 })
    const paymentId = queued.json().payment.id

    for (const plot of [first, second]) {
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/payments/${paymentId}/allocations`,
        headers: { authorization: finance },
        payload: { plotId: plot.id, amountCents: 2_000_000 },
      })
      expect(response.statusCode).toBe(201)
    }

    const payment = await h.app.inject({
      method: 'GET',
      url: `/api/payments/${paymentId}`,
      headers: { authorization: finance },
    })
    expect(payment.json().payment.status).toBe('matched')
    expect(payment.json().payment.allocations).toHaveLength(2)
  })
})

describe('ledger immutability', () => {
  it('blocks updates to recorded receipts at the database level', async () => {
    await pay({ receipt: 'IMM-1', accountRef: 'PLOT1', amountCents: 1_000_000 })
    expect(() =>
      h.db.prepare('UPDATE payments SET amount_cents = 1 WHERE receipt = ?').run('IMM-1'),
    ).toThrow(/immutable/i)
  })

  it('blocks deletion of recorded receipts', async () => {
    await pay({ receipt: 'IMM-2', accountRef: 'PLOT1', amountCents: 1_000_000 })
    expect(() => h.db.prepare('DELETE FROM payments WHERE receipt = ?').run('IMM-2')).toThrow(/immutable/i)
  })

  it('blocks tampering with allocations', async () => {
    await reserveFreshPlot(1)
    await pay({ receipt: 'IMM-3', accountRef: 'PLOT1', amountCents: 1_000_000 })
    expect(() => h.db.prepare('UPDATE payment_allocations SET amount_cents = 1').run()).toThrow(/immutable/i)
    expect(() => h.db.prepare('DELETE FROM payment_allocations').run()).toThrow(/immutable/i)
  })

  it('blocks tampering with the audit log', () => {
    expect(() => h.db.prepare(`UPDATE audit_log SET action = 'tampered'`).run()).toThrow(/append-only/i)
    expect(() => h.db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/i)
  })
})

describe('reversals', () => {
  it('reverses a receipt by appending a mirrored entry, leaving the original intact', async () => {
    await reserveFreshPlot(1)
    const original = await pay({ receipt: 'REV-1', accountRef: 'PLOT1', amountCents: 6_000_000 })
    const paymentId = original.json().payment.id
    expect((await plotByNumber(h, sales, 1)).paidCents).toBe(6_000_000)

    const response = await h.app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/reversal`,
      headers: { authorization: finance },
      payload: { reason: 'Bank recalled the transfer' },
    })

    expect(response.statusCode).toBe(201)
    const reversal = response.json().payment
    expect(reversal.amountCents).toBe(-6_000_000)
    expect(reversal.reversesPaymentId).toBe(paymentId)
    expect(reversal.status).toBe('reversal')

    // The plot account is unwound. Nobody has paid and the hold was consumed
    // when the money landed, so the plot genuinely returns to the sales pool.
    const plot = await plotByNumber(h, sales, 1)
    expect(plot.paidCents).toBe(0)
    expect(plot.status).toBe('available')
    expect(plot.client).toBeNull()

    // ...but the original receipt is still on the record.
    const originalAfter = await h.app.inject({
      method: 'GET',
      url: `/api/payments/${paymentId}`,
      headers: { authorization: finance },
    })
    expect(originalAfter.json().payment).toMatchObject({ receipt: 'REV-1', amountCents: 6_000_000, status: 'reversed' })

    // The release is recorded, so a director can always see why a sold plot
    // went back on the market.
    const director = await signIn(h, 'director')
    const audit = await h.app.inject({
      method: 'GET',
      url: '/api/audit?entityType=payment&limit=50',
      headers: { authorization: director },
    })
    expect(audit.json().entries.map((e: { action: string }) => e.action)).toContain('payment.reversed')
  })

  it('refuses to reverse the same receipt twice', async () => {
    const original = await pay({ receipt: 'REV-2', accountRef: 'PLOT1', amountCents: 1_000_000 })
    const paymentId = original.json().payment.id
    const reverse = () =>
      h.app.inject({
        method: 'POST',
        url: `/api/payments/${paymentId}/reversal`,
        headers: { authorization: finance },
        payload: { reason: 'Duplicate entry' },
      })

    expect((await reverse()).statusCode).toBe(201)
    expect((await reverse()).statusCode).toBe(409)
  })

  it('refuses to allocate against a reversed receipt', async () => {
    const plot = await reserveFreshPlot(1)
    const original = await pay({ receipt: 'REV-3', accountRef: 'RENT', amountCents: 1_000_000 })
    const paymentId = original.json().payment.id

    await h.app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/reversal`,
      headers: { authorization: finance },
      payload: { reason: 'Recalled' },
    })

    const response = await h.app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/allocations`,
      headers: { authorization: finance },
      payload: { plotId: plot.id, amountCents: 500_000 },
    })
    expect(response.statusCode).toBe(409)
  })

  it('requires a reason', async () => {
    const original = await pay({ receipt: 'REV-4', accountRef: 'PLOT1', amountCents: 1_000_000 })
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/payments/${original.json().payment.id}/reversal`,
      headers: { authorization: finance },
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })
})
