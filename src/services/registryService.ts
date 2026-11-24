// Workflow Registry API (mock). DEC-56 … DEC-58, DEC-115. A record only: nothing here builds, deploys or calls the workflow.
// The workflow decides what runs; a version is its code, a name and the workflow JSON the portal reads (DEC-115).
//   GET  /registry                    list           → 200 RegistryRow[]           (Super admin)
//   GET  /registry/selectable?merchantId=  listSelectable → 200 SelectableVersion[]  (anyone who may create flows; DEC-56)
//   POST /registry                    register       → 201 RegistryEntry | 422 VALIDATION
//   PUT  /registry/{code}             update         → 200 RegistryEntry | 422 VALIDATION (a reason when flows use it)
//   POST /registry/{code}/status      changeStatus   → 200 RegistryEntry | 422 VALIDATION
//   POST /registry/{code}/default     setDefault     → 200 RegistryEntry | 422 VALIDATION
//   GET  /registry/{code}/flows       flowsUsing     → 200 FlowUsingVersion[] (replaces the Merchant Workflow Directory, DEC-85)
import { canOnPlatform, isInternal, projectsWhere } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { definitionChangeError, locksFields, normaliseDefinition, readDefinition, selectableForNewFlow, setDefaultError, statusChangeError, validateRegistryInput, withDefault, type RegistryInput } from '@/domain/registryRules'
import type { Actor, AuditAction, Flow, RegistryEntry, RegistryStatus, SettingChange, WorkflowCode } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { newId } from '@/lib/ids'

/** Registry row with "flows using it" (DEC-85: replaces the Merchant Workflow Directory). */
export type RegistryRow = RegistryEntry & { flowsUsing: number }

/** What a flow creator needs to pick a version: what the portal read from its JSON. The JSON itself stays internal. */
export type SelectableVersion = Pick<RegistryEntry, 'code' | 'name' | 'phases' | 'faceMatchMethod' | 'configurableChecks' | 'riskMinimumsPerFlow' | 'isDefault'>

/** A flow on a version, with where it lives. */
export interface FlowUsingVersion {
  flowId: string
  name: string
  status: Flow['status']
  projectId: string // REQ: DEC-109 — the link opens the flow inside its project
  projectName: string
  merchantName: string
}

export interface RegistryService {
  list(actor: Actor): Promise<RegistryRow[]>
  flowsUsing(code: WorkflowCode, actor: Actor): Promise<FlowUsingVersion[]>
  /** REQ: DEC-56 — what this user may choose for a new flow in that merchant (Internal testing: internal users only). */
  listSelectable(actor: Actor, merchantId?: string): Promise<SelectableVersion[]>
  register(input: RegistryInput, actor: Actor): Promise<RegistryEntry>
  /** The code never changes; the name, definition and Merchant access can, at any status (DEC-115). */
  update(code: WorkflowCode, input: RegistryInput, actor: Actor): Promise<RegistryEntry>
  changeStatus(code: WorkflowCode, to: RegistryStatus, reason: string, actor: Actor): Promise<RegistryEntry>
  setDefault(code: WorkflowCode, actor: Actor): Promise<RegistryEntry>
}

// REQ: DEC-70 / DEC-99 — Workflow Registry: super admin, or platform staff with Registry View (read) / Manage (changes).
function requireRegistry(actor: Actor, action: 'viewRegistry' | 'manageRegistry' = 'manageRegistry') {
  if (!canOnPlatform(accountOf(actor), action)) throw new ServiceError('FORBIDDEN', action === 'viewRegistry' ? 'You do not have permission to view the Workflow Registry.' : 'You do not have permission to manage the Workflow Registry.')
}

function load(code: WorkflowCode): RegistryEntry {
  const e = db.state().registry.find((x) => x.code === code)
  if (!e) throw new ServiceError('NOT_FOUND', `Workflow version ${code} not found.`)
  return e
}

function put(entry: RegistryEntry) {
  db.setState((st) => ({ registry: st.registry.map((e) => (e.code === entry.code ? entry : e)) }))
}

// Registry events have no merchant or project, so only Super admin sees them in the Audit Log.
function audit(actor: Actor, action: AuditAction, code: WorkflowCode, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: now(), action, actor, actorRole: 'Super admin', ip: clientIpFor(actor), details: { code, ...details } }))
}

