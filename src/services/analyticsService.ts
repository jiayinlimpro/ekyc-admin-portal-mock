// Dashboard & billing API (mock). The real backend aggregates server-side; pages receive summaries only.
// REQ: DEC-86 — every role, data scoped: Platform Admin all merchants, Merchant Owner the merchant's projects, others
// their own projects. Filters: merchant (Platform Admin), projects (the header's switcher), flow.
//   GET /analytics/filters                         → DashboardFilters
//   GET /analytics/overview?days=&…               → OverviewStats
//   GET /analytics/intelligence?days=&…           → IntelligenceReport
//   GET /billing/periods                           → string[]
//   GET /billing?period=YYYY-MM&…                  → BillingReport
import { evaluateCase } from '@/domain/checkRules'
import { billingBy, billingLine, billingTotals, intelligenceStats, monthRange, mytDay, overviewStats, presetRange, type BillingLine, type BillingTotals, type IntelligenceStats, type OverviewStats } from '@/domain/dashboards'
import { TOKEN_PRICE } from '@/domain/openQuestions'
import { hasRisk, hasSelfie } from '@/domain/registryRules'
import { resolveThreshold, type Thresholds } from '@/domain/thresholds'
import type { Actor, Check, Flow, Project, Verification } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { projectIdsWhere, requireMerchantInScope } from './accessGuard'
import { sweepExpiredClaims } from './claimSweep'
import { simulateNetwork, wire } from './network'

export interface DashboardScope {
  merchantId?: string // Platform Admin only; others are scoped to their merchant anyway
  projectIds?: string[] // the header's projects in view; outside the user's scope they are ignored
  flowId?: string
}

export interface AnalyticsQuery extends DashboardScope {
  days: number
}

/** Merchants, projects and flows the user can filter dashboards on, with names for display. */
export interface DashboardFilters {
  merchants: { merchantId: string; name: string }[]
  projects: Pick<Project, 'projectId' | 'merchantId' | 'name'>[]
  flows: Pick<Flow, 'flowId' | 'projectId' | 'name' | 'workflowVersion'>[]
}

export type IntelligenceReport = IntelligenceStats & {
  /** The flow's current thresholds, for the histogram lines; only when one flow is selected (they differ per flow). */
  thresholds?: Record<Check, Thresholds>
}

export interface BillingReport {
  period: string
  tokenPrice: number
  lines: BillingLine[] // newest first
  totals: BillingTotals
  byMerchant: (BillingTotals & { key: string })[]
  byProject: (BillingTotals & { key: string })[]
  byFlow: (BillingTotals & { key: string })[]
}

export interface AnalyticsService {
  filters(actor: Actor): Promise<DashboardFilters>
  overview(q: AnalyticsQuery, actor: Actor): Promise<OverviewStats>
  intelligence(q: AnalyticsQuery, actor: Actor): Promise<IntelligenceReport>
  /** Billing months that have data, newest first ("2026-09"). */
  billingPeriods(actor: Actor): Promise<string[]>
  billing(q: DashboardScope & { period: string }, actor: Actor): Promise<BillingReport>
}

function scoped(actor: Actor, q: DashboardScope): Verification[] {
  if (q.merchantId) requireMerchantInScope(actor, q.merchantId)
  const allowed = projectIdsWhere(actor, 'viewDashboards')
  const asked = q.projectIds ? new Set(q.projectIds) : undefined
  return db
    .state()
    .verifications.filter((v) => allowed.has(v.projectId) && (!asked || asked.has(v.projectId)) && (!q.merchantId || v.merchantId === q.merchantId) && (!q.flowId || v.flowId === q.flowId))
}

/** Each case evaluated with the flow revision it started on (DEC-52). */
function contextOf(v: Verification) {
  const s = db.state()
  const entry = s.registry.find((e) => e.code === v.workflowVersion)!
  const settings = s.flowRevisions.find((r) => r.flowId === v.flowId && r.revision === v.configRevision)?.settings ?? s.flows.find((f) => f.flowId === v.flowId)!.settings
  const ev = evaluateCase({ submissions: v.submissions, riskLevel: v.riskLevel }, { checks: entry.configurableChecks, faceMatchMethod: entry.faceMatchMethod, hasRisk: hasRisk(entry), settings })
  return { checks: ev.checks, hasSelfie: hasSelfie(entry) }
}

export const mockAnalyticsService: AnalyticsService = {
  async filters(actor) {
    await simulateNetwork('dashboard filters')
    const allowed = projectIdsWhere(actor, 'viewDashboards')
    const s = db.state()
    const projects = s.projects.filter((p) => allowed.has(p.projectId))
    return wire({
      merchants: s.merchants.filter((m) => projects.some((p) => p.merchantId === m.merchantId)).map(({ merchantId, name }) => ({ merchantId, name })),
      projects: projects.map(({ projectId, merchantId, name }) => ({ projectId, merchantId, name })),
      flows: s.flows.filter((f) => allowed.has(f.projectId) && f.status !== 'DRAFT').map(({ flowId, projectId, name, workflowVersion }) => ({ flowId, projectId, name, workflowVersion })),
    })
  },

  async overview(q, actor) {
    await simulateNetwork('overview')
    const at = now()
    sweepExpiredClaims(at)
    const { current, previous } = presetRange(q.days, at)
    return wire(overviewStats(scoped(actor, q), current, previous, at))
  },

  async intelligence(q, actor) {
    await simulateNetwork('intelligence')
    const { current } = presetRange(q.days, now())
    const stats = intelligenceStats(scoped(actor, q), current, contextOf)
    const flow = q.flowId ? db.state().flows.find((f) => f.flowId === q.flowId) : undefined
    const thresholds = flow && {
      FACE_MATCH: resolveThreshold('FACE_MATCH', flow.settings.checks.FACE_MATCH.threshold),
      LIVENESS: resolveThreshold('LIVENESS', flow.settings.checks.LIVENESS.threshold),
    }
    return wire({ ...stats, thresholds })
  },

  async billingPeriods(actor) {
    await simulateNetwork('billing periods')
    const months = new Set(scoped(actor, {}).map((v) => mytDay(v.createdAt).slice(0, 7)))
    return [...months].sort().reverse()
  },

  // REQ: DEC-60 — tokens per liveness submission, whatever the final status.
  async billing(q, actor) {
    await simulateNetwork('billing')
    const { from, to } = monthRange(q.period)
    const lines = scoped(actor, q)
      .map((v) => billingLine(v, TOKEN_PRICE))
      .filter((l) => l.chargedAt >= from && l.chargedAt <= to)
      .sort((a, b) => b.chargedAt.localeCompare(a.chargedAt))
    return wire({
      period: q.period,
      tokenPrice: TOKEN_PRICE,
      lines,
      totals: billingTotals(lines, TOKEN_PRICE),
      byMerchant: billingBy(lines, (l) => l.merchantId, TOKEN_PRICE),
      byProject: billingBy(lines, (l) => l.projectId, TOKEN_PRICE),
      byFlow: billingBy(lines, (l) => l.flowId, TOKEN_PRICE),
    })
  },
}

export const analyticsService: AnalyticsService = mockAnalyticsService
