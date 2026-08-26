import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import type { Db } from '../db/index.js'
import type { Config } from '../config.js'
import type { Clock } from '../domain/time.js'
import { AppError, badRequest, unauthenticated } from '../domain/errors.js'
import type { AuthUser } from '../services/auth.js'
import { authenticate } from '../services/auth.js'
import { assertCan } from '../services/rbac.js'
import type { Permission } from '../services/rbac.js'

export interface AppContext {
  db: Db
  config: Config
  clock: Clock
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `requireAuth`; absent on public routes. */
    authUser?: AuthUser
  }
}

/** Validates input with zod, converting failures into a 400 with field detail. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw badRequest(
      'Request validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return result.data
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) throw unauthenticated('Provide a Bearer token')
  const token = header.slice('Bearer '.length).trim()
  if (!token) throw unauthenticated('Provide a Bearer token')
  return token
}

export function requireAuth(ctx: AppContext) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    request.authUser = authenticate(ctx.db, ctx.clock, bearerToken(request))
  }
}

/** Authenticates, then enforces the capability the route declares it needs. */
export function requirePermission(ctx: AppContext, permission: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = authenticate(ctx.db, ctx.clock, bearerToken(request))
    request.authUser = user
    assertCan(user.role, permission)
  }
}

export function actorOf(request: FastifyRequest): AuthUser {
  const user = request.authUser
  if (!user) throw new AppError('internal_error', 'Route is missing an authentication guard')
  return user
}

export const clientIp = (request: FastifyRequest): string => request.ip
