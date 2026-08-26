import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, clientIp, parse, requirePermission } from '../context.js'
import type { AppContext } from '../context.js'
import { cancelReservation, getPlot, listPlots, reservePlot } from '../../services/plots.js'
import { PLOT_STATUS_ORDER } from '../../domain/plots.js'

const listQuery = z.object({
  projectId: z.string().optional(),
  status: z.enum(PLOT_STATUS_ORDER as [string, ...string[]]).optional(),
})

const reserveBody = z.object({
  buyerName: z.string().min(2, 'Buyer name is required'),
  buyerPhone: z.string().min(9, 'A valid mobile number is required'),
  terms: z.enum(['cash', 'instalment']).default('cash'),
})

const cancelBody = z.object({ reason: z.string().max(500).optional() })

export async function registerPlotRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/plots', { preHandler: requirePermission(ctx, 'plots:read') }, async (request) => {
    const query = parse(listQuery, request.query)
    return {
      plots: listPlots(ctx.db, ctx.clock, {
        projectId: query.projectId,
        status: query.status as never,
      }),
    }
  })

  app.get<{ Params: { id: string } }>(
    '/plots/:id',
    { preHandler: requirePermission(ctx, 'plots:read') },
    async (request) => ({ plot: getPlot(ctx.db, ctx.clock, request.params.id) }),
  )

  app.post<{ Params: { id: string } }>(
    '/plots/:id/reservations',
    { preHandler: requirePermission(ctx, 'plots:reserve') },
    async (request, reply) => {
      const body = parse(reserveBody, request.body)
      const result = reservePlot(ctx.db, ctx.config, ctx.clock, {
        plotId: request.params.id,
        buyerName: body.buyerName,
        buyerPhone: body.buyerPhone,
        terms: body.terms,
        actor: actorOf(request),
        ip: clientIp(request),
      })
      return reply.status(201).send(result)
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/plots/:id/reservations',
    { preHandler: requirePermission(ctx, 'plots:cancel_reservation') },
    async (request) => {
      const body = parse(cancelBody, request.body ?? {})
      return {
        plot: cancelReservation(ctx.db, ctx.clock, {
          plotId: request.params.id,
          actor: actorOf(request),
          reason: body.reason,
          ip: clientIp(request),
        }),
      }
    },
  )
}
