import { z } from 'zod'

/**
 * Environment configuration. Parsed and validated once at startup so that a
 * misconfigured deployment fails immediately rather than at first request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  /** SQLite database file, or ':memory:' for ephemeral instances. */
  DATABASE_URL: z.string().min(1).default('./data/redseal.db'),
  /** Comma-separated list of browser origins permitted to call the API. */
  CORS_ORIGINS: z.string().default('http://127.0.0.1:4173,http://localhost:4173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Lifetime of an issued session token, in hours. */
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** Reservation hold period, in days. Red Seal policy is seven days. */
  RESERVATION_HOLD_DAYS: z.coerce.number().int().positive().default(7),
  /** Failed logins allowed per email+IP inside the lockout window. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** Password for the seeded demo accounts. Required outside development. */
  SEED_PASSWORD: z.string().min(8).optional(),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}

export function corsOrigins(config: Config): string[] {
  return config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
}
