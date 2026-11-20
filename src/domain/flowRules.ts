// Project and flow lifecycle (DEC-26, DEC-51, DEC-92 … DEC-94). Settings validation and presets: flowSettings.ts.
import type { Flow, Project, RegistryEntry, RuleError, VerificationStatus } from './types'

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

export function retireError(flow: Pick<Flow, 'flowId' | 'status'>, project: Pick<Project, 'defaultFlowId'>): string | undefined {
  if (flow.status !== 'ACTIVE') return 'Only an active flow can be retired.'
  if (project.defaultFlowId === flow.flowId) return 'Choose a new default flow before retiring this one.'
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

export function setDefaultFlowError(project: Pick<Project, 'projectId' | 'defaultFlowId'>, flow: Pick<Flow, 'flowId' | 'projectId' | 'status'>): string | undefined {
  if (flow.projectId !== project.projectId) return 'This flow belongs to another project.'
  if (project.defaultFlowId === flow.flowId) return 'This flow is already the default.'
  if (flow.status !== 'ACTIVE') return 'Only an active flow can be the default.'
  return undefined
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

// REQ: DEC-26 — after a rejection, the same end user may start a new case only from this time. Who counts as "the same
// end user", and whether the wait covers one flow or the whole project, is OQ-22.
export function newCaseAllowedAt(rejectedAt: string, cooldownMin: number): Date | undefined {
  if (!(cooldownMin > 0)) return undefined
  return new Date(new Date(rejectedAt).getTime() + cooldownMin * 60_000)
}

export function inCooldown(rejectedAt: string, cooldownMin: number, now: Date): boolean {
  const until = newCaseAllowedAt(rejectedAt, cooldownMin)
  return !!until && now < until
}
