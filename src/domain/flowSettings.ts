// Flow Detail settings: defaults, validation, Advanced guard, diff and save with revision (DEC-19, DEC-50 … DEC-53).
import { hasRisk } from './registryRules'
import { DEFAULT_COOLDOWN_MIN, DEFAULT_RISK_MAX_ALLOWED, RETRY_LIMITS } from './openQuestions'
import { PRESET_LABELS, resolveThreshold } from './thresholds'
import { CHECKS, type Check, type Flow, type FlowSettings, type Project, type RegistryEntry, type RuleError, type ThresholdChoice } from './types'

type By = Flow['updatedBy']

/**
 * A new flow starts on Standard with the default retries and cooldown. Session expiry and accepted documents have no
 * default: they are required fields until OQ-19 is answered.
 */
export function newFlowSettings(entry: Pick<RegistryEntry, 'phases'>): FlowSettings {
  const check = { threshold: { preset: 'STANDARD' } as ThresholdChoice, retriesAllowed: RETRY_LIMITS.default }
  return {
    checks: { FACE_MATCH: { ...check }, LIVENESS: { ...check } },
    cooldownMin: DEFAULT_COOLDOWN_MIN,
    acceptedDocuments: [],
    sessionExpiryMin: Number.NaN,
    risk: hasRisk(entry) ? { enabled: true, maxAllowedLevel: DEFAULT_RISK_MAX_ALLOWED } : undefined,
  }
}

export function createFlow(
  ids: { flowId: string; project: Pick<Project, 'projectId' | 'merchantId'> },
  input: { name: string; description: string },
  entry: Pick<RegistryEntry, 'code' | 'phases'>,
  now: Date,
  by: By,
): Flow {
  return {
    flowId: ids.flowId,
    projectId: ids.project.projectId,
    merchantId: ids.project.merchantId,
    name: input.name.trim(),
    description: input.description.trim(),
    workflowVersion: entry.code,
    status: 'DRAFT',
    settings: newFlowSettings(entry),
    revision: 0,
    routing: { kind: 'NONE' },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    updatedBy: by,
  }
}

const whole = (n: number, min: number, max = Number.POSITIVE_INFINITY) => Number.isInteger(n) && n >= min && n <= max

// REQ: DEC-53 — FRS messages where the FRS has one. Also the settings gate for activating a flow (flowRules.activateError).
export function validateFlow(flow: Pick<Flow, 'name' | 'settings'>, entry: Pick<RegistryEntry, 'phases' | 'configurableChecks'>): RuleError[] {
  const errors: RuleError[] = []
  const s = flow.settings
  if (!flow.name.trim()) errors.push({ field: 'name', message: 'Flow name is required' })
  for (const c of entry.configurableChecks) {
    const f = (k: string) => `checks.${c}.${k}`
    const t = s.checks[c].threshold
    if (t.preset === 'ADVANCED') {
      const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100
      if (!Number.isFinite(t.autoReject)) errors.push({ field: f('autoReject'), message: 'Auto-Reject threshold is required' })
      else if (!inRange(t.autoReject)) errors.push({ field: f('autoReject'), message: 'Value must be between 0.00 and 100.00' })
      if (!Number.isFinite(t.autoPass)) errors.push({ field: f('autoPass'), message: 'Auto-Pass threshold is required' })
      else if (!inRange(t.autoPass)) errors.push({ field: f('autoPass'), message: 'Value must be between 0.00 and 100.00' })
      if (inRange(t.autoReject) && inRange(t.autoPass) && t.autoReject >= t.autoPass) {
        errors.push({ field: f('autoReject'), message: 'Auto-Reject threshold must be lower than Auto-Pass threshold' })
      }
    }
    if (!whole(s.checks[c].retriesAllowed, RETRY_LIMITS.min, RETRY_LIMITS.max)) {
      errors.push({ field: f('retriesAllowed'), message: `Retries allowed must be a whole number between ${RETRY_LIMITS.min} and ${RETRY_LIMITS.max}` })
    }
  }
  if (!Number.isFinite(s.cooldownMin)) errors.push({ field: 'cooldownMin', message: 'Cooldown period is required. Enter 0 for no cooldown' })
  else if (!whole(s.cooldownMin, 0)) errors.push({ field: 'cooldownMin', message: 'Cooldown period must be a whole number of minutes, 0 or more' })
  if (!Number.isFinite(s.sessionExpiryMin)) errors.push({ field: 'sessionExpiryMin', message: 'Session expiry is required' })
  else if (!whole(s.sessionExpiryMin, 1)) errors.push({ field: 'sessionExpiryMin', message: 'Session expiry must be a whole number of minutes, at least 1' })
  if (s.acceptedDocuments.length === 0) errors.push({ field: 'acceptedDocuments', message: 'Select at least one accepted document' })
  if (hasRisk(entry) && !s.risk) errors.push({ field: 'risk', message: 'Risk settings are required for this workflow version' })
  return errors
}

