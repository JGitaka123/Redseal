import type { Db } from '../db/index.js'
import { transaction } from '../db/index.js'
import { newId } from '../domain/ids.js'
import { shillingsToCents } from '../domain/money.js'
import { addDays, iso } from '../domain/time.js'
import type { Clock } from '../domain/time.js'
import { createUser } from '../services/auth.js'
import type { AuthUser } from '../services/auth.js'
import { openCase } from '../services/cases.js'
import { recordPayment } from '../services/payments.js'
import { reservePlot } from '../services/plots.js'
import type { Config } from '../config.js'

/**
 * Demonstration data mirroring the front-end prototype. Every record is
 * fictional. The seed deliberately replays real operations — reserve, then pay
 * — rather than writing end states directly, so the seeded database is only
 * ever in a state the domain rules can actually produce.
 */

const PIONEER_PLOT_COUNT = 34
const REGULAR_CASH = shillingsToCents(375_000)
const REGULAR_INSTALMENT = shillingsToCents(450_000)
const LARGE_CASH = shillingsToCents(5_200_000)
const LARGE_INSTALMENT = shillingsToCents(5_850_000)

interface SeededSale {
  plotNumber: number
  buyer: string
  phone: string
  terms: 'cash' | 'instalment'
  /** Instalments paid so far, in shillings. */
  payments: number[]
  openTitleCase?: boolean
}

const SALES: SeededSale[] = [
  { plotNumber: 2, buyer: 'Faith Wanjiku', phone: '0712 680 941', terms: 'cash', payments: [375_000] },
  { plotNumber: 7, buyer: 'Samuel Muriuki', phone: '0721 441 208', terms: 'instalment', payments: [150_000, 100_000, 25_000] },
  { plotNumber: 16, buyer: 'Lilian Muthoni', phone: '0704 227 913', terms: 'instalment', payments: [] },
  { plotNumber: 17, buyer: 'Daniel Mwangi', phone: '0719 082 614', terms: 'cash', payments: [375_000] },
  { plotNumber: 18, buyer: 'Mercy Wambui', phone: '0708 561 302', terms: 'cash', payments: [375_000] },
  { plotNumber: 19, buyer: 'Peter Kariuki', phone: '0722 104 637', terms: 'cash', payments: [375_000] },
  { plotNumber: 20, buyer: 'Jane Wairimu', phone: '0711 935 480', terms: 'cash', payments: [375_000] },
  { plotNumber: 29, buyer: 'George Njiru', phone: '0701 842 529', terms: 'cash', payments: [375_000] },
  { plotNumber: 31, buyer: 'Alice Nyambura', phone: '0798 331 204', terms: 'instalment', payments: [120_000] },
  { plotNumber: 32, buyer: 'John Njeru', phone: '0716 490 117', terms: 'cash', payments: [375_000] },
  { plotNumber: 33, buyer: 'Dennis Ngari', phone: '0720 513 896', terms: 'cash', payments: [375_000], openTitleCase: true },
]

export interface SeedAccounts {
  director: AuthUser
  sales: AuthUser
  finance: AuthUser
  registry: AuthUser
}

export function seedUsers(db: Db, clock: Clock, password: string): SeedAccounts {
  return transaction(db, () => ({
    director: createUser(db, clock, {
      email: 'director@redseal.example',
      name: 'Mzee Kariuki',
      role: 'director',
      password,
    }),
    sales: createUser(db, clock, {
      email: 'sales@redseal.example',
      name: 'Agnes Mutiso',
      role: 'sales',
      password,
    }),
    finance: createUser(db, clock, {
      email: 'finance@redseal.example',
      name: 'Brian Otieno',
      role: 'finance',
      password,
    }),
    registry: createUser(db, clock, {
      email: 'registry@redseal.example',
      name: 'Grace Wanjiru',
      role: 'registry',
      password,
    }),
  }))
}

export interface SeededProjects {
  pioneerId: string
}

export function seedProjects(db: Db, clock: Clock): SeededProjects {
  const now = iso(clock.now())
  const pioneerId = newId()

  return transaction(db, () => {
    const insertProject = db.prepare(
      `INSERT INTO projects (id, name, location, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    insertProject.run(pioneerId, 'Pioneer Estate Phase 2', 'Embu · 14 km from town', 'Selling', now, now)
    insertProject.run(newId(), 'Fadhili Gardens', 'Embu County', 'Completed', now, now)
    insertProject.run(newId(), 'Pinnacle Estate Phase 2', 'Embu County', 'Closing', now, now)

    const insertPlot = db.prepare(
      `INSERT INTO plots (id, project_id, number, size, cash_price_cents, instalment_price_cents,
                          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?)`,
    )
    for (let number = 1; number <= PIONEER_PLOT_COUNT; number += 1) {
      const isLarge = number === PIONEER_PLOT_COUNT
      insertPlot.run(
        newId(),
        pioneerId,
        number,
        isLarge ? '2.1 acres' : '50 × 100 ft',
        isLarge ? LARGE_CASH : REGULAR_CASH,
        isLarge ? LARGE_INSTALMENT : REGULAR_INSTALMENT,
        now,
        now,
      )
    }
    return { pioneerId }
  })
}

/** Replays the demonstration sales through the real reservation and payment paths. */
export function seedSales(
  db: Db,
  config: Config,
  clock: Clock,
  projectId: string,
  accounts: SeedAccounts,
): void {
  const now = clock.now()

  for (const sale of SALES) {
    const plot = db
      .prepare('SELECT id FROM plots WHERE project_id = ? AND number = ?')
      .get(projectId, sale.plotNumber) as { id: string } | undefined
    if (!plot) continue

    reservePlot(db, config, clock, {
      plotId: plot.id,
      buyerName: sale.buyer,
      buyerPhone: sale.phone,
      terms: sale.terms,
      actor: accounts.sales,
    })

    sale.payments.forEach((amount, index) => {
      recordPayment(db, clock, {
        receipt: `SEED${String(sale.plotNumber).padStart(2, '0')}${index + 1}`,
        channel: 'mpesa',
        payerName: sale.buyer,
        payerPhone: sale.phone,
        accountRef: `PLOT${sale.plotNumber}`,
        amountCents: shillingsToCents(amount),
        // Space instalments out so arrears ageing has something to show.
        receivedAt: iso(addDays(now, -(sale.payments.length - index) * 21)),
        actor: accounts.finance,
      })
    })

    if (sale.openTitleCase) {
      const client = db
        .prepare('SELECT client_id FROM plots WHERE id = ?')
        .get(plot.id) as { client_id: string | null }
      if (client.client_id) {
        openCase(db, clock, {
          clientId: client.client_id,
          plotId: plot.id,
          service: 'title_transfer',
          officer: 'Grace W.',
          nextAction: 'Receive valuation report',
          actor: accounts.registry,
        })
      }
    }
  }

  // A second service line so the case desk is not title-transfer only.
  const succession = db
    .prepare('SELECT id FROM clients WHERE name = ?')
    .get('Alice Nyambura') as { id: string } | undefined
  if (succession) {
    openCase(db, clock, {
      clientId: succession.id,
      service: 'succession',
      officer: 'Lucy M.',
      nextAction: "Awaiting Chief's letter",
      actor: accounts.registry,
    })
  }
}

export interface SeedResult {
  projectId: string
  accounts: SeedAccounts
}

export function seedDemoData(db: Db, config: Config, clock: Clock, password: string): SeedResult {
  const accounts = seedUsers(db, clock, password)
  const { pioneerId } = seedProjects(db, clock)
  seedSales(db, config, clock, pioneerId, accounts)
  return { projectId: pioneerId, accounts }
}
