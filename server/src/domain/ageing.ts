import { daysBetween } from './time.js'

export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+'

export const AGEING_BUCKETS: AgeingBucket[] = ['0-30', '31-60', '61-90', '90+']

export function bucketForDays(days: number): AgeingBucket {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

export interface ArrearsRow {
  /** When the obligation started — first payment, or the reservation date. */
  since: Date
  outstandingCents: number
}

/**
 * Buckets outstanding balances by how long the debt has been open. Rows with
 * nothing outstanding are ignored so a fully paid plot never shows as arrears.
 */
export function ageArrears(rows: ArrearsRow[], now: Date): Record<AgeingBucket, number> {
  const totals: Record<AgeingBucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  for (const row of rows) {
    if (row.outstandingCents <= 0) continue
    totals[bucketForDays(daysBetween(row.since, now))] += row.outstandingCents
  }
  return totals
}
