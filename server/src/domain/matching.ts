/**
 * M-Pesa style reconciliation. Paybill account references arrive as free text
 * typed by the payer, so they are normalised before being matched to a plot.
 */
export interface MatchCandidate {
  plotId: string
  plotNumber: number
  clientPhone: string | null
  outstandingCents: number
}

export type MatchResult =
  | { kind: 'matched'; plotId: string; reason: 'account_reference' | 'payer_phone' }
  | { kind: 'unmatched'; reason: 'no_reference' | 'unknown_reference' | 'ambiguous_phone' }

/** Extracts a plot number from references like `PLOT 7`, `plt-7`, `P7` or `7`. */
export function parsePlotReference(reference: string | null | undefined): number | null {
  if (!reference) return null
  const match = /^\s*(?:plot|plt|p)?\s*[-#/]?\s*(\d{1,4})\s*$/i.exec(reference)
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Kenyan mobile numbers appear as 0712…, +254712… or 254712… in statements. */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('254')) return `0${digits.slice(3)}`
  if (digits.startsWith('0')) return digits
  if (digits.length === 9) return `0${digits}`
  return digits
}

/**
 * Resolves a receipt to a plot account. An explicit account reference always
 * wins; otherwise the payer's phone number is used, but only when it points at
 * exactly one plot that still owes money. Anything else goes to the exception
 * queue for a human to resolve — the system never guesses.
 */
export function matchPayment(
  payment: { accountRef?: string | null; payerPhone?: string | null },
  candidates: MatchCandidate[],
): MatchResult {
  const plotNumber = parsePlotReference(payment.accountRef)
  if (plotNumber !== null) {
    const hit = candidates.find((c) => c.plotNumber === plotNumber)
    return hit
      ? { kind: 'matched', plotId: hit.plotId, reason: 'account_reference' }
      : { kind: 'unmatched', reason: 'unknown_reference' }
  }

  const phone = normalisePhone(payment.payerPhone)
  if (phone) {
    const owing = candidates.filter(
      (c) => normalisePhone(c.clientPhone) === phone && c.outstandingCents > 0,
    )
    if (owing.length === 1 && owing[0]) {
      return { kind: 'matched', plotId: owing[0].plotId, reason: 'payer_phone' }
    }
    if (owing.length > 1) return { kind: 'unmatched', reason: 'ambiguous_phone' }
  }

  return { kind: 'unmatched', reason: 'no_reference' }
}
