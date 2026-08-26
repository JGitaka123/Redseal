import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../context.js'

export async function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Liveness: the process is up. Never touches the database.
  app.get('/health', async () => ({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }))

  // Readiness: the process can actually serve traffic.
  app.get('/ready', async (_request, reply) => {
    try {
      ctx.db.prepare('SELECT 1').get()
      return { status: 'ready' }
    } catch {
      return reply.status(503).send({ error: { code: 'internal_error', message: 'Database unavailable' } })
    }
  })
}
