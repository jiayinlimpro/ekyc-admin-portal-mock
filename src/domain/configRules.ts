// Draft → Deploy rules for the per-phase eKYC Workflow configuration (DEC-50 … DEC-53).
import { deriveStatus } from './statusRules'
import type { MerchantConfig, PhaseConfig, Verification } from './types'

export interface ConfigError {
  field: string // e.g. "phases.FACE_MATCH.autoReject"
  message: string
}

// REQ: DEC-53
export function validateConfig(cfg: Pick<MerchantConfig, 'phases' | 'claimTimeoutMin' | 'claimWarningMin'>): ConfigError[] {
  const errors: ConfigError[] = []
  const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100
  for (const p of cfg.phases) {
    const f = (k: keyof PhaseConfig) => `phases.${p.phase}.${k}`
    if (!inRange(p.autoPass)) errors.push({ field: f('autoPass'), message: 'Auto-Pass must be between 0 and 100.' })
    if (!inRange(p.autoReject)) errors.push({ field: f('autoReject'), message: 'Auto-Reject must be between 0 and 100.' })
    if (inRange(p.autoPass) && inRange(p.autoReject) && p.autoReject >= p.autoPass) {
      errors.push({ field: f('autoReject'), message: 'Auto-Reject must be lower than Auto-Pass.' })
    }
    if (!Number.isInteger(p.maxAttempts) || p.maxAttempts < 1) {
      errors.push({ field: f('maxAttempts'), message: 'Max attempts must be a whole number, at least 1.' })
    }
    if (!Number.isFinite(p.cooldownSec) || p.cooldownSec < 0) {
      errors.push({ field: f('cooldownSec'), message: 'Cooldown cannot be negative.' })
    }
  }
  if (!Number.isInteger(cfg.claimTimeoutMin) || cfg.claimTimeoutMin < 1) {
    errors.push({ field: 'claimTimeoutMin', message: 'Claim timeout must be a whole number of minutes, at least 1.' })
  }
  if (!Number.isInteger(cfg.claimWarningMin) || cfg.claimWarningMin < 0 || cfg.claimWarningMin >= cfg.claimTimeoutMin) {
    errors.push({ field: 'claimWarningMin', message: 'Claim warning must be between 0 and the claim timeout.' })
  }
  return errors
}

export interface ConfigChange {
  field: string
  from: unknown
  to: unknown
}

/** Field-level diff between the deployed baseline and a draft, used for diff badges and the CONFIG_DEPLOY delta log. */
export function diffConfig(base: MerchantConfig, draft: MerchantConfig): ConfigChange[] {
  const changes: ConfigChange[] = []
  const push = (field: string, from: unknown, to: unknown) => {
    if (from !== to) changes.push({ field, from, to })
  }
  for (const d of draft.phases) {
    const b = base.phases.find((p) => p.phase === d.phase)
    for (const k of ['enabled', 'autoPass', 'autoReject', 'maxAttempts', 'cooldownSec'] as const) {
      push(`phases.${d.phase}.${k}`, b?.[k], d[k])
    }
  }
  push('risk.enabled', base.risk?.enabled, draft.risk?.enabled)
  push('risk.maxAllowedLevel', base.risk?.maxAllowedLevel, draft.risk?.maxAllowedLevel)
  push('claimTimeoutMin', base.claimTimeoutMin, draft.claimTimeoutMin)
  push('claimWarningMin', base.claimWarningMin, draft.claimWarningMin)
  return changes
}

// REQ: DEC-51 — v1.2.0 → v1.3.0
export function bumpMinor(version: string): string {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`Invalid config version: ${version}`)
  return `v${m[1]}.${Number(m[2]) + 1}.0`
}

export interface ImpactCounts {
  total: number
  APPROVED: number
  PENDING_REVIEW: number
  REJECTED: number
}

/**
 * What-if: the SYSTEM outcome each finished session would get under `cfg`. Preview only — deployed config applies to
 * new sessions (DEC-52). Sessions still in progress are skipped; manual decisions are ignored (system view).
 */
export function previewImpact(records: Pick<Verification, 'attempts' | 'riskLevel'>[], cfg: Pick<MerchantConfig, 'phases' | 'risk' | 'workflowVersion'>): ImpactCounts {
  const out: ImpactCounts = { total: 0, APPROVED: 0, PENDING_REVIEW: 0, REJECTED: 0 }
  for (const r of records) {
    const { status } = deriveStatus(r, cfg)
    if (status === 'PROCESSING') continue
    out.total++
    out[status]++
  }
  return out
}
