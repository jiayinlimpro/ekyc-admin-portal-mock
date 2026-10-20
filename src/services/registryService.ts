// Workflow Registry API (mock). DEC-56 … DEC-58. A record only: nothing here builds, deploys or calls AWS Step Functions.
//   GET  /registry                    list           → 200 RegistryRow[]           (Platform Admin)
//   GET  /registry/selectable         listSelectable → 200 SelectableVersion[]     (anyone who may create flows)
//   POST /registry                    register       → 201 RegistryEntry | 422 VALIDATION
//   PUT  /registry/{code}             update         → 200 RegistryEntry | 422 VALIDATION (locked fields)
//   POST /registry/{code}/status      changeStatus   → 200 RegistryEntry | 422 VALIDATION
//   POST /registry/{code}/default     setDefault     → 200 RegistryEntry | 422 VALIDATION
import { canOnPlatform, projectsWhere } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { isLocked, selectableForNewFlow, setDefaultError, statusChangeError, validateRegistryInput, withDefault, type RegistryInput } from '@/domain/registryRules'
import type { Actor, AuditAction, RegistryEntry, RegistryStatus, SettingChange, WorkflowCode } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { validation } from './projectService'

/** Registry row with "flows using it" (DEC-85: replaces the Merchant Workflow Directory). */
export type RegistryRow = RegistryEntry & { flowsUsing: number }

/** What a flow creator needs to pick a version. State machine references are internal and left out. */
export type SelectableVersion = Pick<RegistryEntry, 'code' | 'name' | 'description' | 'phases' | 'faceMatchMethod' | 'requiredInputs' | 'configurableChecks' | 'isDefault'>

export interface RegistryService {
  list(actor: Actor): Promise<RegistryRow[]>
  listSelectable(actor: Actor): Promise<SelectableVersion[]>
  register(input: RegistryInput, actor: Actor): Promise<RegistryEntry>
  /** The code never changes. After first activation only name, description and state machine references can (DEC-56). */
  update(code: WorkflowCode, input: RegistryInput, actor: Actor): Promise<RegistryEntry>
  changeStatus(code: WorkflowCode, to: RegistryStatus, reason: string, actor: Actor): Promise<RegistryEntry>
  setDefault(code: WorkflowCode, actor: Actor): Promise<RegistryEntry>
}

// REQ: DEC-70 — Workflow Registry is Platform Admin only.
function requireRegistry(actor: Actor) {
  if (!canOnPlatform(accountOf(actor), 'manageRegistry')) throw new ServiceError('FORBIDDEN', 'Only Platform Admin can manage the Workflow Registry.')
}

function load(code: WorkflowCode): RegistryEntry {
  const e = db.state().registry.find((x) => x.code === code)
  if (!e) throw new ServiceError('NOT_FOUND', `Workflow version ${code} not found.`)
  return e
}

function put(entry: RegistryEntry) {
  db.setState((st) => ({ registry: st.registry.map((e) => (e.code === entry.code ? entry : e)) }))
}

// Registry events have no merchant or project, so only Platform Admin sees them in the Audit Log.
function audit(actor: Actor, action: AuditAction, code: WorkflowCode, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: now(), action, actor, actorRole: 'PLATFORM_ADMIN', ip: clientIpFor(actor), details: { code, ...details } }))
}

const FIELDS: (keyof RegistryInput)[] = ['name', 'description', 'phases', 'faceMatchMethod', 'requiredInputs', 'configurableChecks', 'stateMachineSandbox', 'stateMachineProduction']
const text = (v: unknown) => (Array.isArray(v) ? v.join(' → ') || '—' : v === undefined || v === '' ? '—' : String(v))

function diff(e: RegistryEntry, input: RegistryInput): SettingChange[] {
  return FIELDS.filter((f) => text(e[f as keyof RegistryEntry]) !== text(input[f])).map((f) => ({ field: f, from: text(e[f as keyof RegistryEntry]), to: text(input[f]) }))
}

const fields = (input: RegistryInput) => ({
  name: input.name.trim(),
  description: input.description.trim(),
  phases: input.phases,
  faceMatchMethod: input.faceMatchMethod,
  requiredInputs: input.requiredInputs,
  configurableChecks: input.configurableChecks,
  stateMachineSandbox: input.stateMachineSandbox?.trim() || undefined,
  stateMachineProduction: input.stateMachineProduction?.trim() || undefined,
})

