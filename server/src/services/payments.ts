import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import { AppError, badRequest, conflict, notFound } from '../domain/errors.js'
import { newId } from '../domain/ids.js'
import { matchPayment, normalisePhone } from '../domain/matching.js'
import type { MatchCandidate } from '../domain/matching.js'
import { outstandingCents, totalDueCents } from '../domain/plots.js'
import { iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import { recordAudit } from './audit.js'
import type { AuthUser } from './auth.js'
import { expireReservations, recomputePlotStatus } from './plots.js'

export type PaymentChannel = 'mpesa' | 'bank' | 'cash' | 'cheque'

export type PaymentStatus = 'matched' | 'partially_allocated' | 'unmatched' | 'reversal' | 'reversed'

export interface PaymentView {
  id: string
  receipt: string
  channel: PaymentChannel
  payerName: string
  payerPhone: string | null
  accountRef: string | null
  amountCents: number
  allocatedCents: number
  unallocatedCents: number
  status: PaymentStatus
  receivedAt: string
  recordedAt: string
  reversesPaymentId: string | null
  allocations: Array<{ plotId: string; plotNumber: number; amountCents: number; automatic: boolean }>
}

interface PaymentRow {
  id: string
  receipt: string
  channel: PaymentChannel
  payer_name: string
  payer_phone: string | null
  account_ref: string | null
  amount_cents: number
  received_at: string
  recorded_at: string
  reverses_payment_id: string | null
  allocated_cents: number | null
  reversed_by: string | null
}

const PAYMENT_SELECT = `
  SELECT p.id, p.receipt, p.channel, p.payer_name, p.payer_phone, p.account_ref,
         p.amount_cents, p.received_at, p.recorded_at, p.reverses_payment_id,
         (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.payment_id = p.id) AS allocated_cents,
         (SELECT r.id FROM payments r WHERE r.reverses_payment_id = p.id) AS reversed_by
  FROM payments p
`

function statusOf(row: PaymentRow): PaymentStatus {
  if (row.reverses_payment_id) return 'reversal'
  if (row.reversed_by) return 'reversed'
  const allocated = row.allocated_cents ?? 0
  if (allocated === row.amount_cents) return 'matched'
  if (allocated === 0) return 'unmatched'
  return 'partially_allocated'
}

function loadAllocations(db: Db, paymentId: string) {
  return (
    db
      .prepare(
        `SELECT a.plot_id, pl.number AS plot_number, a.amount_cents, a.automatic
         FROM payment_allocations a JOIN plots pl ON pl.id = a.plot_id
         WHERE a.payment_id = ? ORDER BY a.allocated_at`,
      )
      .all(paymentId) as Array<{
      plot_id: string
      plot_number: number
      amount_cents: number
      automatic: number
    }>
  ).map((a) => ({
    plotId: a.plot_id,
    plotNumber: a.plot_number,
    amountCents: a.amount_cents,
    automatic: a.automatic === 1,
  }))
}

function toView(db: Db, row: PaymentRow): PaymentView {
  const allocated = row.allocated_cents ?? 0
  return {
    id: row.id,
    receipt: row.receipt,
    channel: row.channel,
    payerName: row.payer_name,
    payerPhone: row.payer_phone,
    accountRef: row.account_ref,
    amountCents: row.amount_cents,
    allocatedCents: allocated,
    unallocatedCents: row.amount_cents - allocated,
    status: statusOf(row),
    receivedAt: row.received_at,
    recordedAt: row.recorded_at,
    reversesPaymentId: row.reverses_payment_id,
    allocations: loadAllocations(db, row.id),
  }
}

/** Plots that can absorb a payment, newest obligations last. */
function matchCandidates(db: Db): MatchCandidate[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.number, p.terms, p.cash_price_cents, p.instalment_price_cents, c.phone,
              (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.plot_id = p.id) AS paid
       FROM plots p LEFT JOIN clients c ON c.id = p.client_id`,
    )
    .all() as Array<{
    id: string
    number: number
    terms: 'cash' | 'instalment' | null
    cash_price_cents: number
    instalment_price_cents: number
    phone: string | null
    paid: number
  }>

  return rows.map((r) => {
    const due = totalDueCents(
      { cashPriceCents: r.cash_price_cents, instalmentPriceCents: r.instalment_price_cents },
      r.terms,
    )
    return {
      plotId: r.id,
      plotNumber: r.number,
      clientPhone: r.phone,
      outstandingCents: outstandingCents(due, r.paid),
    }
  })
}

function plotOutstanding(db: Db, plotId: string): number {
  const row = db
    .prepare(
      `SELECT p.terms, p.cash_price_cents, p.instalment_price_cents,
              (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.plot_id = p.id) AS paid
       FROM plots p WHERE p.id = ?`,
    )
    .get(plotId) as
    | { terms: 'cash' | 'instalment' | null; cash_price_cents: number; instalment_price_cents: number; paid: number }
    | undefined
  if (!row) throw notFound(`Plot ${plotId} not found`)
  const due = totalDueCents(
    { cashPriceCents: row.cash_price_cents, instalmentPriceCents: row.instalment_price_cents },
    row.terms,
  )
  return outstandingCents(due, row.paid)
}

function insertAllocation(
  db: Db,
  now: Date,
  input: { paymentId: string; plotId: string; amountCents: number; actorId: string; automatic: boolean },
): string {
  const id = newId()
  db.prepare(
    `INSERT INTO payment_allocations (id, payment_id, plot_id, amount_cents, allocated_at, allocated_by, automatic)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.paymentId, input.plotId, input.amountCents, iso(now), input.actorId, input.automatic ? 1 : 0)
  return id
}

