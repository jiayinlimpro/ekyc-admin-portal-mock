import { useEffect, useState } from 'react'
import { can } from '@/domain/permissions'
import type { Merchant } from '@/domain/types'
import { merchantService } from '@/services/merchantService'
import { ALL_MERCHANTS, useSession } from '@/stores/sessionStore'

/**
 * The merchant scope every service call on a page should use: the admin's top-bar selection, or undefined for
 * "all merchants". Reviewers are scoped server-side, so for them it is undefined too. Also returns merchant names.
 */
export function useScope() {
  const actor = useSession((s) => s.actor)
  const selected = useSession((s) => s.merchantId)
  const [merchants, setMerchants] = useState<Merchant[]>([])
  useEffect(() => {
    let live = true
    merchantService.list(actor).then((m) => live && setMerchants(m), () => live && setMerchants([]))
    return () => {
      live = false
    }
  }, [actor])
  const scope = can(actor, 'canViewAllMerchants') && selected !== ALL_MERCHANTS ? selected : undefined
  const label = scope ? (merchants.find((m) => m.merchantId === scope)?.name ?? scope) : can(actor, 'canViewAllMerchants') ? 'All merchants' : (merchants[0]?.name ?? actor.merchantId ?? '')
  const merchantName = (id: string) => merchants.find((m) => m.merchantId === id)?.name ?? id
  return { actor, scope, label, merchants, merchantName }
}
