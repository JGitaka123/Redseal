import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import { AppError, badRequest, notFound } from '../domain/errors.js'
import { newId } from '../domain/ids.js'
import { normalisePhone } from '../domain/matching.js'
import { derivePlotStatus, outstandingCents, totalDueCents } from '../domain/plots.js'
import type { PlotStatus, SaleTerms } from '../domain/plots.js'
import { addDays, iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import type { Config } from '../config.js'
import { recordAudit } from './audit.js'
import type { AuthUser } from './auth.js'

export interface PlotView {
  id: string
  projectId: string
  projectName: string
  number: number
  size: string
  status: PlotStatus
  terms: SaleTerms | null
  cashPriceCents: number
  instalmentPriceCents: number
  totalDueCents: number
  paidCents: number
  outstandingCents: number
  client: { id: string; name: string; phone: string } | null
  reservedUntil: string | null
}

interface PlotRow {
  id: string
  project_id: string
  project_name: string
  number: number
  size: string
  status: PlotStatus
  terms: SaleTerms | null
  cash_price_cents: number
  instalment_price_cents: number
  title_processing: number
  client_id: string | null
  client_name: string | null
  client_phone: string | null
  paid_cents: number | null
  allocation_count: number
  reserved_until: string | null
}

const PLOT_SELECT = `
  SELECT p.id, p.project_id, pr.name AS project_name, p.number, p.size, p.status, p.terms,
         p.cash_price_cents, p.instalment_price_cents, p.title_processing,
         c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
         (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.plot_id = p.id) AS paid_cents,
         (SELECT COUNT(*) FROM payment_allocations a WHERE a.plot_id = p.id AND a.amount_cents > 0) AS allocation_count,
         (SELECT r.expires_at FROM reservations r WHERE r.plot_id = p.id AND r.status = 'active') AS reserved_until
  FROM plots p
  JOIN projects pr ON pr.id = p.project_id
  LEFT JOIN clients c ON c.id = p.client_id
`

function toView(row: PlotRow): PlotView {
  const due = totalDueCents(
    { cashPriceCents: row.cash_price_cents, instalmentPriceCents: row.instalment_price_cents },
    row.terms,
  )
  const paid = row.paid_cents ?? 0
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    number: row.number,
    size: row.size,
    status: row.status,
    terms: row.terms,
    cashPriceCents: row.cash_price_cents,
    instalmentPriceCents: row.instalment_price_cents,
    totalDueCents: due,
    paidCents: paid,
    outstandingCents: outstandingCents(due, paid),
    client: row.client_id
      ? { id: row.client_id, name: row.client_name ?? '', phone: row.client_phone ?? '' }
      : null,
    reservedUntil: row.reserved_until,
  }
}

/**
 * Recomputes and persists a plot's derived status from its underlying facts.
 * Must be called inside the transaction that changed any of those facts.
 */
export function recomputePlotStatus(db: Db, plotId: string, now: Date): PlotStatus {
  const row = db.prepare(`${PLOT_SELECT} WHERE p.id = ?`).get(plotId) as PlotRow | undefined
  if (!row) throw notFound(`Plot ${plotId} not found`)

  const due = totalDueCents(
    { cashPriceCents: row.cash_price_cents, instalmentPriceCents: row.instalment_price_cents },
    row.terms,
  )
  const status = derivePlotStatus({
    hasActiveReservation: row.reserved_until !== null,
    allocatedCents: row.paid_cents ?? 0,
    totalDueCents: due,
    allocationCount: row.allocation_count,
    titleProcessing: row.title_processing === 1,
  })

  // Once money is on a plot the hold has done its job: convert it, so a paid
  // plot is never quietly released by the expiry sweeper.
  if ((row.paid_cents ?? 0) > 0 && row.reserved_until !== null) {
    db.prepare(
      `UPDATE reservations SET status = 'converted', closed_at = ? WHERE plot_id = ? AND status = 'active'`,
    ).run(iso(now), plotId)
  }

  // A plot that has fallen all the way back to available belongs to nobody.
  const clearOwner = status === 'available'
  db.prepare(
    `UPDATE plots SET status = ?, updated_at = ?,
       client_id = CASE WHEN ? = 1 THEN NULL ELSE client_id END,
       terms = CASE WHEN ? = 1 THEN NULL ELSE terms END
     WHERE id = ?`,
  ).run(status, iso(now), clearOwner ? 1 : 0, clearOwner ? 1 : 0, plotId)

  return status
}

/**
 * Expires reservations whose hold period has elapsed and returns the affected
 * plot ids. Run lazily before any read or write that depends on availability,
 * so a stale hold never blocks a sale even if no sweeper is running.
 */
export function expireReservations(db: Db, now: Date, plotId?: string): string[] {
  const params: unknown[] = [iso(now)]
  let clause = `status = 'active' AND expires_at <= ?`
  if (plotId) {
    clause += ' AND plot_id = ?'
    params.push(plotId)
  }

  const due = db.prepare(`SELECT id, plot_id FROM reservations WHERE ${clause}`).all(...params) as Array<{
    id: string
    plot_id: string
  }>
  if (due.length === 0) return []

  const close = db.prepare(`UPDATE reservations SET status = 'expired', closed_at = ? WHERE id = ?`)
  for (const reservation of due) {
    close.run(iso(now), reservation.id)
    recordAudit(db, now, {
      actorId: null,
      action: 'reservation.expired',
      entityType: 'reservation',
      entityId: reservation.id,
      after: { plotId: reservation.plot_id, status: 'expired' },
    })
  }
  for (const reservation of due) recomputePlotStatus(db, reservation.plot_id, now)
  return due.map((r) => r.plot_id)
}

