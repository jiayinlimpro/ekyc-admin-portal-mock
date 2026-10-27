// Projects API (mock). DEC-90 … DEC-93, DEC-96.
//   GET   /projects/mine              listMine → 200 MyProject[] (project switcher, "All my projects")
//   GET   /projects                   listRows → 200 ProjectRow[] (Projects screen)
//   GET   /projects/{id}              get      → 200 Project | 404
//   POST  /merchants/{id}/projects    create   → 201 Project | 403 | 422 VALIDATION
//   PATCH /projects/{id}              rename   → 200 Project | 403 | 422 VALIDATION
//   POST  /projects/{id}/archive      archive  → 200 Project | 403 | 422 VALIDATION
//   PATCH /projects/{id}/general      updateGeneral    → 200 Project (branding, language)
//   PATCH /projects/{id}/review-ops   updateClaimTimeout → 200 Project
//   POST  /projects/{id}/decision-reasons                 addDecisionReason       → 200 Project | 403 | 422 VALIDATION
//   PATCH /projects/{id}/decision-reasons/{code}          updateDecisionReason    → 200 Project | 403 | 404 | 422
//   POST  /projects/{id}/decision-reasons/{code}/status   setDecisionReasonActive → 200 Project | 403 | 404 | 422
import { canInMerchant, canInProject, hasProject, isInternal, roleNamesInProject, type ProjectAction } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { createFlow } from '@/domain/flowSettings'
import { archiveError, IN_FLIGHT_STATUSES, validateProjectName } from '@/domain/flowRules'
import { canTurnOff, customCode, reasonsOf, REJECT_GROUP_LABELS, validateReasonInput, type ReasonInput } from '@/domain/decisionReasons'
import { DEFAULT_CLAIM_TIMEOUT_SEC } from '@/domain/openQuestions'
import { claimTimeoutError, diffSettings, PROJECT_SETTING_DEFAULTS, validateGeneral, type GeneralSettings } from '@/domain/projectSettings'
import { defaultVersion } from '@/domain/registryRules'
import { coversProject, grantsOf } from '@/domain/roles'
import type { Actor, AuditAction, DecisionReason, Project, ProjectDecisionReasons, RuleError } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, internalTestsFilter, projectById, requireActive, roleIn } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { newId } from '@/lib/ids'

/** A project the user can reach, with their role names in it (DEC-73: switcher and "roles in the current project"). */
export type MyProject = Project & { roles: string[] }

/** A row on the Projects screen: the project, the user's roles, and what it holds. */
export type ProjectRow = MyProject & {
  merchantName: string
  flows: number
  activeFlows: number
  defaultFlowName: string
  members: number // users with access, incl. All projects (DEC-77), Pending or Active; not Super admins
  inFlightCases: number // PROCESSING + PENDING_REVIEW
  /** REQ: DEC-102 — the user may rename it / archive it (separate permissions). */
  canRename: boolean
  canArchive: boolean
}

export interface ProjectService {
  listMine(actor: Actor): Promise<MyProject[]>
  listRows(actor: Actor): Promise<ProjectRow[]>
  /** Merchants where the user may create projects (Super admin: all; Merchant Owner: theirs). */
  creatableMerchants(actor: Actor): Promise<{ merchantId: string; name: string }[]>
  get(projectId: string, actor: Actor): Promise<Project>
  create(merchantId: string, input: { name: string }, actor: Actor): Promise<Project>
  rename(projectId: string, name: string, actor: Actor): Promise<Project>
  archive(projectId: string, actor: Actor): Promise<Project>
  updateGeneral(projectId: string, input: GeneralSettings, actor: Actor): Promise<Project>
  /** REQ: DEC-22 / DEC-53 — applies to claims made from now on. */
  /** REQ: DEC-53 — seconds, at least 60 (the screen sends whole minutes × 60). */
  updateClaimTimeout(projectId: string, claimTimeoutSec: number, actor: Actor): Promise<Project>
  /** REQ: DEC-106 — a Custom decision reason; its code is generated. */
  addDecisionReason(projectId: string, input: ReasonInput, actor: Actor): Promise<Project>
  /** REQ: DEC-106 — rename a Custom reason, or change its group or "note required"; the outcome stays. */
  updateDecisionReason(projectId: string, code: string, input: Omit<ReasonInput, 'outcome'>, actor: Actor): Promise<Project>
  /** REQ: DEC-106 — turn a reason on or off (System Default ones too); "Other" stays on. */
  setDecisionReasonActive(projectId: string, code: string, active: boolean, actor: Actor): Promise<Project>
}

