import type { Db } from '../db/index.js'
import { newId } from '../domain/ids.js'
import { iso } from '../domain/time.js'

export interface AuditEntry {
  actorId: string | null
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  ip?: string | null
}

/**
 * Appends an audit record. Callers pass the surrounding transaction's db handle
 * so the audit row commits atomically with the change it describes — a change
 * can never be persisted without its audit trail.
 */
export function recordAudit(db: Db, at: Date, entry: AuditEntry): string {
  const id = newId()
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before_json, after_json, ip, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.actorId,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    entry.ip ?? null,
    iso(at),
  )
  return id
}

export interface AuditRow {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string
  before: unknown
  after: unknown
  ip: string | null
  at: string
}

export function listAudit(
  db: Db,
  filter: { entityType?: string; entityId?: string; limit: number; offset: number },
): AuditRow[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.entityType) {
    where.push('a.entity_type = ?')
    params.push(filter.entityType)
  }
  if (filter.entityId) {
    where.push('a.entity_id = ?')
    params.push(filter.entityId)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity_type, a.entity_id,
              a.before_json, a.after_json, a.ip, a.at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${clause}
       ORDER BY a.at DESC, a.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, filter.limit, filter.offset) as Array<Record<string, unknown>>

  return rows.map((r) => ({
    id: r.id as string,
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    action: r.action as string,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    before: r.before_json ? JSON.parse(r.before_json as string) : null,
    after: r.after_json ? JSON.parse(r.after_json as string) : null,
    ip: (r.ip as string | null) ?? null,
    at: r.at as string,
  }))
}
