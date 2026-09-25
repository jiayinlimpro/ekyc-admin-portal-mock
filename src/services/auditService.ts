// Audit log API (mock). Read-only: entries are written by the other services.
//   GET /audit?…  → 200 Paged<AuditEntry>
import { can } from '@/domain/permissions'
import type { Actor, AuditAction, AuditEntry, Paged } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { sweepExpiredClaims } from './claimSweep'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'

export interface AuditQuery {
  actions?: AuditAction[]
  referenceNo?: string // exact
  merchantId?: string
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
    if (!can(actor, 'canViewAudit')) throw new ServiceError('FORBIDDEN', 'You do not have permission to view audit logs.')
    sweepExpiredClaims(now())
    const scope = can(actor, 'canViewAllMerchants') ? undefined : actor.merchantId
    const actorId = (e: AuditEntry) => (e.actor.kind === 'SYSTEM' ? 'SYSTEM' : e.actor.userId)
    const rows = db
      .state()
      .audit.filter(
        (e) =>
          (!scope || e.merchantId === scope) &&
          (!q.merchantId || e.merchantId === q.merchantId) &&
          (!q.actions?.length || q.actions.includes(e.action)) &&
          (!q.referenceNo || e.referenceNo === q.referenceNo) &&
          (!q.actorUserId || actorId(e) === q.actorUserId) &&
          (!q.from || e.at >= q.from) &&
          (!q.to || e.at <= q.to),
      )
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    const pageSize = Math.max(1, q.pageSize ?? 50)
    const page = Math.max(1, q.page ?? 1)
    return { items: wire(rows.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total: rows.length }
  },
}

export const auditService: AuditService = mockAuditService
