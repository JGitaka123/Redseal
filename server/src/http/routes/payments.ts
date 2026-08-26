import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, clientIp, parse, requirePermission } from '../context.js'
import type { AppContext } from '../context.js'
import {
  allocatePayment,
  getPayment,
  importStatement,
  listExceptions,
  listPayments,
  recordPayment,
  reversePayment,
} from '../../services/payments.js'

const channel = z.enum(['mpesa', 'bank', 'cash', 'cheque'])

const receiptShape = {
  receipt: z.string().min(3).max(64),
  channel,
  payerName: z.string().min(2),
  payerPhone: z.string().min(9).optional(),
  accountRef: z.string().max(64).optional(),
  amountCents: z.number().int().positive(),
  receivedAt: z.iso.datetime(),
}

const recordBody = z.object(receiptShape)

const importBody = z.object({
  entries: z.array(z.object(receiptShape)).min(1).max(500),
})

const allocateBody = z.object({
  plotId: z.string().min(1),
  amountCents: z.number().int().positive(),
})

const reverseBody = z.object({ reason: z.string().min(3).max(500) })

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['matched', 'partially_allocated', 'unmatched', 'reversal', 'reversed']).optional(),
})

export async function registerPaymentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/payments', { preHandler: requirePermission(ctx, 'payments:read') }, async (request) => {
    const query = parse(listQuery, request.query)
    return { payments: listPayments(ctx.db, query) }
  })

  app.get('/payments/exceptions', { preHandler: requirePermission(ctx, 'payments:read') }, async () => ({
    exceptions: listExceptions(ctx.db),
  }))

  app.get<{ Params: { id: string } }>(
    '/payments/:id',
    { preHandler: requirePermission(ctx, 'payments:read') },
    async (request) => ({ payment: getPayment(ctx.db, request.params.id) }),
  )

  app.post('/payments', { preHandler: requirePermission(ctx, 'payments:record') }, async (request, reply) => {
    const body = parse(recordBody, request.body)
    const payment = recordPayment(ctx.db, ctx.clock, {
      ...body,
      actor: actorOf(request),
      ip: clientIp(request),
    })
    return reply.status(201).send({ payment })
  })

  app.post('/payments/import', { preHandler: requirePermission(ctx, 'payments:record') }, async (request, reply) => {
    const body = parse(importBody, request.body)
    const result = importStatement(ctx.db, ctx.clock, body.entries, actorOf(request), clientIp(request))
    return reply.status(201).send({
      imported: result.imported,
      importedCount: result.imported.length,
      skippedReceipts: result.skipped,
    })
  })

  app.post<{ Params: { id: string } }>(
    '/payments/:id/allocations',
    { preHandler: requirePermission(ctx, 'payments:allocate') },
    async (request, reply) => {
      const body = parse(allocateBody, request.body)
      const payment = allocatePayment(ctx.db, ctx.clock, {
        paymentId: request.params.id,
        plotId: body.plotId,
        amountCents: body.amountCents,
        actor: actorOf(request),
        ip: clientIp(request),
      })
      return reply.status(201).send({ payment })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/payments/:id/reversal',
    { preHandler: requirePermission(ctx, 'payments:reverse') },
    async (request, reply) => {
      const body = parse(reverseBody, request.body)
      const payment = reversePayment(ctx.db, ctx.clock, {
        paymentId: request.params.id,
        reason: body.reason,
        actor: actorOf(request),
        ip: clientIp(request),
      })
      return reply.status(201).send({ payment })
    },
  )
}
