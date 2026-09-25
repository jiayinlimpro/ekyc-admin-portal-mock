// Dashboard & billing API (mock). The real backend aggregates server-side; pages receive summaries only.
//   GET /analytics/overview?days=&merchantId=      → OverviewStats
//   GET /analytics/intelligence?days=&merchantId=  → IntelligenceStats
//   GET /billing?period=YYYY-MM&merchantId=        → BillingReport
import { intelligenceStats, mytDay, overviewStats, presetRange, type IntelligenceStats, type OverviewStats } from '@/domain/analytics'
import { billingLine, billingTotals, monthRange, type BillingLine, type BillingTotals } from '@/domain/billing'
import { POLICY, PRICING } from '@/domain/openQuestions'
import { can, canAccessMerchant } from '@/domain/permissions'
import type { Actor, Verification } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { sweepExpiredClaims } from './claimSweep'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'

export interface AnalyticsQuery {
  days: number
  merchantId?: string
}

export interface BillingReport {
  period: string
  chargePerAttempt: boolean
  lines: BillingLine[] // newest first
  totals: BillingTotals
  byMerchant: (BillingTotals & { merchantId: string })[]
}

export interface AnalyticsService {
  overview(q: AnalyticsQuery, actor: Actor): Promise<OverviewStats>
  intelligence(q: AnalyticsQuery, actor: Actor): Promise<IntelligenceStats>
  /** Billing months that have data, newest first ("2026-09"). */
  billingPeriods(actor: Actor): Promise<string[]>
  billing(q: { period: string; merchantId?: string; chargePerAttempt?: boolean }, actor: Actor): Promise<BillingReport>
}

function scoped(actor: Actor, merchantId?: string): Verification[] {
  if (merchantId && !canAccessMerchant(actor, merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
  const scope = can(actor, 'canViewAllMerchants') ? merchantId : actor.merchantId
  return db.state().verifications.filter((v) => !scope || v.merchantId === scope)
}

export const mockAnalyticsService: AnalyticsService = {
  async overview(q, actor) {
    await simulateNetwork('overview')
    const at = now()
    sweepExpiredClaims(at)
    const { current, previous } = presetRange(q.days, at)
    return wire(overviewStats(scoped(actor, q.merchantId), current, previous, at))
  },

  async intelligence(q, actor) {
    await simulateNetwork('intelligence')
    const { current } = presetRange(q.days, now())
    const configs = db.state().configs
    const configFor = (v: Verification) => configs[v.merchantId]?.history.find((c) => c.version === v.configVersion)
    return wire(intelligenceStats(scoped(actor, q.merchantId), current, configFor))
  },

  async billingPeriods(actor) {
    await simulateNetwork('billing periods')
    if (!can(actor, 'canViewBilling')) throw new ServiceError('FORBIDDEN', 'You do not have permission to view billing.')
    const months = new Set(scoped(actor).map((v) => mytDay(v.attempts[0]?.startedAt ?? v.lastUpdatedAt).slice(0, 7)))
    return [...months].sort().reverse()
  },

  async billing(q, actor) {
    await simulateNetwork('billing')
    if (!can(actor, 'canViewBilling')) throw new ServiceError('FORBIDDEN', 'You do not have permission to view billing.')
    const chargePerAttempt = q.chargePerAttempt ?? POLICY.chargePerAttempt
    const { from, to } = monthRange(q.period)
    const lines = scoped(actor, q.merchantId)
      .map((v) => billingLine(v, PRICING, chargePerAttempt))
      .filter((l) => l.chargedAt >= from && l.chargedAt <= to)
      .sort((a, b) => b.chargedAt.localeCompare(a.chargedAt))
    const groups = new Map<string, BillingLine[]>()
    for (const l of lines) groups.set(l.merchantId, [...(groups.get(l.merchantId) ?? []), l])
    return wire({
      period: q.period,
      chargePerAttempt,
      lines,
      totals: billingTotals(lines),
      byMerchant: [...groups].map(([merchantId, ls]) => ({ merchantId, ...billingTotals(ls) })).sort((a, b) => b.total - a.total),
    })
  },
}

export const analyticsService: AnalyticsService = mockAnalyticsService
