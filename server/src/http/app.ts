import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { AppError } from '../domain/errors.js'
import { corsOrigins } from '../config.js'
import type { AppContext } from './context.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCaseRoutes } from './routes/cases.js'
import { registerClientRoutes } from './routes/clients.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerOverviewRoutes } from './routes/overview.js'
import { registerPaymentRoutes } from './routes/payments.js'
import { registerPlotRoutes } from './routes/plots.js'

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      ctx.config.NODE_ENV === 'test'
        ? false
        : {
            level: ctx.config.LOG_LEVEL,
            // Receipts and tokens must never reach the log stream.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    // Trust the reverse proxy so rate limiting and audit records see the real IP.
    trustProxy: true,
    bodyLimit: 1_048_576,
  })

  await app.register(cors, {
    origin: corsOrigins(ctx.config),
    credentials: true,
    // Stated explicitly: the default advertises only the methods registered on
    // the previewed route, which would leave browsers blocking PATCH and DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  })

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details ?? null },
      })
    }
    const fastifyError = error as { statusCode?: number; message?: string }
    if (fastifyError.statusCode === 400) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: fastifyError.message ?? 'Invalid request' },
      })
    }
    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'An unexpected error occurred' },
    })
  })

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
    }),
  )

  await registerHealthRoutes(app, ctx)
  await app.register(
    async (api) => {
      await registerAuthRoutes(api, ctx)
      await registerPlotRoutes(api, ctx)
      await registerClientRoutes(api, ctx)
      await registerPaymentRoutes(api, ctx)
      await registerCaseRoutes(api, ctx)
      await registerOverviewRoutes(api, ctx)
    },
    { prefix: '/api' },
  )

  return app
}
