import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { systemClock } from './domain/time.js'
import { buildApp } from './http/app.js'
import { expireReservations } from './services/plots.js'
import { transaction } from './db/index.js'

/** Sweeps expired reservations hourly so inventory frees up without traffic. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function main(): Promise<void> {
  const config = loadConfig()
  const db = openDb(config.DATABASE_URL)
  const app = await buildApp({ db, config, clock: systemClock })

  const sweeper = setInterval(() => {
    try {
      const released = transaction(db, () => expireReservations(db, systemClock.now()))
      if (released.length > 0) app.log.info({ released: released.length }, 'expired reservations released')
    } catch (error) {
      app.log.error({ err: error }, 'reservation sweep failed')
    }
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    clearInterval(sweeper)
    await app.close()
    db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: config.HOST, port: config.PORT })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
