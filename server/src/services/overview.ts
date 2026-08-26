import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import { ageArrears } from '../domain/ageing.js'
import type { AgeingBucket } from '../domain/ageing.js'
import { outstandingCents, PLOT_STATUS_ORDER, totalDueCents } from '../domain/plots.js'
import type { PlotStatus } from '../domain/plots.js'
import { iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import { expireReservations } from './plots.js'

export interface OverviewMetrics {
  generatedAt: string
  collections: { todayCents: number; monthToDateCents: number; transactionsToday: number }
  receivables: { totalOutstandingCents: number; contractedValueCents: number; collectedCents: number }
  inventory: { total: number; byStatus: Record<PlotStatus, number>; availableValueCents: number }
  reconciliation: { exceptions: number; exceptionValueCents: number; autoMatchedRate: number }
  cases: { open: number; delayed: number; awaitingClient: number; closedThisMonth: number }
  arrears: Record<AgeingBucket, number>
  projects: Array<{
    id: string
    name: string
    location: string
    status: string
    plots: number
    sold: number
    revenueCents: number
  }>
}

interface PlotAggRow {
  id: string
  status: PlotStatus
  terms: 'cash' | 'instalment' | null
  cash_price_cents: number
  instalment_price_cents: number
  paid: number
  since: string | null
}

/**
 * Builds the director dashboard in a single pass over the plot ledger so that
 * every headline figure on the page is computed from the same snapshot.
 */
export function overview(db: Db, clock: Clock): OverviewMetrics {
  const now = clock.now()
  transaction(db, () => expireReservations(db, now))

  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const plots = db
    .prepare(
      `SELECT p.id, p.status, p.terms, p.cash_price_cents, p.instalment_price_cents,
              (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.plot_id = p.id) AS paid,
              COALESCE(
                (SELECT MIN(a.allocated_at) FROM payment_allocations a WHERE a.plot_id = p.id),
                (SELECT MIN(r.created_at) FROM reservations r WHERE r.plot_id = p.id AND r.status = 'active')
              ) AS since
       FROM plots p`,
    )
    .all() as PlotAggRow[]

  const byStatus = Object.fromEntries(PLOT_STATUS_ORDER.map((s) => [s, 0])) as Record<PlotStatus, number>
  let contracted = 0
  let collected = 0
  let outstandingTotal = 0
  let availableValue = 0
  const arrearsRows: Array<{ since: Date; outstandingCents: number }> = []

  for (const plot of plots) {
    byStatus[plot.status] += 1
    const due = totalDueCents(
      { cashPriceCents: plot.cash_price_cents, instalmentPriceCents: plot.instalment_price_cents },
      plot.terms,
    )
    if (plot.status === 'available') {
      availableValue += plot.cash_price_cents
      continue
    }
    const open = outstandingCents(due, plot.paid)
    contracted += due
    collected += plot.paid
    outstandingTotal += open
    if (open > 0 && plot.since) arrearsRows.push({ since: new Date(plot.since), outstandingCents: open })
  }

  const collectionsToday = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n
       FROM payments WHERE received_at >= ? AND reverses_payment_id IS NULL`,
    )
    .get(iso(startOfDay)) as { total: number; n: number }

  const collectionsMonth = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE received_at >= ?`)
    .get(iso(startOfMonth)) as { total: number }

  const exceptionRows = db
    .prepare(
      `SELECT p.amount_cents,
              (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.payment_id = p.id) AS allocated
       FROM payments p
       WHERE p.reverses_payment_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.reverses_payment_id = p.id)`,
    )
    .all() as Array<{ amount_cents: number; allocated: number }>

  const exceptions = exceptionRows.filter((r) => r.allocated < r.amount_cents)
  const exceptionValue = exceptions.reduce((sum, r) => sum + (r.amount_cents - r.allocated), 0)
  const autoMatched = db
    .prepare(`SELECT COUNT(DISTINCT payment_id) AS n FROM payment_allocations WHERE automatic = 1`)
    .get() as { n: number }
  const settledCount = exceptionRows.length
  const autoMatchedRate = settledCount === 0 ? 0 : Math.round((autoMatched.n / settledCount) * 1000) / 10

  const caseCounts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status <> 'closed' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'delayed' THEN 1 ELSE 0 END) AS delayed,
         SUM(CASE WHEN status = 'awaiting_client' THEN 1 ELSE 0 END) AS awaiting,
         SUM(CASE WHEN status = 'closed' AND closed_at >= ? THEN 1 ELSE 0 END) AS closed_month
       FROM cases`,
    )
    .get(iso(startOfMonth)) as {
    open: number | null
    delayed: number | null
    awaiting: number | null
    closed_month: number | null
  }

  const projects = db
    .prepare(
      `SELECT pr.id, pr.name, pr.location, pr.status,
              COUNT(p.id) AS plots,
              SUM(CASE WHEN p.status <> 'available' THEN 1 ELSE 0 END) AS sold,
              COALESCE(SUM((SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.plot_id = p.id)), 0) AS revenue
       FROM projects pr LEFT JOIN plots p ON p.project_id = pr.id
       GROUP BY pr.id ORDER BY pr.name`,
    )
    .all() as Array<{
    id: string
    name: string
    location: string
    status: string
    plots: number
    sold: number
    revenue: number
  }>

  return {
    generatedAt: iso(now),
    collections: {
      todayCents: collectionsToday.total,
      monthToDateCents: collectionsMonth.total,
      transactionsToday: collectionsToday.n,
    },
    receivables: {
      totalOutstandingCents: outstandingTotal,
      contractedValueCents: contracted,
      collectedCents: collected,
    },
    inventory: { total: plots.length, byStatus, availableValueCents: availableValue },
    reconciliation: {
      exceptions: exceptions.length,
      exceptionValueCents: exceptionValue,
      autoMatchedRate,
    },
    cases: {
      open: caseCounts.open ?? 0,
      delayed: caseCounts.delayed ?? 0,
      awaitingClient: caseCounts.awaiting ?? 0,
      closedThisMonth: caseCounts.closed_month ?? 0,
    },
    arrears: ageArrears(arrearsRows, now),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location,
      status: p.status,
      plots: p.plots,
      sold: p.sold ?? 0,
      revenueCents: p.revenue ?? 0,
    })),
  }
}

/** Recent activity feed derived from the audit trail. */
export function activityFeed(db: Db, limit: number) {
  return (
    db
      .prepare(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.after_json, a.at, u.name AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.action NOT LIKE 'auth.%'
         ORDER BY a.at DESC, a.rowid DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as string,
    action: r.action as string,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    detail: r.after_json ? JSON.parse(r.after_json as string) : null,
    actor: (r.actor as string | null) ?? 'System',
    at: r.at as string,
  }))
}
