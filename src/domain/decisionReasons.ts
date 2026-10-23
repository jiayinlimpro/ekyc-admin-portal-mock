// REQ: DEC-106 — decision reasons: what a reviewer picks on Approve or Reject, per project. System Default reasons are
// shared and locked (a project can only turn one off); Custom reasons are added, renamed or turned off, never deleted.
import type { Decision, DecisionOutcome, DecisionReason, DecisionReasonRef, ProjectDecisionReasons, RejectReasonGroup, RuleError } from './types'
import { REJECT_REASON_GROUPS } from './types'

export const REJECT_GROUP_LABELS: Record<RejectReasonGroup, string> = {
  DOCUMENT: 'Document',
  FACE_LIVENESS: 'Face & liveness',
  IDENTITY: 'Identity & eligibility',
  FRAUD_RISK: 'Fraud & risk',
  OTHER: 'Other',
}

const reject = (group: RejectReasonGroup, code: string, name: string, noteRequired = false): DecisionReason => ({ code, name, outcome: 'REJECT', group, noteRequired, system: true, active: true })
const approve = (code: string, name: string, noteRequired = false): DecisionReason => ({ code, name, outcome: 'APPROVE', noteRequired, system: true, active: true })

/** System Default reasons, in display order. The codes are stable across projects and merchants (reports compare them). */
export const SYSTEM_DECISION_REASONS: readonly DecisionReason[] = [
  reject('DOCUMENT', 'DOC_TYPE_NOT_ACCEPTED', 'Document type not accepted'),
  reject('DOCUMENT', 'DOC_EXPIRED', 'Document expired'),
  reject('DOCUMENT', 'DOC_UNCLEAR', 'Document unclear (blur, glare, cropped)'),
  reject('DOCUMENT', 'DOC_NOT_ORIGINAL', 'Document not original (photocopy, screen)'),
  reject('DOCUMENT', 'DOC_TAMPERED', 'Document tampered or forged'),
  reject('DOCUMENT', 'DOC_DATA_INCONSISTENT', 'Document data inconsistent (e.g. NRIC vs date of birth)'),
  reject('FACE_LIVENESS', 'FACE_MISMATCH', 'Face doesn’t match ID'),
  reject('FACE_LIVENESS', 'SPOOF_SUSPECTED', 'Spoof suspected (photo, mask, screen, deepfake)'),
  reject('FACE_LIVENESS', 'FACE_NOT_VISIBLE', 'Face not clearly visible'),
  reject('IDENTITY', 'DETAILS_MISMATCH', 'Details don’t match what the customer submitted'),
  reject('IDENTITY', 'UNDERAGE', 'Below minimum age'),
  reject('IDENTITY', 'NATIONALITY_NOT_ACCEPTED', 'Nationality or residency not accepted'),
  reject('FRAUD_RISK', 'DUPLICATE_IDENTITY', 'Duplicate identity (same person, different ID)'),
  reject('FRAUD_RISK', 'RISK_NOT_ACCEPTABLE', 'Risk not acceptable after review'),
  reject('FRAUD_RISK', 'OTHER_FRAUD', 'Other fraud indicators'),
  reject('OTHER', 'REJECT_OTHER', 'Other', true),
  approve('FACE_CONFIRMED', 'Face confirmed by reviewer (e.g. old ID photo)'),
  approve('QUALITY_LOW_IDENTITY_CONFIRMED', 'Image quality low but identity confirmed'),
  approve('RISK_ACCEPTED', 'Risk signals reviewed and accepted'),
  approve('SAME_PERSON_REONBOARDING', 'Existing user is the same person (re-onboarding)'),
  approve('APPROVE_OTHER', 'Other', true),
]

/** "Other" keeps every outcome choosable: it can't be turned off. */
export const ALWAYS_ON_CODES: readonly string[] = ['REJECT_OTHER', 'APPROVE_OTHER']
export const REASON_NAME_MAX = 80

