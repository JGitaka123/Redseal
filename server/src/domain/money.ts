/**
 * All monetary values are stored and transported as integer cents to keep
 * arithmetic exact. Never introduce a floating point shilling amount.
 */
export type Cents = number

export const shillingsToCents = (shillings: number): Cents => Math.round(shillings * 100)

export const centsToShillings = (cents: Cents): number => cents / 100

export function formatKes(cents: Cents): string {
  const shillings = centsToShillings(cents)
  return `KSh ${new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: shillings % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(shillings)}`
}

export function assertPositiveCents(value: number, field: string): void {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer number of cents`)
  if (value <= 0) throw new Error(`${field} must be greater than zero`)
}
