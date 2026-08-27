import { describe, expect, it } from 'vitest'
import { formatApiDate, relativeTime, toUiCase, toUiPlot, toUiPlots, toUiTransaction } from './mapping'
import type { ApiCase, ApiPayment, ApiPlot } from './types'

const plot = (overrides: Partial<ApiPlot> = {}): ApiPlot => ({
  id: 'uuid-1',
  projectId: 'proj-1',
  projectName: 'Pioneer Estate Phase 2',
  number: 7,
  size: '50 × 100 ft',
  status: 'on_instalment',
  terms: 'instalment',
  cashPriceCents: 37_500_000,
  instalmentPriceCents: 45_000_000,
  totalDueCents: 45_000_000,
  paidCents: 27_500_000,
  outstandingCents: 17_500_000,
  client: { id: 'c1', name: 'Samuel Muriuki', phone: '0721441208' },
  reservedUntil: null,
  ...overrides,
})

describe('toUiPlot', () => {
  it('converts cents to shillings and keeps the server id for writes', () => {
    expect(toUiPlot(plot())).toEqual({
      id: 7,
      apiId: 'uuid-1',
      status: 'on_instalment',
      size: '50 × 100 ft',
      cashPrice: 375_000,
      instalmentPrice: 450_000,
      buyer: 'Samuel Muriuki',
      buyerPhone: '0721441208',
      paid: 275_000,
      reservedUntil: undefined,
    })
  })

  it('leaves an untouched available plot without a paid figure', () => {
    const mapped = toUiPlot(plot({ status: 'available', client: null, paidCents: 0 }))
    expect(mapped.paid).toBeUndefined()
    expect(mapped.buyer).toBeUndefined()
  })

  it('reports a zero balance for a reserved plot that has paid nothing', () => {
    const mapped = toUiPlot(plot({ status: 'reserved', paidCents: 0 }))
    expect(mapped.paid).toBe(0)
  })

  it('formats the reservation expiry for display', () => {
    const mapped = toUiPlot(plot({ reservedUntil: '2026-08-22T09:00:00.000Z' }))
    expect(mapped.reservedUntil).toBe('22 Aug 2026')
  })

  it('sorts plots by number', () => {
    const mapped = toUiPlots([plot({ number: 12 }), plot({ number: 3 }), plot({ number: 7 })])
    expect(mapped.map((p) => p.id)).toEqual([3, 7, 12])
  })
})

describe('formatApiDate', () => {
  it('returns undefined for absent or invalid dates', () => {
    expect(formatApiDate(null)).toBeUndefined()
    expect(formatApiDate('not-a-date')).toBeUndefined()
  })
})

describe('toUiCase', () => {
  const record: ApiCase = {
    id: 'k1',
    reference: 'TTL/2026/0033',
    client: { id: 'c1', name: 'Dennis Ngari', phone: '0720513896' },
    plotId: 'uuid-33',
    service: 'title_transfer',
    stage: 'Valuation for stamp duty',
    status: 'awaiting_client',
    officer: 'Grace W.',
    progress: 56,
    nextAction: 'Receive valuation report',
    updatedAt: '2026-08-20T10:24:00.000Z',
  }

  it('renders API enums as the labels the case desk shows', () => {
    expect(toUiCase(record)).toMatchObject({
      id: 'TTL/2026/0033',
      client: 'Dennis Ngari',
      service: 'Title transfer',
      status: 'Awaiting client',
      progress: 56,
      next: 'Receive valuation report',
    })
  })

  it.each([
    ['on_track', 'On track'],
    ['delayed', 'Delayed'],
    ['closed', 'On track'],
  ] as const)('maps %s to %s', (status, label) => {
    expect(toUiCase({ ...record, status }).status).toBe(label)
  })
})

describe('toUiTransaction', () => {
  const payment = (overrides: Partial<ApiPayment> = {}): ApiPayment => ({
    id: 'p1',
    receipt: 'QK73HD91XZ',
    channel: 'mpesa',
    payerName: 'Samuel Muriuki',
    payerPhone: '0721441208',
    accountRef: 'PLOT7',
    amountCents: 2_500_000,
    allocatedCents: 2_500_000,
    unallocatedCents: 0,
    status: 'matched',
    receivedAt: '2026-08-20T10:42:00.000Z',
    recordedAt: '2026-08-20T10:42:00.000Z',
    allocations: [{ plotId: 'uuid-7', plotNumber: 7, amountCents: 2_500_000, automatic: true }],
    ...overrides,
  })

  it('shows the plot a receipt was matched to', () => {
    expect(toUiTransaction(payment())).toEqual([
      'QK73HD91XZ',
      'Samuel Muriuki',
      'Plot 7',
      25_000,
      'Matched',
      '20 Aug 2026',
    ])
  })

  it('falls back to the raw reference for an unmatched receipt', () => {
    const row = toUiTransaction(payment({ status: 'unmatched', allocations: [], accountRef: 'RENT' }))
    expect(row[2]).toBe('RENT')
    expect(row[4]).toBe('Exception')
  })

  it('says Unallocated when there is no reference at all', () => {
    const row = toUiTransaction(payment({ status: 'unmatched', allocations: [], accountRef: null }))
    expect(row[2]).toBe('Unallocated')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')

  it.each([
    ['2026-08-20T11:59:40.000Z', 'Just now'],
    ['2026-08-20T11:48:00.000Z', '12 min ago'],
    ['2026-08-20T11:00:00.000Z', '1 hr ago'],
    ['2026-08-20T09:00:00.000Z', '3 hrs ago'],
    ['2026-08-19T12:00:00.000Z', 'Yesterday'],
    ['2026-08-17T12:00:00.000Z', '3 days ago'],
  ])('renders %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected)
  })

  it('returns an empty string for an invalid timestamp', () => {
    expect(relativeTime('nonsense', now)).toBe('')
  })
})
