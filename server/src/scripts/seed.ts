import { loadConfig } from '../config.js'
import { openDb } from '../db/index.js'
import { systemClock } from '../domain/time.js'
import { seedDemoData } from '../seed/demo-data.js'

const config = loadConfig()

if (config.NODE_ENV === 'production' && !config.SEED_PASSWORD) {
  console.error('Refusing to seed production without an explicit SEED_PASSWORD.')
  process.exit(1)
}

const db = openDb(config.DATABASE_URL)
const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
if (existing.n > 0) {
  console.error('Database already contains users — refusing to re-seed.')
  db.close()
  process.exit(1)
}

const password = config.SEED_PASSWORD ?? 'redseal-demo-2026'
const result = seedDemoData(db, config, systemClock, password)

console.log('Seeded demonstration data.')
console.log(`  Project: ${result.projectId}`)
for (const [role, user] of Object.entries(result.accounts)) {
  console.log(`  ${role.padEnd(9)} ${user.email}`)
}
if (!config.SEED_PASSWORD) console.log(`  Password: ${password}`)
db.close()