export const validation = (errors: RuleError[]) => new ServiceError('VALIDATION', errors[0].message, errors)

/** A project the user has access to, or "not found" (DEC-72). */
export function loadProject(actor: Actor, projectId: string): Project {
  const p = projectById(projectId)
  if (!p || !hasProject(accountOf(actor), p)) throw new ServiceError('NOT_FOUND', `Project ${projectId} not found.`)
  return p
}

/** Member of the project but without the right: "forbidden" (they know the project exists). */
export function requireInProject(actor: Actor, action: ProjectAction, p: Project, what: string): void {
  if (!canInProject(accountOf(actor), action, p)) throw new ServiceError('FORBIDDEN', `You do not have permission to ${what} in this project.`)
}

// REQ: DEC-42 — actor, role in the project, project, target and old/new values.
export function auditProject(actor: Actor | 'SYSTEM', action: AuditAction, p: Pick<Project, 'projectId' | 'merchantId'>, details: Record<string, unknown>, at = now()) {
  db.appendAudit(
    makeAudit({
      id: '',
      now: at,
      action,
      actor,
      actorRole: actor === 'SYSTEM' ? undefined : roleIn(actor, p.projectId),
      ip: actor === 'SYSTEM' ? '-' : clientIpFor(actor),
      merchantId: p.merchantId,
      projectId: p.projectId,
      details,
    }),
  )
}

const by = (actor: Actor) => ({ userId: actor.userId, fullName: actor.fullName })

/** Saves a settings patch and audits PROJECT_SETTING_CHANGED with old and new values; no change, no entry. */
export function saveSettings(actor: Actor, p: Project, patch: Partial<Project>): Project {
  const changes = diffSettings(p, patch)
  if (!changes.length) return wire(p)
  db.setState((st) => ({ projects: st.projects.map((x) => (x.projectId === p.projectId ? { ...x, ...patch } : x)) }))
  auditProject(actor, 'PROJECT_SETTING_CHANGED', p, { changes })
  return wire(projectById(p.projectId)!)
}

const reasonLabel = (r: Pick<DecisionReason, 'outcome' | 'group'>) => `${r.outcome === 'REJECT' ? 'Reject' : 'Approve'}${r.group ? ` · ${REJECT_GROUP_LABELS[r.group]}` : ''}`

/** REQ: DEC-106 / DEC-42 — saves the project's decision reasons and audits each change as a project setting. */
function saveReasons(actor: Actor, p: Project, next: ProjectDecisionReasons, changes: { field: string; from: string; to: string }[]): Project {
  db.setState((st) => ({ projects: st.projects.map((x) => (x.projectId === p.projectId ? { ...x, decisionReasons: next } : x)) }))
  auditProject(actor, 'PROJECT_SETTING_CHANGED', p, { changes })
  return wire(projectById(p.projectId)!)
}

function editableReasons(actor: Actor, projectId: string): Project {
  requireActive(actor)
  const p = loadProject(actor, projectId)
  requireInProject(actor, 'manageProjectSettings', p, 'change project settings')
  return p
}

