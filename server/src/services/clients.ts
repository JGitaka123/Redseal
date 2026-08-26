import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import { conflict, notFound } from '../domain/errors.js'
import { normalisePhone } from '../domain/matching.js'
import { outstandingCents, totalDueCents } from '../domain/plots.js'
import { iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import { recordAudit } from './audit.js'
import type { AuthUser } from './auth.js'
import { upsertClientByPhone } from './plots.js'

export interface ClientView {
  id: string
  name: string
  phone: string
  email: string | null
  nationalId: string | null
  plots: Array<{ id: string; number: number; projectName: string; status: string }>
  totalPaidCents: number
  totalOutstandingCents: number
  openCases: number
  createdAt: string
}

interface ClientRow {
  id: string
  name: string
  phone: string
  email: string | null
  national_id: string | null
  created_at: string
}

function decorate(db: Db, row: ClientRow): ClientView {
  const plots = db
    .prepare(
      `SELECT p.id, p.number, p.status, p.terms, p.cash_price_cents, p.instalment_price_cents,
              pr.name AS project_name,
              (SELECT COALESCE(SUM(a.amount_cents), 0) FROM payment_allocations a WHERE a.plot_id = p.id) AS paid
       FROM plots p JOIN projects pr ON pr.id = p.project_id
       WHERE p.client_id = ? ORDER BY pr.name, p.number`,
    )
    .all(row.id) as Array<{
    id: string
    number: number
    status: string
    terms: 'cash' | 'instalment' | null
    cash_price_cents: number
    instalment_price_cents: number
    project_name: string
    paid: number
  }>

  let paidTotal = 0
  let outstandingTotal = 0
  for (const plot of plots) {
    const due = totalDueCents(
      { cashPriceCents: plot.cash_price_cents, instalmentPriceCents: plot.instalment_price_cents },
      plot.terms,
    )
    paidTotal += plot.paid
    outstandingTotal += outstandingCents(due, plot.paid)
  }

  const openCases = (
    db.prepare(`SELECT COUNT(*) AS n FROM cases WHERE client_id = ? AND status <> 'closed'`).get(row.id) as {
      n: number
    }
  ).n

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    nationalId: row.national_id,
    plots: plots.map((p) => ({ id: p.id, number: p.number, projectName: p.project_name, status: p.status })),
    totalPaidCents: paidTotal,
    totalOutstandingCents: outstandingTotal,
    openCases,
    createdAt: row.created_at,
  }
}

export function listClients(db: Db, filter: { search?: string } = {}): ClientView[] {
  const params: unknown[] = []
  let clause = ''
  if (filter.search) {
    clause = `WHERE name LIKE ? OR phone LIKE ? OR COALESCE(national_id, '') LIKE ?`
    const like = `%${filter.search}%`
    params.push(like, like, like)
  }
  const rows = db
    .prepare(`SELECT id, name, phone, email, national_id, created_at FROM clients ${clause} ORDER BY name`)
    .all(...params) as ClientRow[]
  return rows.map((r) => decorate(db, r))
}

export function getClient(db: Db, clientId: string): ClientView {
  const row = db
    .prepare('SELECT id, name, phone, email, national_id, created_at FROM clients WHERE id = ?')
    .get(clientId) as ClientRow | undefined
  if (!row) throw notFound(`Client ${clientId} not found`)
  return decorate(db, row)
}

export function createClient(
  db: Db,
  clock: Clock,
  input: {
    name: string
    phone: string
    email?: string | null
    nationalId?: string | null
    actor: AuthUser
    ip?: string | null
  },
): ClientView {
  const now = clock.now()

  return transaction(db, () => {
    const phone = normalisePhone(input.phone)
    const existing = db.prepare('SELECT id FROM clients WHERE phone = ?').get(phone)
    if (existing) throw conflict(`A client with phone ${phone} already exists`)

    const { id } = upsertClientByPhone(db, now, {
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      nationalId: input.nationalId ?? null,
    })

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'client.created',
      entityType: 'client',
      entityId: id,
      after: { name: input.name, phone },
      ip: input.ip,
    })

    return getClient(db, id)
  })
}

export function updateClient(
  db: Db,
  clock: Clock,
  input: {
    clientId: string
    name?: string
    email?: string | null
    nationalId?: string | null
    kraPin?: string | null
    actor: AuthUser
    ip?: string | null
  },
): ClientView {
  const now = clock.now()

  return transaction(db, () => {
    const before = getClient(db, input.clientId)
    db.prepare(
      `UPDATE clients SET name = COALESCE(?, name), email = COALESCE(?, email),
                          national_id = COALESCE(?, national_id), kra_pin = COALESCE(?, kra_pin),
                          updated_at = ?
       WHERE id = ?`,
    ).run(
      input.name ?? null,
      input.email ?? null,
      input.nationalId ?? null,
      input.kraPin ?? null,
      iso(now),
      input.clientId,
    )

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'client.updated',
      entityType: 'client',
      entityId: input.clientId,
      before: { name: before.name, email: before.email, nationalId: before.nationalId },
      after: { name: input.name ?? before.name, email: input.email ?? before.email },
      ip: input.ip,
    })

    return getClient(db, input.clientId)
  })
}