export interface RecordPaymentInput {
  receipt: string
  channel: PaymentChannel
  payerName: string
  payerPhone?: string | null
  accountRef?: string | null
  amountCents: number
  receivedAt: string
  actor: AuthUser
  ip?: string | null
}

/**
 * Appends a receipt to the immutable ledger and attempts to reconcile it.
 *
 * Auto-matching only ever allocates up to what the plot still owes: any surplus
 * is left unallocated and surfaces in the exception queue, so the system never
 * silently absorbs money it cannot account for.
 */
export function recordPayment(db: Db, clock: Clock, input: RecordPaymentInput): PaymentView {
  const now = clock.now()
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw badRequest('Payment amount must be a positive integer number of cents')
  }

  return transaction(db, () => {
    expireReservations(db, now)

    const duplicate = db.prepare('SELECT id FROM payments WHERE receipt = ?').get(input.receipt)
    if (duplicate) throw conflict(`Receipt ${input.receipt} has already been recorded`)

    const paymentId = newId()
    const phone = normalisePhone(input.payerPhone)
    db.prepare(
      `INSERT INTO payments (id, receipt, channel, payer_name, payer_phone, account_ref, amount_cents,
                             received_at, recorded_at, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      paymentId,
      input.receipt,
      input.channel,
      input.payerName,
      phone,
      input.accountRef ?? null,
      input.amountCents,
      input.receivedAt,
      iso(now),
      input.actor.id,
    )

    const match = matchPayment(
      { accountRef: input.accountRef, payerPhone: phone },
      matchCandidates(db),
    )

    if (match.kind === 'matched') {
      const outstanding = plotOutstanding(db, match.plotId)
      const allocatable = Math.min(input.amountCents, outstanding)
      if (allocatable > 0) {
        insertAllocation(db, now, {
          paymentId,
          plotId: match.plotId,
          amountCents: allocatable,
          actorId: input.actor.id,
          automatic: true,
        })
        recomputePlotStatus(db, match.plotId, now)
      }
    }

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: paymentId,
      after: {
        receipt: input.receipt,
        amountCents: input.amountCents,
        match: match.kind === 'matched' ? { plotId: match.plotId, reason: match.reason } : match,
      },
      ip: input.ip,
    })

    const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(paymentId) as PaymentRow
    return toView(db, row)
  })
}

/**
 * Imports a batch of statement lines. Receipts already in the ledger are
 * skipped rather than rejected, so re-importing an overlapping statement is
 * safe and idempotent.
 */
export function importStatement(
  db: Db,
  clock: Clock,
  rows: Array<Omit<RecordPaymentInput, 'actor' | 'ip'>>,
  actor: AuthUser,
  ip?: string | null,
): { imported: PaymentView[]; skipped: string[] } {
  const imported: PaymentView[] = []
  const skipped: string[] = []

  for (const row of rows) {
    const exists = db.prepare('SELECT id FROM payments WHERE receipt = ?').get(row.receipt)
    if (exists) {
      skipped.push(row.receipt)
      continue
    }
    imported.push(recordPayment(db, clock, { ...row, actor, ip }))
  }
  return { imported, skipped }
}

/** Manually allocates part or all of a receipt to a plot account. */
export function allocatePayment(
  db: Db,
  clock: Clock,
  input: { paymentId: string; plotId: string; amountCents: number; actor: AuthUser; ip?: string | null },
): PaymentView {
  const now = clock.now()
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw badRequest('Allocation amount must be a positive integer number of cents')
  }

  return transaction(db, () => {
    const payment = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(input.paymentId) as
      | PaymentRow
      | undefined
    if (!payment) throw notFound(`Payment ${input.paymentId} not found`)
    if (payment.reverses_payment_id) throw conflict('A reversal entry cannot be allocated')
    if (payment.reversed_by) throw conflict('This receipt has been reversed')

    const unallocated = payment.amount_cents - (payment.allocated_cents ?? 0)
    if (input.amountCents > unallocated) {
      throw new AppError(
        'over_allocation',
        `Only ${unallocated} cents of receipt ${payment.receipt} remain unallocated`,
      )
    }

    const outstanding = plotOutstanding(db, input.plotId)
    if (input.amountCents > outstanding) {
      throw new AppError(
        'over_allocation',
        `Plot account only has ${outstanding} cents outstanding`,
      )
    }

    insertAllocation(db, now, {
      paymentId: input.paymentId,
      plotId: input.plotId,
      amountCents: input.amountCents,
      actorId: input.actor.id,
      automatic: false,
    })
    recomputePlotStatus(db, input.plotId, now)

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'payment.allocated',
      entityType: 'payment',
      entityId: input.paymentId,
      after: { plotId: input.plotId, amountCents: input.amountCents },
      ip: input.ip,
    })

    const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(input.paymentId) as PaymentRow
    return toView(db, row)
  })
}

/**
 * Reverses a receipt by appending a mirrored negative entry and offsetting
 * allocations. Nothing is ever updated or deleted, so the original receipt and
 * its correction both remain visible to auditors.
 */
export function reversePayment(
  db: Db,
  clock: Clock,
  input: { paymentId: string; reason: string; actor: AuthUser; ip?: string | null },
): PaymentView {
  const now = clock.now()

  return transaction(db, () => {
    const original = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(input.paymentId) as
      | PaymentRow
      | undefined
    if (!original) throw notFound(`Payment ${input.paymentId} not found`)
    if (original.reverses_payment_id) throw conflict('A reversal entry cannot itself be reversed')
    if (original.reversed_by) throw conflict('This receipt has already been reversed')

    const reversalId = newId()
    db.prepare(
      `INSERT INTO payments (id, receipt, channel, payer_name, payer_phone, account_ref, amount_cents,
                             received_at, recorded_at, recorded_by, reverses_payment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      reversalId,
      `${original.receipt}-REV`,
      original.channel,
      original.payer_name,
      original.payer_phone,
      original.account_ref,
      -original.amount_cents,
      iso(now),
      iso(now),
      input.actor.id,
      original.id,
    )

    const allocations = loadAllocations(db, original.id)
    for (const allocation of allocations) {
      insertAllocation(db, now, {
        paymentId: reversalId,
        plotId: allocation.plotId,
        amountCents: -allocation.amountCents,
        actorId: input.actor.id,
        automatic: false,
      })
    }
    for (const allocation of allocations) recomputePlotStatus(db, allocation.plotId, now)

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'payment.reversed',
      entityType: 'payment',
      entityId: original.id,
      after: { reversalId, reason: input.reason },
      ip: input.ip,
    })

    const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(reversalId) as PaymentRow
    return toView(db, row)
  })
}

export function listPayments(
  db: Db,
  filter: { limit: number; offset: number; status?: PaymentStatus } = { limit: 50, offset: 0 },
): PaymentView[] {
  const rows = db
    .prepare(`${PAYMENT_SELECT} ORDER BY p.received_at DESC, p.rowid DESC`)
    .all() as PaymentRow[]
  const views = rows.map((r) => toView(db, r))
  const filtered = filter.status ? views.filter((v) => v.status === filter.status) : views
  return filtered.slice(filter.offset, filter.offset + filter.limit)
}

export function getPayment(db: Db, paymentId: string): PaymentView {
  const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(paymentId) as PaymentRow | undefined
  if (!row) throw notFound(`Payment ${paymentId} not found`)
  return toView(db, row)
}

/** Receipts that still need a human decision before the books balance. */
export function listExceptions(db: Db): PaymentView[] {
  const rows = db.prepare(`${PAYMENT_SELECT} ORDER BY p.received_at DESC`).all() as PaymentRow[]
  return rows
    .map((r) => toView(db, r))
    .filter((v) => v.status === 'unmatched' || v.status === 'partially_allocated')
}