export const mockRegistryService: RegistryService = {
  async list(actor) {
    await simulateNetwork('list registry')
    requireRegistry(actor)
    const flows = db.state().flows
    return wire(db.state().registry.map((e) => ({ ...e, flowsUsing: flows.filter((f) => f.workflowVersion === e.code).length })))
  },

  // REQ: DEC-56 — Active versions only; for anyone who may create flows somewhere.
  async listSelectable(actor) {
    await simulateNetwork('list selectable versions')
    if (projectsWhere(accountOf(actor), 'manageFlows', db.state().projects).length === 0) throw new ServiceError('FORBIDDEN', 'You do not have permission to create flows.')
    return wire(
      selectableForNewFlow(db.state().registry).map(({ code, name, description, phases, faceMatchMethod, requiredInputs, configurableChecks, isDefault }) => ({
        code,
        name,
        description,
        phases,
        faceMatchMethod,
        requiredInputs,
        configurableChecks,
        isDefault,
      })),
    )
  },

  async register(input, actor) {
    await simulateNetwork('register workflow')
    requireActive(actor)
    requireRegistry(actor)
    const errors = validateRegistryInput(input, db.state().registry.map((e) => e.code))
    if (errors.length) throw validation(errors)
    const at = now().toISOString()
    const entry: RegistryEntry = {
      code: input.code.trim(),
      ...fields(input),
      releaseNotes: [{ at, by: actor.fullName, text: input.releaseNote.trim() }],
      status: 'DRAFT',
      isDefault: false,
      registeredAt: at,
      registeredBy: actor.fullName,
      updatedAt: at,
      updatedBy: actor.fullName,
    }
    db.setState((st) => ({ registry: [...st.registry, entry] }))
    audit(actor, 'WORKFLOW_REGISTERED', entry.code, { name: entry.name, phases: entry.phases })
    return wire(entry)
  },

  async update(code, input, actor) {
    await simulateNetwork('update workflow')
    requireActive(actor)
    requireRegistry(actor)
    const e = load(code)
    if (input.code.trim() !== code) throw validation([{ field: 'code', message: 'The workflow code cannot be changed.' }])
    const errors = validateRegistryInput(input, db.state().registry.filter((x) => x.code !== code).map((x) => x.code))
    const changes = diff(e, input)
    // REQ: DEC-56 — after first activation, anything other than name, description and state machines needs a new code.
    for (const c of changes) {
      if (isLocked(e, c.field as keyof RegistryInput)) errors.push({ field: c.field, message: 'This field is locked once the version has been active. Register a new version code instead.' })
    }
    if (!changes.length) errors.push({ field: 'form', message: 'There are no changes to save.' })
    if (errors.length) throw validation(errors)
    const at = now().toISOString()
    const updated: RegistryEntry = { ...e, ...fields(input), releaseNotes: [...e.releaseNotes, { at, by: actor.fullName, text: input.releaseNote.trim() }], updatedAt: at, updatedBy: actor.fullName }
    put(updated)
    audit(actor, 'WORKFLOW_UPDATED', code, { changes, releaseNote: input.releaseNote.trim() })
    return wire(updated)
  },

  // REQ: DEC-56 / DEC-57 — Draft → Active needs complete fields; never back to Draft; the default can't be deprecated.
  async changeStatus(code, to, reason, actor) {
    await simulateNetwork('change workflow status')
    requireActive(actor)
    requireRegistry(actor)
    const e = load(code)
    const blocked = statusChangeError(e, to, reason)
    if (blocked) throw validation([{ field: 'status', message: blocked }])
    const at = now().toISOString()
    const updated: RegistryEntry = { ...e, status: to, activatedAt: e.activatedAt ?? (to === 'ACTIVE' ? at : undefined), updatedAt: at, updatedBy: actor.fullName }
    put(updated)
    audit(actor, 'WORKFLOW_STATUS_CHANGED', code, { reason: reason.trim(), changes: [{ field: 'Status', from: e.status, to }] })
    return wire(updated)
  },

  async setDefault(code, actor) {
    await simulateNetwork('set default workflow')
    requireActive(actor)
    requireRegistry(actor)
    const e = load(code)
    const blocked = setDefaultError(e)
    if (blocked) throw validation([{ field: 'default', message: blocked }])
    const before = db.state().registry.find((x) => x.isDefault)?.code ?? '—'
    db.setState((st) => ({ registry: withDefault(st.registry, code) }))
    audit(actor, 'WORKFLOW_DEFAULT_CHANGED', code, { changes: [{ field: 'Default for new merchants', from: before, to: code }] })
    return wire(load(code))
  },
}

export const registryService: RegistryService = mockRegistryService
