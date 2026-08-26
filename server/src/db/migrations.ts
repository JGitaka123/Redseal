import type { Db } from './index.js'

interface Migration {
  id: string
  sql: string
}

/**
 * Append-only list of schema migrations. Never edit an applied migration —
 * add a new one, so that existing deployments converge to the same schema.
 */
const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_schema',
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('director','sales','finance','registry')),
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT NOT NULL,
  ip        TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0,1)),
  at        TEXT NOT NULL
);
CREATE INDEX ix_login_attempts_lookup ON login_attempts(email, ip, at);

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  location   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('Planning','Selling','Closing','Completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  email       TEXT,
  national_id TEXT,
  kra_pin     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE plots (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects(id),
  number                 INTEGER NOT NULL,
  size                   TEXT NOT NULL,
  cash_price_cents       INTEGER NOT NULL CHECK (cash_price_cents > 0),
  instalment_price_cents INTEGER NOT NULL CHECK (instalment_price_cents > 0),
  status                 TEXT NOT NULL CHECK (status IN ('available','reserved','deposit_paid','on_instalment','fully_paid','title_processing')),
  terms                  TEXT CHECK (terms IN ('cash','instalment')),
  client_id              TEXT REFERENCES clients(id),
  title_processing       INTEGER NOT NULL DEFAULT 0 CHECK (title_processing IN (0,1)),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (project_id, number)
);
CREATE INDEX ix_plots_status ON plots(status);
CREATE INDEX ix_plots_client ON plots(client_id);

CREATE TABLE reservations (
  id         TEXT PRIMARY KEY,
  plot_id    TEXT NOT NULL REFERENCES plots(id),
  client_id  TEXT NOT NULL REFERENCES clients(id),
  terms      TEXT NOT NULL CHECK (terms IN ('cash','instalment')),
  status     TEXT NOT NULL CHECK (status IN ('active','converted','expired','cancelled')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at  TEXT,
  created_by TEXT NOT NULL REFERENCES users(id)
);
-- A plot may hold at most one active reservation. This partial unique index is
-- the authority on that rule: it holds even when two requests race.
CREATE UNIQUE INDEX ux_reservations_active_plot ON reservations(plot_id) WHERE status = 'active';
CREATE INDEX ix_reservations_plot ON reservations(plot_id);

-- Immutable receipts ledger. Corrections are made by appending a reversal row
-- that points at the original via reverses_payment_id, never by editing.
CREATE TABLE payments (
  id                  TEXT PRIMARY KEY,
  receipt             TEXT NOT NULL UNIQUE,
  channel             TEXT NOT NULL CHECK (channel IN ('mpesa','bank','cash','cheque')),
  payer_name          TEXT NOT NULL,
  payer_phone         TEXT,
  account_ref         TEXT,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents <> 0),
  received_at         TEXT NOT NULL,
  recorded_at         TEXT NOT NULL,
  recorded_by         TEXT NOT NULL REFERENCES users(id),
  reverses_payment_id TEXT REFERENCES payments(id),
  client_id           TEXT REFERENCES clients(id)
);
CREATE INDEX ix_payments_received ON payments(received_at);
CREATE TRIGGER trg_payments_immutable_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
CREATE TRIGGER trg_payments_immutable_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;

-- Append-only allocation of receipts against plot accounts.
CREATE TABLE payment_allocations (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES payments(id),
  plot_id      TEXT NOT NULL REFERENCES plots(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  allocated_at TEXT NOT NULL,
  allocated_by TEXT NOT NULL REFERENCES users(id),
  automatic    INTEGER NOT NULL DEFAULT 0 CHECK (automatic IN (0,1))
);
CREATE INDEX ix_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX ix_allocations_plot ON payment_allocations(plot_id);
CREATE TRIGGER trg_allocations_immutable_update BEFORE UPDATE ON payment_allocations
BEGIN SELECT RAISE(ABORT, 'payment allocations are immutable'); END;
CREATE TRIGGER trg_allocations_immutable_delete BEFORE DELETE ON payment_allocations
BEGIN SELECT RAISE(ABORT, 'payment allocations are immutable'); END;

CREATE TABLE cases (
  id          TEXT PRIMARY KEY,
  reference   TEXT NOT NULL UNIQUE,
  client_id   TEXT NOT NULL REFERENCES clients(id),
  plot_id     TEXT REFERENCES plots(id),
  service     TEXT NOT NULL CHECK (service IN ('title_transfer','beaconing','succession','subdivision','valuation')),
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('on_track','awaiting_client','delayed','closed')),
  officer     TEXT NOT NULL,
  progress    INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  next_action TEXT NOT NULL,
  opened_at   TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  closed_at   TEXT
);
CREATE INDEX ix_cases_client ON cases(client_id);
CREATE INDEX ix_cases_status ON cases(status);

CREATE TABLE case_events (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id),
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  note       TEXT,
  at         TEXT NOT NULL,
  actor_id   TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX ix_case_events_case ON case_events(case_id);

-- Append-only audit trail covering every state change in the system.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  ip          TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX ix_audit_at ON audit_log(at);
CREATE TRIGGER trg_audit_immutable_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER trg_audit_immutable_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
`,
  },
]

export function runMigrations(db: Db): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: string }).id),
  )
  const ran: string[] = []

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, new Date().toISOString())
    })
    apply()
    ran.push(migration.id)
  }
  return ran
}

export const migrationIds = () => MIGRATIONS.map((m) => m.id)
