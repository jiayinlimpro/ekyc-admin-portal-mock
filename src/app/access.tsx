// What the signed-in user may reach, loaded once per user for the header, menu and page guard (DEC-71 … DEC-73, DEC-109).
// UI only: every service checks again.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { canAnyInProject, canOnPlatform, type PlatformAction, type ProjectAction } from '@/domain/access'
import { projectService, type MyProject } from '@/services/projectService'
import { userService, type AccountAccess } from '@/services/userService'
import { useSession } from '@/stores/sessionStore'

/**
 * Who may open a screen. `project`: the user's role in the selected project (in Merchant settings: in the merchant's
 * projects). `platform`: super admins, and platform staff with that permission.
 */
export type AccessRule = { project: ProjectAction | readonly ProjectAction[] } | { platform: PlatformAction }

export interface Access {
  ready: boolean
  /** Loading the account or projects failed (e.g. network): show a retry, not "No access". */
  error?: string
  retry: () => void
  /** The account with its grants (DEC-70). */
  account?: AccountAccess
  /** Every project the user's assignments cover (the Merchants page, the header's switchers). */
  projects: MyProject[]
  /** REQ: DEC-109 — the inner portal's project (Go to project). A user with one project always has it. */
  selected?: MyProject
  /** The projects in view: the selected one; in Merchant settings, the merchant's projects. */
  inView: MyProject[]
  /** REQ: DEC-109 — set inside Merchant settings: its pages show the whole merchant. */
  merchantScope?: string
  allows: (rule: AccessRule | undefined) => boolean
}

const AccessContext = createContext<Access>({ ready: false, retry: () => {}, projects: [], inView: [], allows: () => false })

function allowsIn(account: AccountAccess | undefined, inView: readonly MyProject[]) {
  return (rule: AccessRule | undefined) => {
    if (!rule) return true
    if (!account) return false
    if ('platform' in rule) return canOnPlatform(account, rule.platform)
    return inView.some((p) => canAnyInProject(account, rule.project, p))
  }
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const actor = useSession((s) => s.actor)
  const projectId = useSession((s) => s.projectId)
  const [loaded, setLoaded] = useState<{ userId: string; account?: AccountAccess; projects: MyProject[]; error?: string }>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    Promise.all([userService.me(actor), projectService.listMine(actor)]).then(
      ([account, projects]) => live && setLoaded({ userId: actor.userId, account, projects }),
      (e: unknown) => live && setLoaded({ userId: actor.userId, projects: [], error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [actor, attempt])

  const value = useMemo<Access>(() => {
    const ready = loaded?.userId === actor.userId
    const account = ready ? loaded.account : undefined
    const projects = ready ? loaded.projects : []
    const selected = projects.find((p) => p.projectId === projectId) ?? (projects.length === 1 ? projects[0] : undefined)
    const inView = selected ? [selected] : []
    const retry = () => {
      setLoaded(undefined)
      setAttempt((n) => n + 1)
    }
    return { ready, error: ready ? loaded.error : undefined, retry, account, projects, selected, inView, allows: allowsIn(account, inView) }
  }, [loaded, actor, projectId])

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

/** REQ: DEC-109 — Merchant settings: the pages inside see every project of the merchant the user can reach, no project. */
export function MerchantScope({ merchantId, children }: { merchantId: string; children: ReactNode }) {
  const access = useAccess()
  const value = useMemo<Access>(() => {
    const inView = access.projects.filter((p) => p.merchantId === merchantId)
    return { ...access, selected: undefined, inView, merchantScope: merchantId, allows: allowsIn(access.account, inView) }
  }, [access, merchantId])
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export const useAccess = () => useContext(AccessContext)
