# Red Seal Operations API

The backend service behind the Red Seal Homes operations platform: authenticated,
role-aware APIs over an auditable store of projects, plots, clients, receipts and
service cases.

Everything here is driven by the same rules the front-end prototype demonstrates,
but enforced on the server where they cannot be bypassed.

## Running it

```bash
pnpm install
pnpm --filter @redseal/server migrate   # create/upgrade the database
pnpm --filter @redseal/server seed      # load demonstration data
pnpm --filter @redseal/server dev       # http://127.0.0.1:4000
```

From the repository root you can also use `pnpm dev:server`, `pnpm seed:server`,
`pnpm test:server`, `pnpm lint:server`, `pnpm build:server`.

### Configuration

All settings come from the environment and are validated at startup, so a
misconfigured deployment fails immediately instead of at the first request.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `HOST` / `PORT` | `127.0.0.1` / `4000` | Listen address |
| `DATABASE_URL` | `./data/redseal.db` | SQLite file, or `:memory:` |
| `CORS_ORIGINS` | `http://127.0.0.1:4173,…` | Comma-separated browser origins |
| `LOG_LEVEL` | `info` | Pino log level |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `RESERVATION_HOLD_DAYS` | `7` | Plot hold period (Red Seal policy) |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed logins before lockout |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lockout window |
| `SEED_PASSWORD` | — | Password for seeded accounts; required in production |

## Architecture

```
src/
  domain/     Pure business rules — no database, no HTTP, fully unit tested
  services/   Transactional use cases built on the domain rules
  http/       Fastify routes: validation, authorisation, serialisation
  db/         Connection, pragmas and append-only migrations
  seed/       Demonstration data, replayed through the real use cases
```

The dependency direction is strictly inward: `http → services → domain`. The
domain layer knows nothing about SQL or Fastify, which is why the rules that
matter most are the cheapest to test.

## The rules the server enforces

**A plot's status is always derived, never asserted.** `derivePlotStatus` computes
status from the underlying facts — active hold, allocated money, number of
receipts, open title case — and is recomputed inside the same transaction that
changes any of them. Status cannot drift from the ledger.

**One plot, one hold.** Reservations are created inside an `IMMEDIATE`
transaction, and a partial unique index (`WHERE status = 'active'`) is the final
authority. If two agents reserve the same plot at the same instant, exactly one
commits; the other is told the plot is gone.

**Holds expire on their own.** A hold older than `RESERVATION_HOLD_DAYS` is
released lazily before any read or write that depends on availability, and by an
hourly sweep. A plot that has received money is never released.

**The receipts ledger is append-only.** `payments`, `payment_allocations` and
`audit_log` all carry `BEFORE UPDATE`/`BEFORE DELETE` triggers that abort. A
correction is a new, mirrored negative entry that points at the original via
`reverses_payment_id` — both remain visible to an auditor forever.

**The system never guesses at money.** Auto-matching uses an explicit account
reference first, then the payer's phone, and only when it points at exactly one
plot that still owes money. It allocates at most what is owed; any surplus stays
unallocated and appears in the exception queue for a human.

**Every mutation is audited.** Audit rows are written with the same transaction
handle as the change they describe, so a change can never be persisted without
its trail.

## Authentication and roles

Sign in at `POST /api/auth/login` and send `Authorization: Bearer <token>`.

Sessions are opaque random tokens; only their SHA-256 hash is stored, so a
database leak yields no usable sessions. Opaque tokens are used deliberately
instead of JWTs: an operations tool needs revocation to be immediate and
reliable. Passwords are hashed with scrypt.

| Capability | director | sales | finance | registry |
| --- | :-: | :-: | :-: | :-: |
| Read plots, clients, cases, reports | ✓ | ✓ | ✓ | ✓ |
| Reserve / cancel a plot | ✓ | ✓ | | |
| Create and edit clients | ✓ | ✓ | | ✓ |
| Record, allocate, reverse receipts | ✓ | | ✓ | |
| Open and advance cases | ✓ | | | ✓ |
| Read the audit trail | ✓ | | | |

Routes declare the *capability* they need, not the role, so adding a role later
does not mean touching every route.

## API

