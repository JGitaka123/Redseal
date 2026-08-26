import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, plotByNumber, signIn } from './harness.js'
import type { Harness } from './harness.js'
import { shillingsToCents } from '../domain/money.js'
import { runMigrations, migrationIds } from '../db/migrations.js'

let h: Harness
let sales: string

beforeEach(async () => {
  h = await createHarness()
  sales = await signIn(h, 'sales')
})
afterEach(async () => {
  await h.close()
})

/**
 * The seeded database must reproduce exactly the demonstration state the
 * front-end prototype shows, so the API can be pointed at the existing UI
 * without the story changing.
 */
describe('seeded demonstration data', () => {
  const expected: Array<[number, string, number]> = [
    [2, 'fully_paid', 375_000],
    [7, 'on_instalment', 275_000],
    [16, 'reserved', 0],
    [17, 'fully_paid', 375_000],
    [18, 'fully_paid', 375_000],
    [19, 'fully_paid', 375_000],
    [20, 'fully_paid', 375_000],
    [29, 'fully_paid', 375_000],
    [31, 'deposit_paid', 120_000],
    [32, 'fully_paid', 375_000],
    [33, 'title_processing', 375_000],
  ]

  it.each(expected)('plot %i is %s with KSh %i paid', async (number, status, paidShillings) => {
    const plot = await plotByNumber(h, sales, number)
    expect(plot.status).toBe(status)
    expect(plot.paidCents).toBe(shillingsToCents(paidShillings))
  })

  it('leaves the remaining plots available', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/plots', headers: { authorization: sales } })
    const available = response.json().plots.filter((p: { status: string }) => p.status === 'available')
    expect(available).toHaveLength(34 - expected.length)
  })

  it('derives every status rather than writing it directly', async () => {
    // Plot 7 reached on_instalment through three separate receipts.
    const payments = h.db
      .prepare(
        `SELECT COUNT(*) AS n FROM payment_allocations a
         JOIN plots p ON p.id = a.plot_id WHERE p.number = 7`,
      )
      .get() as { n: number }
    expect(payments.n).toBe(3)
  })

  it('registers each buyer exactly once', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/clients', headers: { authorization: sales } })
    const phones = response.json().clients.map((c: { phone: string }) => c.phone)
    expect(new Set(phones).size).toBe(phones.length)
  })

  it('creates the four operational roles', () => {
    const roles = (h.db.prepare('SELECT role FROM users ORDER BY role').all() as Array<{ role: string }>).map(
      (r) => r.role,
    )
    expect(roles).toEqual(['director', 'finance', 'registry', 'sales'])
  })
})

describe('migrations', () => {
  it('are idempotent — re-running applies nothing', () => {
    expect(runMigrations(h.db)).toEqual([])
  })

  it('records every known migration as applied', () => {
    const applied = (h.db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map(
      (r) => r.id,
    )
    expect(applied).toEqual(migrationIds())
  })

  it('enforces referential integrity', () => {
    expect(() =>
      h.db
        .prepare(
          `INSERT INTO reservations (id, plot_id, client_id, terms, status, created_at, expires_at, created_by)
           VALUES ('x', 'no-such-plot', 'no-such-client', 'cash', 'active', '2026-01-01', '2026-01-08', 'nobody')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('rejects an unknown plot status', () => {
    expect(() => h.db.prepare(`UPDATE plots SET status = 'imaginary'`).run()).toThrow(/CHECK constraint/i)
  })

  it('rejects a non-positive price', () => {
    expect(() => h.db.prepare(`UPDATE plots SET cash_price_cents = 0`).run()).toThrow(/CHECK constraint/i)
  })
})
