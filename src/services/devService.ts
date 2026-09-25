// Dev-only helpers for the mock: fake users for "Switch user" and demo data reset. Not part of the real API contract.
import type { Actor } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { wire } from './network'

export const devService = {
  /** Users available in the dev "Switch user" menu (there is no real login in the mock). */
  async listUsers(): Promise<Actor[]> {
    return wire(db.state().users)
  },

  /** Re-seed all demo data with claims relative to now (run before a UAT session; see docs/SCENARIOS.md). */
  async resetDemoData(): Promise<void> {
    db.reset()
  },
}
