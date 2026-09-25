// Single source of "now" for services and UI timers (MOCK-04). Domain functions never read the clock themselves.
import { useDevFlags } from '@/stores/devFlagsStore'

export function now(): Date {
  return new Date(Date.now() + useDevFlags.getState().timeOffsetMs)
}
