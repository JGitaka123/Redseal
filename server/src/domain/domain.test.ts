import { describe, expect, it } from 'vitest'
import { ageArrears, bucketForDays } from './ageing.js'
import { matchPayment, normalisePhone, parsePlotReference } from './matching.js'
import { derivePlotStatus, outstandingCents, totalDueCents } from './plots.js'
import { centsToShillings, formatKes, shillingsToCents } from './money.js'

describe('money', () => {
  it('round-trips shillings through integer cents', () => {
    expect(shillingsToCents(375_000)).toBe(37_500_000)
    expect(centsToShillings(37_500_000)).toBe(375_000)
  })

  it('avoids floating point drift on fractional amounts', () => {
    expect(shillingsToCents(0.1 + 0.2)).toBe(30)
  })

  it('formats whole shillings without decimals', () => {
    expect(formatKes(37_500_000)).toBe('KSh 375,000')
  })
})

describe('parsePlotReference', () => {
  it.each([
    ['PLOT7', 7],
    ['plot 7', 7],
    ['plt-7', 7],
    ['P7', 7],
    ['  7 ', 7],
    ['PLOT/34', 34],
  ])('parses %s', (input, expected) => {
    expect(parsePlotReference(input as string)).toBe(expected)
  })

  it.each(['', 'rent', 'PLOT', 'PLOT7A', '7B'])('rejects %s', (input) => {
    expect(parsePlotReference(input)).toBeNull()
  })

  it('rejects absent references', () => {
    expect(parsePlotReference(null)).toBeNull()
    expect(parsePlotReference(undefined)).toBeNull()
  })
})

describe('normalisePhone', () => {
  it.each([
    ['0712 680 941', '0712680941'],
    ['+254712680941', '0712680941'],
    ['254712680941', '0712680941'],
    ['712680941', '0712680941'],
  ])('normalises %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected)
  })

  it('returns null when there are no digits', () => {
    expect(normalisePhone('n/a')).toBeNull()
  })
})

describe('matchPayment', () => {
  const candidates = [
    { plotId: 'a', plotNumber: 7, clientPhone: '0712680941', outstandingCents: 100_000 },
    { plotId: 'b', plotNumber: 8, clientPhone: '0712680941', outstandingCents: 50_000 },
    { plotId: 'c', plotNumber: 9, clientPhone: '0700000000', outstandingCents: 0 },
  ]

  it('prefers an explicit account reference', () => {
    expect(matchPayment({ accountRef: 'PLOT7', payerPhone: '0700000000' }, candidates)).toEqual({
      kind: 'matched',
      plotId: 'a',
      reason: 'account_reference',
    })
  })

  it('flags a reference that names no known plot', () => {
    expect(matchPayment({ accountRef: 'PLOT99' }, candidates)).toEqual({
      kind: 'unmatched',
      reason: 'unknown_reference',
    })
  })

  it('refuses to guess when a phone owes on several plots', () => {
    expect(matchPayment({ payerPhone: '0712680941' }, candidates)).toEqual({
      kind: 'unmatched',
      reason: 'ambiguous_phone',
    })
  })

  it('matches on phone when exactly one plot still owes money', () => {
    const single = [candidates[0]!, candidates[2]!]
    expect(matchPayment({ payerPhone: '+254712680941' }, single)).toEqual({
      kind: 'matched',
      plotId: 'a',
      reason: 'payer_phone',
    })
  })

  it('does not match a phone whose plots are fully paid', () => {
    expect(matchPayment({ payerPhone: '0700000000' }, candidates)).toEqual({
      kind: 'unmatched',
      reason: 'no_reference',
    })
  })
})

describe('derivePlotStatus', () => {
  const base = {
    hasActiveReservation: false,
    allocatedCents: 0,
    totalDueCents: 1000,
    allocationCount: 0,
    titleProcessing: false,
  }

  it('is available with no reservation and no money', () => {
    expect(derivePlotStatus(base)).toBe('available')
  })

  it('is reserved when held but unpaid', () => {
    expect(derivePlotStatus({ ...base, hasActiveReservation: true })).toBe('reserved')
  })

  it('is deposit_paid after a single part payment', () => {
    expect(derivePlotStatus({ ...base, allocatedCents: 300, allocationCount: 1 })).toBe('deposit_paid')
  })

  it('is on_instalment once a second payment lands', () => {
    expect(derivePlotStatus({ ...base, allocatedCents: 600, allocationCount: 2 })).toBe('on_instalment')
  })

  it('is fully_paid when the balance is cleared', () => {
    expect(derivePlotStatus({ ...base, allocatedCents: 1000, allocationCount: 2 })).toBe('fully_paid')
  })

  it('treats an overpayment as fully paid, never negative', () => {
    expect(derivePlotStatus({ ...base, allocatedCents: 1200, allocationCount: 2 })).toBe('fully_paid')
    expect(outstandingCents(1000, 1200)).toBe(0)
  })

  it('lets title processing win over every other state', () => {
    expect(derivePlotStatus({ ...base, allocatedCents: 1000, titleProcessing: true })).toBe('title_processing')
  })

  it('falls back to available when a reversal removes all money', () => {
    expect(derivePlotStatus({ ...base, allocatedCents: 0, allocationCount: 0 })).toBe('available')
  })
})

describe('totalDueCents', () => {
  const pricing = { cashPriceCents: 1000, instalmentPriceCents: 1200 }

  it('charges the instalment price only on instalment terms', () => {
    expect(totalDueCents(pricing, 'instalment')).toBe(1200)
    expect(totalDueCents(pricing, 'cash')).toBe(1000)
    expect(totalDueCents(pricing, null)).toBe(1000)
  })
})

describe('arrears ageing', () => {
  it.each([
    [0, '0-30'],
    [30, '0-30'],
    [31, '31-60'],
    [60, '31-60'],
    [61, '61-90'],
    [90, '61-90'],
    [91, '90+'],
  ])('puts %i days in %s', (days, bucket) => {
    expect(bucketForDays(days)).toBe(bucket)
  })

  it('buckets balances and ignores settled rows', () => {
    const now = new Date('2026-08-20T00:00:00.000Z')
    const totals = ageArrears(
      [
        { since: new Date('2026-08-10T00:00:00.000Z'), outstandingCents: 100 },
        { since: new Date('2026-07-10T00:00:00.000Z'), outstandingCents: 200 },
        { since: new Date('2026-01-01T00:00:00.000Z'), outstandingCents: 400 },
        { since: new Date('2026-01-01T00:00:00.000Z'), outstandingCents: 0 },
      ],
      now,
    )
    expect(totals).toEqual({ '0-30': 100, '31-60': 200, '61-90': 0, '90+': 400 })
  })
})
