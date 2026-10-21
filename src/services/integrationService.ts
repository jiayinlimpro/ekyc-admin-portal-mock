// Project Settings › Integration API (mock). DEC-54, DEC-75: users with Manage API keys and webhook, and Platform Admin.
// Secrets are mock values, shown once; every change is audited.
//   GET    /projects/{id}/integration          get          → 200 Integration | 403
//   POST   /projects/{id}/api-keys             createKey    → 201 { key, secret }
//   POST   /api-keys/{keyId}/rotate            rotateKey    → 200 { key, secret }
//   DELETE /api-keys/{keyId}                   revokeKey    → 200 key
//   PUT    /projects/{id}/webhook              setWebhook   → 200 { webhook, secret? } (secret only when created or regenerated)
//   PUT    /projects/{id}/access-lists         updateLists  → 200 AccessLists
import { validateAccessLists, webhookUrlError, type AccessLists } from '@/domain/projectSettings'
import type { Actor, ProjectApiKey, ProjectWebhook } from '@/domain/types'
import { now } from '@/lib/clock'
import { mockSecret } from '@/mocks/builders'
import { db } from '@/mocks/mockDb'
import { requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { auditProject, loadProject, requireInProject, saveSettings, validation } from './projectService'

export interface Integration {
  keys: ProjectApiKey[] // newest first
  webhook?: ProjectWebhook
  lists: AccessLists
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
  updateLists(projectId: string, lists: AccessLists, actor: Actor): Promise<AccessLists>
}

const hint = (secret: string) => `${secret.slice(0, 8)}…${secret.slice(-4)}`

function loadIntegration(actor: Actor, projectId: string) {
  const p = loadProject(actor, projectId)
  requireInProject(actor, 'manageIntegration', p, 'manage API keys and webhooks') // REQ: DEC-75
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
    const p = loadIntegration(actor, projectId)
    const s = db.state()
    return wire({
      keys: s.projectKeys.filter((k) => k.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      webhook: s.webhooks.find((w) => w.projectId === projectId),
      lists: { redirectUrls: p.redirectUrls, allowedOrigins: p.allowedOrigins, ipAllowlist: p.ipAllowlist },
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
      keyId: `key_mock_${projectId.toLowerCase()}_${String(existing.length + 1).padStart(2, '0')}`,
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

  async updateLists(projectId, lists, actor) {
    await simulateNetwork('update access lists')
    requireActive(actor)
    const p = loadIntegration(actor, projectId)
    const clean: AccessLists = {
      redirectUrls: lists.redirectUrls.map((v) => v.trim()).filter(Boolean),
      allowedOrigins: lists.allowedOrigins.map((v) => v.trim().replace(/\/$/, '')).filter(Boolean),
      ipAllowlist: lists.ipAllowlist.map((v) => v.trim()).filter(Boolean),
    }
    const errors = validateAccessLists(clean)
    if (errors.length) throw validation(errors)
    const saved = saveSettings(actor, p, clean)
    return wire({ redirectUrls: saved.redirectUrls, allowedOrigins: saved.allowedOrigins, ipAllowlist: saved.ipAllowlist })
  },
}

export const integrationService: IntegrationService = mockIntegrationService
