// REQ: DEC-84 / DEC-104 — where "/" lands: Overview for everyone who may open it; a role without dashboards (Support,
// Implementation, Billing, Developer, Member) lands on the first screen of its menu instead of "No access".
import { Navigate } from 'react-router'
import { useAccess } from './access'
import { NAV_ITEMS } from './nav'
import { LANDING_PATH } from './tabs'

/** The first menu screen the user may open, in menu order (Overview first). */
function useLandingPath(): string | undefined {
  const access = useAccess()
  if (!access.ready) return undefined
  return NAV_ITEMS.find((i) => i.inMenu && i.built && access.allows(i.access))?.path ?? LANDING_PATH
}

export function Landing() {
  const path = useLandingPath()
  return path ? <Navigate to={path} replace /> : null
}
