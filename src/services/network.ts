// Simulated network behaviour for the mock services: latency and optional random failures (dev flags).
import type { Actor } from '@/domain/types'
import { useDevFlags } from '@/stores/devFlagsStore'
import { ServiceError } from './errors'

export async function simulateNetwork(operation: string): Promise<void> {
  const { simulateLatency, latencyMs, simulateErrors, errorRate } = useDevFlags.getState()
  if (simulateLatency) {
    const [min, max] = latencyMs
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)))
  }
  if (simulateErrors && Math.random() < errorRate) {
    throw new ServiceError('SIMULATED', `Simulated network error (${operation}). Try again.`)
  }
}

/** Fake client IP for audit entries: stable per user, from the RFC 5737 documentation range. */
export function clientIpFor(actor: Pick<Actor, 'userId'>): string {
  const n = [...actor.userId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 254, 7)
  return `203.0.113.${n + 1}`
}

/** Responses are copies, as if they came over the wire: callers can't mutate the mock DB by accident. */
export const wire = <T>(value: T): T => structuredClone(value)
