// Dashboard aggregations (pure). "Submitted" = the first attempt's start (DEC-04). Days are MYT calendar days.
import { isClaimActive } from './claimRules'
import { attemptsExhausted } from './statusRules'
import {
  CAPTURE_PHASES,
  RISK_LEVELS,
  VERIFICATION_STATUSES,
  type CapturePhase,
  type MerchantConfig,
  type RiskLevel,
  type Verification,
  type VerificationStatus,
} from './types'

const MYT = 8 * 3_600_000
const DAY = 86_400_000

export const submittedAt = (v: Pick<Verification, 'attempts' | 'lastUpdatedAt'>) => v.attempts[0]?.startedAt ?? v.lastUpdatedAt
export const mytDay = (iso: string | number | Date) => new Date(new Date(iso).getTime() + MYT).toISOString().slice(0, 10)

export interface DateRange {
  from: string // ISO, inclusive
  to: string // ISO, inclusive
}

/** Last `days` MYT calendar days up to `now` (today included), plus the equally long period before it. */
export function presetRange(days: number, now: Date): { current: DateRange; previous: DateRange } {
  const todayStart = Date.parse(`${mytDay(now)}T00:00:00.000Z`) - MYT
  const from = todayStart - (days - 1) * DAY
  return {
    current: { from: new Date(from).toISOString(), to: now.toISOString() },
    previous: { from: new Date(from - days * DAY).toISOString(), to: new Date(from - 1).toISOString() },
  }
}

export const inRange = (v: Pick<Verification, 'attempts' | 'lastUpdatedAt'>, r: DateRange) => {
  const t = submittedAt(v)
  return t >= r.from && t <= r.to
}

const zeroStatus = (): Record<VerificationStatus, number> => Object.fromEntries(VERIFICATION_STATUSES.map((s) => [s, 0])) as Record<VerificationStatus, number>

export interface OverviewStats {
  total: number
  previousTotal: number
  byStatus: Record<VerificationStatus, number>
  /** REQ: DEC-14 — Auto-Clear = APPROVED with lastUpdatedBy SYSTEM. */
  autoCleared: number
  manuallyDecided: number
  pending: { total: number; claimed: number; unclaimed: number }
  daily: { day: string; counts: Record<VerificationStatus, number> }[]
  byMerchant: { merchantId: string; total: number; autoCleared: number; pending: number; rejected: number }[]
}

/** Current status of the sessions submitted in the range (a snapshot as of `now`). */
export function overviewStats(records: Verification[], range: DateRange, previous: DateRange, now: Date): OverviewStats {
  const rows = records.filter((v) => inRange(v, range))
  const byStatus = zeroStatus()
  const days = new Map<string, Record<VerificationStatus, number>>()
  for (let t = Date.parse(`${mytDay(range.from)}T00:00:00.000Z`); mytDay(t - MYT) <= mytDay(range.to); t += DAY) days.set(mytDay(t - MYT), zeroStatus())
  const merchants = new Map<string, OverviewStats['byMerchant'][number]>()
  let autoCleared = 0
  let manuallyDecided = 0
  let claimed = 0
  for (const v of rows) {
    byStatus[v.status]++
    days.get(mytDay(submittedAt(v)))![v.status]++
    const auto = v.status === 'APPROVED' && v.lastUpdatedBy.kind === 'SYSTEM'
    if (auto) autoCleared++
    if (v.lastUpdatedBy.kind === 'USER') manuallyDecided++
    if (v.status === 'PENDING_REVIEW' && isClaimActive(v, now)) claimed++
    const m = merchants.get(v.merchantId) ?? { merchantId: v.merchantId, total: 0, autoCleared: 0, pending: 0, rejected: 0 }
    m.total++
    if (auto) m.autoCleared++
    if (v.status === 'PENDING_REVIEW') m.pending++
    if (v.status === 'REJECTED') m.rejected++
    merchants.set(v.merchantId, m)
  }
  return {
    total: rows.length,
    previousTotal: records.filter((v) => inRange(v, previous)).length,
    byStatus,
    autoCleared,
    manuallyDecided,
    pending: { total: byStatus.PENDING_REVIEW, claimed, unclaimed: byStatus.PENDING_REVIEW - claimed },
    daily: [...days].map(([day, counts]) => ({ day, counts })),
    byMerchant: [...merchants.values()].sort((a, b) => b.total - a.total),
  }
}

export const HISTOGRAM_BIN = 5 // score bins of 5 points: [0,5), [5,10) … [95,100]

export interface IntelligenceStats {
  sessions: number
  /** REQ: DEC-18 — the Retry KPI counts user retakes only. */
  retriedSessions: number
  userRetakes: number
  attemptLimitReached: number
  retakesByPhase: Record<CapturePhase, number>
  /** Latest score per phase from each session's last attempt that reached the phase. */
  histograms: Record<CapturePhase, number[]>
  riskLevels: Record<RiskLevel, number>
}

export function intelligenceStats(records: Verification[], range: DateRange, configFor: (v: Verification) => Pick<MerchantConfig, 'phases'> | undefined): IntelligenceStats {
  const rows = records.filter((v) => inRange(v, range))
  const bins = Math.ceil(100 / HISTOGRAM_BIN)
  const histograms = Object.fromEntries(CAPTURE_PHASES.map((p) => [p, Array<number>(bins).fill(0)])) as Record<CapturePhase, number[]>
  const retakesByPhase = Object.fromEntries(CAPTURE_PHASES.map((p) => [p, 0])) as Record<CapturePhase, number>
  const riskLevels = Object.fromEntries(RISK_LEVELS.map((l) => [l, 0])) as Record<RiskLevel, number>
  let retriedSessions = 0
  let userRetakes = 0
  let attemptLimitReached = 0
  for (const v of rows) {
    const retakes = v.attempts.filter((a, i) => a.isUserRetake && i > 0)
    if (retakes.length) retriedSessions++
    userRetakes += retakes.length
    // A retake repeats the phase where the previous attempt stopped.
    v.attempts.forEach((a, i) => {
      if (i > 0 && a.isUserRetake) retakesByPhase[v.attempts[i - 1].phase]++
    })
    const cfg = configFor(v)
    if (cfg && attemptsExhausted(v.attempts, cfg)) attemptLimitReached++
    for (const p of CAPTURE_PHASES) {
      const score = [...v.attempts].reverse().find((a) => a.phaseScores[p] !== undefined)?.phaseScores[p]
      if (score !== undefined) histograms[p][Math.min(bins - 1, Math.floor(score / HISTOGRAM_BIN))]++
    }
    if (v.riskLevel) riskLevels[v.riskLevel]++
  }
  return { sessions: rows.length, retriedSessions, userRetakes, attemptLimitReached, retakesByPhase, histograms, riskLevels }
}
