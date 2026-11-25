// Project Settings › Integration API (mock). DEC-54, DEC-75: users with Manage API keys and webhook, and Super admin.
// Secrets are mock values, shown once; every change is audited.
//   GET    /projects/{id}/integration          get          → 200 Integration | 403
//   POST   /projects/{id}/api-keys             createKey    → 201 { key, secret }
//   POST   /api-keys/{keyId}/rotate            rotateKey    → 200 { key, secret }
//   DELETE /api-keys/{keyId}                   revokeKey    → 200 key
//   PUT    /projects/{id}/webhook              setWebhook   → 200 { webhook, secret? } (secret only when created or regenerated)
// REQ: DEC-117 — no redirect URLs, web origins or IP allowlist.
import { webhookUrlError } from '@/domain/projectSettings'
import type { Actor, ProjectApiKey, ProjectWebhook } from '@/domain/types'
import { now } from '@/lib/clock'
import { mockSecret } from '@/mocks/builders'
import { db } from '@/mocks/mockDb'
import { requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { auditProject, loadProject, requireInProject, validation } from './projectService'
import { newId } from '@/lib/ids'
import { mayInProject } from './accessGuard'
import { apiAccess } from '@/domain/merchantRules'

export interface Integration {
  /** REQ: DEC-98 — live only when the merchant is Active; Onboarding = sandbox only; Suspended / Terminated = stopped. */
  apiAccess: ReturnType<typeof apiAccess>
  canManage: boolean
  keys: ProjectApiKey[] // newest first
  webhook?: ProjectWebhook
}

/** A secret is returned once, on create / rotate / regenerate; afterwards only its hint is shown. */
export interface WithSecret<T> {
  value: T
  secret: string
}

export interface IntegrationService {
  get(projectId: string, actor: Actor): Promise<Integration>
  createKey(projectId: string, name: string, actor: Actor): Promise<WithSecret<ProjectApiKey>>
  rotateKey(keyId: string, actor: Actor): Promise<WithSecret<ProjectApiKey>>
  revokeKey(keyId: string, actor: Actor): Promise<ProjectApiKey>
  setWebhook(projectId: string, input: { url: string; regenerateSecret?: boolean }, actor: Actor): Promise<{ webhook: ProjectWebhook; secret?: string }>
}

const hint = (secret: string) => `${secret.slice(0, 8)}…${secret.slice(-4)}`

function loadIntegration(actor: Actor, projectId: string, action: 'viewIntegration' | 'manageIntegration' = 'manageIntegration') {
  const p = loadProject(actor, projectId)
  requireInProject(actor, action, p, action === 'viewIntegration' ? 'view API keys and webhooks' : 'manage API keys and webhooks') // REQ: DEC-75 / DEC-99
  return p
}

function loadKey(actor: Actor, keyId: string) {
  const key = db.state().projectKeys.find((k) => k.keyId === keyId)
  if (!key) throw new ServiceError('NOT_FOUND', `API key ${keyId} not found.`)
  return { key, project: loadIntegration(actor, key.projectId) }
}

const putKey = (key: ProjectApiKey) => db.setState((st) => ({ projectKeys: st.projectKeys.map((k) => (k.keyId === key.keyId ? key : k)) }))

export const mockIntegrationService: IntegrationService = {
  async get(projectId, actor) {
    await simulateNetwork('get integration')
    const p = loadIntegration(actor, projectId, 'viewIntegration')
    const s = db.state()
    const merchant = s.merchants.find((m) => m.merchantId === p.merchantId)
    return wire({
      apiAccess: apiAccess(merchant?.status ?? 'ACTIVE'),
      canManage: mayInProject(actor, 'manageIntegration', projectId), // REQ: DEC-99 — View is read-only
      keys: s.projectKeys.filter((k) => k.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      webhook: s.webhooks.find((w) => w.projectId === projectId),
    })
  },

  async createKey(projectId, name, actor) {
    await simulateNetwork('create API key')
    requireActive(actor)
    const p = loadIntegration(actor, projectId)
    const n = name.trim()
    if (!n) throw validation([{ field: 'name', message: 'Key name is required' }])
    const existing = db.state().projectKeys.filter((k) => k.projectId === projectId)
    if (existing.some((k) => k.status === 'ACTIVE' && k.name.toLowerCase() === n.toLowerCase())) throw validation([{ field: 'name', message: 'An active key with this name already exists' }])
    const secret = mockSecret()
    const key: ProjectApiKey = {
      keyId: newId('key'),
      projectId,
      name: n,
      secretHint: hint(secret),
      status: 'ACTIVE',
      createdAt: now().toISOString(),
      createdBy: actor.fullName,
    }
    db.setState((st) => ({ projectKeys: [...st.projectKeys, key] }))
    auditProject(actor, 'API_KEY_CREATED', p, { keyId: key.keyId, name: n })
    return wire({ value: key, secret })
  },

  async rotateKey(keyId, actor) {
    await simulateNetwork('rotate API key')
    requireActive(actor)
    const { key, project } = loadKey(actor, keyId)
    if (key.status !== 'ACTIVE') throw validation([{ field: 'status', message: 'A revoked key cannot be rotated.' }])
    const secret = mockSecret()
    const rotated = { ...key, secretHint: hint(secret), createdAt: now().toISOString(), createdBy: actor.fullName, lastUsedAt: undefined }
    putKey(rotated)
    auditProject(actor, 'API_KEY_ROTATED', project, { keyId, changes: [{ field: 'Secret', from: key.secretHint, to: rotated.secretHint }] })
    return wire({ value: rotated, secret })
  },

  async revokeKey(keyId, actor) {
    await simulateNetwork('revoke API key')
    requireActive(actor)
    const { key, project } = loadKey(actor, keyId)
    if (key.status === 'REVOKED') return wire(key)
    const revoked = { ...key, status: 'REVOKED' as const, revokedAt: now().toISOString() }
    putKey(revoked)
    auditProject(actor, 'API_KEY_REVOKED', project, { keyId, name: key.name })
    return wire(revoked)
  },

  // REQ: DEC-55 — POSTs verification.status_changed signed with the project's secret (simulated in the mock).
  async setWebhook(projectId, input, actor) {
    await simulateNetwork('set webhook')
    requireActive(actor)
    const p = loadIntegration(actor, projectId)
    const url = input.url.trim()
    const error = webhookUrlError(url)
    if (error) throw validation([{ field: 'url', message: error }])
    const before = db.state().webhooks.find((w) => w.projectId === projectId)
    const secret = !before || input.regenerateSecret ? `whsec_${mockSecret().slice(8)}` : undefined
    const webhook: ProjectWebhook = {
      webhookId: before?.webhookId ?? newId('whk'),
      projectId,
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
    db.setState((st) => ({ webhooks: [...st.webhooks.filter((w) => w.projectId !== projectId), webhook] }))
    auditProject(actor, 'WEBHOOK_CHANGED', p, { changes })
    return wire({ webhook, secret })
  },
}

export const integrationService: IntegrationService = mockIntegrationService
