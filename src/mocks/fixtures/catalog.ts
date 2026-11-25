// Registry, projects and flows (DEC-56 … DEC-58, DEC-90 … DEC-95). Dates are relative to seeding (MOCK-05).
// Coverage: every flow status, Advanced thresholds set by Super admin, a revision history,
// an archived project, and a merchant with two projects.
import { diffFlow, newFlowSettings } from '@/domain/flowSettings'
import { DEFAULT_RISK_MINIMUMS } from '@/domain/openQuestions'
import { readDefinition } from '@/domain/registryRules'
import { PROJECT_SETTING_DEFAULTS } from '@/domain/projectSettings'
import type { DocumentType, Flow, FlowRevision, FlowSettings, FlowStatus, Project, RegistryEntry, RiskScores, ThresholdChoice } from '@/domain/types'
import { fx, stableId } from '@/lib/ids'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const ADMIN = { userId: fx('USR-2026-0001'), fullName: 'Lim Wei Jie' }
const SYSTEM = { userId: 'SYSTEM' as const, fullName: 'SYSTEM' as const }

export function buildRegistry(now: Date): RegistryEntry[] {
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString()
  // REQ: DEC-115 — each version is its code, a name and the workflow JSON from the backend; the rest is read from the JSON.
  const entry = (e: Pick<RegistryEntry, 'code' | 'name' | 'status' | 'isDefault'> & Partial<Pick<RegistryEntry, 'accessMerchantIds'>>, days: number, steps: string[], tunable: string[]): RegistryEntry => {
    const definition = JSON.stringify({ workflowCode: e.code, steps, tunable }, null, 2)
    return {
      entryId: stableId('wfv', e.code),
      accessMerchantIds: [],
      ...e,
      definition,
      ...readDefinition(definition, e.code).definition!,
      activatedAt: e.status === 'LIMITED_RELEASE' || e.status === 'ACTIVE' || e.status === 'DEPRECATED' ? ago(days) : undefined,
      registeredAt: ago(days),
      registeredBy: ADMIN.fullName,
      updatedAt: ago(days),
      updatedBy: ADMIN.fullName,
    }
  }
  const THRESHOLDS = ['FACE_MATCH', 'LIVENESS']
  // REQ: DEC-58 — FRS initial records.
  return [
    entry({ code: 'W1', name: 'ID + Selfie + Liveness', status: 'ACTIVE', isDefault: true }, 400, ['DOCUMENT', 'SELFIE', 'LIVENESS'], THRESHOLDS),
    entry({ code: 'W3', name: 'ID + Liveness', status: 'ACTIVE', isDefault: false }, 300, ['DOCUMENT', 'LIVENESS'], THRESHOLDS),
    entry({ code: 'W4', name: 'ID + Liveness + Risk Assessment', status: 'ACTIVE', isDefault: false }, 300, ['DOCUMENT', 'LIVENESS', 'RISK'], THRESHOLDS),
    // REQ: DEC-107 / DEC-56 — W5 = W4 with the risk minimums set per flow; Limited release to Atoz.
    entry({ code: 'W5', name: 'ID + Liveness + component risk', status: 'LIMITED_RELEASE', accessMerchantIds: [fx('MER-0001')], isDefault: false }, 10, ['DOCUMENT', 'LIVENESS', 'RISK'], [...THRESHOLDS, 'RISK_MINIMUMS']),
    // REQ: DEC-56 — Internal testing: only super admins and platform staff can build flows on it; not charged.
    entry({ code: 'W6', name: 'ID + Liveness (next engine build)', status: 'INTERNAL_TESTING', isDefault: false }, 3, ['DOCUMENT', 'LIVENESS'], THRESHOLDS),
  ]
}

interface FlowSpec {
  flowId: string
  projectId: string
  name: string
  description: string
  version: 'W1' | 'W3' | 'W4' | 'W5' | 'W6'
  status: FlowStatus
  createdDaysAgo: number
  /** Saved revisions, oldest first: when (hours ago), who, why and the settings. Empty for a Draft. */
  revisions: { hoursAgo: number; by?: { userId: string; fullName: string }; reason: string; settings: FlowSettings }[]
  draftSettings?: FlowSettings
}

const preset = (p: 'LOW' | 'STANDARD' | 'HIGH'): ThresholdChoice => ({ preset: p })

