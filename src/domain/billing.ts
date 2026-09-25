// REQ: DEC-60 — every verification is charged when the end user enters the flow. Retake charging is OQ-07.
import { submittedAt } from './analytics'
import type { PRICING } from './openQuestions'
import type { Verification, VerificationStatus, WorkflowVersion } from './types'

export type Pricing = { perVerification: Record<WorkflowVersion, number>; perRetake: number; currency: typeof PRICING.currency }

export interface BillingLine {
  referenceNo: string
  merchantId: string
  chargedAt: string // entry into the flow
  workflowVersion: WorkflowVersion
  status: VerificationStatus // "Verification Status" column
  attempts: number
  userRetakes: number
  base: number
  retries: number // "Cost of Retries"
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function billingLine(v: Verification, pricing: Pricing, chargePerAttempt: boolean): BillingLine {
  const userRetakes = v.attempts.filter((a, i) => i > 0 && a.isUserRetake).length
  const base = pricing.perVerification[v.workflowVersion]
  const retries = chargePerAttempt ? round2(userRetakes * pricing.perRetake) : 0
  return {
    referenceNo: v.referenceNo,
    merchantId: v.merchantId,
    chargedAt: submittedAt(v),
    workflowVersion: v.workflowVersion,
    status: v.status,
    attempts: v.attempts.length,
    userRetakes,
    base,
    retries,
    total: round2(base + retries),
  }
}

export interface BillingTotals {
  verifications: number
  base: number
  retries: number
  userRetakes: number
  total: number
}

export function billingTotals(lines: BillingLine[]): BillingTotals {
  return lines.reduce<BillingTotals>(
    (t, l) => ({ verifications: t.verifications + 1, base: round2(t.base + l.base), retries: round2(t.retries + l.retries), userRetakes: t.userRetakes + l.userRetakes, total: round2(t.total + l.total) }),
    { verifications: 0, base: 0, retries: 0, userRetakes: 0, total: 0 },
  )
}

/** Billing periods are MYT calendar months: "2026-09". */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number)
  const start = Date.UTC(y, m - 1, 1) - 8 * 3_600_000
  const end = Date.UTC(y, m, 1) - 8 * 3_600_000 - 1
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
}
