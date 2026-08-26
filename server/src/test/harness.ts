import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../config.js'
import type { Config } from '../config.js'
import { openDb } from '../db/index.js'
import type { Db } from '../db/index.js'
import { mutableClock } from '../domain/time.js'
import { buildApp } from '../http/app.js'
import { seedDemoData } from '../seed/demo-data.js'
import type { SeedAccounts } from '../seed/demo-data.js'

export const TEST_PASSWORD = 'correct-horse-battery'
export const TEST_NOW = '2026-08-20T09:00:00.000Z'

export interface Harness {
  app: FastifyInstance
  db: Db
  config: Config
  clock: ReturnType<typeof mutableClock>
  accounts: SeedAccounts
  projectId: string
  close(): Promise<void>
}

/**
 * Builds a fully seeded API instance backed by an in-memory database and a
 * clock the test controls, so expiry and ageing behaviour is deterministic.
 */
export async function createHarness(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: ':memory:',
    ...overrides,
  } as NodeJS.ProcessEnv)

  const db = openDb(config.DATABASE_URL)
  const clock = mutableClock(TEST_NOW)
  const seed = seedDemoData(db, config, clock, TEST_PASSWORD)
  const app = await buildApp({ db, config, clock })
  await app.ready()

  return {
    app,
    db,
    config,
    clock,
    accounts: seed.accounts,
    projectId: seed.projectId,
    async close() {
      await app.close()
      db.close()
    },
  }
}

export type TestRole = 'director' | 'sales' | 'finance' | 'registry'

const EMAILS: Record<TestRole, string> = {
  director: 'director@redseal.example',
  sales: 'sales@redseal.example',
  finance: 'finance@redseal.example',
  registry: 'registry@redseal.example',
}

/** Logs in through the real login route and returns an Authorization header. */
export async function signIn(h: Harness, role: TestRole): Promise<string> {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: EMAILS[role], password: TEST_PASSWORD },
  })
  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed for ${role}: ${response.statusCode} ${response.body}`)
  }
  return `Bearer ${response.json().token}`
}

export interface TestPlot {
  id: string
  number: number
  status: string
  paidCents: number
  outstandingCents: number
  totalDueCents: number
  reservedUntil: string | null
  client: { id: string; name: string; phone: string } | null
}

export async function plotByNumber(h: Harness, auth: string, number: number): Promise<TestPlot> {
  const response = await h.app.inject({
    method: 'GET',
    url: '/api/plots',
    headers: { authorization: auth },
  })
  const plot = response.json().plots.find((p: TestPlot) => p.number === number)
  if (!plot) throw new Error(`Plot ${number} not found`)
  return plot
}
