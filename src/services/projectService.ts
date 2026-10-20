// Projects API (mock). DEC-90 … DEC-93, DEC-96.
//   GET   /projects/mine              listMine → 200 MyProject[] (project switcher, "All my projects")
//   GET   /projects/{id}              get      → 200 Project | 404
//   POST  /merchants/{id}/projects    create   → 201 Project | 403 | 422 VALIDATION
//   PATCH /projects/{id}              rename   → 200 Project | 403 | 422 VALIDATION
//   POST  /projects/{id}/archive      archive  → 200 Project | 403 | 422 VALIDATION
import { canInMerchant, canInProject, roleInProject, type ProjectAction } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { createFlow } from '@/domain/flowSettings'
import { archiveError, validateProjectName } from '@/domain/flowRules'
import { DEFAULT_CLAIM_TIMEOUT_MIN } from '@/domain/openQuestions'
import { defaultVersion } from '@/domain/registryRules'
import type { Actor, AuditAction, EffectiveRole, Project, RuleError } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, projectById, requireActive, roleIn } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

/** A project the user can reach, with their role in it (DEC-73: switcher and "role in the current project"). */
export type MyProject = Project & { role: EffectiveRole }

export interface ProjectService {
  listMine(actor: Actor): Promise<MyProject[]>
  get(projectId: string, actor: Actor): Promise<Project>
  create(merchantId: string, input: { name: string }, actor: Actor): Promise<Project>
  rename(projectId: string, name: string, actor: Actor): Promise<Project>
  archive(projectId: string, actor: Actor): Promise<Project>
}

export function nextId(prefix: string, ids: readonly string[], width = 4): string {
  const max = ids.map((id) => Number(id.slice(prefix.length))).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}

export const validation = (errors: RuleError[]) => new ServiceError('VALIDATION', errors[0].message, errors)

/** A project the user has a role in, or "not found" (DEC-72). */
export function loadProject(actor: Actor, projectId: string): Project {
  const p = projectById(projectId)
  if (!p || !roleInProject(accountOf(actor), p)) throw new ServiceError('NOT_FOUND', `Project ${projectId} not found.`)
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

export const mockProjectService: ProjectService = {
  async listMine(actor) {
    await simulateNetwork('list my projects')
    const me = accountOf(actor)
    const rows = db
      .state()
      .projects.map((p) => ({ ...p, role: roleInProject(me, p) }))
      .filter((p): p is MyProject => !!p.role)
      .sort((a, b) => a.merchantId.localeCompare(b.merchantId) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    return wire(rows)
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
    if (!s.merchants.some((m) => m.merchantId === merchantId) || (me.level !== 'PLATFORM_ADMIN' && me.merchantId !== merchantId)) {
      throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    }
    if (!canInMerchant(me, 'manageProjects', merchantId)) throw new ServiceError('FORBIDDEN', 'You do not have permission to create projects.')
    const errors = validateProjectName(input.name, s.projects.filter((p) => p.merchantId === merchantId))
    if (errors.length) throw validation(errors)
    const entry = defaultVersion(s.registry)
    if (!entry) throw validation([{ field: 'form', message: 'No default workflow version is set in the registry.' }])
    const at = now()
    const projectId = nextId('PRJ-', s.projects.map((p) => p.projectId))
    const flowId = nextId('FLW-', s.flows.map((f) => f.flowId))
    const project: Project = {
      projectId,
      merchantId,
      name: input.name.trim(),
      status: 'ACTIVE',
      isDefault: false,
      defaultFlowId: flowId,
      claimTimeoutMin: DEFAULT_CLAIM_TIMEOUT_MIN,
      createdAt: at.toISOString(),
      createdBy: actor.fullName,
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
    requireInProject(actor, 'manageProjects', p, 'rename projects')
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
    requireInProject(actor, 'manageProjects', p, 'archive projects')
    const error = archiveError(p, db.state().projects.filter((x) => x.merchantId === p.merchantId))
    if (error) throw validation([{ field: 'status', message: error }])
    db.setState((st) => ({ projects: st.projects.map((x) => (x.projectId === projectId ? { ...x, status: 'ARCHIVED' } : x)) }))
    auditProject(actor, 'PROJECT_ARCHIVED', p, { changes: [{ field: 'Status', from: 'Active', to: 'Archived' }] })
    return wire(projectById(projectId)!)
  },
}

export const projectService: ProjectService = mockProjectService
