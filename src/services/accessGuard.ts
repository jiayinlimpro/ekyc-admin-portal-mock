// Service-side access checks (DEC-71, DEC-72). The session only says who the user is; what they may do is read from their
// account and project roles, as the real backend would. The legacy `Actor.role` is never trusted here.
import { canInProject, projectsWhere, type ProjectAction } from '@/domain/access'
import type { Actor, Project, UserAccount } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ServiceError } from './errors'

/** The account behind the session. A session for an account that no longer exists has no access at all. */
export function accountOf(actor: Pick<Actor, 'userId'>): UserAccount {
  const a = db.state().accounts.find((x) => x.userId === actor.userId)
  if (!a) throw new ServiceError('FORBIDDEN', 'Your account was not found.')
  return a
}

/** Invited and deactivated users cannot change anything, even with a stale session (DEC-74). */
export function requireActive(actor: Pick<Actor, 'userId'>): UserAccount {
  const a = accountOf(actor)
  if (a.status !== 'ACTIVE') throw new ServiceError('FORBIDDEN', 'Your account is inactive.')
  return a
}

export const projectById = (projectId: string): Project | undefined => db.state().projects.find((p) => p.projectId === projectId)

/** Whether the user may do `action` in a project. An unknown project is never allowed. */
export function mayInProject(actor: Pick<Actor, 'userId'>, action: ProjectAction, projectId: string): boolean {
  const p = projectById(projectId)
  return !!p && canInProject(accountOf(actor), action, p)
}

/** Ids of the projects where the user may do `action` (case lists, dashboard and audit scope; DEC-72, DEC-86). */
export function projectIdsWhere(actor: Pick<Actor, 'userId'>, action: ProjectAction): Set<string> {
  return new Set(projectsWhere(accountOf(actor), action, db.state().projects).map((p) => p.projectId))
}