// REQ: DEC-115 — what is stored: the name, the JSON (pretty-printed) and what the portal read from it.
const fields = (input: RegistryInput) => {
  const definition = normaliseDefinition(input.definition)
  return {
    name: input.name.trim(),
    definition,
    ...readDefinition(definition, input.code).definition!,
    accessMerchantIds: input.accessMerchantIds.filter((id) => db.state().merchants.some((m) => m.merchantId === id)),
  }
}

const compact = (json: string) => JSON.stringify(JSON.parse(json))
const merchantsText = (ids: readonly string[]) => ids.map((id) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id).join(', ') || '—'

/** Old and new values for the audit entry: the name, the JSON (compact) and Merchant access. */
function diff(e: RegistryEntry, next: ReturnType<typeof fields>): SettingChange[] {
  const out: SettingChange[] = []
  if (e.name !== next.name) out.push({ field: 'name', from: e.name, to: next.name })
  if (e.definition !== next.definition) out.push({ field: 'definition', from: compact(e.definition), to: compact(next.definition) })
  if (merchantsText(e.accessMerchantIds) !== merchantsText(next.accessMerchantIds)) out.push({ field: 'accessMerchantIds', from: merchantsText(e.accessMerchantIds), to: merchantsText(next.accessMerchantIds) })
  return out
}

export const mockRegistryService: RegistryService = {
  async list(actor) {
    await simulateNetwork('list registry')
    requireRegistry(actor, 'viewRegistry')
    const flows = db.state().flows
    return wire(db.state().registry.map((e) => ({ ...e, flowsUsing: flows.filter((f) => f.workflowVersion === e.code).length })))
  },

  async flowsUsing(code, actor) {
    await simulateNetwork('flows using version')
    requireRegistry(actor, 'viewRegistry')
    load(code)
    const s = db.state()
    return wire(
      s.flows
        .filter((f) => f.workflowVersion === code)
        .map((f) => {
          const p = s.projects.find((x) => x.projectId === f.projectId)
          return { flowId: f.flowId, name: f.name, status: f.status, projectId: f.projectId, projectName: p?.name ?? f.projectId, merchantName: s.merchants.find((m) => m.merchantId === f.merchantId)?.name ?? f.merchantId }
        })
        .sort((a, b) => a.merchantName.localeCompare(b.merchantName) || a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name)),
    )
  },

  // REQ: DEC-56 — Active versions only; for anyone who may create flows somewhere.
  async listSelectable(actor, merchantId) {
    await simulateNetwork('list selectable versions')
    if (projectsWhere(accountOf(actor), 'createFlows', db.state().projects).length === 0) throw new ServiceError('FORBIDDEN', 'You do not have permission to create flows.')
    return wire(
      selectableForNewFlow(db.state().registry, { internal: isInternal(accountOf(actor)), merchantId: merchantId ?? accountOf(actor).merchantId }).map(({ code, name, phases, faceMatchMethod, configurableChecks, riskMinimumsPerFlow, isDefault }) => ({
        code,
        name,
        phases,
        faceMatchMethod,
        configurableChecks,
        riskMinimumsPerFlow,
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
      entryId: newId('wfv'),
      code: input.code.trim(),
      ...fields(input),
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
    if (errors.length) throw validation(errors)
    const next = fields(input)
    const changes = diff(e, next)
    if (!changes.length) throw validation([{ field: 'form', message: 'There are no changes to save.' }])
    // REQ: DEC-115 — editable at any status; flows using it follow the new definition for new sessions, so say why.
    const flowsUsing = db.state().flows.filter((f) => f.workflowVersion === code).length
    const blocked = definitionChangeError(flowsUsing, changes.some((c) => c.field === 'definition'), input.reason)
    if (blocked) throw validation([{ field: 'reason', message: blocked }])
    const at = now().toISOString()
    const updated: RegistryEntry = { ...e, ...next, updatedAt: at, updatedBy: actor.fullName }
    put(updated)
    audit(actor, 'WORKFLOW_UPDATED', code, { changes, ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}) })
    return wire(updated)
  },

  // REQ: DEC-56 / DEC-57 — any status with a reason; the default stays Active.
  async changeStatus(code, to, reason, actor) {
    await simulateNetwork('change workflow status')
    requireActive(actor)
    requireRegistry(actor)
    const e = load(code)
    const blocked = statusChangeError(e, to, reason)
    if (blocked) throw validation([{ field: 'status', message: blocked }])
    const at = now().toISOString()
    const updated: RegistryEntry = { ...e, status: to, activatedAt: e.activatedAt ?? (locksFields(to) ? at : undefined), updatedAt: at, updatedBy: actor.fullName }
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
