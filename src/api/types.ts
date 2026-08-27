/** Response shapes returned by the Red Seal operations API. */

export type ApiPlotStatus =
  | 'available'
  | 'reserved'
  | 'deposit_paid'
  | 'on_instalment'
  | 'fully_paid'
  | 'title_processing'

export interface ApiPlot {
  id: string
  projectId: string
  projectName: string
  number: number
  size: string
  status: ApiPlotStatus
  terms: 'cash' | 'instalment' | null
  cashPriceCents: number
  instalmentPriceCents: number
  totalDueCents: number
  paidCents: number
  outstandingCents: number
  client: { id: string; name: string; phone: string } | null
  reservedUntil: string | null
}

export interface ApiPayment {
  id: string
  receipt: string
  channel: 'mpesa' | 'bank' | 'cash' | 'cheque'
  payerName: string
  payerPhone: string | null
  accountRef: string | null
  amountCents: number
  allocatedCents: number
  unallocatedCents: number
  status: 'matched' | 'partially_allocated' | 'unmatched' | 'reversal' | 'reversed'
  receivedAt: string
  recordedAt: string
  allocations: Array<{ plotId: string; plotNumber: number; amountCents: number; automatic: boolean }>
}

export interface ApiCase {
  id: string
  reference: string
  client: { id: string; name: string; phone: string }
  plotId: string | null
  service: 'title_transfer' | 'beaconing' | 'succession' | 'subdivision' | 'valuation'
  stage: string
  status: 'on_track' | 'awaiting_client' | 'delayed' | 'closed'
  officer: string
  progress: number
  nextAction: string
  updatedAt: string
}

export interface ApiUser {
  id: string
  email: string
  name: string
  role: 'director' | 'sales' | 'finance' | 'registry'
  permissions: string[]
}

export interface ApiActivity {
  id: string
  action: string
  entityType: string
  entityId: string
  detail: unknown
  actor: string
  at: string
}

export interface ApiOverview {
  collections: { todayCents: number; monthToDateCents: number; transactionsToday: number }
  receivables: { totalOutstandingCents: number; contractedValueCents: number; collectedCents: number }
  inventory: { total: number; byStatus: Record<ApiPlotStatus, number>; availableValueCents: number }
  reconciliation: { exceptions: number; exceptionValueCents: number; autoMatchedRate: number }
  cases: { open: number; delayed: number; awaitingClient: number; closedThisMonth: number }
  arrears: Record<string, number>
  projects: Array<{
    id: string
    name: string
    location: string
    status: string
    plots: number
    sold: number
    revenueCents: number
  }>
}

/** The error envelope every failing endpoint returns. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}
