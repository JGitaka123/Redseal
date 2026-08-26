import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, plotByNumber, signIn } from './harness.js'
import type { Harness } from './harness.js'
import { shillingsToCents } from '../domain/money.js'
import { iso } from '../domain/time.js'

let h: Harness
let director: string
let sales: string

beforeEach(async () => {
  h = await createHarness()
  director = await signIn(h, 'director')
  sales = await signIn(h, 'sales')
})
afterEach(async () => {
  await h.close()
})

const fetchOverview = async () => {
  const response = await h.app.inject({ method: 'GET', url: '/api/overview', headers: { authorization: director } })
  expect(response.statusCode).toBe(200)
  return response.json().overview
}

describe('director overview', () => {
  it('counts the whole inventory once, across every status', async () => {
    const overview = await fetchOverview()
    const counted = Object.values(overview.inventory.byStatus as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    )
    expect(overview.inventory.total).toBe(34)
    expect(counted).toBe(34)
  })

  it('reports receivables that reconcile with the plot ledger', async () => {
    const overview = await fetchOverview()
    const { contractedValueCents, collectedCents, totalOutstandingCents } = overview.receivables
    // Every shilling contracted is either collected or still owed.
    expect(contractedValueCents - collectedCents).toBe(totalOutstandingCents)
  })

  it('matches collected revenue to the sum of plot balances', async () => {
    const overview = await fetchOverview()
    const plots = (
      await h.app.inject({ method: 'GET', url: '/api/plots', headers: { authorization: sales } })
    ).json().plots as Array<{ paidCents: number }>

    const paidTotal = plots.reduce((sum, p) => sum + p.paidCents, 0)
    expect(overview.receivables.collectedCents).toBe(paidTotal)
  })

  it('values available inventory at the cash price', async () => {
    const overview = await fetchOverview()
    const plots = (
      await h.app.inject({ method: 'GET', url: '/api/plots?status=available', headers: { authorization: sales } })
    ).json().plots as Array<{ cashPriceCents: number }>

    expect(overview.inventory.availableValueCents).toBe(
      plots.reduce((sum, p) => sum + p.cashPriceCents, 0),
    )
  })

  it('ages arrears into buckets that sum to the outstanding balance', async () => {
    const overview = await fetchOverview()
    const bucketed = Object.values(overview.arrears as Record<string, number>).reduce((a, b) => a + b, 0)
    expect(bucketed).toBe(overview.receivables.totalOutstandingCents)
  })

  it('counts today’s collections only', async () => {
    const before = await fetchOverview()
    const finance = await signIn(h, 'finance')

    await h.app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: finance },
      payload: {
        receipt: 'TODAY-1',
        channel: 'mpesa',
        payerName: 'Today Payer',
        accountRef: 'PLOT4',
        amountCents: shillingsToCents(25_000),
        receivedAt: iso(h.clock.now()),
      },
    })

    const after = await fetchOverview()
    expect(after.collections.todayCents - before.collections.todayCents).toBe(shillingsToCents(25_000))
    expect(after.collections.transactionsToday).toBe(before.collections.transactionsToday + 1)
  })

  it('surfaces unreconciled receipts and their value', async () => {
    const finance = await signIn(h, 'finance')
    await h.app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: finance },
      payload: {
        receipt: 'EXC-1',
        channel: 'mpesa',
        payerName: 'Mystery Payer',
        accountRef: 'RENT',
        amountCents: shillingsToCents(47_500),
        receivedAt: iso(h.clock.now()),
      },
    })

    const overview = await fetchOverview()
    expect(overview.reconciliation.exceptions).toBe(1)
    expect(overview.reconciliation.exceptionValueCents).toBe(shillingsToCents(47_500))
  })

  it('summarises the three projects', async () => {
    const overview = await fetchOverview()
    expect(overview.projects.map((p: { name: string }) => p.name).sort()).toEqual([
      'Fadhili Gardens',
      'Pinnacle Estate Phase 2',
      'Pioneer Estate Phase 2',
    ])

    const pioneer = overview.projects.find((p: { name: string }) => p.name === 'Pioneer Estate Phase 2')
    expect(pioneer.plots).toBe(34)
    expect(pioneer.sold).toBeGreaterThan(0)
  })

  it('reflects a new reservation immediately', async () => {
    const before = await fetchOverview()
    const plot = await plotByNumber(h, sales, 1)

    await h.app.inject({
      method: 'POST',
      url: `/api/plots/${plot.id}/reservations`,
      headers: { authorization: sales },
      payload: { buyerName: 'Mary Wanjiku', buyerPhone: '0712 345 678' },
    })

    const after = await fetchOverview()
    expect(after.inventory.byStatus.available).toBe(before.inventory.byStatus.available - 1)
    expect(after.inventory.byStatus.reserved).toBe(before.inventory.byStatus.reserved + 1)
  })

  it('counts open, delayed and awaiting-client cases', async () => {
    const overview = await fetchOverview()
    expect(overview.cases.open).toBeGreaterThan(0)
  })
})

describe('activity feed', () => {
  it('reports recent operational events, newest first', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/activity?limit=10',
      headers: { authorization: director },
    })

    expect(response.statusCode).toBe(200)
    const activity = response.json().activity
    expect(activity.length).toBeGreaterThan(0)
    expect(activity.length).toBeLessThanOrEqual(10)

    const timestamps = activity.map((a: { at: string }) => new Date(a.at).getTime())
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps)
  })

  it('never leaks sign-in events into the operational feed', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/activity?limit=100',
      headers: { authorization: director },
    })
    expect(response.json().activity.some((a: { action: string }) => a.action.startsWith('auth.'))).toBe(false)
  })
})
