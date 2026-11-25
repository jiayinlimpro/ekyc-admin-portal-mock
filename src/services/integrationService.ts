// Flow Detail › Integration API (mock). DEC-117: each flow has its own API keys and webhook; the key picks the flow.
// DEC-75 / DEC-102: users with View / Manage API keys and webhook, and Super admin. Secrets are mock values, shown once;
// every change is audited with the flow named. Not a flow setting: no reason, no revision (DEC-51).
//   GET    /flows/{id}/integration             get          → 200 Integration | 403 | 404
//   POST   /flows/{id}/api-keys                createKey    → 201 { key, secret }
//   POST   /api-keys/{keyId}/rotate            rotateKey    → 200 { key, secret }
//   DELETE /api-keys/{keyId}                   revokeKey    → 200 key
//   PUT    /flows/{id}/webhook                 setWebhook   → 200 { webhook, secret? } (secret only when created or regenerated)
import { webhookUrlError } from '@/domain/projectSettings'
import type { Actor, Flow, FlowApiKey, FlowWebhook, Project } from '@/domain/types'
import { now } from '@/lib/clock'
import { mockSecret } from '@/mocks/builders'
import { db } from '@/mocks/mockDb'
import { mayInProject, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { findFlow } from './flowService'
import { simulateNetwork, wire } from './network'
import { auditProject, requireInProject, validation } from './projectService'
import { newId } from '@/lib/ids'
import { apiAccess } from '@/domain/merchantRules'

export interface Integration {
  /** REQ: DEC-98 — live only when the merchant is Active; Onboarding = sandbox only; Suspended / Terminated = stopped. */
  apiAccess: ReturnType<typeof apiAccess>
  canManage: boolean
  keys: FlowApiKey[] // newest first
  webhook?: FlowWebhook
}

/** A secret is returned once, on create / rotate / regenerate; afterwards only its hint is shown. */
export interface WithSecret<T> {
  value: T
  secret: string
}

export interface IntegrationService {
  get(flowId: string, actor: Actor): Promise<Integration>
  createKey(flowId: string, name: string, actor: Actor): Promise<WithSecret<FlowApiKey>>
  rotateKey(keyId: string, actor: Actor): Promise<WithSecret<FlowApiKey>>
  revokeKey(keyId: string, actor: Actor): Promise<FlowApiKey>
  setWebhook(flowId: string, input: { url: string; regenerateSecret?: boolean }, actor: Actor): Promise<{ webhook: FlowWebhook; secret?: string }>
}

const hint = (secret: string) => `${secret.slice(0, 8)}…${secret.slice(-4)}`

type Loaded = { flow: Flow; project: Project }

function loadIntegration(actor: Actor, flowId: string, action: 'viewIntegration' | 'manageIntegration' = 'manageIntegration'): Loaded {
  const found = findFlow(actor, flowId) // "not found" outside the user's projects
  requireInProject(actor, action, found.project, action === 'viewIntegration' ? 'view API keys and webhooks' : 'manage API keys and webhooks') // REQ: DEC-75 / DEC-99
  return found
}

function loadKey(actor: Actor, keyId: string) {
  const key = db.state().apiKeys.find((k) => k.keyId === keyId)
  if (!key) throw new ServiceError('NOT_FOUND', `API key ${keyId} not found.`)
  return { key, ...loadIntegration(actor, key.flowId) }
}

/** REQ: DEC-42 / DEC-117 — integration events go to the project's audit log, naming the flow. */
const audit = (actor: Actor, action: 'API_KEY_CREATED' | 'API_KEY_ROTATED' | 'API_KEY_REVOKED' | 'WEBHOOK_CHANGED', { flow, project }: Loaded, details: Record<string, unknown>) =>
  auditProject(actor, action, project, { flowId: flow.flowId, flowName: flow.name, ...details })

const putKey = (key: FlowApiKey) => db.setState((st) => ({ apiKeys: st.apiKeys.map((k) => (k.keyId === key.keyId ? key : k)) }))

export const mockIntegrationService: IntegrationService = {
  async get(flowId, actor) {
    await simulateNetwork('get integration')
    const { project } = loadIntegration(actor, flowId, 'viewIntegration')
    const s = db.state()
    const merchant = s.merchants.find((m) => m.merchantId === project.merchantId)
    return wire({
      apiAccess: apiAccess(merchant?.status ?? 'ACTIVE'),
      canManage: mayInProject(actor, 'manageIntegration', project.projectId), // REQ: DEC-99 — View is read-only
      keys: s.apiKeys.filter((k) => k.flowId === flowId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      webhook: s.webhooks.find((w) => w.flowId === flowId),
    })
  },

  // REQ: DEC-117 — keys can be created at any flow status (e.g. Draft, to build the integration); sessions start only
  // while the flow is Active (DEC-95).
  async createKey(flowId, name, actor) {
    await simulateNetwork('create API key')
    requireActive(actor)
    const loaded = loadIntegration(actor, flowId)
    const n = name.trim()
    if (!n) throw validation([{ field: 'name', message: 'Key name is required' }])
    const existing = db.state().apiKeys.filter((k) => k.flowId === flowId)
    if (existing.some((k) => k.status === 'ACTIVE' && k.name.toLowerCase() === n.toLowerCase())) throw validation([{ field: 'name', message: 'An active key with this name already exists on this flow' }])
    const secret = mockSecret()
    const key: FlowApiKey = {
      keyId: newId('key'),
      flowId,
      name: n,
      secretHint: hint(secret),
      status: 'ACTIVE',
      createdAt: now().toISOString(),
      createdBy: actor.fullName,
    }
    db.setState((st) => ({ apiKeys: [...st.apiKeys, key] }))
    audit(actor, 'API_KEY_CREATED', loaded, { keyId: key.keyId, name: n })
    return wire({ value: key, secret })
  },

  async rotateKey(keyId, actor) {
    await simulateNetwork('rotate API key')
    requireActive(actor)
    const { key, ...loaded } = loadKey(actor, keyId)
    if (key.status !== 'ACTIVE') throw validation([{ field: 'status', message: 'A revoked key cannot be rotated.' }])
    const secret = mockSecret()
    const rotated = { ...key, secretHint: hint(secret), createdAt: now().toISOString(), createdBy: actor.fullName, lastUsedAt: undefined }
    putKey(rotated)
    audit(actor, 'API_KEY_ROTATED', loaded, { keyId, name: key.name, changes: [{ field: 'Secret', from: key.secretHint, to: rotated.secretHint }] })
    return wire({ value: rotated, secret })
  },

  async revokeKey(keyId, actor) {
    await simulateNetwork('revoke API key')
    requireActive(actor)
    const { key, ...loaded } = loadKey(actor, keyId)
    if (key.status === 'REVOKED') return wire(key)
    const revoked = { ...key, status: 'REVOKED' as const, revokedAt: now().toISOString() }
    putKey(revoked)
    audit(actor, 'API_KEY_REVOKED', loaded, { keyId, name: key.name })
    return wire(revoked)
  },

  // REQ: DEC-55 / DEC-117 — POSTs verification.status_changed for this flow's cases, signed with the flow's secret
  // (simulated in the mock).
  async setWebhook(flowId, input, actor) {
    await simulateNetwork('set webhook')
    requireActive(actor)
    const loaded = loadIntegration(actor, flowId)
    const url = input.url.trim()
    const error = webhookUrlError(url)
    if (error) throw validation([{ field: 'url', message: error }])
    const before = db.state().webhooks.find((w) => w.flowId === flowId)
    const secret = !before || input.regenerateSecret ? `whsec_${mockSecret().slice(8)}` : undefined
    const webhook: FlowWebhook = {
      webhookId: before?.webhookId ?? newId('whk'),
      flowId,
      url,
      events: ['verification.status_changed'],
      secretHint: secret ? hint(secret) : before!.secretHint,
      updatedAt: now().toISOString(),
      updatedBy: actor.fullName,
    }
    const changes = [
      ...(before?.url !== url ? [{ field: 'URL', from: before?.url ?? '—', to: url }] : []),
      ...(secret && before ? [{ field: 'Signing secret', from: before.secretHint, to: webhook.secretHint }] : []),
    ]
    if (!changes.length) return wire({ webhook: before! })
    db.setState((st) => ({ webhooks: [...st.webhooks.filter((w) => w.flowId !== flowId), webhook] }))
    audit(actor, 'WEBHOOK_CHANGED', loaded, { changes })
    return wire({ webhook, secret })
  },
}

export const integrationService: IntegrationService = mockIntegrationService
