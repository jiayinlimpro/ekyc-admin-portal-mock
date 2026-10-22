// Flows API (mock). DEC-50 … DEC-53, DEC-75, DEC-94. Settings live on the flow; saving an Active flow creates a revision.
//   GET  /projects/{id}/flows          list       → 200 Flow[]
//   GET  /projects/{id}/flows/rows     listRows   → 200 FlowRow[] (Flows List)
//   GET  /flows/{id}                   get        → 200 FlowDetail
//   POST /projects/{id}/flows          create     → 201 Flow | 422 VALIDATION (version not selectable)
//   POST /flows/{id}/duplicate         duplicate  → 201 Flow
//   PUT  /flows/{id}                   save       → 200 Flow | 422 VALIDATION (RuleError[] in details)
//   POST /flows/{id}/activate          activate   → 200 Flow | 422 VALIDATION
//   POST /flows/{id}/retire            retire     → 200 Flow | 422 VALIDATION
//   POST /flows/{id}/default           setDefault → 200 Project | 422 VALIDATION
//   POST /flows/{id}/preview           preview    → 200 ImpactSummary (what-if, read-only; MOCK-10)
import { canInProject } from '@/domain/access'
import { flowImpact, type ImpactSummary } from '@/domain/flowImpact'
import { hasRisk } from '@/domain/registryRules'
import { activate, activateError, duplicateFlow, IN_FLIGHT_STATUSES, retire, retireError, setDefaultFlowError, settleRetiring } from '@/domain/flowRules'
import { createFlow, saveFlow, validateFlow } from '@/domain/flowSettings'
import { selectableForNewFlow } from '@/domain/registryRules'
import type { Actor, Flow, FlowRevision, Project, RegistryEntry, RegistryStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, projectById, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { auditProject, loadProject, requireInProject, validation } from './projectService'
import { newId } from '@/lib/ids'

export interface FlowDetail {
  flow: Flow
  revisions: FlowRevision[] // oldest first; "History" and each case's "Rules applied" (DEC-51, DEC-52)
  entry: RegistryEntry // the flow's workflow version: decides which settings apply (DEC-50)
  isDefault: boolean
  inFlightCases: number // PROCESSING + PENDING_REVIEW: a Retiring flow finishes these only
}

/** A row on the Flows List (DEC-94). */
export type FlowRow = Flow & {
  isDefault: boolean
  inFlightCases: number
  versionStatus: RegistryStatus // DEPRECATED shows a "version deprecated" warning (DEC-56)
}

export interface FlowEdit {
  name: string
  description: string
  settings: Flow['settings']
}

export interface FlowService {
  list(projectId: string, actor: Actor): Promise<Flow[]>
  listRows(projectId: string, actor: Actor): Promise<FlowRow[]>
  get(flowId: string, actor: Actor): Promise<FlowDetail>
  create(projectId: string, input: { name: string; description: string; workflowVersion: string }, actor: Actor): Promise<Flow>
  duplicate(flowId: string, actor: Actor): Promise<Flow>
  /** `reason` is required (min 10 characters) for an Active flow, ignored for a Draft. */
  save(flowId: string, next: FlowEdit, reason: string, actor: Actor): Promise<Flow>
  activate(flowId: string, actor: Actor): Promise<Flow>
  retire(flowId: string, actor: Actor): Promise<Flow>
  setDefault(flowId: string, actor: Actor): Promise<Project>
  /** What the edited settings would have done to this flow's finished sessions of the last `days` days. */
  preview(flowId: string, settings: Flow['settings'], actor: Actor, days?: number): Promise<ImpactSummary & { days: number }>
}

const by = (actor: Actor) => ({ userId: actor.userId, fullName: actor.fullName })
const entryOf = (code: string) => db.state().registry.find((e) => e.code === code)
const inFlight = (flowId: string) => db.state().verifications.filter((v) => v.flowId === flowId && IN_FLIGHT_STATUSES.includes(v.status)).length

// REQ: DEC-70 / DEC-75 — flows are managed with Manage flows, and by Super admin in any merchant.
function loadFlow(actor: Actor, flowId: string, action: 'viewFlows' | 'manageFlows' = 'manageFlows'): { flow: Flow; project: Project } {
  const flow = db.state().flows.find((f) => f.flowId === flowId)
  const project = flow && projectById(flow.projectId)
  if (!flow || !project) throw new ServiceError('NOT_FOUND', `Flow ${flowId} not found.`)
  loadProject(actor, project.projectId) // "not found" outside the user's projects
  requireInProject(actor, action, project, action === 'viewFlows' ? 'view flows' : 'manage flows')
  return { flow, project }
}

function putFlow(flow: Flow) {
  db.setState((st) => ({ flows: st.flows.map((f) => (f.flowId === flow.flowId ? flow : f)) }))
}

export const mockFlowService: FlowService = {
  async list(projectId, actor) {
    await simulateNetwork('list flows')
    const project = loadProject(actor, projectId)
    requireInProject(actor, 'viewFlows', project, 'view flows') // REQ: DEC-99 — read-only for Flows View
    return wire(db.state().flows.filter((f) => f.projectId === projectId))
  },

  async listRows(projectId, actor) {
    await simulateNetwork('list flow rows')
    const project = loadProject(actor, projectId)
    requireInProject(actor, 'viewFlows', project, 'view flows') // REQ: DEC-99 — read-only for Flows View
    const order = { ACTIVE: 0, DRAFT: 1, RETIRING: 2, INACTIVE: 3 } as const
    const rows = db
      .state()
      .flows.filter((f) => f.projectId === projectId)
      .map((f) => ({ ...f, isDefault: project.defaultFlowId === f.flowId, inFlightCases: inFlight(f.flowId), versionStatus: entryOf(f.workflowVersion)?.status ?? 'DEPRECATED' }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || order[a.status] - order[b.status] || a.name.localeCompare(b.name))
    return wire(rows)
  },

  async get(flowId, actor) {
    await simulateNetwork('get flow')
    const { flow, project } = loadFlow(actor, flowId, 'viewFlows')
    return wire({
      flow,
      revisions: db.state().flowRevisions.filter((r) => r.flowId === flowId).sort((a, b) => a.revision - b.revision),
      entry: entryOf(flow.workflowVersion)!,
      isDefault: project.defaultFlowId === flowId,
      inFlightCases: inFlight(flowId),
    })
  },

  // REQ: DEC-56 / DEC-94 — only Active registry versions can be picked; the new flow starts as Draft on Standard.
  async create(projectId, input, actor) {
    await simulateNetwork('create flow')
    requireActive(actor)
    const project = loadProject(actor, projectId)
    requireInProject(actor, 'manageFlows', project, 'manage flows')
    if (project.status === 'ARCHIVED') throw validation([{ field: 'form', message: 'This project is archived, so it cannot get new flows.' }])
    const entry = selectableForNewFlow(db.state().registry).find((e) => e.code === input.workflowVersion)
    if (!entry) throw validation([{ field: 'workflowVersion', message: 'Choose an active workflow version.' }])
    if (!input.name.trim()) throw validation([{ field: 'name', message: 'Flow name is required' }])
    const at = now()
    const flow = createFlow({ flowId: newId('flw'), project }, input, entry, at, by(actor))
    db.setState((st) => ({ flows: [...st.flows, flow] }))
    auditProject(actor, 'FLOW_CREATED', project, { flowId: flow.flowId, name: flow.name, workflowVersion: flow.workflowVersion }, at)
    return wire(flow)
  },

  async duplicate(flowId, actor) {
    await simulateNetwork('duplicate flow')
    requireActive(actor)
    const { flow, project } = loadFlow(actor, flowId)
    if (project.status === 'ARCHIVED') throw validation([{ field: 'form', message: 'This project is archived, so it cannot get new flows.' }])
    const at = now()
    const copy = duplicateFlow(flow, newId('flw'), at, by(actor))
    db.setState((st) => ({ flows: [...st.flows, copy] }))
    auditProject(actor, 'FLOW_CREATED', project, { flowId: copy.flowId, name: copy.name, workflowVersion: copy.workflowVersion, duplicatedFrom: flowId }, at)
    return wire(copy)
  },

  // REQ: DEC-51 / DEC-52 / DEC-19 — Advanced values only by Super admin; an Active save needs a reason and adds a revision.
  async save(flowId, next, reason, actor) {
    await simulateNetwork('save flow')
    requireActive(actor)
    const { flow, project } = loadFlow(actor, flowId)
    // REQ: DEC-70 — thresholds, retries allowed and risk level need Change verification level and retries.
    const levelChanged = JSON.stringify(flow.settings.checks) !== JSON.stringify(next.settings.checks) || JSON.stringify(flow.settings.risk) !== JSON.stringify(next.settings.risk)
    if (levelChanged) requireInProject(actor, 'changeVerificationLevel', project, 'change the verification level and retries')
    const canSetAdvanced = canInProject(accountOf(actor), 'setAdvancedThresholds', project)
    const at = now()
    const r = saveFlow(flow, next, { entry: entryOf(flow.workflowVersion)!, canSetAdvanced, reason }, at, by(actor))
    if ('errors' in r) throw validation(r.errors)
    const revision: FlowRevision | undefined =
      flow.status === 'ACTIVE' ? { revisionId: newId('rev'), flowId, revision: r.flow.revision, savedAt: at.toISOString(), savedBy: by(actor), reason: reason.trim(), settings: structuredClone(r.flow.settings), changes: r.changes } : undefined
    db.setState((st) => ({
      flows: st.flows.map((f) => (f.flowId === flowId ? r.flow : f)),
      flowRevisions: revision ? [...st.flowRevisions, revision] : st.flowRevisions,
    }))
    auditProject(actor, 'FLOW_SETTING_CHANGED', project, { flowId, revision: revision?.revision, reason: revision?.reason, changes: r.changes }, at)
    return wire(r.flow)
  },

  // REQ: DEC-94 / DEC-51 — full validation; the first activation records revision R1.
  async activate(flowId, actor) {
    await simulateNetwork('activate flow')
    requireActive(actor)
    const { flow, project } = loadFlow(actor, flowId)
    const entry = entryOf(flow.workflowVersion)
    const blocked = activateError(flow, project, entry)
    if (blocked) throw validation([{ field: 'status', message: blocked }])
    const errors = validateFlow(flow, entry!)
    if (errors.length) throw validation(errors)
    const at = now()
    const active = activate(flow, at, by(actor))
    const first = flow.revision === 0
    db.setState((st) => ({
      flows: st.flows.map((f) => (f.flowId === flowId ? active : f)),
      flowRevisions: first
        ? [...st.flowRevisions, { revisionId: newId('rev'), flowId, revision: 1, savedAt: at.toISOString(), savedBy: by(actor), reason: 'Activated', settings: structuredClone(active.settings), changes: [] }]
        : st.flowRevisions,
    }))
    auditProject(actor, 'FLOW_ACTIVATED', project, { flowId, revision: active.revision, changes: [{ field: 'Status', from: flow.status, to: 'ACTIVE' }] }, at)
    return wire(active)
  },

  // REQ: DEC-94 — not the default; with cases in flight it goes Retiring (finishes those only), otherwise Inactive.
  async retire(flowId, actor) {
    await simulateNetwork('retire flow')
    requireActive(actor)
    const { flow, project } = loadFlow(actor, flowId)
    const blocked = retireError(flow, project)
    if (blocked) throw validation([{ field: 'status', message: blocked }])
    const at = now()
    const retired = retire(flow, inFlight(flowId), at, by(actor))
    putFlow(retired)
    auditProject(actor, 'FLOW_RETIRED', project, { flowId, changes: [{ field: 'Status', from: flow.status, to: retired.status }] }, at)
    return wire(retired)
  },

  async setDefault(flowId, actor) {
    await simulateNetwork('set default flow')
    requireActive(actor)
    const { flow, project } = loadFlow(actor, flowId)
    const blocked = setDefaultFlowError(project, flow)
    if (blocked) throw validation([{ field: 'default', message: blocked }])
    db.setState((st) => ({ projects: st.projects.map((p) => (p.projectId === project.projectId ? { ...p, defaultFlowId: flowId } : p)) }))
    auditProject(actor, 'FLOW_DEFAULT_CHANGED', project, { flowId, changes: [{ field: 'Default flow', from: project.defaultFlowId, to: flowId }] })
    return wire(projectById(project.projectId)!)
  },

  // REQ: MOCK-10 — read-only: re-runs the status rules; never changes a record.
  async preview(flowId, settings, actor, days = 30) {
    await simulateNetwork('flow preview')
    const { flow } = loadFlow(actor, flowId, 'viewFlows')
    const entry = entryOf(flow.workflowVersion)!
    const since = new Date(now().getTime() - days * 86_400_000).toISOString()
    const finished = db.state().verifications.filter((v) => v.flowId === flowId && v.status !== 'PROCESSING' && v.createdAt >= since)
    const ctx = { checks: entry.configurableChecks, faceMatchMethod: entry.faceMatchMethod, hasRisk: hasRisk(entry) }
    return wire({ ...flowImpact(finished, ctx, flow.settings, settings), days })
  },
}

/** A Retiring flow becomes Inactive once its last in-flight case is decided (called after a decision; SYSTEM change). */
export function settleRetiringFlow(flowId: string, at: Date): void {
  const flow = db.state().flows.find((f) => f.flowId === flowId)
  if (!flow) return
  const settled = settleRetiring(flow, inFlight(flowId), at)
  if (settled === flow) return
  putFlow(settled)
  auditProject('SYSTEM', 'FLOW_RETIRED', projectById(flow.projectId)!, { flowId, changes: [{ field: 'Status', from: 'RETIRING', to: 'INACTIVE' }] }, at)
}

export const flowService: FlowService = mockFlowService
