import { describe, expect, it } from 'vitest'
import { defaultVersion, isLocked, selectableForNewFlow, setDefaultError, statusChangeError, validateRegistryInput, withDefault, type RegistryInput } from './registryRules'
import type { RegistryEntry, RegistryStatus } from './types'

const ARN = 'arn:aws:states:ap-southeast-1:123456789012:stateMachine:ekyc_v5'

const input = (overrides: Partial<RegistryInput> = {}): RegistryInput => ({
  code: 'V5',
  name: 'ID + Liveness + component risk',
  description: '',
  phases: ['ID_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'],
  faceMatchMethod: 'ID_VS_LIVENESS',
  requiredInputs: ['EMAIL'],
  configurableChecks: ['FACE_MATCH', 'LIVENESS'],
  riskMinimumsPerFlow: true,
  accessMerchantIds: [],
  releaseNote: 'First registration',
  ...overrides,
})

const entry = (code: string, status: RegistryStatus, isDefault = false): RegistryEntry => ({
  entryId: `wfv_test${code.toLowerCase().padStart(20, '0')}`,
  ...input({ code }),
  releaseNotes: [],
  stateMachineSandbox: ARN,
  stateMachineProduction: ARN,
  status,
  isDefault,
  activatedAt: status === 'DRAFT' ? undefined : '2026-01-01T00:00:00.000Z',
  registeredAt: '2026-01-01T00:00:00.000Z',
  registeredBy: 'Lim Wei Jie',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'Lim Wei Jie',
})

const fields = (i: RegistryInput, codes: string[] = []) => validateRegistryInput(i, codes).map((e) => e.field)

describe('registry: register and edit (FRS)', () => {
  it('Given risk minimums per flow without the Risk Assessment phase, then refused (DEC-107)', () => {
    expect(validateRegistryInput(input({ phases: ['ID_CAPTURE', 'LIVENESS_CHECK'] }), [])).toContainEqual({ field: 'riskMinimumsPerFlow', message: 'Risk minimums need the Risk Assessment phase' })
  })

  it('Given a complete V5, then no errors', () => {
    expect(validateRegistryInput(input(), ['V1', 'V3', 'V4'])).toEqual([])
  })

  it('Given a bad or reused code, then the FRS messages', () => {
    expect(validateRegistryInput(input({ code: 'v5x' }), [])[0].message).toBe('Workflow code must follow the format V<number>, e.g., V5')
    expect(validateRegistryInput(input({ code: 'V4' }), ['V4'])[0].message).toBe('Workflow code already exists')
  })

  it('Given phases without ID Capture first, or ID vs Selfie without a Selfie phase, then errors', () => {
    expect(fields(input({ phases: ['LIVENESS_CHECK'] }))).toContain('phases')
    expect(fields(input({ faceMatchMethod: 'ID_VS_SELFIE' }))).toContain('faceMatchMethod')
  })

  it('Given no thresholds, no release note or a malformed ARN, then errors', () => {
    expect(fields(input({ configurableChecks: [], releaseNote: ' ', stateMachineSandbox: 'not-an-arn' }))).toEqual(['configurableChecks', 'stateMachineSandbox', 'releaseNote'])
  })

  it('Given a version that has been Active, then only name, description, state machine refs and release notes stay editable', () => {
    const active = entry('V4', 'ACTIVE')
    expect(isLocked(active, 'phases')).toBe(true)
    expect(isLocked(active, 'configurableChecks')).toBe(true)
    expect(isLocked(active, 'name')).toBe(false)
    expect(isLocked(active, 'releaseNote')).toBe(false)
    expect(isLocked(entry('V5', 'DRAFT'), 'phases')).toBe(false)
  })
})

describe('registry: statuses, no lifecycle (DEC-56)', () => {
  it('Given any other status with a reason, then allowed, Draft and back included', () => {
    expect(statusChangeError(entry('V5', 'DRAFT'), 'INTERNAL_TESTING', 'Engine build ready')).toBeUndefined()
    expect(statusChangeError(entry('V5', 'INTERNAL_TESTING'), 'LIMITED_RELEASE', 'Pilot with Atoz')).toBeUndefined()
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DEPRECATED', 'Replaced by V4')).toBeUndefined()
    expect(statusChangeError(entry('V3', 'DEPRECATED'), 'DRAFT', 'Back to the drawing board')).toBeUndefined()
  })

  it('Given the same status, no reason, or a running status without both state machine refs, then refused', () => {
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'ACTIVE', 'x')).toBe('This version already has that status.')
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DEPRECATED', '  ')).toBe('Reason for change is required.')
    for (const to of ['INTERNAL_TESTING', 'LIMITED_RELEASE', 'ACTIVE'] as const) {
      expect(statusChangeError({ ...entry('V5', 'DRAFT'), stateMachineProduction: undefined }, to, 'Go'), to).toBe('Add both state machine references first.')
    }
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
