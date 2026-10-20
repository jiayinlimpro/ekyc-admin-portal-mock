import { useEffect, useState } from 'react'
import type { UserAccount } from '@/domain/types'
import { userService } from '@/services/userService'
import { useSession } from '@/stores/sessionStore'

/**
 * The signed-in user's account (level and project roles), refetched on user switch. `ready` turns true once it has
 * loaded or failed; until then pages should not show role-dependent actions. A failure means no rights at all.
 */
export function useMyAccount(): { account?: UserAccount; ready: boolean } {
  const actor = useSession((s) => s.actor)
  const [state, setState] = useState<{ userId: string; account?: UserAccount }>()
  useEffect(() => {
    let live = true
    userService.me(actor).then(
      (account) => live && setState({ userId: actor.userId, account }),
      () => live && setState({ userId: actor.userId }),
    )
    return () => {
      live = false
    }
  }, [actor])
  return state?.userId === actor.userId ? { account: state.account, ready: true } : { ready: false }
}
