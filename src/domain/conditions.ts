// REQ: DEC-35 — condition catalogue (product owner's sheet, 2026-10-20). Feeds the reason banner on Verification Detail,
// the Top-5 failure reason charts and the Reject reason list.
import type { Check, FaceMatchMethod } from './types'

export interface Condition {
  id: string
  stage: string
  label: string
  kind: 'FAILURE' | 'SUCCESS'
  /** "(Retry Allowed)" keeps the case PROCESSING; "(Retry Not Allowed)" is the final reason (DEC-16). */
  retry?: 'ALLOWED' | 'NOT_ALLOWED'
  /** Recorded only: never changes the status, never shown on list or detail, never a Reject reason. */
  recordOnly?: boolean
}

const fail = (id: string, stage: string, label: string, extra: Partial<Condition> = {}): Condition => ({ id, stage, label, kind: 'FAILURE', ...extra })

export const CONDITIONS: readonly Condition[] = [
  fail('ONB_NO_FACE_ID', 'Onboarding', 'No valid face in ID detected'),
  fail('ONB_NO_FACE_SELFIE', 'Onboarding', 'No valid face in Selfie detected'),
  fail('OCR_IMAGE_TOO_SMALL', 'OCR', 'ID image smaller than 320x320'),
  fail('OCR_NO_WORD', 'OCR', 'No word detected'),
  fail('NRIC_IC', 'OCR (NRIC)', 'IC field not detected'),
  fail('NRIC_GENDER', 'OCR (NRIC)', 'Gender field not detected'),
  fail('NRIC_NAME', 'OCR (NRIC)', 'Name field not detected'),
  fail('NRIC_ADDRESS', 'OCR (NRIC)', 'Address field not detected'),
  fail('DL_IC', 'OCR (Drivers License)', 'IC field not detected'),
  fail('DL_VALIDITY', 'OCR (Drivers License)', 'Validity Data field not detected'),
  fail('DL_NAME', 'OCR (Drivers License)', 'Name field not detected'),
  fail('DL_NATIONALITY', 'OCR (Drivers License)', 'Nationality field not detected'),
  fail('DL_CLASS', 'OCR (Drivers License)', 'Class field not detected'),
  fail('DL_ADDRESS', 'OCR (Drivers License)', 'Address field not detected'),
  fail('PASSPORT_MRZ', 'OCR (Passport)', 'Unable to detect the 2 lines MRZ field in passport image'),
  fail('FACE_SELFIE_MISMATCH_RETRY', 'Onboarding', 'ID face and Selfie face do not match (Retry Allowed)', { retry: 'ALLOWED' }),
  fail('FACE_SELFIE_MISMATCH', 'Onboarding', 'ID face and Selfie face do not match (Retry Not Allowed)', { retry: 'NOT_ALLOWED' }),
  fail('EXISTING_USER', 'Onboarding', 'Face already has existing registered user in db', { recordOnly: true }),
  fail('NOT_LIVE_RETRY', 'Liveness', 'Face not live (Retry Allowed)', { retry: 'ALLOWED' }),
  fail('NOT_LIVE', 'Liveness', 'Face not live (Retry Not Allowed)', { retry: 'NOT_ALLOWED' }),
  fail('LIVENESS_FACE_MISMATCH_RETRY', 'Liveness', 'Liveness face does not match ID face (Retry Allowed)', { retry: 'ALLOWED' }),
  fail('LIVENESS_FACE_MISMATCH', 'Liveness', 'Liveness face does not match ID face (Retry Not Allowed)', { retry: 'NOT_ALLOWED' }),
  { id: 'ALL_PASSED', stage: 'Liveness', label: 'All stages passed', kind: 'SUCCESS' },
]

export function conditionById(id: string): Condition | undefined {
  return CONDITIONS.find((c) => c.id === id)
}

/** Shown to reviewers and in charts: everything except record-only conditions. */
export const VISIBLE_CONDITIONS: readonly Condition[] = CONDITIONS.filter((c) => !c.recordOnly)

/**
 * REQ: DEC-31 — the Reject reason list: failures that can end a case. Leaves out record-only conditions and the
 * "(Retry Allowed)" variants, which never end a case.
 */
export const REJECT_REASONS: readonly Condition[] = CONDITIONS.filter((c) => c.kind === 'FAILURE' && !c.recordOnly && c.retry !== 'ALLOWED')

/** The condition for a face match or liveness result below Auto-Pass, with or without retries left. */
export function checkCondition(check: Check, faceMatchMethod: FaceMatchMethod, retryAllowed: boolean): Condition {
  const id =
    check === 'LIVENESS' ? 'NOT_LIVE' : faceMatchMethod === 'ID_VS_SELFIE' ? 'FACE_SELFIE_MISMATCH' : 'LIVENESS_FACE_MISMATCH'
  return conditionById(retryAllowed ? `${id}_RETRY` : id)!
}
