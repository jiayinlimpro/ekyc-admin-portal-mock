// Merchant directory API (mock).
import type { Actor, Merchant } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { accountOf } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { isInternal } from '@/domain/access'

export interface MerchantService {
  list(actor: Actor): Promise<Merchant[]>
  get(merchantId: string, actor: Actor): Promise<Merchant>
}

// Internal accounts (super admin, platform staff) see every merchant's name; everyone else only their own (DEC-99).
function inScope(actor: Actor, merchantId: string): boolean {
  const a = accountOf(actor)
  return isInternal(a) || a.merchantId === merchantId
}

export const mockMerchantService: MerchantService = {
  async list(actor) {
    await simulateNetwork('list merchants')
    return wire(db.state().merchants.filter((m) => inScope(actor, m.merchantId)))
  },

  async get(merchantId, actor) {
    await simulateNetwork('get merchant')
    const m = db.state().merchants.find((x) => x.merchantId === merchantId)
    if (!m || !inScope(actor, merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    return wire(m)
  },
}

export const merchantService: MerchantService = mockMerchantService
