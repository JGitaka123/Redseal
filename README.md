# Red Seal Homes Operations Prototype

A polished, responsive demonstration of the proposed Red Seal Homes integrated operations platform. It turns the Phase 1 product brief into a client-ready interactive story using anonymized demonstration data.

## Prototype scope

- Director overview with collections, receivables, plot availability, title workload, project performance, arrears ageing, and an action centre
- Pioneer Estate Phase 2 interactive site plan with all 34 numbered plots
- Plot selection, pricing, buyer details, payment progress, and a working seven-day reservation flow
- Unified client register
- M-Pesa reconciliation and exception queue concept
- Universal case and title tracking with stage progress, ownership, ageing, and next actions
- Management report catalogue
- Responsive layouts for desktop, tablet, and mobile demonstrations

All names, telephone numbers, transactions, balances, and operational records are fictional demo data. The prototype does not connect to M-Pesa, banks, GIS, SMS, or production databases.

## Run locally

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4173`.

## Quality checks

```bash
pnpm build
pnpm lint
pnpm test
```

## Recommended client demo

1. Start on **Overview** and explain that every project, payment, plot, and case feeds one director view.
2. Open **Projects & plots**, then select an available plot on the Pioneer Phase 2 plan.
3. Reserve the plot for a fictional buyer and show the inventory status updating immediately.
4. Open **Payments** to demonstrate automatic matching and the exception queue.
5. Open **Cases & titles** and explain the “walk-in test”: any staff member can state exactly where a client’s service stands.

## Production path

This repository currently contains the front-end prototype only. The production build should add PostgreSQL/PostGIS, authenticated APIs, role-based permissions, immutable ledgers, transactional plot locking, encrypted document storage, an audit trail, integration adapters, observability, backups, and a staged data-migration process before real client data is introduced.
