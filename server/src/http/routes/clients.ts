import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, clientIp, parse, requirePermission } from '../context.js'
import type { AppContext } from '../context.js'
import { createClient, getClient, listClients, updateClient } from '../../services/clients.js'

const listQuery = z.object({ search: z.string().min(1).max(120).optional() })

const createBody = z.object({
  name: z.string().min(2),
  phone: z.string().min(9),
  email: z.string().email().optional(),
  nationalId: z.string().min(4).optional(),
})

const updateBody = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  nationalId: z.string().min(4).optional(),
  kraPin: z.string().min(4).optional(),
})

export async function registerClientRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/clients', { preHandler: requirePermission(ctx, 'clients:read') }, async (request) => {
    const query = parse(listQuery, request.query)
    return { clients: listClients(ctx.db, { search: query.search }) }
  })

  app.get<{ Params: { id: string } }>(
    '/clients/:id',
    { preHandler: requirePermission(ctx, 'clients:read') },
    async (request) => ({ client: getClient(ctx.db, request.params.id) }),
  )

  app.post('/clients', { preHandler: requirePermission(ctx, 'clients:write') }, async (request, reply) => {
    const body = parse(createBody, request.body)
    const client = createClient(ctx.db, ctx.clock, {
      ...body,
      actor: actorOf(request),
      ip: clientIp(request),
    })
    return reply.status(201).send({ client })
  })

  app.patch<{ Params: { id: string } }>(
    '/clients/:id',
    { preHandler: requirePermission(ctx, 'clients:write') },
    async (request) => {
      const body = parse(updateBody, request.body)
      return {
        client: updateClient(ctx.db, ctx.clock, {
          clientId: request.params.id,
          ...body,
          actor: actorOf(request),
          ip: clientIp(request),
        }),
      }
    },
  )
}
