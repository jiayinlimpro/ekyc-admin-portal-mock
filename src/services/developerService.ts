// Developer credentials API (mock). Secrets are fake (sk_mock_…); everything in a front-end bundle is public anyway.
//   GET  /merchants/{id}/credentials          → masked
//   POST /merchants/{id}/credentials/reveal   → secret (real API: step-up auth, short-lived)
//   POST /merchants/{id}/credentials/rotate   → new key; audited API_KEY_ROTATED
import { makeAudit } from '@/domain/audit'
import { can, canAccessMerchant } from '@/domain/permissions'
import type { Actor, ApiCredential } from '@/domain/types'
import { now } from '@/lib/clock'
import { mockSecret } from '@/mocks/builders'
import { db } from '@/mocks/mockDb'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

export type MaskedCredential = Omit<ApiCredential, 'secret'> & { masked: string }

export const maskSecret = (secret: string) => `${secret.slice(0, 8)}${'•'.repeat(20)}${secret.slice(-4)}`

export interface DeveloperService {
  getCredential(merchantId: string, actor: Actor): Promise<MaskedCredential>
  revealCredential(merchantId: string, actor: Actor): Promise<string>
  rotateCredential(merchantId: string, actor: Actor): Promise<MaskedCredential>
}

function credential(merchantId: string, actor: Actor): ApiCredential {
  if (!can(actor, 'canRotateKeys')) throw new ServiceError('FORBIDDEN', 'You do not have permission to manage API credentials.')
  const c = db.state().apiKeys[merchantId]
  if (!c || !canAccessMerchant(actor, merchantId)) throw new ServiceError('NOT_FOUND', `No credentials for ${merchantId}.`)
  return c
}

const masked = ({ secret, ...rest }: ApiCredential): MaskedCredential => ({ ...rest, masked: maskSecret(secret) })

export const mockDeveloperService: DeveloperService = {
  async getCredential(merchantId, actor) {
    await simulateNetwork('get credential')
    return wire(masked(credential(merchantId, actor)))
  },

  async revealCredential(merchantId, actor) {
    await simulateNetwork('reveal credential')
    return credential(merchantId, actor).secret
  },

  async rotateCredential(merchantId, actor) {
    await simulateNetwork('rotate credential')
    const old = credential(merchantId, actor)
    const n = Number(old.keyId.split('_').at(-1)) + 1
    const at = now()
    const next: ApiCredential = { merchantId, keyId: `${old.keyId.split('_').slice(0, -1).join('_')}_${String(n).padStart(2, '0')}`, secret: mockSecret(), createdAt: at.toISOString(), createdBy: actor.fullName }
    db.setState((s) => ({ apiKeys: { ...s.apiKeys, [merchantId]: next } }))
    db.appendAudit(makeAudit({ id: '', now: at, action: 'API_KEY_ROTATED', actor, ip: clientIpFor(actor), merchantId, details: { fromKeyId: old.keyId, keyId: next.keyId } }))
    return wire(masked(next))
  },
}

export const developerService: DeveloperService = mockDeveloperService
