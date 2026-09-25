// Merchant directory API (mock).
import { canAccessMerchant } from '@/domain/permissions'
import type { Actor, Merchant } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'

export interface MerchantService {
  list(actor: Actor): Promise<Merchant[]>
  get(merchantId: string, actor: Actor): Promise<Merchant>
}

export const mockMerchantService: MerchantService = {
  async list(actor) {
    await simulateNetwork('list merchants')
    return wire(db.state().merchants.filter((m) => canAccessMerchant(actor, m.merchantId)))
  },

  async get(merchantId, actor) {
    await simulateNetwork('get merchant')
    const m = db.state().merchants.find((x) => x.merchantId === merchantId)
    if (!m || !canAccessMerchant(actor, merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    return wire(m)
  },
}

export const merchantService: MerchantService = mockMerchantService
