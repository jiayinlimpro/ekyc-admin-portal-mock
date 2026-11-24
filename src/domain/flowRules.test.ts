import { describe, expect, it } from 'vitest'
import {
  activate,
  activateError,
  archiveError,
  duplicateFlow,
  cooldownFor,
  inCooldown,
  newSessionAllowedAt,
  retire,
  retireError,
  revisionLabel,
  settleRetiring,
  validateProjectName,
  versionLocked,
} from './flowRules'
import type { Flow, Project } from './types'
import { fx } from '@/lib/ids'

const NOW = new Date('2026-10-20T02:00:00.000Z')
const OWNER = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }

const project = (overrides: Partial<Project> = {}): Project => ({
  projectId: fx('PRJ-0001'),
  merchantId: fx('MER-0001'),
  name: 'Default',
  status: 'ACTIVE',
  isDefault: true,
  claimTimeoutSec: 30 * 60,
  createdAt: NOW.toISOString(),
  createdBy: 'SYSTEM',
  branding: {},
  redirectUrls: [],
  allowedOrigins: [],
  ipAllowlist: [],
  decisionReasons: { disabledSystemCodes: [], custom: [] },
  ...overrides,
})

const flow = (overrides: Partial<Flow> = {}): Flow => ({
  flowId: fx('FLW-0002'),
  projectId: fx('PRJ-0001'),
  merchantId: fx('MER-0001'),
  name: 'Foreigner onboarding',
  description: 'Passport holders',
  workflowVersion: 'W4',
  status: 'ACTIVE',
  settings: {
    checks: { FACE_MATCH: { threshold: { preset: 'STANDARD' } }, LIVENESS: { threshold: { preset: 'HIGH' } } },
    retries: { DOCUMENT: 3, SELFIE: 3, LIVENESS: 3 },
    cooldownMin: 0,
    unsuccessfulCooldownMin: 0,
    acceptedDocuments: ['PASSPORT'],
    sessionExpiryMin: 30,
    risk: { enabled: true, minimums: { EXIF: 50, NOISE: 50, EMAIL_VALIDITY: 50, OSINT: 50 } },
  },
  revision: 3,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  updatedBy: OWNER,
  ...overrides,
})

const W4 = { code: 'W4', status: 'ACTIVE' as const }

describe('projects (DEC-93)', () => {
  it('Given an empty or duplicate name, then refused', () => {
    expect(validateProjectName('  ', [])[0].message).toBe('Project name is required')
    expect(validateProjectName('retail app', [{ name: 'Retail App' }])[0].message).toBe('A project with this name already exists')
    expect(validateProjectName('SME app', [{ name: 'Retail App' }])).toEqual([])
  })

  it("Given the Default project is the merchant's only active project, then it cannot be archived", () => {
    const def = project()
    expect(archiveError(def, [def])).toBe("The Default project can't be archived while it is the merchant's only active project.")
    expect(archiveError(def, [def, project({ projectId: fx('PRJ-0002'), isDefault: false })])).toBeUndefined()
    expect(archiveError(project({ status: 'ARCHIVED' }), [])).toBe('This project is already archived.')
  })
})

describe('flow lifecycle (DEC-94, DEC-51)', () => {
  it('Given a Draft flow on an active version, when activated, then Active with revision R1 and the version locks', () => {
    const draft = flow({ status: 'DRAFT', revision: 0 })
    expect(revisionLabel(draft)).toBeUndefined()
    expect(versionLocked(draft)).toBe(false)
    expect(activateError(draft, project(), W4)).toBeUndefined()
    const active = activate(draft, NOW, OWNER)
    expect(active).toMatchObject({ status: 'ACTIVE', revision: 1 })
    expect(revisionLabel(active)).toBe('W4-R1')
    expect(versionLocked(active)).toBe(true)
  })

  it('Given a deprecated or draft version, or an archived project, then activation is refused', () => {
    const draft = flow({ status: 'DRAFT', revision: 0 })
    expect(activateError(draft, project(), { code: 'W3', status: 'DEPRECATED' })).toBe('Workflow version W3 is deprecated; create a new flow on an active version.')
    expect(activateError(draft, project(), { code: 'W5', status: 'DRAFT' })).toMatch(/W5 is draft/)
    expect(activateError(draft, project({ status: 'ARCHIVED' }), W4)).toMatch(/archived/)
  })

  it('Given a re-activated flow, then its revision is kept', () => {
    expect(activate(flow({ status: 'INACTIVE', revision: 3 }), NOW, OWNER).revision).toBe(3)
  })

  it('Given any Active flow, when retiring, then allowed (no default flow, DEC-95); a Draft or Inactive one is refused', () => {
    expect(retireError(flow({ flowId: fx('FLW-0001') }))).toBeUndefined()
    expect(retireError(flow({ status: 'DRAFT' }))).toBe('Only an active flow can be retired.')
    expect(retireError(flow({ status: 'INACTIVE' }))).toBe('Only an active flow can be retired.')
  })

  it('Given in-flight cases, when retired, then Retiring until the last case is decided, then Inactive by SYSTEM', () => {
    const retiring = retire(flow(), 2, NOW, OWNER)
    expect(retiring.status).toBe('RETIRING')
    expect(settleRetiring(retiring, 1, NOW)).toBe(retiring)
    expect(settleRetiring(retiring, 0, NOW)).toMatchObject({ status: 'INACTIVE', updatedBy: { userId: 'SYSTEM' } })
    expect(retire(flow(), 0, NOW, OWNER).status).toBe('INACTIVE')
  })

  it('Given a duplicate, then a Draft copy with no revision and independent settings', () => {
    const src = flow()
    const copy = duplicateFlow(src, fx('FLW-0003'), NOW, OWNER)
    expect(copy).toMatchObject({ flowId: fx('FLW-0003'), name: 'Foreigner onboarding (copy)', status: 'DRAFT', revision: 0 })
    copy.settings.cooldownMin = 60
    expect(src.settings.cooldownMin).toBe(0)
  })
})

describe('cooldowns after Rejected and after Unsuccessful (DEC-26, DEC-112)', () => {
  const rejectedAt = '2026-10-20T01:00:00.000Z'

  it('Given cooldown 0, then a new session is allowed straight away', () => {
    expect(newSessionAllowedAt(rejectedAt, 0)).toBeUndefined()
    expect(inCooldown(rejectedAt, 0, NOW)).toBe(false)
  })

  it('Given cooldown 120 min, then a new session is allowed only from the end + 120 min', () => {
    expect(newSessionAllowedAt(rejectedAt, 120)?.toISOString()).toBe('2026-10-20T03:00:00.000Z')
    expect(inCooldown(rejectedAt, 120, NOW)).toBe(true)
    expect(inCooldown(rejectedAt, 120, new Date('2026-10-20T03:00:00.000Z'))).toBe(false)
  })

  it('Given a flow with both cooldowns, then the case status picks one, whatever the phase; other statuses have none', () => {
    const s = { cooldownMin: 120, unsuccessfulCooldownMin: 30 }
    expect(cooldownFor('REJECTED', s)).toBe(120) // incl. a W1 face mismatch and a reviewer's reject
    expect(cooldownFor('UNSUCCESSFUL', s)).toBe(30) // a document or W1 selfie with no usable image
    for (const st of ['PROCESSING', 'PENDING_REVIEW', 'APPROVED'] as const) expect(cooldownFor(st, s)).toBe(0)
  })
})
