// Project and flow lifecycle (DEC-26, DEC-51, DEC-92 … DEC-94). Settings validation and presets: flowSettings.ts.
import type { Flow, FlowSettings, Project, RegistryEntry, RuleError, VerificationStatus } from './types'

type By = Flow['updatedBy']

// ----- Projects -----------------------------------------------------------------------------------------------------

/** `others` = the merchant's other projects. Unique names per merchant are a mock rule (keeps the switcher unambiguous). */
export function validateProjectName(name: string, others: readonly Pick<Project, 'name'>[]): RuleError[] {
  const n = name.trim()
  if (!n) return [{ field: 'name', message: 'Project name is required' }]
  if (others.some((p) => p.name.trim().toLowerCase() === n.toLowerCase())) return [{ field: 'name', message: 'A project with this name already exists' }]
  return []
}

// REQ: DEC-93 — archive = no new sessions; existing cases stay reviewable. Never deleted.
export function archiveError(project: Pick<Project, 'projectId' | 'status' | 'isDefault'>, merchantProjects: readonly Pick<Project, 'projectId' | 'status'>[]): string | undefined {
  if (project.status === 'ARCHIVED') return 'This project is already archived.'
  const othersActive = merchantProjects.some((p) => p.projectId !== project.projectId && p.status === 'ACTIVE')
  if (project.isDefault && !othersActive) return "The Default project can't be archived while it is the merchant's only active project."
  return undefined
}

// ----- Flows --------------------------------------------------------------------------------------------------------

/** Cases not yet APPROVED or REJECTED. */
export const IN_FLIGHT_STATUSES: readonly VerificationStatus[] = ['PROCESSING', 'PENDING_REVIEW']

// REQ: DEC-51 — e.g. "V4-R3"; undefined while the flow has never been active.
export function revisionLabel(flow: Pick<Flow, 'workflowVersion' | 'revision'>): string | undefined {
  return flow.revision > 0 ? `${flow.workflowVersion}-R${flow.revision}` : undefined
}

// REQ: DEC-94 — the version is locked once the flow has been active; to change it, create a new flow.
export function versionLocked(flow: Pick<Flow, 'revision'>): boolean {
  return flow.revision > 0
}

/** Settings validity (flowSettings.validateFlow) is checked separately by the service before activating. */
export function activateError(
  flow: Pick<Flow, 'status'>,
  project: Pick<Project, 'status'>,
  version: Pick<RegistryEntry, 'code' | 'status'> | undefined,
): string | undefined {
  if (flow.status === 'ACTIVE') return 'This flow is already active.'
  if (project.status === 'ARCHIVED') return 'This project is archived, so its flows cannot take new sessions.'
  if (!version) return 'Unknown workflow version.'
  if (version.status !== 'ACTIVE') return `Workflow version ${version.code} is ${version.status.toLowerCase()}; create a new flow on an active version.`
  return undefined
}

/** First activation creates revision R1 (DEC-51); re-activating keeps the current revision. */
export function activate(flow: Flow, now: Date, by: By): Flow {
  return { ...flow, status: 'ACTIVE', revision: Math.max(flow.revision, 1), updatedAt: now.toISOString(), updatedBy: by }
}

// REQ: DEC-94 / DEC-95 — any Active flow can be retired; new sessions sent with its Flow ID are refused from then on.
export function retireError(flow: Pick<Flow, 'status'>): string | undefined {
  if (flow.status !== 'ACTIVE') return 'Only an active flow can be retired.'
  return undefined
}

/** Retiring with cases still in flight → RETIRING (finishes those cases only); otherwise straight to INACTIVE. */
export function retire(flow: Flow, inFlight: number, now: Date, by: By): Flow {
  return { ...flow, status: inFlight > 0 ? 'RETIRING' : 'INACTIVE', updatedAt: now.toISOString(), updatedBy: by }
}

/** RETIRING → INACTIVE once its last in-flight case is decided. Returns the same object when nothing changes. */
export function settleRetiring(flow: Flow, inFlight: number, now: Date): Flow {
  if (flow.status !== 'RETIRING' || inFlight > 0) return flow
  return { ...flow, status: 'INACTIVE', updatedAt: now.toISOString(), updatedBy: { userId: 'SYSTEM', fullName: 'SYSTEM' } }
}

/** A copy starts as Draft with no revision; its version can still be changed until first activated. */
export function duplicateFlow(flow: Flow, flowId: string, now: Date, by: By): Flow {
  return {
    ...flow,
    flowId,
    name: `${flow.name} (copy)`,
    status: 'DRAFT',
    revision: 0,
    settings: structuredClone(flow.settings),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    updatedBy: by,
  }
}

// ----- Cooldown -----------------------------------------------------------------------------------------------------

// REQ: DEC-26 / DEC-112 — the case's status picks the cooldown, not the phase: Rejected (also a reviewer's reject) or
// Failed. No cooldown for the other statuses.
export function cooldownFor(status: VerificationStatus, settings: Pick<FlowSettings, 'cooldownMin' | 'failedCooldownMin'>): number {
  if (status === 'REJECTED') return settings.cooldownMin
  if (status === 'FAILED') return settings.failedCooldownMin
  return 0
}

// REQ: DEC-26 / DEC-113 — the same Reference ID may start a new session on the case only from this time.
export function newSessionAllowedAt(endedAt: string, cooldownMin: number): Date | undefined {
  if (!(cooldownMin > 0)) return undefined
  return new Date(new Date(endedAt).getTime() + cooldownMin * 60_000)
}

export function inCooldown(endedAt: string, cooldownMin: number, now: Date): boolean {
  const until = newSessionAllowedAt(endedAt, cooldownMin)
  return !!until && now < until
}
