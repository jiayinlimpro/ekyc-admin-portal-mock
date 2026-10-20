// REQ: MOCK-10 — Flow Detail what-if: re-run the status rules over a flow's finished sessions with edited settings.
// Read-only: it never changes a record. Pure.
import { evaluateCase, type FlowContext } from './checkRules'
import { VERIFICATION_STATUSES, type FlowSettings, type Verification, type VerificationStatus } from './types'

export interface ImpactSummary {
  total: number
  before: Record<VerificationStatus, number> // SYSTEM result with the current settings
  after: Record<VerificationStatus, number> // with the edited settings; PROCESSING = would still be retrying
  changed: number // sessions whose result would differ
}

const zero = () => Object.fromEntries(VERIFICATION_STATUSES.map((s) => [s, 0])) as Record<VerificationStatus, number>

export function flowImpact(
  cases: readonly Pick<Verification, 'submissions' | 'riskLevel'>[],
  flow: Omit<FlowContext, 'settings'>,
  current: Pick<FlowSettings, 'checks' | 'risk'>,
  edited: Pick<FlowSettings, 'checks' | 'risk'>,
): ImpactSummary {
  const out: ImpactSummary = { total: cases.length, before: zero(), after: zero(), changed: 0 }
  for (const c of cases) {
    const input = { submissions: c.submissions, riskLevel: c.riskLevel }
    const a = evaluateCase(input, { ...flow, settings: current }).status
    const b = evaluateCase(input, { ...flow, settings: edited }).status
    out.before[a]++
    out.after[b]++
    if (a !== b) out.changed++
  }
  return out
}
