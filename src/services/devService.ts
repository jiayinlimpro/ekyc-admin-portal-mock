// Dev-only helpers for the mock: fake users for "Switch user", scenario links and demo data reset.
// Not part of the real API contract.
import type { Actor, VerificationStatus } from '@/domain/types'
import { EDGE_CASES } from '@/mocks/fixtures/edgeCases'
import { db } from '@/mocks/mockDb'
import { wire } from './network'

export interface ScenarioSummary {
  id: string // S01 …
  title: string
  referenceNo: string
  expectedStatus: VerificationStatus
  asUserId: string
}

export const devService = {
  /** Users available in the dev "Switch user" menu (there is no real login in the mock). */
  async listUsers(): Promise<Actor[]> {
    return wire(db.state().users)
  },

  /** Named UAT scenarios from docs/SCENARIOS.md. */
  async listScenarios(): Promise<ScenarioSummary[]> {
    return EDGE_CASES.map((e) => ({ id: e.id, title: e.title, referenceNo: e.referenceNo, expectedStatus: e.status, asUserId: e.asUserId }))
  },

  /** Re-seed all demo data with claims relative to now (run before a UAT session; see docs/SCENARIOS.md). */
  async resetDemoData(): Promise<void> {
    db.reset()
  },

  seededAt(): string {
    return db.state().seededAt
  },
}
