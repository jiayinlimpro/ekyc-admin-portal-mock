import { describe, expect, it } from 'vitest'
import { defaultVersion, internalOnlyFlow, internalOnlySession, isLocked, readDefinition, selectableForNewFlow, setDefaultError, statusChangeError, validateRegistryInput, withDefault, type RegistryInput } from './registryRules'
import type { RegistryEntry, RegistryStatus } from './types'

const V5 = { workflowCode: 'V5', steps: ['DOCUMENT', 'LIVENESS', 'RISK'], tunable: ['FACE_MATCH', 'LIVENESS', 'RISK_MINIMUMS'] }
const json = (o: Record<string, unknown>) => JSON.stringify(o)

const input = (overrides: Partial<RegistryInput> = {}): RegistryInput => ({
  code: 'V5',
  name: 'ID + Liveness + component risk',
  definition: json(V5),
  accessMerchantIds: [],
  ...overrides,
})

const entry = (code: string, status: RegistryStatus, isDefault = false): RegistryEntry => {
  const definition = json({ ...V5, workflowCode: code })
  return {
    entryId: `wfv_test${code.toLowerCase().padStart(20, '0')}`,
    code,
    name: code,
    definition,
    ...readDefinition(definition, code).definition!,
    accessMerchantIds: [],
    status,
    isDefault,
    activatedAt: status === 'DRAFT' ? undefined : '2026-01-01T00:00:00.000Z',
    registeredAt: '2026-01-01T00:00:00.000Z',
    registeredBy: 'Lim Wei Jie',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'Lim Wei Jie',
  }
}

const message = (o: unknown, code = 'V5') => readDefinition(typeof o === 'string' ? o : JSON.stringify(o), code).errors[0]?.message

describe('registry: the workflow JSON (DEC-115)', () => {
  it('Given V5’s workflow JSON, then the portal reads its steps, its tunables and risk minimums per flow; other keys are ignored', () => {
    expect(readDefinition(json({ ...V5, stateMachine: 'onboard_v5' }), 'V5')).toEqual({
      definition: { phases: ['ID_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'], faceMatchMethod: 'ID_VS_LIVENESS', configurableChecks: ['FACE_MATCH', 'LIVENESS'], riskMinimumsPerFlow: true },
      errors: [],
    })
  })

  it('Given a version with a SELFIE step, then the face is matched ID vs selfie, not entered by anyone; without RISK_MINIMUMS the minimums are fixed', () => {
    expect(readDefinition(json({ workflowCode: 'V1', steps: ['DOCUMENT', 'SELFIE', 'LIVENESS'], tunable: ['LIVENESS', 'FACE_MATCH'] }), 'V1').definition).toEqual({
      phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK'],
      faceMatchMethod: 'ID_VS_SELFIE',
      configurableChecks: ['FACE_MATCH', 'LIVENESS'],
      riskMinimumsPerFlow: false,
    })
  })

  it('Given a JSON the portal can’t read, then one message under the field', () => {
    expect(message('  ')).toBe('Paste the workflow JSON.')
    expect(message('{ steps: [')).toBe('This is not valid JSON.')
    expect(message([V5])).toMatch(/must be an object/)
    expect(message({ ...V5, workflowCode: undefined })).toBe('The JSON has no "workflowCode".')
    expect(message({ ...V5, workflowCode: 'V4' })).toBe('This JSON is for V4, not V5.')
    expect(message({ ...V5, steps: [] })).toMatch(/needs "steps"/)
    expect(message({ ...V5, steps: ['DOCUMENT', 'FACE', 'LIVENESS'] })).toBe('Unknown step "FACE". Steps are DOCUMENT, SELFIE, LIVENESS, RISK.')
    expect(message({ ...V5, steps: ['DOCUMENT', 'LIVENESS', 'LIVENESS'] })).toBe('A step is listed twice.')
    expect(message({ ...V5, steps: ['LIVENESS', 'DOCUMENT'] })).toBe('DOCUMENT must be the first step.')
    expect(message({ ...V5, steps: ['DOCUMENT', 'SELFIE'] })).toBe('Every workflow has a LIVENESS step.')
    expect(message({ ...V5, tunable: 'FACE_MATCH' })).toMatch(/needs "tunable"/)
    expect(message({ ...V5, tunable: ['FACE_MATCH', 'DOCUMENT'] })).toBe('Unknown tunable "DOCUMENT". Tunables are FACE_MATCH, LIVENESS, RISK_MINIMUMS.')
    expect(message({ ...V5, tunable: ['RISK_MINIMUMS'] })).toBe('"tunable" needs at least one threshold: FACE_MATCH or LIVENESS.')
  })

  it('Given RISK_MINIMUMS without the RISK step, then refused (DEC-107)', () => {
    expect(message({ ...V5, steps: ['DOCUMENT', 'LIVENESS'] })).toBe('RISK_MINIMUMS needs the RISK step.')
  })
})