export function listPlots(
  db: Db,
  clock: Clock,
  filter: { projectId?: string; status?: PlotStatus } = {},
): PlotView[] {
  transaction(db, () => expireReservations(db, clock.now()))

  const where: string[] = []
  const params: unknown[] = []
  if (filter.projectId) {
    where.push('p.project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.status) {
    where.push('p.status = ?')
    params.push(filter.status)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db.prepare(`${PLOT_SELECT} ${clause} ORDER BY pr.name, p.number`).all(...params) as PlotRow[]
  return rows.map(toView)
}

export function getPlot(db: Db, clock: Clock, plotId: string): PlotView {
  transaction(db, () => expireReservations(db, clock.now(), plotId))
  const row = db.prepare(`${PLOT_SELECT} WHERE p.id = ?`).get(plotId) as PlotRow | undefined
  if (!row) throw notFound(`Plot ${plotId} not found`)
  return toView(row)
}

export function findPlotByNumber(db: Db, projectId: string, number: number): PlotView | null {
  const row = db
    .prepare(`${PLOT_SELECT} WHERE p.project_id = ? AND p.number = ?`)
    .get(projectId, number) as PlotRow | undefined
  return row ? toView(row) : null
}

/** Finds a client by phone number, creating one when this is a new buyer. */
export function upsertClientByPhone(
  db: Db,
  now: Date,
  input: { name: string; phone: string; email?: string | null; nationalId?: string | null },
): { id: string; created: boolean } {
  const phone = normalisePhone(input.phone)
  if (!phone) throw badRequest('A valid mobile number is required')

  const existing = db.prepare('SELECT id FROM clients WHERE phone = ?').get(phone) as
    | { id: string }
    | undefined
  if (existing) return { id: existing.id, created: false }

  const id = newId()
  db.prepare(
    `INSERT INTO clients (id, name, phone, email, national_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name.trim(), phone, input.email ?? null, input.nationalId ?? null, iso(now), iso(now))
  return { id, created: true }
}

export interface ReserveInput {
  plotId: string
  buyerName: string
  buyerPhone: string
  terms: SaleTerms
  actor: AuthUser
  ip?: string | null
}

export interface ReserveResult {
  reservationId: string
  plot: PlotView
}

/**
 * Reserves an available plot for a buyer.
 *
 * The whole operation runs in one IMMEDIATE transaction, and the partial unique
 * index on active reservations is the final authority: if two agents reserve the
 * same plot at the same moment, exactly one commits and the other is told the
 * plot is no longer available.
 */
export function reservePlot(
  db: Db,
  config: Config,
  clock: Clock,
  input: ReserveInput,
): ReserveResult {
  const now = clock.now()

  return transaction(db, () => {
    expireReservations(db, now, input.plotId)

    const plot = db.prepare(`${PLOT_SELECT} WHERE p.id = ?`).get(input.plotId) as PlotRow | undefined
    if (!plot) throw notFound(`Plot ${input.plotId} not found`)
    if (plot.status !== 'available') {
      throw new AppError(
        'plot_unavailable',
        `Plot ${plot.number} is ${plot.status.replace('_', ' ')} and cannot be reserved`,
      )
    }

    const client = upsertClientByPhone(db, now, { name: input.buyerName, phone: input.buyerPhone })
    const reservationId = newId()
    const expiresAt = addDays(now, config.RESERVATION_HOLD_DAYS)

    try {
      db.prepare(
        `INSERT INTO reservations (id, plot_id, client_id, terms, status, created_at, expires_at, created_by)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).run(reservationId, input.plotId, client.id, input.terms, iso(now), iso(expiresAt), input.actor.id)
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new AppError('plot_unavailable', `Plot ${plot.number} has just been reserved by someone else`)
      }
      throw error
    }

    db.prepare('UPDATE plots SET client_id = ?, terms = ?, updated_at = ? WHERE id = ?')
      .run(client.id, input.terms, iso(now), input.plotId)
    recomputePlotStatus(db, input.plotId, now)

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'plot.reserved',
      entityType: 'plot',
      entityId: input.plotId,
      before: { status: plot.status },
      after: { status: 'reserved', reservationId, clientId: client.id, expiresAt: iso(expiresAt) },
      ip: input.ip,
    })

    const row = db.prepare(`${PLOT_SELECT} WHERE p.id = ?`).get(input.plotId) as PlotRow
    return { reservationId, plot: toView(row) }
  })
}

export function cancelReservation(
  db: Db,
  clock: Clock,
  input: { plotId: string; actor: AuthUser; reason?: string; ip?: string | null },
): PlotView {
  const now = clock.now()

  return transaction(db, () => {
    const reservation = db
      .prepare(`SELECT id FROM reservations WHERE plot_id = ? AND status = 'active'`)
      .get(input.plotId) as { id: string } | undefined
    if (!reservation) throw notFound('No active reservation for this plot')

    db.prepare(`UPDATE reservations SET status = 'cancelled', closed_at = ? WHERE id = ?`)
      .run(iso(now), reservation.id)
    recomputePlotStatus(db, input.plotId, now)

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'reservation.cancelled',
      entityType: 'reservation',
      entityId: reservation.id,
      after: { plotId: input.plotId, reason: input.reason ?? null },
      ip: input.ip,
    })

    const row = db.prepare(`${PLOT_SELECT} WHERE p.id = ?`).get(input.plotId) as PlotRow
    return toView(row)
  })
}
