// eKYC Workflow configuration API (mock). Per-phase settings, draft → deploy (DEC-50 … DEC-53).
//   GET    /merchants/{id}/config                 getActive
//   GET    /merchants/{id}/config/versions/{v}    getVersion
//   GET    /merchants/{id}/config/draft           getDraft
//   PUT    /merchants/{id}/config/draft           saveDraft  → 422 VALIDATION
//   DELETE /merchants/{id}/config/draft           discardDraft
//   POST   /merchants/{id}/config/deploy          deploy     → 422 VALIDATION (no draft / no changes / invalid)
//   GET    /merchants/{id}/config/versions        listVersions
//   POST   /merchants/{id}/config/preview         previewImpact (what-if on recent sessions; read-only)
import { makeAudit } from '@/domain/audit'
import { bumpMinor, diffConfig, previewImpact, validateConfig, type ImpactCounts } from '@/domain/configRules'
import { can, canAccessMerchant } from '@/domain/permissions'
import type { Actor, MerchantConfig } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

export type ConfigDraftInput = Pick<MerchantConfig, 'phases' | 'risk' | 'claimTimeoutMin' | 'claimWarningMin'>

export interface ConfigService {
  getActive(merchantId: string, actor: Actor): Promise<MerchantConfig>
  getVersion(merchantId: string, version: string, actor: Actor): Promise<MerchantConfig>
  getDraft(merchantId: string, actor: Actor): Promise<MerchantConfig | null>
  saveDraft(merchantId: string, input: ConfigDraftInput, actor: Actor): Promise<MerchantConfig>
  discardDraft(merchantId: string, actor: Actor): Promise<void>
  deploy(merchantId: string, actor: Actor): Promise<MerchantConfig>
  /** Deployed versions, newest first. */
  listVersions(merchantId: string, actor: Actor): Promise<MerchantConfig[]>
  /** SYSTEM outcomes of the merchant's finished sessions under the baseline vs the given draft. */
  previewImpact(merchantId: string, input: ConfigDraftInput, actor: Actor): Promise<{ baseline: ImpactCounts; draft: ImpactCounts }>
}

function record(merchantId: string, actor: Actor) {
  const rec = db.state().configs[merchantId]
  if (!rec || !canAccessMerchant(actor, merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
  return rec
}

function requireConfigure(actor: Actor) {
  if (!can(actor, 'canConfigureWorkflow')) throw new ServiceError('FORBIDDEN', 'You do not have permission to change the eKYC Workflow.')
}

function writeRecord(merchantId: string, patch: Partial<ReturnType<typeof record>>) {
  db.setState((s) => ({ configs: { ...s.configs, [merchantId]: { ...s.configs[merchantId], ...patch } } }))
}

function audit(actor: Actor, action: 'CONFIG_DRAFT_SAVE' | 'CONFIG_DISCARD' | 'CONFIG_DEPLOY', merchantId: string, at: Date, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: at, action, actor, ip: clientIpFor(actor), merchantId, details }))
}

export const mockConfigService: ConfigService = {
  async getActive(merchantId, actor) {
    await simulateNetwork('get config')
    return wire(record(merchantId, actor).deployed)
  },

  async getVersion(merchantId, version, actor) {
    await simulateNetwork('get config version')
    const c = record(merchantId, actor).history.find((h) => h.version === version)
    if (!c) throw new ServiceError('NOT_FOUND', `Config ${version} not found.`)
    return wire(c)
  },

  async getDraft(merchantId, actor) {
    await simulateNetwork('get draft')
    return wire(record(merchantId, actor).draft ?? null)
  },

  async saveDraft(merchantId, input, actor) {
    await simulateNetwork('save draft')
    requireConfigure(actor)
    const rec = record(merchantId, actor)
    const at = now()
    const draft: MerchantConfig = {
      ...rec.deployed,
      phases: input.phases,
      risk: rec.deployed.workflowVersion === 'V4' ? input.risk : undefined, // risk settings exist for V4 only
      claimTimeoutMin: input.claimTimeoutMin,
      claimWarningMin: input.claimWarningMin,
      version: bumpMinor(rec.deployed.version),
      state: 'DRAFT',
      updatedAt: at.toISOString(),
      updatedBy: { userId: actor.userId, fullName: actor.fullName },
      deployedAt: undefined,
    }
    const errors = validateConfig(draft)
    if (errors.length) throw new ServiceError('VALIDATION', 'The draft has validation errors.', errors)
    writeRecord(merchantId, { draft })
    audit(actor, 'CONFIG_DRAFT_SAVE', merchantId, at, { draftVersion: draft.version, changes: diffConfig(rec.deployed, draft) })
    return wire(draft)
  },

  async discardDraft(merchantId, actor) {
    await simulateNetwork('discard draft')
    requireConfigure(actor)
    const rec = record(merchantId, actor)
    if (!rec.draft) return
    writeRecord(merchantId, { draft: undefined })
    audit(actor, 'CONFIG_DISCARD', merchantId, now(), { draftVersion: rec.draft.version })
  },

  // REQ: DEC-51 / DEC-52 — new sessions only: existing records keep their configVersion.
  async deploy(merchantId, actor) {
    await simulateNetwork('deploy config')
    requireConfigure(actor)
    const rec = record(merchantId, actor)
    if (!rec.draft) throw new ServiceError('VALIDATION', 'There is no draft to deploy.')
    const errors = validateConfig(rec.draft)
    if (errors.length) throw new ServiceError('VALIDATION', 'The draft has validation errors.', errors)
    const changes = diffConfig(rec.deployed, rec.draft)
    if (!changes.length) throw new ServiceError('VALIDATION', 'The draft has no changes to deploy.')
    const at = now()
    const deployed: MerchantConfig = {
      ...rec.draft,
      version: bumpMinor(rec.deployed.version),
      state: 'DEPLOYED',
      updatedAt: at.toISOString(),
      updatedBy: { userId: actor.userId, fullName: actor.fullName },
      deployedAt: at.toISOString(),
    }
    writeRecord(merchantId, { deployed, draft: undefined, history: [...rec.history, deployed] })
    audit(actor, 'CONFIG_DEPLOY', merchantId, at, { fromVersion: rec.deployed.version, toVersion: deployed.version, changes })
    return wire(deployed)
  },

  async listVersions(merchantId, actor) {
    await simulateNetwork('list config versions')
    return wire([...record(merchantId, actor).history].reverse())
  },

  async previewImpact(merchantId, input, actor) {
    await simulateNetwork('preview config')
    const rec = record(merchantId, actor)
    const sessions = db.state().verifications.filter((v) => v.merchantId === merchantId)
    const draft = { ...rec.deployed, ...input, risk: rec.deployed.workflowVersion === 'V4' ? input.risk : undefined }
    return { baseline: previewImpact(sessions, rec.deployed), draft: previewImpact(sessions, draft) }
  },
}

export const configService: ConfigService = mockConfigService
