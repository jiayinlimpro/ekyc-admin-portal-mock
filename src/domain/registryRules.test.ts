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
  releaseNote: 'First registration',
  ...overrides,
})

const entry = (code: string, status: RegistryStatus, isDefault = false): RegistryEntry => ({
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

describe('registry: status lifecycle (DEC-56)', () => {
  it('Given Draft → Active, Draft → Deprecated, Active → Deprecated, Deprecated → Active, then allowed with a reason', () => {
    expect(statusChangeError(entry('V5', 'DRAFT'), 'ACTIVE', 'Released')).toBeUndefined()
    expect(statusChangeError(entry('V5', 'DRAFT'), 'DEPRECATED', 'Withdrawn')).toBeUndefined()
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DEPRECATED', 'Replaced by V4')).toBeUndefined()
    expect(statusChangeError(entry('V3', 'DEPRECATED'), 'ACTIVE', 'Re-activated')).toBeUndefined()
  })

  it('Given any move back to Draft, then refused', () => {
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DRAFT', 'x')).toBe('A version cannot go back to Draft.')
  })

  it('Given no reason, or activation without both state machine refs, then refused', () => {
    expect(statusChangeError(entry('V3', 'ACTIVE'), 'DEPRECATED', '  ')).toBe('Reason for change is required.')
    expect(statusChangeError({ ...entry('V5', 'DRAFT'), stateMachineProduction: undefined }, 'ACTIVE', 'Go')).toBe('Add both state machine references before activating.')
  })

  it('Given the default version, when deprecating, then refused until another default is set (DEC-57)', () => {
    expect(statusChangeError(entry('V1', 'ACTIVE', true), 'DEPRECATED', 'Old')).toBe('Set another version as default before deprecating this version')
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

  it('Given flow creation, then only Active versions are offered — no Draft, no Deprecated (DEC-56)', () => {
    const list = selectableForNewFlow([...entries, entry('V2X', 'DEPRECATED')]).map((e) => e.code)
    expect(list).toEqual(['V1', 'V3', 'V4'])
  })
})
