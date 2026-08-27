import type { Activity, CaseRecord, Plot } from '../types'
import type { ApiActivity, ApiCase, ApiPayment, ApiPlot } from './types'

/** The API speaks integer cents; the UI renders whole shillings. */
export const centsToShillings = (cents: number): number => cents / 100

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatApiDate(iso: string | null): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : DATE_FORMAT.format(date)
}

/**
 * Maps an API plot onto the shape the existing views render. The UI keys plots
 * by their human number, so the server's id is carried alongside as `apiId` for
 * write operations.
 */
export function toUiPlot(plot: ApiPlot): Plot {
  return {
    id: plot.number,
    apiId: plot.id,
    status: plot.status,
    size: plot.size,
    cashPrice: centsToShillings(plot.cashPriceCents),
    instalmentPrice: centsToShillings(plot.instalmentPriceCents),
    buyer: plot.client?.name,
    buyerPhone: plot.client?.phone,
    paid: plot.paidCents === 0 && !plot.client ? undefined : centsToShillings(plot.paidCents),
    reservedUntil: formatApiDate(plot.reservedUntil),
  }
}

export const toUiPlots = (plots: ApiPlot[]): Plot[] =>
  [...plots].sort((a, b) => a.number - b.number).map(toUiPlot)

const CASE_STATUS_LABEL: Record<ApiCase['status'], CaseRecord['status']> = {
  on_track: 'On track',
  awaiting_client: 'Awaiting client',
  delayed: 'Delayed',
  // A closed case has nothing outstanding, so it reads as on track.
  closed: 'On track',
}

const CASE_SERVICE_LABEL: Record<ApiCase['service'], string> = {
  title_transfer: 'Title transfer',
  beaconing: 'Beaconing',
  succession: 'Succession',
  subdivision: 'Subdivision',
  valuation: 'Valuation',
}

export function toUiCase(record: ApiCase): CaseRecord {
  return {
    id: record.reference,
    client: record.client.name,
    service: CASE_SERVICE_LABEL[record.service],
    stage: record.stage,
    status: CASE_STATUS_LABEL[record.status],
    officer: record.officer,
    updated: formatApiDate(record.updatedAt) ?? '',
    progress: record.progress,
    next: record.nextAction,
  }
}

const PAYMENT_STATUS_LABEL: Record<ApiPayment['status'], string> = {
  matched: 'Matched',
  partially_allocated: 'Part matched',
  unmatched: 'Exception',
  reversal: 'Reversal',
  reversed: 'Reversed',
}

/** The payments table renders rows as tuples; keep that contract. */
export function toUiTransaction(payment: ApiPayment): (string | number)[] {
  const plot = payment.allocations[0]
  return [
    payment.receipt,
    payment.payerName,
    plot ? `Plot ${plot.plotNumber}` : (payment.accountRef ?? 'Unallocated'),
    centsToShillings(payment.amountCents),
    PAYMENT_STATUS_LABEL[payment.status],
    formatApiDate(payment.receivedAt) ?? '',
  ]
}

const ACTIVITY_KIND: Record<string, Activity['kind']> = {
  'plot.reserved': 'plot',
  'reservation.cancelled': 'plot',
  'reservation.expired': 'plot',
  'payment.recorded': 'payment',
  'payment.allocated': 'payment',
  'payment.reversed': 'payment',
  'case.opened': 'case',
  'case.advanced': 'case',
  'client.created': 'client',
  'client.updated': 'client',
}

const ACTIVITY_TITLE: Record<string, string> = {
  'plot.reserved': 'Plot reserved',
  'reservation.cancelled': 'Reservation cancelled',
  'reservation.expired': 'Reservation expired',
  'payment.recorded': 'Payment received',
  'payment.allocated': 'Payment allocated',
  'payment.reversed': 'Payment reversed',
  'case.opened': 'Case opened',
  'case.advanced': 'Case moved forward',
  'client.created': 'New client registered',
  'client.updated': 'Client updated',
}

/** Renders "3 hrs ago" style relative times for the activity feed. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((now.getTime() - then) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

export function toUiActivity(entry: ApiActivity, index: number, now?: Date): Activity {
  return {
    id: index,
    kind: ACTIVITY_KIND[entry.action] ?? 'client',
    title: ACTIVITY_TITLE[entry.action] ?? entry.action,
    detail: `${entry.entityType} · ${entry.actor}`,
    time: relativeTime(entry.at, now),
  }
}
