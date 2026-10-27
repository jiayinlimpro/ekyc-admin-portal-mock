// Service-side access checks (DEC-71, DEC-72). The session only says who the user is; what they may do is read from their
// account, its role assignments and the roles' current permissions, as the real backend would.
import { canInProject, isInternal, projectsWhere, roleNamesInProject, type ProjectAction } from '@/domain/access'
import { grantsOf } from '@/domain/roles'
import { internalOnlyFlow, internalOnlySession } from '@/domain/registryRules'
import type { Actor, Flow, Project, UserAccess, UserAccount, Verification } from '@/domain/types'
import { newId } from '@/lib/ids'
import { db } from '@/mocks/mockDb'
import { ServiceError } from './errors'
import { merchantAllowsSignIn } from '@/domain/merchantRules'

/** An account with its grants: editing a role applies at once to everyone holding it (DEC-76). */
export type AccountAccess = UserAccount & UserAccess

/** The account with its grants, resolved against the current roles. */
export const withAccess = (a: UserAccount): AccountAccess => ({ ...a, grants: grantsOf(a.assignments, db.state().roles) })

/** The account behind the session. A session for an account that no longer exists has no access at all. */
export function accountOf(actor: Pick<Actor, 'userId'>): AccountAccess {
  const a = db.state().accounts.find((x) => x.userId === actor.userId)
  if (!a) throw new ServiceError('FORBIDDEN', 'Your account was not found.')
  // REQ: DEC-98 — a Suspended or Terminated merchant's users are signed out at once: every request is refused.
  const m = a.merchantId ? db.state().merchants.find((x) => x.merchantId === a.merchantId) : undefined
  if (m && !merchantAllowsSignIn(m.status)) throw new ServiceError('FORBIDDEN', `${m.name} is ${m.status === 'SUSPENDED' ? 'suspended' : 'terminated'}: its users can’t sign in.`)
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

/** A new role assignment ID (DEC-97). */
export const nextAssignmentId = () => newId('asg')

/**
 * A merchant the user may pick in a filter: any merchant for Super admin, otherwise only their own (DEC-86). Anything else
 * is "not found", like a case outside the user's projects.
 */
export function requireMerchantInScope(actor: Pick<Actor, 'userId'>, merchantId: string): void {
  const a = accountOf(actor)
  const exists = db.state().merchants.some((m) => m.merchantId === merchantId)
  // Internal accounts work across merchants; what they see inside is limited by their permissions (DEC-99).
  if (!exists || (!isInternal(a) && a.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
}

/**
 * REQ: DEC-56 — what a merchant user never sees: flows on an Internal testing version and the test sessions run on one.
 * Internal users (super admins, platform staff) see both. Callers treat a hidden flow or case as "not found".
 */
export function internalTestsFilter(actor: Pick<Actor, 'userId'>): { flow: (f: Pick<Flow, 'workflowVersion'>) => boolean; session: (v: Pick<Verification, 'charged'>) => boolean } {
  if (isInternal(accountOf(actor))) return { flow: () => true, session: () => true }
  const registry = db.state().registry
  return {
    flow: (f) => !internalOnlyFlow(registry.find((e) => e.code === f.workflowVersion)?.status),
    session: (v) => !internalOnlySession(v),
  }
}

/** Ids of the projects where the user may do `action` (case lists, dashboard and audit scope; DEC-72, DEC-86). */
export function projectIdsWhere(actor: Pick<Actor, 'userId'>, action: ProjectAction): Set<string> {
  return new Set(projectsWhere(accountOf(actor), action, db.state().projects).map((p) => p.projectId))
}
