import { describe, expect, it } from 'vitest'
import { advancedErrors, createFlow, diffFlow, newFlowSettings, saveFlow, validateFlow } from './flowSettings'
import type { Flow, FlowSettings, RegistryEntry } from './types'

const NOW = new Date('2026-10-20T02:00:00.000Z')
const OWNER = { userId: 'USR-2026-0002', fullName: 'Tan Mei Ling' }
const V4: Pick<RegistryEntry, 'code' | 'phases' | 'configurableChecks'> = { code: 'V4', phases: ['ID_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'], configurableChecks: ['FACE_MATCH', 'LIVENESS'] }
const V1: typeof V4 = { code: 'V1', phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK'], configurableChecks: ['FACE_MATCH', 'LIVENESS'] }

const complete = (s: FlowSettings): FlowSettings => ({ ...s, acceptedDocuments: ['MYKAD'], sessionExpiryMin: 30 })
const draft = () => createFlow({ flowId: 'FLW-0009', project: { projectId: 'PRJ-0001', merchantId: 'MER-0001' } }, { name: ' Malaysian onboarding ', description: '' }, V4, NOW, OWNER)
const active = (): Flow => ({ ...draft(), status: 'ACTIVE', revision: 2, settings: complete(draft().settings) })
const fields = (e: { field: string }[]) => e.map((x) => x.field)

describe('new flow (DEC-50, OQ-19)', () => {
  it('Given a new V4 flow, then Draft, no revision, Standard presets, 3 retries, no cooldown and risk on', () => {
    const f = draft()
    expect(f).toMatchObject({ name: 'Malaysian onboarding', status: 'DRAFT', revision: 0, workflowVersion: 'V4', routing: { kind: 'NONE' } })
    expect(f.settings.checks.LIVENESS).toEqual({ threshold: { preset: 'STANDARD' }, retriesAllowed: 3 })
    expect(f.settings.cooldownMin).toBe(0)
    expect(f.settings.risk).toEqual({ enabled: true, maxAllowedLevel: 'MEDIUM' })
    expect(newFlowSettings(V1).risk).toBeUndefined()
  })

  it('Given session expiry and accepted documents are open questions, then they start empty and are required', () => {
    expect(fields(validateFlow(draft(), V4))).toEqual(['sessionExpiryMin', 'acceptedDocuments'])
  })
})

describe('validation (DEC-53)', () => {
  it('Given Advanced values out of order or range, then the FRS messages', () => {
    const s = complete(draft().settings)
    s.checks.FACE_MATCH.threshold = { preset: 'ADVANCED', autoReject: 90, autoPass: 80 }
    s.checks.LIVENESS.threshold = { preset: 'ADVANCED', autoReject: Number.NaN, autoPass: 120 }
    expect(validateFlow({ name: 'x', settings: s }, V4).map((e) => e.message)).toEqual([
      'Auto-Reject threshold must be lower than Auto-Pass threshold',
      'Auto-Reject threshold is required',
      'Value must be between 0.00 and 100.00',
    ])
  })

  it('Given retries outside 1–5 or a negative cooldown, then errors (OQ-03)', () => {
    const s = complete(draft().settings)
    s.checks.FACE_MATCH.retriesAllowed = 0
    s.checks.LIVENESS.retriesAllowed = 6
    s.cooldownMin = -1
    expect(fields(validateFlow({ name: 'x', settings: s }, V4))).toEqual(['checks.FACE_MATCH.retriesAllowed', 'checks.LIVENESS.retriesAllowed', 'cooldownMin'])
  })
})

describe('Advanced is Platform Admin only (DEC-19)', () => {
  const base = complete(draft().settings)
  const adv = (autoReject: number, autoPass: number): FlowSettings => ({ ...base, checks: { ...base.checks, FACE_MATCH: { threshold: { preset: 'ADVANCED', autoReject, autoPass }, retriesAllowed: 3 } } })

  it('Given a merchant user, when choosing Advanced, then refused; Platform Admin may', () => {
    expect(advancedErrors(base, adv(80, 92), false)[0]).toEqual({ field: 'checks.FACE_MATCH.threshold', message: 'Only Platform Admin can set Advanced thresholds' })
    expect(advancedErrors(base, adv(80, 92), true)).toEqual([])
  })

  it('Given Advanced set by the platform, then a merchant user may keep it or switch back to a preset, but not change the numbers', () => {
    const set = adv(80, 92)
    expect(advancedErrors(set, set, false)).toEqual([])
    expect(advancedErrors(set, base, false)).toEqual([])
    expect(advancedErrors(set, adv(80, 93), false)).toHaveLength(1)
  })
})

describe('save with revision (DEC-51, DEC-52)', () => {
  const ctx = { entry: V4, canSetAdvanced: false, reason: '' }

  it('Given a Draft, then it saves without a reason and without a revision, even when incomplete', () => {
    const f = draft()
    const r = saveFlow(f, { ...f, description: 'Malaysians with MyKad' }, ctx, NOW, OWNER)
    expect('flow' in r && r.flow.revision).toBe(0)
  })

  it('Given an Active flow, when saved without a 10-character reason, then refused', () => {
    const f = active()
    const next = { ...f, settings: { ...f.settings, cooldownMin: 60 } }
    const r = saveFlow(f, next, { ...ctx, reason: 'too short' }, NOW, OWNER)
    expect('errors' in r && fields(r.errors)).toEqual(['reason'])
  })

  it('Given an Active flow with a reason, then the next revision and old → new changes', () => {
    const f = active()
    const settings = { ...f.settings, checks: { ...f.settings.checks, LIVENESS: { threshold: { preset: 'HIGH' as const }, retriesAllowed: 2 } } }
    const r = saveFlow(f, { ...f, settings }, { ...ctx, reason: 'Tighten liveness after spoof attempts' }, NOW, OWNER)
    if (!('flow' in r)) throw new Error(JSON.stringify(r.errors))
    expect(r.flow.revision).toBe(3)
    expect(r.changes).toEqual([
      { field: 'checks.LIVENESS.threshold', from: 'Standard (reject < 70, approve ≥ 85)', to: 'High (reject < 80, approve ≥ 92)' },
      { field: 'checks.LIVENESS.retriesAllowed', from: '3', to: '2' },
    ])
  })

  it('Given no changes, or a retiring flow, then nothing is saved', () => {
    const f = active()
    expect(fields((saveFlow(f, f, { ...ctx, reason: 'nothing changed here' }, NOW, OWNER) as { errors: [] }).errors)).toEqual(['form'])
    expect(fields((saveFlow({ ...f, status: 'RETIRING' }, f, ctx, NOW, OWNER) as { errors: [] }).errors)).toEqual(['status'])
  })

  it('Given a diff, then accepted documents compare as a set', () => {
    const f = active()
    expect(diffFlow(f, { ...f, settings: { ...f.settings, acceptedDocuments: ['PASSPORT', 'MYKAD'] } })).toEqual([{ field: 'acceptedDocuments', from: 'MYKAD', to: 'MYKAD, PASSPORT' }])
  })
})
