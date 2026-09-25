import { useEffect, useState } from 'react'
import { now } from '@/lib/clock'
import { useDevFlags } from '@/stores/devFlagsStore'

/** Mock "now" that re-renders every `intervalMs` and immediately when the time warp changes. */
export function useNow(intervalMs = 1000): Date {
  useDevFlags((s) => s.timeOffsetMs) // subscribe: time warp re-renders at once
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now()
}
