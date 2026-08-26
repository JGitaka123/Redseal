/**
 * A clock abstraction. Production uses the system clock; tests inject a fixed
 * or advanceable clock so that expiry and ageing behaviour is deterministic.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) }
}

/** A clock that starts at `iso` and only moves when the test advances it. */
export function mutableClock(iso: string) {
  let current = new Date(iso)
  return {
    now: () => new Date(current),
    advanceDays(days: number) {
      current = new Date(current.getTime() + days * 86_400_000)
    },
    advanceMinutes(minutes: number) {
      current = new Date(current.getTime() + minutes * 60_000)
    },
  }
}

export const iso = (d: Date): string => d.toISOString()

export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000)

export const addHours = (d: Date, hours: number): Date => new Date(d.getTime() + hours * 3_600_000)

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}