function settings(o: { fm?: ThresholdChoice; l?: ThresholdChoice; retries?: number; cooldownMin?: number; unsuccessfulCooldownMin?: number; docs?: DocumentType[]; risk?: boolean | RiskScores }): FlowSettings {
  const r = o.retries ?? 3
  return {
    checks: { FACE_MATCH: { threshold: o.fm ?? preset('STANDARD') }, LIVENESS: { threshold: o.l ?? preset('STANDARD') } },
    retries: { DOCUMENT: 3, SELFIE: r, LIVENESS: r }, // REQ: DEC-108
    cooldownMin: o.cooldownMin ?? 0,
    unsuccessfulCooldownMin: o.unsuccessfulCooldownMin ?? 0, // REQ: DEC-26 / DEC-112
    acceptedDocuments: o.docs ?? ['MYKAD'],
    risk: o.risk ? { enabled: true, minimums: o.risk === true ? { ...DEFAULT_RISK_MINIMUMS } : o.risk } : undefined, // REQ: DEC-107
  }
}

interface ProjectSpec extends Omit<Project, 'createdAt' | 'createdBy' | keyof typeof PROJECT_SETTING_DEFAULTS>, Partial<Pick<Project, keyof typeof PROJECT_SETTING_DEFAULTS>> {
  createdDaysAgo: number
  createdBy: string
}

// Owners per merchant (see fixtures/users.ts). Default projects are created by SYSTEM with the merchant (DEC-92).
const PROJECTS: ProjectSpec[] = [
  {
    projectId: fx('PRJ-0001'), merchantId: fx('MER-0001'), name: 'Default', status: 'ACTIVE', isDefault: true, claimTimeoutSec: 1800, createdDaysAgo: 400, createdBy: 'SYSTEM',
    branding: { primaryColor: '#1D4ED8' }, language: 'en',
    // REQ: DEC-106 — the project's own reasons (codes generated when added).
    decisionReasons: {
      disabledSystemCodes: [],
      custom: [
        { code: 'CUSTOM_CUSTOMER_ON_INTERNAL_WATCHLIST', name: 'Customer on internal watchlist', outcome: 'REJECT', group: 'FRAUD_RISK', noteRequired: true, system: false, active: true },
        { code: 'CUSTOM_CONFIRMED_BY_VIDEO_CALL', name: 'Identity confirmed by video call', outcome: 'APPROVE', noteRequired: false, system: false, active: true },
      ],
    },
  },
  { projectId: fx('PRJ-0002'), merchantId: fx('MER-0001'), name: 'SME app', status: 'ACTIVE', isDefault: false, claimTimeoutSec: 2700, createdDaysAgo: 60, createdBy: 'Tan Mei Ling' },
  // Vantage onboards every nationality, so that System Default reason is off (DEC-106).
  { projectId: fx('PRJ-0003'), merchantId: fx('MER-0002'), name: 'Default', status: 'ACTIVE', isDefault: true, claimTimeoutSec: 1800, createdDaysAgo: 400, createdBy: 'SYSTEM', decisionReasons: { disabledSystemCodes: ['NATIONALITY_NOT_ACCEPTED'], custom: [] } },
  { projectId: fx('PRJ-0004'), merchantId: fx('MER-0003'), name: 'Default', status: 'ACTIVE', isDefault: true, claimTimeoutSec: 1800, createdDaysAgo: 300, createdBy: 'SYSTEM' },
  { projectId: fx('PRJ-0005'), merchantId: fx('MER-0004'), name: 'Default', status: 'ACTIVE', isDefault: true, claimTimeoutSec: 1200, createdDaysAgo: 300, createdBy: 'SYSTEM' },
  { projectId: fx('PRJ-0006'), merchantId: fx('MER-0005'), name: 'Default', status: 'ACTIVE', isDefault: true, claimTimeoutSec: 1800, createdDaysAgo: 250, createdBy: 'SYSTEM' },
  { projectId: fx('PRJ-0007'), merchantId: fx('MER-0005'), name: 'Wallet app', status: 'ACTIVE', isDefault: false, claimTimeoutSec: 1800, createdDaysAgo: 90, createdBy: 'Ng Chee Keong' },
  { projectId: fx('PRJ-0008'), merchantId: fx('MER-0005'), name: 'Pilot 2025', status: 'ARCHIVED', isDefault: false, claimTimeoutSec: 1800, createdDaysAgo: 240, createdBy: 'Ng Chee Keong' },
  { projectId: fx('PRJ-0009'), merchantId: fx('MER-0006'), name: 'Default', status: 'ACTIVE', isDefault: true, claimTimeoutSec: 1800, createdDaysAgo: 20, createdBy: 'SYSTEM' },
]

const OWNER_ATOZ = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }

