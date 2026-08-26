import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import { badRequest, conflict, notFound } from '../domain/errors.js'
import { CASE_PREFIX, caseReference, newId } from '../domain/ids.js'
import { iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import { recordAudit } from './audit.js'
import type { AuthUser } from './auth.js'
import { recomputePlotStatus } from './plots.js'

export type CaseService = 'title_transfer' | 'beaconing' | 'succession' | 'subdivision' | 'valuation'
export type CaseStatus = 'on_track' | 'awaiting_client' | 'delayed' | 'closed'

/**
 * The ordered stage pipeline for each service line. Progress is derived from a
 * stage's position here, so the percentage a client is quoted can never
 * disagree with the stage they are actually at.
 */
export const CASE_STAGES: Record<CaseService, readonly string[]> = {
  title_transfer: [
    'Instructions received',
    'Consent to transfer',
    'Valuation for stamp duty',
    'Stamp duty paid',
    'Lodged for registration',
    'Title issued',
  ],
  beaconing: ['Instructions received', 'Field work scheduled', 'Field work complete', 'Beacon certificate issued'],
  succession: ['Documents collection', 'Gazette notice', 'Court hearing', 'Grant issued', 'Confirmation of grant'],
  subdivision: ['Instructions received', 'Mutation drawn', 'Land board approval', 'New numbers issued'],
  valuation: ['Instructions received', 'Inspection booked', 'Report drafted', 'Report issued'],
}

export function progressForStage(service: CaseService, stage: string): number {
  const stages = CASE_STAGES[service]
  const index = stages.indexOf(stage)
  if (index === -1) throw badRequest(`'${stage}' is not a valid stage for ${service}`)
  return Math.round(((index + 1) / stages.length) * 100)
}

export interface CaseView {
  id: string
  reference: string
  client: { id: string; name: string; phone: string }
  plotId: string | null
  service: CaseService
  stage: string
  status: CaseStatus
  officer: string
  progress: number
  nextAction: string
  openedAt: string
  updatedAt: string
  closedAt: string | null
}

interface CaseRow {
  id: string
  reference: string
  client_id: string
  client_name: string
  client_phone: string
  plot_id: string | null
  service: CaseService
  stage: string
  status: CaseStatus
  officer: string
  progress: number
  next_action: string
  opened_at: string
  updated_at: string
  closed_at: string | null
}

const CASE_SELECT = `
  SELECT k.id, k.reference, k.client_id, c.name AS client_name, c.phone AS client_phone,
         k.plot_id, k.service, k.stage, k.status, k.officer, k.progress, k.next_action,
         k.opened_at, k.updated_at, k.closed_at
  FROM cases k JOIN clients c ON c.id = k.client_id
`

const toView = (row: CaseRow): CaseView => ({
  id: row.id,
  reference: row.reference,
  client: { id: row.client_id, name: row.client_name, phone: row.client_phone },
  plotId: row.plot_id,
  service: row.service,
  stage: row.stage,
  status: row.status,
  officer: row.officer,
  progress: row.progress,
  nextAction: row.next_action,
  openedAt: row.opened_at,
  updatedAt: row.updated_at,
  closedAt: row.closed_at,
})

function nextSequence(db: Db, prefix: string, year: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM cases WHERE reference LIKE ?`)
    .get(`${prefix}/${year}/%`) as { n: number }
  return row.n + 1
}

export function openCase(
  db: Db,
  clock: Clock,
  input: {
    clientId: string
    plotId?: string | null
    service: CaseService
    officer: string
    nextAction: string
    actor: AuthUser
    ip?: string | null
  },
): CaseView {
  const now = clock.now()

  return transaction(db, () => {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(input.clientId)
    if (!client) throw notFound(`Client ${input.clientId} not found`)

    const stages = CASE_STAGES[input.service]
    const stage = stages[0]
    if (!stage) throw badRequest(`No stages configured for ${input.service}`)

    const year = now.getUTCFullYear()
    const reference = caseReference(CASE_PREFIX[input.service], year, nextSequence(db, CASE_PREFIX[input.service], year))
    const id = newId()

    db.prepare(
      `INSERT INTO cases (id, reference, client_id, plot_id, service, stage, status, officer, progress,
                          next_action, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'on_track', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      reference,
      input.clientId,
      input.plotId ?? null,
      input.service,
      stage,
      input.officer,
      progressForStage(input.service, stage),
      input.nextAction,
      iso(now),
      iso(now),
    )

    db.prepare(
      `INSERT INTO case_events (id, case_id, from_stage, to_stage, note, at, actor_id)
       VALUES (?, ?, NULL, ?, 'Case opened', ?, ?)`,
    ).run(newId(), id, stage, iso(now), input.actor.id)

    // A title transfer takes the plot out of the sales pipeline while it runs.
    if (input.service === 'title_transfer' && input.plotId) {
      db.prepare('UPDATE plots SET title_processing = 1, updated_at = ? WHERE id = ?').run(iso(now), input.plotId)
      recomputePlotStatus(db, input.plotId, now)
    }

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'case.opened',
      entityType: 'case',
      entityId: id,
      after: { reference, service: input.service, clientId: input.clientId, plotId: input.plotId ?? null },
      ip: input.ip,
    })

    return toView(db.prepare(`${CASE_SELECT} WHERE k.id = ?`).get(id) as CaseRow)
  })
}

