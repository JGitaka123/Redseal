import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, clientIp, parse, requireAuth } from '../context.js'
import type { AppContext } from '../context.js'
import { login, logout } from '../../services/auth.js'
import { ROLE_PERMISSIONS } from '../../services/rbac.js'
import { recordAudit } from '../../services/audit.js'
import { transaction } from '../../db/index.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const body = parse(loginSchema, request.body)
    // Deliberately not wrapped in a transaction: a rollback on failure would
    // discard the failed-attempt record that drives lockout.
    const result = login(ctx.db, ctx.config, ctx.clock, { ...body, ip: clientIp(request) })
    transaction(ctx.db, () =>
      recordAudit(ctx.db, ctx.clock.now(), {
        actorId: result.user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: result.user.id,
        ip: clientIp(request),
      }),
    )
    return reply.status(200).send({
      token: result.token,
      expiresAt: result.expiresAt,
      user: { ...result.user, permissions: [...ROLE_PERMISSIONS[result.user.role]] },
    })
  })

  app.post('/auth/logout', { preHandler: requireAuth(ctx) }, async (request, reply) => {
    const header = request.headers.authorization ?? ''
    logout(ctx.db, ctx.clock, header.slice('Bearer '.length).trim())
    return reply.status(204).send()
  })

  app.get('/auth/me', { preHandler: requireAuth(ctx) }, async (request) => {
    const user = actorOf(request)
    return { user: { ...user, permissions: [...ROLE_PERMISSIONS[user.role]] } }
  })
}
