import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, clientIp, parse, requirePermission } from '../context.js'
import type { AppContext } from '../context.js'
import { advanceCase, CASE_STAGES, caseTimeline, getCase, listCases, openCase } from '../../services/cases.js'

const service = z.enum(['title_transfer', 'beaconing', 'succession', 'subdivision', 'valuation'])
const status = z.enum(['on_track', 'awaiting_client', 'delayed', 'closed'])

const listQuery = z.object({
  status: status.optional(),
  service: service.optional(),
  search: z.string().min(1).max(120).optional(),
})

const openBody = z.object({
  clientId: z.string().min(1),
  plotId: z.string().min(1).optional(),
  service,
  officer: z.string().min(2),
  nextAction: z.string().min(2).max(300),
})

const advanceBody = z.object({
  stage: z.string().min(2),
  status: status.optional(),
  nextAction: z.string().min(2).max(300).optional(),
  note: z.string().max(500).optional(),
})

export async function registerCaseRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // The stage catalogue lets the client render pipelines without hardcoding them.
  app.get('/cases/stages', { preHandler: requirePermission(ctx, 'cases:read') }, async () => ({
    stages: CASE_STAGES,
  }))

  app.get('/cases', { preHandler: requirePermission(ctx, 'cases:read') }, async (request) => {
    const query = parse(listQuery, request.query)
    return { cases: listCases(ctx.db, query) }
  })

  app.get<{ Params: { id: string } }>(
    '/cases/:id',
    { preHandler: requirePermission(ctx, 'cases:read') },
    async (request) => ({
      case: getCase(ctx.db, request.params.id),
      timeline: caseTimeline(ctx.db, request.params.id),
    }),
  )

  app.post('/cases', { preHandler: requirePermission(ctx, 'cases:write') }, async (request, reply) => {
    const body = parse(openBody, request.body)
    const record = openCase(ctx.db, ctx.clock, {
      ...body,
      actor: actorOf(request),
      ip: clientIp(request),
    })
    return reply.status(201).send({ case: record })
  })

  app.patch<{ Params: { id: string } }>(
    '/cases/:id',
    { preHandler: requirePermission(ctx, 'cases:write') },
    async (request) => {
      const body = parse(advanceBody, request.body)
      return {
        case: advanceCase(ctx.db, ctx.clock, {
          caseId: request.params.id,
          ...body,
          actor: actorOf(request),
          ip: clientIp(request),
        }),
      }
    },
  )
}
