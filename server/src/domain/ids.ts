import { randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()

/** Builds a human-facing case reference such as `TTL/2026/0033`. */
export function caseReference(prefix: string, year: number, sequence: number): string {
  return `${prefix}/${year}/${String(sequence).padStart(4, '0')}`
}

export const CASE_PREFIX = {
  title_transfer: 'TTL',
  beaconing: 'SUR',
  succession: 'SUC',
  subdivision: 'SUB',
  valuation: 'VAL',
} as const