const FLOWS: FlowSpec[] = [
  {
    flowId: fx('FLW-0001'), projectId: fx('PRJ-0001'), name: 'Malaysian onboarding', description: 'Malaysians with MyKad', version: 'W4', status: 'ACTIVE', createdDaysAgo: 400,
    revisions: [
      { hoursAgo: 120 * 24, reason: 'Flow activated', settings: settings({ fm: preset('LOW'), l: preset('LOW'), risk: true }) },
      { hoursAgo: 2, by: OWNER_ATOZ, reason: 'Tighten face match and liveness after a fraud review', settings: settings({ risk: true }) }, // S12 is still on R1
    ],
  },
  {
    flowId: fx('FLW-0002'), projectId: fx('PRJ-0001'), name: 'Foreigner onboarding', description: 'Passport holders', version: 'W4', status: 'ACTIVE', createdDaysAgo: 200,
    revisions: [{ hoursAgo: 200 * 24, by: OWNER_ATOZ, reason: 'Flow activated', settings: settings({ fm: preset('HIGH'), cooldownMin: 120, unsuccessfulCooldownMin: 30, docs: ['PASSPORT'], risk: true }) }],
  },
  {
    // REQ: DEC-107 — W5: this flow's own risk minimums (EXIF looser, Noise stricter, OSINT looser than the defaults).
    flowId: fx('FLW-0014'), projectId: fx('PRJ-0001'), name: 'Premium accounts', description: 'Premium customers, own risk minimums', version: 'W5', status: 'ACTIVE', createdDaysAgo: 9,
    revisions: [{ hoursAgo: 9 * 24, by: OWNER_ATOZ, reason: 'Flow activated', settings: settings({ fm: preset('HIGH'), risk: { EXIF: 40, NOISE: 60, EMAIL_VALIDITY: 50, OSINT: 30 } }) }],
  },
  {
    flowId: fx('FLW-0003'), projectId: fx('PRJ-0001'), name: 'Tourist onboarding', description: 'Short-stay visitors (draft)', version: 'W4', status: 'DRAFT', createdDaysAgo: 3,
    revisions: [], draftSettings: newFlowSettings({ phases: ['ID_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'] }),
  },
  {
    flowId: fx('FLW-0004'), projectId: fx('PRJ-0002'), name: 'SME director check', description: 'Directors of SME customers', version: 'W3', status: 'ACTIVE', createdDaysAgo: 60,
    revisions: [{ hoursAgo: 60 * 24, by: OWNER_ATOZ, reason: 'Flow activated', settings: settings({ retries: 2, docs: ['MYKAD', 'PASSPORT'] }) }],
  },
  {
    flowId: fx('FLW-0005'), projectId: fx('PRJ-0003'), name: 'Standard onboarding', description: 'All Vantage customers', version: 'W1', status: 'ACTIVE', createdDaysAgo: 400,
    revisions: [
      { hoursAgo: 120 * 24, reason: 'Flow activated', settings: settings({ docs: ['MYKAD', 'PASSPORT'] }) },
      { hoursAgo: 30 * 24, by: ADMIN, reason: 'Custom face match band agreed with Vantage risk team', settings: settings({ fm: { preset: 'ADVANCED', autoReject: 82, autoPass: 93 }, docs: ['MYKAD', 'PASSPORT', 'DRIVING_LICENSE'] }) },
    ],
  },
  {
    flowId: fx('FLW-0006'), projectId: fx('PRJ-0004'), name: 'Customer onboarding', description: 'All Tesla customers', version: 'W4', status: 'ACTIVE', createdDaysAgo: 300,
    revisions: [{ hoursAgo: 300 * 24, reason: 'Flow activated', settings: settings({ risk: true }) }],
  },
  {
    flowId: fx('FLW-0013'), projectId: fx('PRJ-0004'), name: 'Customer onboarding (strict)', description: 'A/B test of stricter thresholds', version: 'W4', status: 'ACTIVE', createdDaysAgo: 45,
    revisions: [{ hoursAgo: 45 * 24, by: { userId: fx('USR-2026-0052'), fullName: 'Wong Kah Heng' }, reason: 'Flow activated', settings: settings({ fm: preset('HIGH'), l: preset('HIGH'), risk: true }) }],
  },
  {
    flowId: fx('FLW-0007'), projectId: fx('PRJ-0005'), name: 'Standard onboarding', description: 'All Boring Company customers', version: 'W1', status: 'ACTIVE', createdDaysAgo: 300,
    revisions: [{ hoursAgo: 300 * 24, reason: 'Flow activated', settings: settings({}) }],
  },
  {
    flowId: fx('FLW-0008'), projectId: fx('PRJ-0005'), name: 'Express (pilot)', description: 'Pilot without selfie, being retired', version: 'W3', status: 'RETIRING', createdDaysAgo: 120,
    revisions: [{ hoursAgo: 120 * 24, by: { userId: fx('USR-2026-0063'), fullName: 'Farah Binti Ismail' }, reason: 'Flow activated', settings: settings({ l: preset('LOW') }) }],
  },
  {
    flowId: fx('FLW-0009'), projectId: fx('PRJ-0006'), name: 'Onboarding', description: 'All 3Nova customers', version: 'W4', status: 'ACTIVE', createdDaysAgo: 250,
    revisions: [{ hoursAgo: 250 * 24, reason: 'Flow activated', settings: settings({ risk: true }) }],
  },
  {
    flowId: fx('FLW-0010'), projectId: fx('PRJ-0007'), name: 'Wallet KYC', description: 'Wallet app sign-ups', version: 'W4', status: 'ACTIVE', createdDaysAgo: 90,
    revisions: [{ hoursAgo: 90 * 24, by: { userId: fx('USR-2026-0071'), fullName: 'Ng Chee Keong' }, reason: 'Flow activated', settings: settings({ docs: ['MYKAD', 'PASSPORT'], risk: true }) }],
  },
  {
    flowId: fx('FLW-0011'), projectId: fx('PRJ-0008'), name: 'Pilot flow', description: '2025 pilot (project archived)', version: 'W1', status: 'INACTIVE', createdDaysAgo: 240,
    revisions: [{ hoursAgo: 240 * 24, by: { userId: fx('USR-2026-0071'), fullName: 'Ng Chee Keong' }, reason: 'Flow activated', settings: settings({}) }],
  },
  {
    flowId: fx('FLW-0012'), projectId: fx('PRJ-0009'), name: 'First flow', description: 'Created with the merchant', version: 'W1', status: 'ACTIVE', createdDaysAgo: 20,
    revisions: [{ hoursAgo: 20 * 24, reason: 'Flow activated', settings: settings({}) }],
  },
  {
    // REQ: DEC-56 — built by the platform on the Internal testing W6: internal users see it; Atoz's own users never do.
    flowId: fx('FLW-0015'), projectId: fx('PRJ-0001'), name: 'Next engine trial', description: 'Platform test of W6 (internal only)', version: 'W6', status: 'ACTIVE', createdDaysAgo: 5,
    revisions: [{ hoursAgo: 5 * 24, by: ADMIN, reason: 'Internal test of the next engine build', settings: settings({}) }],
  },
]

