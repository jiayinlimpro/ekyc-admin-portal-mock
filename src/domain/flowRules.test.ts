import { describe, expect, it } from 'vitest'
import {
  activate,
  activateError,
  archiveError,
  duplicateFlow,
  inCooldown,
  newCaseAllowedAt,
  retire,
  retireError,
  revisionLabel,
  setDefaultFlowError,
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
  defaultFlowId: fx('FLW-0001'),
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
  workflowVersion: 'V4',
  status: 'ACTIVE',
  settings: {
    checks: { FACE_MATCH: { threshold: { preset: 'STANDARD' }, retriesAllowed: 3 }, LIVENESS: { threshold: { preset: 'HIGH' }, retriesAllowed: 3 } },
    cooldownMin: 0,
    acceptedDocuments: ['PASSPORT'],
    sessionExpiryMin: 30,
    risk: { enabled: true, minimums: { EXIF: 50, NOISE: 50, EMAIL_VALIDITY: 50, OSINT: 50 } },
  },
  revision: 3,
  routing: { kind: 'RULE', priority: 1, summary: 'nationality ≠ MYS' },
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  updatedBy: OWNER,
  ...overrides,
})

const V4 = { code: 'V4', status: 'ACTIVE' as const }

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
    expect(activateError(draft, project(), V4)).toBeUndefined()
    const active = activate(draft, NOW, OWNER)
    expect(active).toMatchObject({ status: 'ACTIVE', revision: 1 })
    expect(revisionLabel(active)).toBe('V4-R1')
    expect(versionLocked(active)).toBe(true)
  })

  it('Given a deprecated or draft version, or an archived project, then activation is refused', () => {
    const draft = flow({ status: 'DRAFT', revision: 0 })
    expect(activateError(draft, project(), { code: 'V3', status: 'DEPRECATED' })).toBe('Workflow version V3 is deprecated; create a new flow on an active version.')
    expect(activateError(draft, project(), { code: 'V5', status: 'DRAFT' })).toMatch(/V5 is draft/)
    expect(activateError(draft, project({ status: 'ARCHIVED' }), V4)).toMatch(/archived/)
  })

  it('Given a re-activated flow, then its revision is kept', () => {
    expect(activate(flow({ status: 'INACTIVE', revision: 3 }), NOW, OWNER).revision).toBe(3)
  })

  it('Given the default flow, when retiring, then refused until a new default is chosen', () => {
    expect(retireError(flow({ flowId: fx('FLW-0001') }), project())).toBe('Choose a new default flow before retiring this one.')
    expect(retireError(flow(), project())).toBeUndefined()
  })

  it('Given in-flight cases, when retired, then Retiring until the last case is decided, then Inactive by SYSTEM', () => {
    const retiring = retire(flow(), 2, NOW, OWNER)
    expect(retiring.status).toBe('RETIRING')
    expect(settleRetiring(retiring, 1, NOW)).toBe(retiring)
    expect(settleRetiring(retiring, 0, NOW)).toMatchObject({ status: 'INACTIVE', updatedBy: { userId: 'SYSTEM' } })
    expect(retire(flow(), 0, NOW, OWNER).status).toBe('INACTIVE')
  })

  it('Given set as default, then only an active flow of the same project', () => {
    expect(setDefaultFlowError(project(), flow())).toBeUndefined()
    expect(setDefaultFlowError(project(), flow({ status: 'DRAFT' }))).toBe('Only an active flow can be the default.')
    expect(setDefaultFlowError(project(), flow({ projectId: fx('PRJ-0002') }))).toBe('This flow belongs to another project.')
  })

  it('Given a duplicate, then a Draft copy with no revision, no routing and independent settings', () => {
    const src = flow()
    const copy = duplicateFlow(src, fx('FLW-0003'), NOW, OWNER)
    expect(copy).toMatchObject({ flowId: fx('FLW-0003'), name: 'Foreigner onboarding (copy)', status: 'DRAFT', revision: 0, routing: { kind: 'NONE' } })
    copy.settings.cooldownMin = 60
    expect(src.settings.cooldownMin).toBe(0)
  })
})

describe('cooldown after rejection (DEC-26)', () => {
  const rejectedAt = '2026-10-20T01:00:00.000Z'

  it('Given cooldown 0, then a new case is allowed straight away', () => {
    expect(newCaseAllowedAt(rejectedAt, 0)).toBeUndefined()
    expect(inCooldown(rejectedAt, 0, NOW)).toBe(false)
  })

  it('Given cooldown 120 min, then a new case is allowed only from rejection + 120 min', () => {
    expect(newCaseAllowedAt(rejectedAt, 120)?.toISOString()).toBe('2026-10-20T03:00:00.000Z')
    expect(inCooldown(rejectedAt, 120, NOW)).toBe(true)
    expect(inCooldown(rejectedAt, 120, new Date('2026-10-20T03:00:00.000Z'))).toBe(false)
  })
})
