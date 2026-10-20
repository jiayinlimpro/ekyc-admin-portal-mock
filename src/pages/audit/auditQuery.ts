// Audit Logs filters <-> URL <-> service query (same pattern as the Verifications List).
import { AUDIT_ACTIONS, type AuditAction } from '@/domain/types'
import { mytDateToUtcIso } from '@/lib/format'
import type { AuditQuery } from '@/services/auditService'

export interface AuditFilters {
  actions: AuditAction[]
  referenceNo: string
  actorUserId: string // '' any, 'SYSTEM', or a userId
  merchantId: string
  from: string // MYT yyyy-MM-dd
  to: string
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { actions: [], referenceNo: '', actorUserId: '', merchantId: '', from: '', to: '' }
export const AUDIT_PAGE_SIZES = [25, 50, 100] as const
const DEFAULT_SIZE = 50
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface AuditParams {
  filters: AuditFilters
  page: number
  pageSize: number
}

export function parseAuditParams(sp: URLSearchParams): AuditParams {
  const actions = (sp.get('action') ?? '').split(',').filter((a): a is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(a))
  const date = (k: string) => (DATE.test(sp.get(k) ?? '') ? sp.get(k)! : '')
  const page = Number(sp.get('page'))
  const size = Number(sp.get('size'))
  return {
    filters: { actions: [...new Set(actions)], referenceNo: sp.get('ref')?.trim() ?? '', actorUserId: sp.get('actor') ?? '', merchantId: sp.get('merchant') ?? '', from: date('from'), to: date('to') },
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (AUDIT_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_SIZE,
  }
}

export function toAuditSearch(p: AuditParams): URLSearchParams {
  const f = p.filters
  const sp = new URLSearchParams()
  const set = (k: string, v: string) => v && sp.set(k, v)
  set('action', f.actions.join(','))
  set('ref', f.referenceNo.trim())
  set('actor', f.actorUserId)
  set('merchant', f.merchantId)
  set('from', f.from)
  set('to', f.to)
  if (p.page > 1) sp.set('page', String(p.page))
  if (p.pageSize !== DEFAULT_SIZE) sp.set('size', String(p.pageSize))
  return sp
}

/** `projectId` = the header's selected project (DEC-73); under "All my projects" the service scopes by role (DEC-70). */
export function toAuditQuery(p: AuditParams, projectId?: string): AuditQuery {
  const f = p.filters
  return {
    actions: f.actions.length ? f.actions : undefined,
    referenceNo: f.referenceNo ? f.referenceNo.toUpperCase() : undefined,
    actorUserId: f.actorUserId || undefined,
    merchantId: projectId ? undefined : f.merchantId || undefined,
    projectId,
    from: f.from ? mytDateToUtcIso(f.from) : undefined,
    to: f.to ? mytDateToUtcIso(f.to, true) : undefined,
    page: p.page,
    pageSize: p.pageSize,
  }
}
