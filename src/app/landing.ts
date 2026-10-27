// REQ: DEC-109 / DEC-104 — where Go to project lands: the first screen of the project's menu the user may open (Overview for
// most roles; e.g. Flows for a Developer, Billing for a Billing role).
import { canAnyInProject, canOnPlatform } from '@/domain/access'
import type { MyProject } from '@/services/projectService'
import type { AccountAccess } from '@/services/userService'
import { NAV_ITEMS } from './nav'

export function projectLandingPath(account: AccountAccess | undefined, project: MyProject): string {
  const first = NAV_ITEMS.find((i) => {
    if (i.layer !== 'inner' || !i.inMenu || !i.built) return false
    if (!i.access) return true
    if (!account) return false
    return 'platform' in i.access ? canOnPlatform(account, i.access.platform) : canAnyInProject(account, i.access.project, project)
  })
  return first?.path ?? '/dashboard'
}
