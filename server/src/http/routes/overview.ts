import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parse, requirePermission } from '../context.js'
import type { AppContext } from '../context.js'
import { activityFeed, overview } from '../../services/overview.js'
import { listAudit } from '../../services/audit.js'

const activityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const auditQuery = z.object({
  entityType: z.string().min(1).max(40).optional(),
  entityId: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function registerOverviewRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/overview', { preHandler: requirePermission(ctx, 'overview:read') }, async () => ({
    overview: overview(ctx.db, ctx.clock),
  }))

  app.get('/activity', { preHandler: requirePermission(ctx, 'overview:read') }, async (request) => {
    const query = parse(activityQuery, request.query)
    return { activity: activityFeed(ctx.db, query.limit) }
  })

  app.get('/projects', { preHandler: requirePermission(ctx, 'overview:read') }, async () => ({
    projects: overview(ctx.db, ctx.clock).projects,
  }))

  // The audit trail is director-only: it is the record used to settle disputes.
  app.get('/audit', { preHandler: requirePermission(ctx, 'audit:read') }, async (request) => {
    const query = parse(auditQuery, request.query)
    return { entries: listAudit(ctx.db, query) }
  })
}
