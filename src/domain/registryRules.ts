// Workflow Registry rules (DEC-56, DEC-57, DEC-58; FRS Workflow Registry Notes B and C).
// The registry is a record only: nothing here builds, deploys or calls AWS Step Functions.
import type { RegistryEntry, RegistryStatus, RuleError, WorkflowCode } from './types'

export const CODE_PATTERN = /^V[0-9]{1,3}$/
export const ARN_PATTERN = /^arn:aws:states:[a-z0-9-]+:\d{12}:stateMachine:[A-Za-z0-9_-]+$/

export type RegistryInput = Pick<
  RegistryEntry,
  'code' | 'name' | 'description' | 'phases' | 'faceMatchMethod' | 'requiredInputs' | 'configurableChecks' | 'riskMinimumsPerFlow' | 'accessMerchantIds' | 'stateMachineSandbox' | 'stateMachineProduction'
> & { releaseNote: string }

export function hasRisk(e: Pick<RegistryEntry, 'phases'>): boolean {
  return e.phases.includes('RISK_ASSESSMENT')
}

export function hasSelfie(e: Pick<RegistryEntry, 'phases'>): boolean {
  return e.phases.includes('SELFIE_CAPTURE')
}

/** FRS field rules for register and edit. `existingCodes` excludes the entry being edited. */
export function validateRegistryInput(input: RegistryInput, existingCodes: readonly WorkflowCode[]): RuleError[] {
  const errors: RuleError[] = []
  const code = input.code.trim()
  if (!code) errors.push({ field: 'code', message: 'Workflow code is required' })
  else if (!CODE_PATTERN.test(code)) errors.push({ field: 'code', message: 'Workflow code must follow the format V<number>, e.g., V5' })
  else if (existingCodes.includes(code)) errors.push({ field: 'code', message: 'Workflow code already exists' }) // never reused
  if (!input.name.trim()) errors.push({ field: 'name', message: 'Workflow name cannot be empty' })
  if (input.description.length > 500) errors.push({ field: 'description', message: 'Description cannot exceed 500 characters' })
  if (input.phases.length === 0) errors.push({ field: 'phases', message: 'Select at least one onboarding phase' })
  else if (input.phases[0] !== 'ID_CAPTURE') errors.push({ field: 'phases', message: 'ID Capture is mandatory and must be the first phase' })
  if (input.faceMatchMethod === 'ID_VS_SELFIE' && !hasSelfie(input)) {
    errors.push({ field: 'faceMatchMethod', message: 'ID vs Selfie needs the Selfie Capture phase' })
  }
  if (input.configurableChecks.length === 0) errors.push({ field: 'configurableChecks', message: 'Select at least one configurable threshold' })
  // REQ: DEC-107 — only a version with Risk Assessment can let flows set the risk minimums.
  if (input.riskMinimumsPerFlow && !hasRisk(input)) errors.push({ field: 'riskMinimumsPerFlow', message: 'Risk minimums need the Risk Assessment phase' })
  for (const f of ['stateMachineSandbox', 'stateMachineProduction'] as const) {
    const arn = input[f]?.trim()
    if (arn && !ARN_PATTERN.test(arn)) errors.push({ field: f, message: 'Enter a valid Step Functions state machine ARN' })
  }
  if (!input.releaseNote.trim()) errors.push({ field: 'releaseNote', message: 'Release notes are required' })
  return errors
}

/** FRS Notes C: once a version has been Active, only these can change; anything else needs a new code. */
export const EDITABLE_AFTER_ACTIVE = ['name', 'description', 'accessMerchantIds', 'stateMachineSandbox', 'stateMachineProduction'] as const

export function isLocked(e: Pick<RegistryEntry, 'activatedAt'>, field: keyof RegistryInput): boolean {
  return !!e.activatedAt && !(EDITABLE_AFTER_ACTIVE as readonly string[]).includes(field) && field !== 'releaseNote'
}

/** REQ: DEC-56 — statuses under which sessions run, so the state machines must be recorded. */
export const RUNNABLE_STATUSES: readonly RegistryStatus[] = ['INTERNAL_TESTING', 'LIMITED_RELEASE', 'ACTIVE']

// REQ: DEC-56 / DEC-57 — no lifecycle: any status, with a reason. The default stays Active; running statuses need state machines.
export function statusChangeError(e: Pick<RegistryEntry, 'status' | 'isDefault' | 'stateMachineSandbox' | 'stateMachineProduction'>, to: RegistryStatus, reason: string): string | undefined {
  if (e.status === to) return 'This version already has that status.'
  if (!reason.trim()) return 'Reason for change is required.'
  if (e.isDefault && to !== 'ACTIVE') return 'Set another version as default first: the default for new merchants must stay Active.'
  if (RUNNABLE_STATUSES.includes(to) && (!e.stateMachineSandbox?.trim() || !e.stateMachineProduction?.trim())) {
    return 'Add both state machine references first.'
  }
  return undefined
}

/** REQ: DEC-56 — fields lock once merchants could build on it (Limited release or Active). */
export const locksFields = (to: RegistryStatus) => to === 'LIMITED_RELEASE' || to === 'ACTIVE'

export function setDefaultError(e: Pick<RegistryEntry, 'status' | 'isDefault'>): string | undefined {
  if (e.isDefault) return 'This version is already the default.'
  if (e.status !== 'ACTIVE') return 'Only an Active version can be the default.'
  return undefined
}

/** Moves the "Default for new merchants" flag; exactly one entry holds it afterwards. */
export function withDefault<E extends Pick<RegistryEntry, 'code' | 'isDefault'>>(entries: readonly E[], code: WorkflowCode): E[] {
  return entries.map((e) => (e.isDefault === (e.code === code) ? e : { ...e, isDefault: e.code === code }))
}

export function defaultVersion<E extends Pick<RegistryEntry, 'isDefault'>>(entries: readonly E[]): E | undefined {
  return entries.find((e) => e.isDefault)
}

/** Versions offered when creating a flow. Draft and Deprecated are never offered (DEC-56). */
/** REQ: DEC-56 — versions a user may choose for a new flow: internal users (super admin, platform staff) or a merchant's users. */
export function selectableForNewFlow<E extends Pick<RegistryEntry, 'status' | 'accessMerchantIds'>>(entries: readonly E[], who: { internal: boolean; merchantId?: string }): E[] {
  return entries.filter(
    (e) => e.status === 'ACTIVE' || (who.internal && (e.status === 'INTERNAL_TESTING' || e.status === 'LIMITED_RELEASE')) || (e.status === 'LIMITED_RELEASE' && !!who.merchantId && e.accessMerchantIds.includes(who.merchantId)),
  )
}