/**
 * REQ: DEC-19 — only Platform Admin sets Advanced values. Anyone who may edit the flow can move from Advanced back to a
 * preset, but cannot create Advanced values or change them.
 */
export function advancedErrors(base: Pick<FlowSettings, 'checks'>, next: Pick<FlowSettings, 'checks'>, canSetAdvanced: boolean): RuleError[] {
  if (canSetAdvanced) return []
  return CHECKS.flatMap((c) => {
    const b = base.checks[c].threshold
    const n = next.checks[c].threshold
    if (n.preset !== 'ADVANCED') return []
    const unchanged = b.preset === 'ADVANCED' && b.autoReject === n.autoReject && b.autoPass === n.autoPass
    return unchanged ? [] : [{ field: `checks.${c}.threshold`, message: 'Only Platform Admin can set Advanced thresholds' }]
  })
}

export interface FlowChange {
  field: string
  from: string
  to: string
}

const show = {
  threshold: (c: Check, t: ThresholdChoice) => {
    const v = resolveThreshold(c, t)
    return `${PRESET_LABELS[t.preset]} (reject < ${v.autoReject}, approve ≥ ${v.autoPass})`
  },
  docs: (d: readonly string[]) => [...d].sort().join(', ') || '—',
  num: (n: number) => (Number.isFinite(n) ? String(n) : '—'),
}

/** Field-level changes, worded for the History section and the FLOW_SETTING_CHANGED audit entry (old and new value). */
export function diffFlow(base: Pick<Flow, 'name' | 'description' | 'settings'>, next: Pick<Flow, 'name' | 'description' | 'settings'>): FlowChange[] {
  const out: FlowChange[] = []
  const push = (field: string, from: string, to: string) => {
    if (from !== to) out.push({ field, from, to })
  }
  push('name', base.name, next.name)
  push('description', base.description, next.description)
  for (const c of CHECKS) {
    push(`checks.${c}.threshold`, show.threshold(c, base.settings.checks[c].threshold), show.threshold(c, next.settings.checks[c].threshold))
    push(`checks.${c}.retriesAllowed`, show.num(base.settings.checks[c].retriesAllowed), show.num(next.settings.checks[c].retriesAllowed))
  }
  push('cooldownMin', show.num(base.settings.cooldownMin), show.num(next.settings.cooldownMin))
  push('sessionExpiryMin', show.num(base.settings.sessionExpiryMin), show.num(next.settings.sessionExpiryMin))
  push('acceptedDocuments', show.docs(base.settings.acceptedDocuments), show.docs(next.settings.acceptedDocuments))
  push('risk.enabled', String(base.settings.risk?.enabled ?? '—'), String(next.settings.risk?.enabled ?? '—'))
  push('risk.maxAllowedLevel', base.settings.risk?.maxAllowedLevel ?? '—', next.settings.risk?.maxAllowedLevel ?? '—')
  return out
}

export const MIN_REASON_LENGTH = 10

/** Only Draft and Active flows are edited; Retiring and Inactive flows keep their last settings. */
export function editError(flow: Pick<Flow, 'status'>): string | undefined {
  return flow.status === 'DRAFT' || flow.status === 'ACTIVE' ? undefined : 'Retiring and inactive flows are read-only.'
}

/**
 * REQ: DEC-51 — a Draft flow saves freely (only the name is required; full validation runs on activation). Saving an
 * Active flow is fully validated, needs a reason (min 10 characters) and creates the next revision; it applies to new
 * sessions only (DEC-52). Returns errors, or the saved flow and its changes.
 */
export function saveFlow(
  flow: Flow,
  next: Pick<Flow, 'name' | 'description' | 'settings'>,
  ctx: { entry: Pick<RegistryEntry, 'phases' | 'configurableChecks'>; canSetAdvanced: boolean; reason: string },
  now: Date,
  by: By,
): { errors: RuleError[] } | { flow: Flow; changes: FlowChange[] } {
  const locked = editError(flow)
  if (locked) return { errors: [{ field: 'status', message: locked }] }
  const validation = validateFlow(next, ctx.entry).filter((e) => flow.status === 'ACTIVE' || e.field === 'name')
  const errors = [...validation, ...advancedErrors(flow.settings, next.settings, ctx.canSetAdvanced)]
  const changes = diffFlow(flow, next)
  if (changes.length === 0) errors.push({ field: 'form', message: 'There are no changes to save.' })
  if (flow.status === 'ACTIVE' && ctx.reason.trim().length < MIN_REASON_LENGTH) {
    errors.push({ field: 'reason', message: `Reason for change is required (minimum ${MIN_REASON_LENGTH} characters).` })
  }
  if (errors.length) return { errors }
  const saved: Flow = {
    ...flow,
    name: next.name.trim(),
    description: next.description.trim(),
    settings: structuredClone(next.settings),
    revision: flow.status === 'ACTIVE' ? flow.revision + 1 : flow.revision,
    updatedAt: now.toISOString(),
    updatedBy: by,
  }
  return { flow: saved, changes }
}
