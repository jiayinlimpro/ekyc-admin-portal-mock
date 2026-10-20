// What the signed-in user may reach, loaded once per user for the header, menu and page guard (DEC-71 … DEC-73).
// UI only: every service checks again.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { canInProject, canOnPlatform, type PlatformAction, type ProjectAction } from '@/domain/access'
import { projectService, type MyProject } from '@/services/projectService'
import { userService, type AccountAccess } from '@/services/userService'
import { ALL_PROJECTS, useSession } from '@/stores/sessionStore'

/**
 * Who may open a screen. `project`: the user's role in the selected project (or in any of their projects under "All my
 * projects"). `platform`: Platform Admin only.
 */
export type AccessRule = { project: ProjectAction } | { platform: PlatformAction }

export interface Access {
  ready: boolean
  /** Loading the account or projects failed (e.g. network): show a retry, not "No access". */
  error?: string
  retry: () => void
  /** The account with its grants (DEC-70). */
  account?: AccountAccess
  /** Every project the user's assignments cover (switcher options). */
  projects: MyProject[]
  /** The selected project; undefined = "All my projects". A user with one project always has it selected. */
  selected?: MyProject
  /** The projects in view: the selected one, or all of them. */
  inView: MyProject[]
  allows: (rule: AccessRule | undefined) => boolean
}

const AccessContext = createContext<Access>({ ready: false, retry: () => {}, projects: [], inView: [], allows: () => false })

export function AccessProvider({ children }: { children: ReactNode }) {
  const actor = useSession((s) => s.actor)
  const projectId = useSession((s) => s.projectId) ?? ALL_PROJECTS
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
    const chosen = projectId === ALL_PROJECTS ? undefined : projects.find((p) => p.projectId === projectId)
    const selected = chosen ?? (projects.length === 1 ? projects[0] : undefined)
    const inView = selected ? [selected] : projects
    const allows = (rule: AccessRule | undefined) => {
      if (!rule) return true
      if (!account) return false
      if ('platform' in rule) return canOnPlatform(account, rule.platform)
      return inView.some((p) => canInProject(account, rule.project, p))
    }
    const retry = () => {
      setLoaded(undefined)
      setAttempt((n) => n + 1)
    }
    return { ready, error: ready ? loaded.error : undefined, retry, account, projects, selected, inView, allows }
  }, [loaded, actor, projectId])

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export const useAccess = () => useContext(AccessContext)