export const mockProjectService: ProjectService = {
  async listMine(actor) {
    await simulateNetwork('list my projects')
    const me = accountOf(actor)
    const rows = db
      .state()
      .projects.filter((p) => hasProject(me, p))
      .map((p): MyProject => ({ ...p, roles: roleNamesInProject(me, p) }))
      .sort((a, b) => a.merchantId.localeCompare(b.merchantId) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    return wire(rows)
  },

  async listRows(actor) {
    await simulateNetwork('list projects')
    const me = accountOf(actor)
    const visible = internalTestsFilter(actor).flow // REQ: DEC-56
    const s = db.state()
    const rows = s.projects
      .filter((p) => hasProject(me, p))
      .map((p): ProjectRow => {
        const flows = s.flows.filter((f) => f.projectId === p.projectId && visible(f))
        return {
          ...p,
          roles: roleNamesInProject(me, p),
          merchantName: s.merchants.find((m) => m.merchantId === p.merchantId)?.name ?? p.merchantId,
          flows: flows.length,
          activeFlows: flows.filter((f) => f.status === 'ACTIVE').length,
          defaultFlowName: flows.find((f) => f.flowId === p.defaultFlowId)?.name ?? p.defaultFlowId,
          members: s.accounts.filter((a) => a.status !== 'SUSPENDED' && a.merchantId === p.merchantId && coversProject(grantsOf(a.assignments, s.roles), p.projectId)).length, // REQ: DEC-104 — Member alone doesn't count
          inFlightCases: s.verifications.filter((v) => v.projectId === p.projectId && IN_FLIGHT_STATUSES.includes(v.status)).length,
          canRename: canInProject(me, 'renameProjects', p),
          canArchive: canInProject(me, 'archiveProjects', p),
        }
      })
      .sort((a, b) => a.merchantName.localeCompare(b.merchantName) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    return wire(rows)
  },

  async creatableMerchants(actor) {
    await simulateNetwork('creatable merchants')
    const me = accountOf(actor)
    return wire(db.state().merchants.filter((m) => canInMerchant(me, 'createProjects', m.merchantId)).map(({ merchantId, name }) => ({ merchantId, name })))
  },

  async get(projectId, actor) {
    await simulateNetwork('get project')
    return wire(loadProject(actor, projectId))
  },

  // REQ: DEC-93 — name required, unique within the merchant. MOCK-12: starts with a Draft default flow on the registry default.
  async create(merchantId, input, actor) {
    await simulateNetwork('create project')
    const me = requireActive(actor)
    const s = db.state()
    if (!s.merchants.some((m) => m.merchantId === merchantId) || (!isInternal(me) && me.merchantId !== merchantId)) {
      throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    }
    if (!canInMerchant(me, 'createProjects', merchantId)) throw new ServiceError('FORBIDDEN', 'You do not have permission to create projects.')
    const errors = validateProjectName(input.name, s.projects.filter((p) => p.merchantId === merchantId))
    if (errors.length) throw validation(errors)
    const entry = defaultVersion(s.registry)
    if (!entry) throw validation([{ field: 'form', message: 'No default workflow version is set in the registry.' }])
    const at = now()
    const projectId = newId('prj')
    const flowId = newId('flw')
    const project: Project = {
      projectId,
      merchantId,
      name: input.name.trim(),
      status: 'ACTIVE',
      isDefault: false,
      defaultFlowId: flowId,
      claimTimeoutSec: DEFAULT_CLAIM_TIMEOUT_SEC,
      createdAt: at.toISOString(),
      createdBy: actor.fullName,
      ...structuredClone(PROJECT_SETTING_DEFAULTS),
    }
    const flow = createFlow({ flowId, project }, { name: 'Default flow', description: 'Created with the project' }, entry, at, by(actor))
    db.setState((st) => ({ projects: [...st.projects, project], flows: [...st.flows, flow] }))
    auditProject(actor, 'PROJECT_CREATED', project, { name: project.name }, at)
    auditProject(actor, 'FLOW_CREATED', project, { flowId, name: flow.name, workflowVersion: flow.workflowVersion, isDefault: true }, at)
    return wire(project)
  },

  async rename(projectId, name, actor) {
    await simulateNetwork('rename project')
    requireActive(actor)
    const p = loadProject(actor, projectId)
    requireInProject(actor, 'renameProjects', p, 'rename projects')
    const errors = validateProjectName(name, db.state().projects.filter((x) => x.merchantId === p.merchantId && x.projectId !== projectId))
    if (errors.length) throw validation(errors)
    const n = name.trim()
    if (n === p.name) return wire(p)
    db.setState((st) => ({ projects: st.projects.map((x) => (x.projectId === projectId ? { ...x, name: n } : x)) }))
    auditProject(actor, 'PROJECT_RENAMED', p, { changes: [{ field: 'Name', from: p.name, to: n }] })
    return wire(projectById(projectId)!)
  },

  async archive(projectId, actor) {
    await simulateNetwork('archive project')
    requireActive(actor)
    const p = loadProject(actor, projectId)
    requireInProject(actor, 'archiveProjects', p, 'archive projects')
    const error = archiveError(p, db.state().projects.filter((x) => x.merchantId === p.merchantId))
    if (error) throw validation([{ field: 'status', message: error }])
    db.setState((st) => ({ projects: st.projects.map((x) => (x.projectId === projectId ? { ...x, status: 'ARCHIVED' } : x)) }))
    auditProject(actor, 'PROJECT_ARCHIVED', p, { changes: [{ field: 'Status', from: 'Active', to: 'Archived' }] })
    return wire(projectById(projectId)!)
  },

  async updateGeneral(projectId, input, actor) {
    await simulateNetwork('update project general')
    requireActive(actor)
    const p = loadProject(actor, projectId)
    requireInProject(actor, 'manageProjectSettings', p, 'change project settings')
    const next: GeneralSettings = {
      branding: { primaryColor: input.branding.primaryColor?.trim() || undefined, logoUrl: input.branding.logoUrl?.trim() || undefined },
      language: input.language || undefined,
    }
    const errors = validateGeneral(next)
    if (errors.length) throw validation(errors)
    return saveSettings(actor, p, next)
  },

  async updateClaimTimeout(projectId, claimTimeoutSec, actor) {
    await simulateNetwork('update claim timeout')
    requireActive(actor)
    const p = loadProject(actor, projectId)
    requireInProject(actor, 'manageProjectSettings', p, 'change project settings')
    const error = claimTimeoutError(claimTimeoutSec)
    if (error) throw validation([{ field: 'claimTimeoutSec', message: error }])
    return saveSettings(actor, p, { claimTimeoutSec })
  },

  async addDecisionReason(projectId, input, actor) {
    await simulateNetwork('add decision reason')
    const p = editableReasons(actor, projectId)
    const all = reasonsOf(p.decisionReasons)
    const errors = validateReasonInput(input, all)
    if (errors.length) throw validation(errors)
    const reason: DecisionReason = {
      code: customCode(input.name, all),
      name: input.name.trim(),
      outcome: input.outcome,
      group: input.outcome === 'REJECT' ? input.group : undefined,
      noteRequired: input.noteRequired,
      system: false,
      active: true,
    }
    return saveReasons(actor, p, { ...p.decisionReasons, custom: [...p.decisionReasons.custom, reason] }, [{ field: 'Decision reason added', from: '—', to: `${reason.name} (${reasonLabel(reason)})` }])
  },

  async updateDecisionReason(projectId, code, input, actor) {
    await simulateNetwork('update decision reason')
    const p = editableReasons(actor, projectId)
    const r = p.decisionReasons.custom.find((x) => x.code === code)
    if (!r) {
      if (reasonsOf(p.decisionReasons).some((x) => x.code === code)) throw validation([{ field: 'name', message: 'System Default reasons can’t be edited; turn it off and add your own instead.' }])
      throw new ServiceError('NOT_FOUND', `Decision reason ${code} not found.`)
    }
    const errors = validateReasonInput({ ...input, outcome: r.outcome }, reasonsOf(p.decisionReasons), code)
    if (errors.length) throw validation(errors)
    const next: DecisionReason = { ...r, name: input.name.trim(), group: r.outcome === 'REJECT' ? input.group : undefined, noteRequired: input.noteRequired }
    const changes = [
      ...(next.name !== r.name ? [{ field: 'Decision reason name', from: r.name, to: next.name }] : []),
      ...(next.group !== r.group ? [{ field: `Decision reason “${next.name}” group`, from: reasonLabel(r), to: reasonLabel(next) }] : []),
      ...(next.noteRequired !== r.noteRequired ? [{ field: `Decision reason “${next.name}” note required`, from: r.noteRequired ? 'Yes' : 'No', to: next.noteRequired ? 'Yes' : 'No' }] : []),
    ]
    if (!changes.length) return wire(p)
    return saveReasons(actor, p, { ...p.decisionReasons, custom: p.decisionReasons.custom.map((x) => (x.code === code ? next : x)) }, changes)
  },

  async setDecisionReasonActive(projectId, code, active, actor) {
    await simulateNetwork('turn decision reason on or off')
    const p = editableReasons(actor, projectId)
    const r = reasonsOf(p.decisionReasons).find((x) => x.code === code)
    if (!r) throw new ServiceError('NOT_FOUND', `Decision reason ${code} not found.`)
    if (!active && !canTurnOff(r)) throw validation([{ field: 'active', message: '“Other” stays on, so every outcome always has a reason.' }])
    if (r.active === active) return wire(p)
    const cfg = p.decisionReasons
    const next: ProjectDecisionReasons = r.system
      ? { ...cfg, disabledSystemCodes: active ? cfg.disabledSystemCodes.filter((c) => c !== code) : [...cfg.disabledSystemCodes, code] }
      : { ...cfg, custom: cfg.custom.map((x) => (x.code === code ? { ...x, active } : x)) }
    return saveReasons(actor, p, next, [{ field: `Decision reason “${r.name}” (${reasonLabel(r)})`, from: r.active ? 'On' : 'Off', to: active ? 'On' : 'Off' }])
  },
}

export const projectService: ProjectService = mockProjectService