export const canTurnOff = (r: Pick<DecisionReason, 'code'>) => !ALWAYS_ON_CODES.includes(r.code)

const rank = (r: DecisionReason) => [r.outcome === 'REJECT' ? 0 : 1, r.group ? REJECT_REASON_GROUPS.indexOf(r.group) : 0, ALWAYS_ON_CODES.includes(r.code) ? 1 : 0]

/** The project's reasons, System Default first within each group and "Other" last; `active` reflects the project. */
export function reasonsOf(cfg: ProjectDecisionReasons): DecisionReason[] {
  const all = [...SYSTEM_DECISION_REASONS.map((r) => ({ ...r, active: !cfg.disabledSystemCodes.includes(r.code) })), ...cfg.custom]
  return all
    .map((r, i) => ({ r, i, k: rank(r) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.r)
}

export const activeReasons = (cfg: ProjectDecisionReasons, outcome?: DecisionOutcome) => reasonsOf(cfg).filter((r) => r.active && (!outcome || r.outcome === outcome))

export interface ReasonInput {
  name: string
  outcome: DecisionOutcome
  group?: RejectReasonGroup
  noteRequired: boolean
}

/** Name required, at most 80 characters, unique per outcome (System Default names included); a Reject reason has a group. */
export function validateReasonInput(input: ReasonInput, existing: readonly DecisionReason[], editingCode?: string): RuleError[] {
  const errors: RuleError[] = []
  const name = input.name.trim()
  if (!name) errors.push({ field: 'name', message: 'Enter a name.' })
  else if (name.length > REASON_NAME_MAX) errors.push({ field: 'name', message: `The name can be at most ${REASON_NAME_MAX} characters.` })
  else if (existing.some((r) => r.code !== editingCode && r.outcome === input.outcome && r.name.toLowerCase() === name.toLowerCase()))
    errors.push({ field: 'name', message: `${input.outcome === 'REJECT' ? 'A Reject' : 'An Approve'} reason with this name already exists.` })
  if (input.outcome === 'REJECT' && !input.group) errors.push({ field: 'group', message: 'Choose a group.' })
  return errors
}

/** CUSTOM_ + the name in capitals; a number is added if that code is taken. Never shown for editing. */
export function customCode(name: string, existing: readonly Pick<DecisionReason, 'code'>[]): string {
  const base = `CUSTOM_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'REASON'}`
  const taken = new Set(existing.map((r) => r.code))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export const NOTE_MAX = 500

// REQ: DEC-31 / DEC-106 — Reject: one or more active Reject reasons; Approve: exactly one active Approve reason; a note
// when a chosen reason requires it.
export function decisionError(d: Decision, reasons: readonly DecisionReason[]): string | undefined {
  if ((d.note?.length ?? 0) > NOTE_MAX) return `The note can be at most ${NOTE_MAX} characters.`
  if (!d.reasonCodes.length) return d.outcome === 'REJECT' ? 'Choose at least one reason for the rejection.' : 'Choose a reason for the approval.'
  if (d.outcome === 'APPROVE' && d.reasonCodes.length > 1) return 'Choose one reason for the approval.'
  const chosen = d.reasonCodes.map((c) => reasons.find((r) => r.code === c))
  if (chosen.some((r) => !r || r.outcome !== d.outcome)) return 'Unknown reason.'
  const off = chosen.find((r) => !r!.active)
  if (off) return `“${off.name}” is turned off in this project.`
  const needsNote = chosen.find((r) => r!.noteRequired)
  if (needsNote && !d.note?.trim()) return `Add a note: “${needsNote.name}” needs one.`
  return undefined
}

export const reasonRefs = (codes: readonly string[], reasons: readonly DecisionReason[]): DecisionReasonRef[] =>
  codes.map((code) => ({ code, name: reasons.find((r) => r.code === code)?.name ?? code }))
