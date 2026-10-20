// Dev-only helpers for the mock: fake users for "Switch user", scenario links and demo data reset.
// Not part of the real API contract.
import { isClaimActive } from '@/domain/claimRules'
import { VERIFICATION_STATUSES, type AccessLevel, type Actor, type UserStatus, type VerificationStatus, type WorkflowVersion } from '@/domain/types'
import { PROJECT_ROLE_LABELS } from '@/lib/labels'
import { now } from '@/lib/clock'
import { EDGE_CASES } from '@/mocks/fixtures/edgeCases'
import { db } from '@/mocks/mockDb'
import { wire } from './network'

/** A demo user for "Switch user" and the mock login: the session part plus a one-line description of their access. */
export type DevUser = Actor & { email: string; level: AccessLevel; status: UserStatus; merchantId?: string; access: string }

export interface ScenarioSummary {
  id: string // S01 …
  title: string
  referenceNo: string
  expectedStatus: VerificationStatus
  asUserId: string
}

export const devService = {
  /** Users available in the dev "Switch user" menu and the mock login (there is no real login in the mock). */
  async listUsers(): Promise<DevUser[]> {
    const s = db.state()
    const merchant = (id?: string) => s.merchants.find((m) => m.merchantId === id)?.name ?? id ?? ''
    const project = (id: string) => s.projects.find((p) => p.projectId === id)?.name ?? id
    return wire(
      s.accounts.map((a) => {
        const access =
          a.level === 'PLATFORM_ADMIN'
            ? 'Platform Admin · all merchants'
            : a.level === 'MERCHANT_OWNER'
              ? `Merchant Owner · ${merchant(a.merchantId)}`
              : `${a.memberships.map((m) => `${PROJECT_ROLE_LABELS[m.role]} in ${project(m.projectId)}`).join(', ') || 'No projects'} · ${merchant(a.merchantId)}`
        return { userId: a.userId, fullName: a.fullName, email: a.email, level: a.level, status: a.status, merchantId: a.merchantId, access }
      }),
    )
  },

  /** Named UAT scenarios from docs/SCENARIOS.md. */
  async listScenarios(): Promise<ScenarioSummary[]> {
    return EDGE_CASES.map((e) => ({ id: e.id, title: e.title, referenceNo: e.referenceNo, expectedStatus: e.status, asUserId: e.asUserId }))
  },

  /** Re-seed all demo data with claims relative to now (run before a UAT session; see docs/SCENARIOS.md). */
  async resetDemoData(): Promise<void> {
    db.reset()
  },

  /** Data coverage for QA: every status × workflow version, claimed, manual vs system, risk (guide §5). */
  async coverage(): Promise<{ rows: { status: VerificationStatus; byVersion: Partial<Record<WorkflowVersion, number>>; claimed: number; manual: number; system: number }[]; total: number }> {
    const at = now()
    const vs = db.state().verifications
    return {
      total: vs.length,
      rows: VERIFICATION_STATUSES.map((status) => {
        const rs = vs.filter((v) => v.status === status)
        const byVersion: Partial<Record<WorkflowVersion, number>> = {}
        for (const v of rs) byVersion[v.workflowVersion] = (byVersion[v.workflowVersion] ?? 0) + 1
        return { status, byVersion, claimed: rs.filter((v) => isClaimActive(v, at)).length, manual: rs.filter((v) => v.lastUpdatedBy.kind === 'USER').length, system: rs.filter((v) => v.lastUpdatedBy.kind === 'SYSTEM').length }
      }),
    }
  },

  seededAt(): string {
    return db.state().seededAt
  },
}
