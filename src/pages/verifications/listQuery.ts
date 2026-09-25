// Verifications List filter state <-> URL query params <-> service query. Pure, unit-tested.
// Filters live in the URL so a filtered list can be shared and survives refresh / tab switches.
import { RISK_LEVELS, VERIFICATION_STATUSES, type RiskLevel, type VerificationStatus } from '@/domain/types'
import { mytDateToUtcIso } from '@/lib/format'
import type { VerificationQuery } from '@/services/verificationService'

export interface ListFilters {
  referenceNo: string
  fullName: string
  statuses: VerificationStatus[]
  merchantId: string // '' = all in scope
  submittedFrom: string // MYT date yyyy-MM-dd, '' = open
  submittedTo: string
  riskLevels: RiskLevel[]
  claimedBy: string // '' = any, 'UNCLAIMED', or a userId
  lastUpdatedBy: '' | 'SYSTEM' | 'MANUAL'
}

export interface ListParams {
  filters: ListFilters
  page: number
  pageSize: number
}

export const EMPTY_FILTERS: ListFilters = {
  referenceNo: '',
  fullName: '',
  statuses: [],
  merchantId: '',
  submittedFrom: '',
  submittedTo: '',
  riskLevels: [],
  claimedBy: '',
  lastUpdatedBy: '',
}

export const PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 20

const DATE = /^\d{4}-\d{2}-\d{2}$/

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return []
  // Unknown values (e.g. an old "CLAIMED" status in a bookmarked link) are dropped, never passed on.
  return [...new Set(raw.split(','))].filter((v): v is T => (allowed as readonly string[]).includes(v))
}

export function parseListParams(sp: URLSearchParams): ListParams {
  const date = (k: string) => (DATE.test(sp.get(k) ?? '') ? sp.get(k)! : '')
  const updatedBy = sp.get('updatedBy')
  const page = Number(sp.get('page'))
  const size = Number(sp.get('size'))
  return {
    filters: {
      referenceNo: sp.get('referenceNo')?.trim() ?? '',
      fullName: sp.get('fullName')?.trim() ?? '',
      statuses: list(sp.get('status'), VERIFICATION_STATUSES),
      merchantId: sp.get('merchant') ?? '',
      submittedFrom: date('from'),
      submittedTo: date('to'),
      riskLevels: list(sp.get('risk'), RISK_LEVELS),
      claimedBy: sp.get('claimedBy') ?? '',
      lastUpdatedBy: updatedBy === 'SYSTEM' || updatedBy === 'MANUAL' ? updatedBy : '',
    },
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** Only non-default values are written, so a clean list has a clean URL. */
export function toSearchParams(p: ListParams): URLSearchParams {
  const f = p.filters
  const sp = new URLSearchParams()
  const set = (k: string, v: string) => v && sp.set(k, v)
  set('referenceNo', f.referenceNo.trim())
  set('fullName', f.fullName.trim())
  set('status', f.statuses.join(','))
  set('merchant', f.merchantId)
  set('from', f.submittedFrom)
  set('to', f.submittedTo)
  set('risk', f.riskLevels.join(','))
  set('claimedBy', f.claimedBy)
  set('updatedBy', f.lastUpdatedBy)
  if (p.page > 1) sp.set('page', String(p.page))
  if (p.pageSize !== DEFAULT_PAGE_SIZE) sp.set('size', String(p.pageSize))
  return sp
}

/** `scopeMerchantId` (top-bar merchant selector) wins over the Merchant filter. */
export function toQuery(p: ListParams, scopeMerchantId?: string): VerificationQuery {
  const f = p.filters
  return {
    referenceNo: f.referenceNo || undefined,
    fullName: f.fullName || undefined,
    statuses: f.statuses.length ? f.statuses : undefined,
    merchantId: scopeMerchantId ?? (f.merchantId || undefined),
    submittedFrom: f.submittedFrom ? mytDateToUtcIso(f.submittedFrom) : undefined,
    submittedTo: f.submittedTo ? mytDateToUtcIso(f.submittedTo, true) : undefined,
    riskLevels: f.riskLevels.length ? f.riskLevels : undefined,
    claimedBy: f.claimedBy || undefined,
    lastUpdatedBy: f.lastUpdatedBy || undefined,
    page: p.page,
    pageSize: p.pageSize,
  }
}

export function validateFilters(f: ListFilters): string | undefined {
  if (f.submittedFrom && f.submittedTo && f.submittedFrom > f.submittedTo) return 'Submitted “from” date must be on or before the “to” date.'
  return undefined
}
