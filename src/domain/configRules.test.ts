import { describe, expect, it } from 'vitest'
import { config } from '@/test/factories'
import { bumpMinor, diffConfig, validateConfig } from './configRules'
import type { MerchantConfig } from './types'

const withPhase = (cfg: MerchantConfig, phase: string, patch: object): MerchantConfig => ({
  ...cfg,
  phases: cfg.phases.map((p) => (p.phase === phase ? { ...p, ...patch } : p)),
})

describe('validateConfig (DEC-53)', () => {
  it('Given the defaults, then no errors', () => {
    expect(validateConfig(config())).toEqual([])
  })

  it('Given Auto-Reject equal to Auto-Pass, then an error on autoReject', () => {
    expect(validateConfig(withPhase(config(), 'FACE_MATCH', { autoPass: 80, autoReject: 80 }))).toEqual([
      { field: 'phases.FACE_MATCH.autoReject', message: 'Auto-Reject must be lower than Auto-Pass.' },
    ])
  })

  it('Given Auto-Pass above 100, then an error', () => {
    expect(validateConfig(withPhase(config(), 'LIVENESS', { autoPass: 101 })).map((e) => e.field)).toEqual(['phases.LIVENESS.autoPass'])
  })

  it('Given max attempts 0 and negative cooldown, then two errors', () => {
    expect(validateConfig(withPhase(config(), 'SELFIE', { maxAttempts: 0, cooldownSec: -1 })).map((e) => e.field)).toEqual([
      'phases.SELFIE.maxAttempts',
      'phases.SELFIE.cooldownSec',
    ])
  })

  it('Given a claim warning not shorter than the timeout, then an error', () => {
    expect(validateConfig(config({ claimTimeoutMin: 5, claimWarningMin: 5 })).map((e) => e.field)).toEqual(['claimWarningMin'])
  })
})

describe('diffConfig', () => {
  it('Given Face Match Auto-Pass 85 → 88 and timeout 30 → 20, then exactly those two changes', () => {
    const base = config()
    const draft = { ...withPhase(base, 'FACE_MATCH', { autoPass: 88 }), claimTimeoutMin: 20 }
    expect(diffConfig(base, draft)).toEqual([
      { field: 'phases.FACE_MATCH.autoPass', from: 85, to: 88 },
      { field: 'claimTimeoutMin', from: 30, to: 20 },
    ])
  })

  it('Given no changes, then an empty diff (Deploy disabled)', () => {
    expect(diffConfig(config(), config())).toEqual([])
  })
})

describe('bumpMinor (DEC-51)', () => {
  it('v1.2.0 → v1.3.0', () => expect(bumpMinor('v1.2.0')).toBe('v1.3.0'))
  it('v1.9.4 → v1.10.0', () => expect(bumpMinor('v1.9.4')).toBe('v1.10.0'))
  it('rejects a malformed version', () => expect(() => bumpMinor('1.2')).toThrow())
})