describe('registry: register and edit (DEC-115)', () => {
  it('Given a code, a name and a readable JSON, then no errors', () => {
    expect(validateRegistryInput(input(), ['V1', 'V3', 'V4'])).toEqual([])
  })

  it('Given a bad or reused code, or no name, then the FRS messages', () => {
    expect(validateRegistryInput(input({ code: 'v5x' }), [])[0].message).toBe('Workflow code must follow the format V<number>, e.g., V5')
    expect(validateRegistryInput(input({ code: 'V4' }), ['V4']).map((e) => e.message)).toEqual(['Workflow code already exists', 'This JSON is for V5, not V4.'])
    expect(validateRegistryInput(input({ name: ' ' }), [])).toEqual([{ field: 'name', message: 'Workflow name cannot be empty' }])
  })

  it('Given a version that has been Limited release or Active, then only the name and Merchant access stay editable; the JSON is locked', () => {
    const active = entry('V4', 'ACTIVE')
    expect(isLocked(active, 'definition')).toBe(true)
    expect(isLocked(active, 'name')).toBe(false)
    expect(isLocked(active, 'accessMerchantIds')).toBe(false)
    expect(isLocked(entry('V5', 'DRAFT'), 'definition')).toBe(false)
  })
})

describe('registry: statuses, no lifecycle (DEC-56)', () => {
  it('Given any other status with a reason, then allowed, Draft and back included', () => {
    expect(statusChangeError(entry('V5', 'DRAFT'), 'INTERNAL_TESTING', 'Engine build ready')).toBeUndefined()
    expect(statusChangeError(entry('V5', 'INTERNAL_TESTING'), 'LIMITED_RELEASE', 'Pilot with Atoz')).toBeUndefined()
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DEPRECATED', 'Replaced by V4')).toBeUndefined()
    expect(statusChangeError(entry('V3', 'DEPRECATED'), 'DRAFT', 'Back to the drawing board')).toBeUndefined()
  })

  it('Given the same status or no reason, then refused; no state machine references are needed (DEC-115)', () => {
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'ACTIVE', 'x')).toBe('This version already has that status.')
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DEPRECATED', '  ')).toBe('Reason for change is required.')
    for (const to of ['INTERNAL_TESTING', 'LIMITED_RELEASE', 'ACTIVE'] as const) expect(statusChangeError(entry('V5', 'DRAFT'), to, 'Go'), to).toBeUndefined()
  })

  it('Given the default version, then it must stay Active (DEC-57)', () => {
    expect(statusChangeError(entry('V1', 'ACTIVE', true), 'DEPRECATED', 'Old')).toBe('Set another version as default first: the default for new merchants must stay Active.')
    expect(statusChangeError(entry('V1', 'ACTIVE', true), 'INTERNAL_TESTING', 'Retest')).toMatch(/must stay Active/)
  })
})

describe('registry: default for new merchants (DEC-57)', () => {
  const entries = [entry('V1', 'ACTIVE', true), entry('V3', 'ACTIVE'), entry('V4', 'ACTIVE'), entry('V5', 'DRAFT')]

  it('Given a new default, then exactly one entry holds the flag', () => {
    const next = withDefault(entries, 'V4')
    expect(next.filter((e) => e.isDefault).map((e) => e.code)).toEqual(['V4'])
    expect(defaultVersion(next)?.code).toBe('V4')
  })

  it('Given a Draft or Deprecated version, then it cannot become the default', () => {
    expect(setDefaultError(entry('V5', 'DRAFT'))).toBe('Only an Active version can be the default.')
    expect(setDefaultError(entry('V3', 'ACTIVE'))).toBeUndefined()
  })

  it('Given flow creation, then Active for everyone; Internal testing for internal users only; Limited release also for listed merchants (DEC-56)', () => {
    const all = [...entries, entry('V2X', 'DEPRECATED'), entry('V6', 'INTERNAL_TESTING'), { ...entry('V7', 'LIMITED_RELEASE'), accessMerchantIds: ['mer_a'] }]
    const codes = (who: { internal: boolean; merchantId?: string }) => selectableForNewFlow(all, who).map((e) => e.code)
    expect(codes({ internal: false, merchantId: 'mer_b' })).toEqual(['V1', 'V3', 'V4'])
    expect(codes({ internal: false, merchantId: 'mer_a' })).toEqual(['V1', 'V3', 'V4', 'V7'])
    expect(codes({ internal: true })).toEqual(['V1', 'V3', 'V4', 'V6', 'V7'])
  })
})

describe('registry: Internal testing is hidden from merchants (DEC-56)', () => {
  it('Given a flow on an Internal testing version, then internal only; on any other status (or an unknown version), not', () => {
    expect(internalOnlyFlow('INTERNAL_TESTING')).toBe(true)
    for (const s of ['DRAFT', 'LIMITED_RELEASE', 'ACTIVE', 'DEPRECATED', undefined] as const) expect(internalOnlyFlow(s)).toBe(false)
  })

  it('Given a session that was not charged (run on Internal testing), then internal only; a charged one is not', () => {
    expect(internalOnlySession({ charged: false })).toBe(true)
    expect(internalOnlySession({ charged: true })).toBe(false)
  })
})