export interface Catalog {
  registry: RegistryEntry[]
  projects: Project[]
  flows: Flow[]
  flowRevisions: FlowRevision[]
}

export function buildCatalog(now: Date): Catalog {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR).toISOString()
  const projects: Project[] = PROJECTS.map(({ createdDaysAgo, ...p }) => ({ ...structuredClone(PROJECT_SETTING_DEFAULTS), ...p, createdAt: at(createdDaysAgo * 24) }))
  const flowRevisions: FlowRevision[] = []
  const flows: Flow[] = FLOWS.map((s) => {
    const project = projects.find((p) => p.projectId === s.projectId)!
    s.revisions.forEach((r, i) => {
      const prev = s.revisions[i - 1]
      flowRevisions.push({
        revisionId: stableId('rev', `${s.flowId}:${i + 1}`),
        flowId: s.flowId,
        revision: i + 1,
        savedAt: at(r.hoursAgo),
        savedBy: r.by ?? SYSTEM,
        reason: r.reason,
        settings: r.settings,
        changes: prev ? diffFlow({ name: s.name, description: s.description, settings: prev.settings }, { name: s.name, description: s.description, settings: r.settings }) : [],
      })
    })
    const last = s.revisions.at(-1)
    return {
      flowId: s.flowId,
      projectId: s.projectId,
      merchantId: project.merchantId,
      name: s.name,
      description: s.description,
      workflowVersion: s.version,
      status: s.status,
      settings: structuredClone(last?.settings ?? s.draftSettings!),
      revision: s.revisions.length,
      createdAt: at(s.createdDaysAgo * 24),
      updatedAt: at(last?.hoursAgo ?? s.createdDaysAgo * 24),
      updatedBy: last?.by ?? (last ? SYSTEM : OWNER_ATOZ),
    }
  })
  return { registry: buildRegistry(now), projects, flows, flowRevisions }
}

/** The revision that was live when a session started (DEC-52). */
export function revisionAt(revisions: readonly FlowRevision[], flowId: string, when: string | Date): FlowRevision | undefined {
  const t = new Date(when).getTime()
  const own = revisions.filter((r) => r.flowId === flowId)
  return own.filter((r) => Date.parse(r.savedAt) <= t).at(-1) ?? own[0]
}