export function advanceCase(
  db: Db,
  clock: Clock,
  input: {
    caseId: string
    stage: string
    status?: CaseStatus
    nextAction?: string
    note?: string
    actor: AuthUser
    ip?: string | null
  },
): CaseView {
  const now = clock.now()

  return transaction(db, () => {
    const current = db.prepare(`${CASE_SELECT} WHERE k.id = ?`).get(input.caseId) as CaseRow | undefined
    if (!current) throw notFound(`Case ${input.caseId} not found`)
    if (current.status === 'closed') throw conflict('This case is already closed')

    const stages = CASE_STAGES[current.service]
    const nextIndex = stages.indexOf(input.stage)
    if (nextIndex === -1) throw badRequest(`'${input.stage}' is not a valid stage for ${current.service}`)

    const currentIndex = stages.indexOf(current.stage)
    if (nextIndex < currentIndex) {
      throw conflict(`A case cannot move backwards from '${current.stage}' to '${input.stage}'`)
    }

    const progress = progressForStage(current.service, input.stage)
    const isFinal = nextIndex === stages.length - 1
    const status: CaseStatus = isFinal ? 'closed' : (input.status ?? current.status)

    db.prepare(
      `UPDATE cases SET stage = ?, progress = ?, status = ?, next_action = ?, updated_at = ?,
                        closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END
       WHERE id = ?`,
    ).run(
      input.stage,
      progress,
      status,
      input.nextAction ?? current.next_action,
      iso(now),
      status,
      iso(now),
      input.caseId,
    )

    db.prepare(
      `INSERT INTO case_events (id, case_id, from_stage, to_stage, note, at, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), input.caseId, current.stage, input.stage, input.note ?? null, iso(now), input.actor.id)

    // Once the title is issued the plot leaves title processing for good.
    if (current.service === 'title_transfer' && current.plot_id && status === 'closed') {
      db.prepare('UPDATE plots SET title_processing = 0, updated_at = ? WHERE id = ?').run(iso(now), current.plot_id)
      recomputePlotStatus(db, current.plot_id, now)
    }

    recordAudit(db, now, {
      actorId: input.actor.id,
      action: 'case.advanced',
      entityType: 'case',
      entityId: input.caseId,
      before: { stage: current.stage, status: current.status },
      after: { stage: input.stage, status, progress },
      ip: input.ip,
    })

    return toView(db.prepare(`${CASE_SELECT} WHERE k.id = ?`).get(input.caseId) as CaseRow)
  })
}

export function listCases(
  db: Db,
  filter: { status?: CaseStatus; service?: CaseService; search?: string } = {},
): CaseView[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.status) {
    where.push('k.status = ?')
    params.push(filter.status)
  }
  if (filter.service) {
    where.push('k.service = ?')
    params.push(filter.service)
  }
  if (filter.search) {
    where.push('(k.reference LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)')
    const like = `%${filter.search}%`
    params.push(like, like, like)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db.prepare(`${CASE_SELECT} ${clause} ORDER BY k.updated_at DESC`).all(...params) as CaseRow[]
  return rows.map(toView)
}

export function getCase(db: Db, caseId: string): CaseView {
  const row = db.prepare(`${CASE_SELECT} WHERE k.id = ?`).get(caseId) as CaseRow | undefined
  if (!row) throw notFound(`Case ${caseId} not found`)
  return toView(row)
}

export function caseTimeline(db: Db, caseId: string) {
  return db
    .prepare(
      `SELECT e.id, e.from_stage, e.to_stage, e.note, e.at, u.name AS actor
       FROM case_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.case_id = ? ORDER BY e.at`,
    )
    .all(caseId)
}
