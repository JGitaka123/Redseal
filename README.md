# Red Seal Homes Operations Platform

The Red Seal Homes integrated operations platform: a responsive web front end
demonstrating the Phase 1 product brief, and an authenticated backend API that
enforces the operational rules behind it.

- `src/` — the React front end (the client-ready demonstration story)
- `server/` — the operations API ([documentation](server/README.md))

## Front-end scope

- Director overview with collections, receivables, plot availability, title workload, project performance, arrears ageing, and an action centre
- Pioneer Estate Phase 2 interactive site plan with all 34 numbered plots
- Plot selection, pricing, buyer details, payment progress, and a working seven-day reservation flow
- Unified client register
- M-Pesa reconciliation and exception queue concept
- Universal case and title tracking with stage progress, ownership, ageing, and next actions
- Management report catalogue
- Responsive layouts for desktop, tablet, and mobile demonstrations

All names, telephone numbers, transactions, balances, and operational records are
fictional demo data. Neither the front end nor the API connects to M-Pesa, banks,
GIS or SMS: those integrations are not built yet, and the payment import endpoint
is the seam they will plug into.

## Backend scope

- Session authentication with scrypt password hashing, revocable opaque tokens
  and sign-in lockout
- Four operational roles — director, sales, finance, registry — enforced per
  route as capabilities
- Transactional plot reservation: one active hold per plot, guaranteed under
  concurrent requests, with automatic expiry of stale holds
- An append-only receipts ledger with allocation, auto-reconciliation, an
  exception queue for anything ambiguous, and reversal by mirrored entry
- Case and title tracking with a fixed stage pipeline and progress derived
  from it
- Director overview aggregations, arrears ageing, and an activity feed
- An append-only audit trail covering every state change

## Run locally

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install

# Front end — http://127.0.0.1:4173
pnpm dev

# API — http://127.0.0.1:4000
pnpm seed:server     # first run only: load demonstration data
pnpm dev:server
```

The front end currently renders its own demonstration data and does not yet call
the API; wiring the two together is the next piece of work.

## Quality checks

```bash
pnpm lint:all      # front end + API
pnpm test:all      # 2 front-end tests, 156 API tests
pnpm build:all
```

Or per package: `pnpm test` / `pnpm test:server`, `pnpm lint` / `pnpm lint:server`,
`pnpm build` / `pnpm build:server`. CI runs all of it on every push, with the API
suite exercised on Node 20 and 22.

## Recommended client demo

1. Start on **Overview** and explain that every project, payment, plot, and case feeds one director view.
2. Open **Projects & plots**, then select an available plot on the Pioneer Phase 2 plan.
3. Reserve the plot for a fictional buyer and show the inventory status updating immediately.
4. Open **Payments** to demonstrate automatic matching and the exception queue.
5. Open **Cases & titles** and explain the “walk-in test”: any staff member can state exactly where a client’s service stands.

## Production path

The API now provides authenticated endpoints, role-based permissions, an
immutable ledger, transactional plot locking and an audit trail. See
[`server/README.md`](server/README.md) for how each rule is enforced and why.

Still required before real client data is introduced:

- PostgreSQL/PostGIS in place of SQLite — the schema is written to port cleanly,
  and plot geometry is the reason to make the move
- Live M-Pesa, bank and SMS adapters behind the existing import seam
- Encrypted document storage
- Backup, restore and observability runbooks
- A staged migration of the existing operational records
