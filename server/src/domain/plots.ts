export type PlotStatus =
  | 'available'
  | 'reserved'
  | 'deposit_paid'
  | 'on_instalment'
  | 'fully_paid'
  | 'title_processing'

export type SaleTerms = 'cash' | 'instalment'

export interface PlotPricing {
  cashPriceCents: number
  instalmentPriceCents: number
}

/** The amount actually owed depends on the terms the buyer signed up to. */
export function totalDueCents(pricing: PlotPricing, terms: SaleTerms | null): number {
  return terms === 'instalment' ? pricing.instalmentPriceCents : pricing.cashPriceCents
}

export interface PlotStateInput {
  hasActiveReservation: boolean
  allocatedCents: number
  totalDueCents: number
  allocationCount: number
  titleProcessing: boolean
}

/**
 * Single source of truth for a plot's status. Status is always derived from
 * the underlying facts (reservation, allocations, title case) and recomputed
 * inside the same transaction that changes any of them, so it can never drift.
 */
export function derivePlotStatus(input: PlotStateInput): PlotStatus {
  if (input.titleProcessing) return 'title_processing'
  if (input.allocatedCents > 0 && input.allocatedCents >= input.totalDueCents) return 'fully_paid'
  if (input.allocatedCents > 0) {
    return input.allocationCount <= 1 ? 'deposit_paid' : 'on_instalment'
  }
  if (input.hasActiveReservation) return 'reserved'
  return 'available'
}

/** Outstanding balance, floored at zero so overpayments never read negative. */
export function outstandingCents(totalDue: number, allocated: number): number {
  return Math.max(0, totalDue - allocated)
}

export const PLOT_STATUS_ORDER: PlotStatus[] = [
  'available',
  'reserved',
  'deposit_paid',
  'on_instalment',
  'fully_paid',
  'title_processing',
]

export const PLOT_STATUS_LABEL: Record<PlotStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  deposit_paid: 'Deposit paid',
  on_instalment: 'On instalment',
  fully_paid: 'Fully paid',
  title_processing: 'Title processing',
}
