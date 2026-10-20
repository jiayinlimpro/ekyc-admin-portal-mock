// Service-side access checks (DEC-71, DEC-72). The session only says who the user is; what they may do is read from their
// account, its role assignments and the roles' current permissions, as the real backend would.
import { canInProject, projectsWhere, roleNamesInProject, type ProjectAction } from '@/domain/access'
import { grantsOf } from '@/domain/roles'
import type { Actor, Project, UserAccess, UserAccount } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ServiceError } from './errors'

/** An account with its grants: editing a role applies at once to everyone holding it (DEC-76). */
export type AccountAccess = UserAccount & UserAccess

/** The account with its grants, resolved against the current roles. */
export const withAccess = (a: UserAccount): AccountAccess => ({ ...a, grants: grantsOf(a.assignments, db.state().roles) })

/** The account behind the session. A session for an account that no longer exists has no access at all. */
export function accountOf(actor: Pick<Actor, 'userId'>): AccountAccess {
  const a = db.state().accounts.find((x) => x.userId === actor.userId)
  if (!a) throw new ServiceError('FORBIDDEN', 'Your account was not found.')
  return withAccess(a)
}

/** Pending and suspended users cannot change anything, even with a stale session (DEC-74). */
export function requireActive(actor: Pick<Actor, 'userId'>): AccountAccess {
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

/** The user's role names in a project, recorded on audit entries (DEC-42), e.g. "Reviewer". */
export function roleIn(actor: Pick<Actor, 'userId'>, projectId: string): string | undefined {
  const p = projectById(projectId)
  return (p && roleNamesInProject(accountOf(actor), p).join(', ')) || undefined
}

/** A new assignment id: ASG-2026-XXXX, unique across all accounts. */
export function nextAssignmentId(): string {
  const ids = db.state().accounts.flatMap((a) => a.assignments.map((x) => Number(x.assignmentId.slice('ASG-2026-'.length))))
  return `ASG-2026-${String(Math.max(0, ...ids.filter(Number.isFinite)) + 1).padStart(4, '0')}`
}

/**
 * A merchant the user may pick in a filter: any merchant for Platform Admin, otherwise only their own (DEC-86). Anything else
 * is "not found", like a case outside the user's projects.
 */
export function requireMerchantInScope(actor: Pick<Actor, 'userId'>, merchantId: string): void {
  const a = accountOf(actor)
  const exists = db.state().merchants.some((m) => m.merchantId === merchantId)
  if (!exists || (a.level !== 'PLATFORM_ADMIN' && a.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
}

/** Ids of the projects where the user may do `action` (case lists, dashboard and audit scope; DEC-72, DEC-86). */
export function projectIdsWhere(actor: Pick<Actor, 'userId'>, action: ProjectAction): Set<string> {
  return new Set(projectsWhere(accountOf(actor), action, db.state().projects).map((p) => p.projectId))
}
