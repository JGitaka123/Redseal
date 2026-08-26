import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import type { Config } from '../config.js'
import { AppError, unauthenticated } from '../domain/errors.js'
import { addHours, iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import type { Role } from './rbac.js'

const SCRYPT_KEYLEN = 64
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK = 8
const SCRYPT_PARALLEL = 1

/**
 * Passwords are hashed with scrypt (memory-hard, in the Node standard library,
 * so no native dependency). The parameters are stored alongside the digest so
 * they can be raised later without invalidating existing hashes.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK,
    p: SCRYPT_PARALLEL,
  })
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK,
    SCRYPT_PARALLEL,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, costRaw, blockRaw, parallelRaw, saltB64, digestB64] = parts
  const salt = Buffer.from(saltB64 as string, 'base64')
  const expected = Buffer.from(digestB64 as string, 'base64')
  const derived = scryptSync(password, salt, expected.length, {
    N: Number(costRaw),
    r: Number(blockRaw),
    p: Number(parallelRaw),
  })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
}

interface UserRow {
  id: string
  email: string
  name: string
  role: Role
  password_hash: string
  active: number
}

function recentFailures(db: Db, email: string, ip: string, since: Date): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE email = ? AND ip = ? AND succeeded = 0 AND at >= ?`,
    )
    .get(email, ip, iso(since)) as { n: number }
  return row.n
}

function recordAttempt(db: Db, email: string, ip: string, succeeded: boolean, at: Date): void {
  db.prepare('INSERT INTO login_attempts (email, ip, succeeded, at) VALUES (?, ?, ?, ?)')
    .run(email, ip, succeeded ? 1 : 0, iso(at))
}

export interface LoginResult {
  token: string
  expiresAt: string
  user: AuthUser
}

/**
 * Authenticates a user and issues an opaque session token. Only the SHA-256
 * hash of the token is stored, so a database leak does not yield usable
 * sessions. Opaque tokens (rather than JWTs) are used deliberately: an
 * operations tool needs immediate, reliable revocation.
 */
export function login(
  db: Db,
  config: Config,
  clock: Clock,
  input: { email: string; password: string; ip: string },
): LoginResult {
  const now = clock.now()
  const email = input.email.trim().toLowerCase()
  const windowStart = new Date(now.getTime() - config.LOGIN_LOCKOUT_MINUTES * 60_000)

  if (recentFailures(db, email, input.ip, windowStart) >= config.LOGIN_MAX_ATTEMPTS) {
    throw new AppError(
      'rate_limited',
      `Too many failed sign-in attempts. Try again in ${config.LOGIN_LOCKOUT_MINUTES} minutes.`,
    )
  }

  const user = db
    .prepare('SELECT id, email, name, role, password_hash, active FROM users WHERE email = ?')
    .get(email) as UserRow | undefined

  // Verify against a dummy hash when the user is unknown so that response time
  // does not reveal whether an email address exists.
  const stored = user?.password_hash ?? DUMMY_HASH
  const passwordOk = verifyPassword(input.password, stored)

  if (!user || !passwordOk || user.active !== 1) {
    // Recorded outside any caller-supplied transaction: if this insert were
    // rolled back with the failed request, lockout would never trigger.
    recordAttempt(db, email, input.ip, false, now)
    throw unauthenticated('Invalid email or password')
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = addHours(now, config.SESSION_TTL_HOURS)
  transaction(db, () => {
    recordAttempt(db, email, input.ip, true, now)
    db.prepare(
      `INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), hashToken(token), user.id, iso(now), iso(expiresAt), iso(now))
  })

  return {
    token,
    expiresAt: iso(expiresAt),
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  }
}

/** Pre-computed so that unknown-user logins do the same work as real ones. */
const DUMMY_HASH = hashPassword(randomBytes(24).toString('hex'))

export function authenticate(db: Db, clock: Clock, token: string): AuthUser {
  const now = clock.now()
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
              u.id, u.email, u.name, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | (UserRow & { session_id: string; expires_at: string; revoked_at: string | null })
    | undefined

  if (!row) throw unauthenticated('Invalid session')
  if (row.revoked_at) throw unauthenticated('Session has been revoked')
  if (new Date(row.expires_at).getTime() <= now.getTime()) throw unauthenticated('Session has expired')
  if (row.active !== 1) throw unauthenticated('Account is disabled')

  db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(iso(now), row.session_id)
  return { id: row.id, email: row.email, name: row.name, role: row.role }
}

export function logout(db: Db, clock: Clock, token: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(iso(clock.now()), hashToken(token))
}

export function createUser(
  db: Db,
  clock: Clock,
  input: { email: string; name: string; role: Role; password: string },
): AuthUser {
  const now = iso(clock.now())
  const id = randomUUID()
  const email = input.email.trim().toLowerCase()
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, email, input.name, input.role, hashPassword(input.password), now, now)
  return { id, email, name: input.name, role: input.role }
}
