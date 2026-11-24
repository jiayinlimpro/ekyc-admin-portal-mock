// Workflow Registry rules (DEC-56, DEC-57, DEC-58, DEC-115).
// The registry is a record only: nothing here builds, deploys or calls the backend workflow. The workflow decides what
// runs; the portal reads the version's workflow JSON (DEC-115) and pushes the flow's tunable settings.
import { CHECKS, type Check, type FaceMatchMethod, type OnboardingPhase, type RegistryEntry, type RegistryStatus, type RuleError, type WorkflowCode } from './types'

export const CODE_PATTERN = /^V[0-9]{1,3}$/

/** REQ: DEC-115 — Register / Edit: the code, a name and the workflow JSON; Merchant access while Limited release (DEC-56). */
export interface RegistryInput {
  code: string
  name: string
  definition: string
  accessMerchantIds: string[]
  reason?: string // REQ: DEC-115 — required when the definition of a version that flows use changes
}

/** What the portal reads from a workflow JSON (DEC-115). */
export type WorkflowDefinition = Pick<RegistryEntry, 'phases' | 'faceMatchMethod' | 'configurableChecks' | 'riskMinimumsPerFlow'>

// REQ: DEC-115 / OQ-39 — the step and tunable names in the workflow JSON (draft contract with engineering).
export const DEFINITION_STEPS: Record<string, OnboardingPhase> = { DOCUMENT: 'ID_CAPTURE', SELFIE: 'SELFIE_CAPTURE', LIVENESS: 'LIVENESS_CHECK', RISK: 'RISK_ASSESSMENT' }
export const DEFINITION_TUNABLES = ['FACE_MATCH', 'LIVENESS', 'RISK_MINIMUMS'] as const

/** REQ: DEC-56 — a flow on an Internal testing version is for internal users only (super admins, platform staff). */
export function internalOnlyFlow(versionStatus: RegistryStatus | undefined): boolean {
  return versionStatus === 'INTERNAL_TESTING'
}

/** REQ: DEC-56 / DEC-60 — a session run on an Internal testing version (not charged) is for internal users only. */
export function internalOnlySession(v: { charged: boolean }): boolean {
  return !v.charged
}

export function hasRisk(e: Pick<RegistryEntry, 'phases'>): boolean {
  return e.phases.includes('RISK_ASSESSMENT')
}

export function hasSelfie(e: Pick<RegistryEntry, 'phases'>): boolean {
  return e.phases.includes('SELFIE_CAPTURE')
}

const list = (xs: readonly string[]) => xs.join(', ')
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * REQ: DEC-115 / OQ-39 — reads a workflow JSON for version `code`: `workflowCode`, `steps` and `tunable`. Other keys are
 * kept and not read. The face match method is not entered: a version with SELFIE matches ID vs selfie.
 */
export function readDefinition(json: string, code: string): { definition?: WorkflowDefinition; errors: RuleError[] } {
  const fail = (message: string) => ({ errors: [{ field: 'definition', message }] })
  if (!json.trim()) return fail('Paste the definition (JSON).')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return fail('This is not valid JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('The definition must be a JSON object, e.g. { "workflowCode": "V7", … }.')
  const o = raw as Record<string, unknown>
  if (typeof o.workflowCode !== 'string' || !o.workflowCode.trim()) return fail('The JSON has no "workflowCode".')
  if (code.trim() && o.workflowCode.trim() !== code.trim()) return fail(`This JSON is for ${o.workflowCode.trim()}, not ${code.trim()}.`)
  const steps = o.steps
  if (!strings(steps) || steps.length === 0) return fail('The JSON needs "steps": a list such as ["DOCUMENT", "LIVENESS"].')
  const unknownStep = steps.find((x) => !(x in DEFINITION_STEPS))
  if (unknownStep !== undefined) return fail(`Unknown step "${unknownStep}". Steps are ${list(Object.keys(DEFINITION_STEPS))}.`)
  if (new Set(steps).size !== steps.length) return fail('A step is listed twice.')
  if (steps[0] !== 'DOCUMENT') return fail('DOCUMENT must be the first step.')
  if (!steps.includes('LIVENESS')) return fail('Every workflow has a LIVENESS step.')
  const tunable = o.tunable
  if (!strings(tunable)) return fail('The JSON needs "tunable": a list such as ["FACE_MATCH", "LIVENESS"].')
  const unknownTunable = tunable.find((x) => !(DEFINITION_TUNABLES as readonly string[]).includes(x))
  if (unknownTunable !== undefined) return fail(`Unknown tunable "${unknownTunable}". Tunables are ${list(DEFINITION_TUNABLES)}.`)
  const checks: Check[] = CHECKS.filter((c) => tunable.includes(c))
  if (checks.length === 0) return fail('"tunable" needs at least one threshold: FACE_MATCH or LIVENESS.')
  // REQ: DEC-107 — only a version with a risk step can let flows set the risk minimums.
  if (tunable.includes('RISK_MINIMUMS') && !steps.includes('RISK')) return fail('RISK_MINIMUMS needs the RISK step.')
  const phases = steps.map((x) => DEFINITION_STEPS[x])
  const faceMatchMethod: FaceMatchMethod = phases.includes('SELFIE_CAPTURE') ? 'ID_VS_SELFIE' : 'ID_VS_LIVENESS'
  return { definition: { phases, faceMatchMethod, configurableChecks: checks, riskMinimumsPerFlow: tunable.includes('RISK_MINIMUMS') }, errors: [] }
}

/** The JSON as stored: pretty-printed, so the same content always compares equal. Unparseable text is kept as typed. */
export function normaliseDefinition(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json.trim()
  }
}

/** Register and edit rules (FRS code rules, DEC-115). `existingCodes` excludes the entry being edited. */
export function validateRegistryInput(input: RegistryInput, existingCodes: readonly WorkflowCode[]): RuleError[] {
  const errors: RuleError[] = []
  const code = input.code.trim()
  if (!code) errors.push({ field: 'code', message: 'Workflow code is required' })
  else if (!CODE_PATTERN.test(code)) errors.push({ field: 'code', message: 'Workflow code must follow the format V<number>, e.g., V5' })
  else if (existingCodes.includes(code)) errors.push({ field: 'code', message: 'Workflow code already exists' }) // never reused
  if (!input.name.trim()) errors.push({ field: 'name', message: 'Workflow name cannot be empty' })
  errors.push(...readDefinition(input.definition, CODE_PATTERN.test(code) ? code : '').errors)
  return errors
}

/** REQ: DEC-115 — the definition stays editable at every status; changing it for a version flows use needs a reason. */
export function definitionChangeError(flowsUsing: number, changed: boolean, reason: string | undefined): string | undefined {
  if (changed && flowsUsing > 0 && !reason?.trim()) return `Reason for change is required: ${flowsUsing} flow(s) use this version.`
  return undefined
}

// REQ: DEC-56 / DEC-57 / DEC-115 — no lifecycle: any status, with a reason. The default stays Active. (No state machine
// references any more: the workflow JSON is required at registration.)
export function statusChangeError(e: Pick<RegistryEntry, 'status' | 'isDefault'>, to: RegistryStatus, reason: string): string | undefined {
  if (e.status === to) return 'This version already has that status.'
  if (!reason.trim()) return 'Reason for change is required.'
  if (e.isDefault && to !== 'ACTIVE') return 'Set another version as default first: the default for new merchants must stay Active.'
  return undefined
}

/** REQ: DEC-56 — records when merchants could first build on it (Limited release or Active). */
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
