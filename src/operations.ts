import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, isLiveMode, readToken, writeToken } from './api/client'
import type { ApiUser } from './api/types'
import { toUiActivity, toUiCase, toUiPlots, toUiTransaction } from './api/mapping'
import { activities as demoActivities, cases as demoCases, initialPlots } from './data'
import type { Activity, CaseRecord, Plot } from './types'

export type Mode = 'demo' | 'live'

export interface Operations {
  mode: Mode
  /** Live mode only: false until the user has a valid session. */
  ready: boolean
  user?: ApiUser
  plots: Plot[]
  cases: CaseRecord[]
  activities: Activity[]
  transactions: (string | number)[][]
  loading: boolean
  error?: string
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  reserve(plot: Plot, buyerName: string, buyerPhone: string): Promise<Plot | undefined>
  refresh(): Promise<void>
}

const DEMO_TRANSACTIONS: (string | number)[][] = [
  ['QK73HD91XZ', 'Samuel Muriuki', 'Plot 7', 25_000, 'Matched', '12 min ago'],
  ['QK73HC55PL', 'Alice Nyambura', 'Plot 31', 40_000, 'Matched', '2 hrs ago'],
  ['QK72GB19MN', 'Unknown payer', 'Unallocated', 47_500, 'Exception', 'Yesterday'],
]

const message = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong'

/**
 * Single data source for the application.
 *
 * With `VITE_API_URL` set the app talks to the operations API and requires a
 * sign-in. Without it the app runs entirely on bundled demonstration data, so
 * the client demo still works with no server running.
 */
export function useOperations(): Operations {
  const live = isLiveMode()

  const [user, setUser] = useState<ApiUser>()
  const [plots, setPlots] = useState<Plot[]>(live ? [] : initialPlots)
  const [cases, setCases] = useState<CaseRecord[]>(live ? [] : demoCases)
  const [activities, setActivities] = useState<Activity[]>(live ? [] : demoActivities)
  const [transactions, setTransactions] = useState<(string | number)[][]>(
    live ? [] : DEMO_TRANSACTIONS,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const [apiPlots, apiCases, apiActivity, apiPayments] = await Promise.all([
        api.listPlots(),
        api.listCases(),
        api.activity(8),
        api.listPayments(),
      ])
      setPlots(toUiPlots(apiPlots))
      setCases(apiCases.map(toUiCase))
      setActivities(apiActivity.map((entry, index) => toUiActivity(entry, index)))
      setTransactions(apiPayments.slice(0, 8).map(toUiTransaction))
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setUser(undefined)
      setError(message(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  // Restore an existing session on mount so a page refresh does not sign the
  // user out. Loading is driven from here and from signIn rather than from an
  // effect watching `user`, which would cascade renders.
  useEffect(() => {
    if (!live || !readToken()) return
    let cancelled = false
    void (async () => {
      try {
        const restored = await api.me()
        if (cancelled) return
        setUser(restored)
        await load()
      } catch {
        writeToken(undefined)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [live, load])

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(undefined)
      setUser(await api.login(email, password))
      await load()
    },
    [load],
  )

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(undefined)
    setPlots([])
    setCases([])
    setActivities([])
    setTransactions([])
  }, [])

  const reserve = useCallback(
    async (plot: Plot, buyerName: string, buyerPhone: string): Promise<Plot | undefined> => {
      if (!live) {
        // Demo mode keeps the original in-memory behaviour.
        let updated: Plot | undefined
        setPlots((current) => {
          const next = current.map((p) =>
            p.id === plot.id
              ? {
                  ...p,
                  status: 'reserved' as const,
                  buyer: buyerName,
                  buyerPhone,
                  paid: 0,
                  reservedUntil: '26 Aug 2026',
                }
              : p,
          )
          updated = next.find((p) => p.id === plot.id)
          return next
        })
        return updated
      }

      if (!plot.apiId) throw new ApiError(0, 'not_found', 'This plot has no server record')
      const terms = plot.status === 'on_instalment' ? 'instalment' : 'cash'
      const { plot: saved } = await api.reservePlot(plot.apiId, buyerName, buyerPhone, terms)
      const mapped = toUiPlots([saved])[0]
      setPlots((current) => current.map((p) => (p.id === mapped?.id ? mapped : p)))
      // Refresh in the background so the activity feed reflects the reservation.
      void load()
      return mapped
    },
    [live, load],
  )

  return useMemo(
    () => ({
      mode: live ? 'live' : 'demo',
      ready: live ? Boolean(user) : true,
      user,
      plots,
      cases,
      activities,
      transactions,
      loading,
      error,
      signIn,
      signOut,
      reserve,
      refresh: load,
    }),
    [live, user, plots, cases, activities, transactions, loading, error, signIn, signOut, reserve, load],
  )
}