All responses are JSON. Errors share one shape:

```json
{ "error": { "code": "plot_unavailable", "message": "…", "details": null } }
```

Codes: `validation_failed` (400), `unauthenticated` (401), `forbidden` (403),
`not_found` (404), `conflict` / `plot_unavailable` / `immutable_record` (409),
`over_allocation` (422), `rate_limited` (429), `internal_error` (500).

| Method | Path | Capability |
| --- | --- | --- |
| `GET` | `/health`, `/ready` | public |
| `POST` | `/api/auth/login` | public |
| `POST` | `/api/auth/logout` | authenticated |
| `GET` | `/api/auth/me` | authenticated |
| `GET` | `/api/plots?projectId=&status=` | `plots:read` |
| `GET` | `/api/plots/:id` | `plots:read` |
| `POST` | `/api/plots/:id/reservations` | `plots:reserve` |
| `DELETE` | `/api/plots/:id/reservations` | `plots:cancel_reservation` |
| `GET` | `/api/clients?search=` | `clients:read` |
| `GET` | `/api/clients/:id` | `clients:read` |
| `POST` | `/api/clients` | `clients:write` |
| `PATCH` | `/api/clients/:id` | `clients:write` |
| `GET` | `/api/payments?limit=&offset=&status=` | `payments:read` |
| `GET` | `/api/payments/exceptions` | `payments:read` |
| `GET` | `/api/payments/:id` | `payments:read` |
| `POST` | `/api/payments` | `payments:record` |
| `POST` | `/api/payments/import` | `payments:record` |
| `POST` | `/api/payments/:id/allocations` | `payments:allocate` |
| `POST` | `/api/payments/:id/reversal` | `payments:reverse` |
| `GET` | `/api/cases?status=&service=&search=` | `cases:read` |
| `GET` | `/api/cases/stages` | `cases:read` |
| `GET` | `/api/cases/:id` | `cases:read` |
| `POST` | `/api/cases` | `cases:write` |
| `PATCH` | `/api/cases/:id` | `cases:write` |
| `GET` | `/api/overview`, `/api/projects`, `/api/activity` | `overview:read` |
| `GET` | `/api/audit?entityType=&entityId=` | `audit:read` |

### Money

Every monetary value is an **integer number of cents** and every field is named
`…Cents`. There is no floating-point shilling anywhere in the system.

### Example

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"sales@redseal.example","password":"…"}' | jq -r .token)

curl -s localhost:4000/api/plots?status=available -H "Authorization: Bearer $TOKEN"

curl -s -X POST localhost:4000/api/plots/$PLOT_ID/reservations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"buyerName":"Mary Wanjiku","buyerPhone":"0712 345 678","terms":"instalment"}'
```

## Tests

```bash
pnpm --filter @redseal/server test
```

The suite covers the domain rules as unit tests and the whole API through real
HTTP requests against a seeded in-memory database with a clock the tests
control, so expiry and ageing behaviour is deterministic rather than timing
dependent. It includes the invariants that matter: reservation races, ledger
immutability at the database level, over-allocation, reversal, lockout, session
expiry and revocation, and the role matrix.

## Decisions worth knowing

**SQLite, not PostgreSQL — for now.** The schema is deliberately portable
(explicit types, `CHECK` constraints, foreign keys, a partial unique index) and
migrations are plain SQL. Moving to PostgreSQL/PostGIS means translating the
migration file and swapping the driver behind `db/index.ts`; the domain and
service layers do not change. PostGIS is the reason to make that move — real plot
geometry is the one thing SQLite cannot do well here.

**Reversing a receipt returns an unpaid plot to `available`.** Once the money is
recalled nobody has paid and the original hold has already been consumed, so the
plot is genuinely back on the market. This is visible rather than silent: the
release is recorded in the audit trail. If Red Seal would rather a reversed sale
park the plot for manual review, that is a small change to
`recomputePlotStatus` — flag it and it can be adjusted.

## Not yet built

Deliberately out of scope for this change, and still required before real client
data is loaded: live M-Pesa/bank adapters (the import endpoint is the seam),
encrypted document storage, SMS notifications, PostGIS geometry, backup and
restore procedures, and a staged migration of the existing records.
