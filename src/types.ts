export type View = 'overview' | 'plots' | 'clients' | 'payments' | 'cases' | 'reports'

export type PlotStatus =
  | 'available'
  | 'reserved'
  | 'deposit_paid'
  | 'on_instalment'
  | 'fully_paid'
  | 'title_processing'

export interface Plot {
  id: number
  /** Server-side identifier, present only when data came from the API. */
  apiId?: string
  status: PlotStatus
  size: string
  cashPrice: number
  instalmentPrice: number
  buyer?: string
  buyerPhone?: string
  paid?: number
  reservedUntil?: string
}

export interface Activity {
  id: number
  kind: 'payment' | 'plot' | 'case' | 'client'
  title: string
  detail: string
  time: string
}

export interface CaseRecord {
  id: string
  client: string
  service: string
  stage: string
  status: 'On track' | 'Awaiting client' | 'Delayed'
  officer: string
  updated: string
  progress: number
  next: string
}
