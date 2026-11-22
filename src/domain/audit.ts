// REQ: DEC-42 — audit entry factory. Entries are append-only.
import type { Actor, AuditAction, AuditEntry, UpdatedBy } from './types'

export function actorRef(actor: Pick<Actor, 'userId' | 'fullName'> | 'SYSTEM'): UpdatedBy {
  return actor === 'SYSTEM' ? { kind: 'SYSTEM' } : { kind: 'USER', userId: actor.userId, fullName: actor.fullName }
}

export function makeAudit(args: {
  id: string
  now: Date
  action: AuditAction
  actor: Pick<Actor, 'userId' | 'fullName'> | 'SYSTEM'
  actorRole?: string
  ip: string
  merchantId?: string
  projectId?: string
  verificationId?: string
  referenceId?: string
  details?: Record<string, unknown>
}): AuditEntry {
  return {
    id: args.id,
    at: args.now.toISOString(),
    action: args.action,
    actor: actorRef(args.actor),
    actorRole: args.actor === 'SYSTEM' ? undefined : args.actorRole,
    merchantId: args.merchantId,
    projectId: args.projectId,
    verificationId: args.verificationId,
    referenceId: args.referenceId,
    ip: args.ip,
    details: args.details ?? {},
  }
}

export function formatUpdatedBy(u: UpdatedBy): string {
  return u.kind === 'SYSTEM' ? 'SYSTEM' : u.fullName // REQ: DEC-97 — names on screen, not user IDs
}
