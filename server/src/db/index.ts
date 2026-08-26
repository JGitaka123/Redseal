import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './migrations.js'

export type Db = Database.Database

/**
 * Opens a database connection with the pragmas this service depends on:
 * foreign keys for referential integrity, WAL for concurrent readers, and a
 * busy timeout so competing writers wait for the write lock instead of
 * failing immediately.
 */
export function openDb(url: string): Db {
  if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true })
  const db = new Database(url)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db)
  return db
}

/**
 * Runs `fn` inside an IMMEDIATE transaction. IMMEDIATE takes the write lock up
 * front, which is what makes competing plot reservations serialise correctly
 * rather than one of them failing late at COMMIT.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const wrapped = db.transaction(fn)
  return wrapped.immediate()
}
