// Audit log API (mock). Read-only: entries are written by the other services.
//   GET /audit?…  → 200 Paged<AuditEntry>
import { canInMerchant } from '@/domain/access'
import type { Actor, AuditAction, AuditEntry, Paged } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, projectIdsWhere } from './accessGuard'
import { sweepExpiredClaims } from './claimSweep'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'

export interface AuditQuery {
  actions?: AuditAction[]
  referenceNo?: string // exact
  merchantId?: string
  projectId?: string
  actorUserId?: string // 'SYSTEM' for system entries
  from?: string // ISO, inclusive
  to?: string // ISO, inclusive
  page?: number
  pageSize?: number
}

export interface AuditService {
  list(q: AuditQuery, actor: Actor): Promise<Paged<AuditEntry>>
}

export const mockAuditService: AuditService = {
  async list(q, actor) {
    await simulateNetwork('list audit')
    // REQ: DEC-70 — Platform Admin: everything; Merchant Owner: the merchant's projects and merchant-wide entries;
    // Project Admin: their projects' entries. Reviewers and Viewers have no Audit Log.
    const me = accountOf(actor)
    const projects = projectIdsWhere(actor, 'viewAudit')
    if (me.level !== 'PLATFORM_ADMIN' && projects.size === 0) throw new ServiceError('FORBIDDEN', 'You do not have permission to view audit logs.')
    const visible = (e: AuditEntry) =>
      me.level === 'PLATFORM_ADMIN' || (e.projectId ? projects.has(e.projectId) : !!e.merchantId && canInMerchant(me, 'viewAudit', e.merchantId))
    sweepExpiredClaims(now())
    const actorId = (e: AuditEntry) => (e.actor.kind === 'SYSTEM' ? 'SYSTEM' : e.actor.userId)
    const rows = db
      .state()
      .audit.filter(
        (e) =>
          visible(e) &&
          (!q.merchantId || e.merchantId === q.merchantId) &&
          (!q.projectId || e.projectId === q.projectId) &&
          (!q.actions?.length || q.actions.includes(e.action)) &&
          (!q.referenceNo || e.referenceNo === q.referenceNo) &&
          (!q.actorUserId || actorId(e) === q.actorUserId) &&
          (!q.from || e.at >= q.from) &&
          (!q.to || e.at <= q.to),
      )
      // Newest first; entries with the same time keep their recorded order (DEC-97: IDs are not time-ordered).
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i)
      .map(({ e }) => e)
    const pageSize = Math.max(1, q.pageSize ?? 50)
    const page = Math.max(1, q.page ?? 1)
    return { items: wire(rows.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total: rows.length }
  },
}

export const auditService: AuditService = mockAuditService
