// Verifications List filter state <-> URL query params <-> service query. Pure, unit-tested.
// Filters live in the URL so a filtered list can be shared and survives refresh / tab switches.
import { RISK_RESULTS, VERIFICATION_STATUSES, type RiskResult, type VerificationStatus } from '@/domain/types'
import { mytDateToUtcIso } from '@/lib/format'
import { VERIFICATION_SORT_KEYS, type VerificationQuery, type VerificationSort, type VerificationSortKey } from '@/services/verificationService'

export const CLAIM_STATES = ['UNCLAIMED', 'MINE', 'OTHERS'] as const
export type ClaimState = (typeof CLAIM_STATES)[number]

// REQ: DEC-43
export interface ListFilters {
  verificationId: string // REQ: DEC-114 — exact
  referenceId: string
  fullName: string
  statuses: VerificationStatus[] // [] = every status
  projectId: string // '' = every project in view
  flowId: string // '' = any
  workflowVersion: string // '' = any
  claim: '' | ClaimState
  createdFrom: string // MYT date yyyy-MM-dd, '' = open
  createdTo: string
  riskResults: RiskResult[]
  lastUpdatedBy: '' | 'SYSTEM' | 'MANUAL'
}

export interface ListParams {
  filters: ListFilters
  /** REQ: DEC-100 — set by clicking a column name; undefined = the default order (Last updated, oldest first). */
  sort?: VerificationSort
  page: number
  pageSize: number
}

/** REQ: DEC-100 — each click on a sortable column: ascending → descending → back to the default order. */
export function nextSort(current: VerificationSort | undefined, by: VerificationSortKey): VerificationSort | undefined {
  if (current?.by !== by) return { by, dir: 'asc' }
  return current.dir === 'asc' ? { by, dir: 'desc' } : undefined
}

function parseSort(raw: string | null): VerificationSort | undefined {
  if (raw === 'newest') return { by: 'lastUpdatedAt', dir: 'desc' } // links from before column sorting
  const [by, dir] = (raw ?? '').split('.')
  return (VERIFICATION_SORT_KEYS as readonly string[]).includes(by) && (dir === 'asc' || dir === 'desc') ? { by: by as VerificationSortKey, dir } : undefined
}

/** REQ: DEC-43 — the default view: Pending Review cases in the user's projects, oldest first (no `sort`). */
export const DEFAULT_FILTERS: ListFilters = {
  verificationId: '',
  referenceId: '',
  fullName: '',
  statuses: ['PENDING_REVIEW'],
  projectId: '',
  flowId: '',
  workflowVersion: '',
  claim: '',
  createdFrom: '',
  createdTo: '',
  riskResults: [],
  lastUpdatedBy: '',
}

export const PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 20

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** In the URL, "every status" is spelled out, because no `status` parameter means the default (Pending Review). */
const ALL_STATUSES = 'ALL'

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return []
  // Unknown values (e.g. an old "CLAIMED" status in a bookmarked link) are dropped, never passed on.
  return [...new Set(raw.split(','))].filter((v): v is T => (allowed as readonly string[]).includes(v))
}

const sameStatuses = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s) => b.includes(s))

export function parseListParams(sp: URLSearchParams): ListParams {
  const date = (k: string) => (DATE.test(sp.get(k) ?? '') ? sp.get(k)! : '')
  const updatedBy = sp.get('updatedBy')
  const claim = sp.get('claim')
  const status = sp.get('status')
  const page = Number(sp.get('page'))
  const size = Number(sp.get('size'))
  const sort = parseSort(sp.get('sort'))
  return {
    filters: {
      verificationId: sp.get('verificationId')?.trim() ?? '',
      referenceId: sp.get('referenceId')?.trim() ?? '',
      fullName: sp.get('fullName')?.trim() ?? '',
      statuses: status === null ? DEFAULT_FILTERS.statuses : status === ALL_STATUSES ? [] : list(status, VERIFICATION_STATUSES),
      projectId: sp.get('project') ?? '',
      flowId: sp.get('flow') ?? '',
      workflowVersion: sp.get('version') ?? '',
      claim: (CLAIM_STATES as readonly string[]).includes(claim ?? '') ? (claim as ClaimState) : '',
      createdFrom: date('from'),
      createdTo: date('to'),
      riskResults: list(sp.get('risk'), RISK_RESULTS),
      lastUpdatedBy: updatedBy === 'SYSTEM' || updatedBy === 'MANUAL' ? updatedBy : '',
    },
    ...(sort && { sort }),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** Only non-default values are written, so the default view has a clean URL. */
export function toSearchParams(p: ListParams): URLSearchParams {
  const f = p.filters
  const sp = new URLSearchParams()
  const set = (k: string, v: string) => v && sp.set(k, v)
  set('verificationId', f.verificationId.trim())
  set('referenceId', f.referenceId.trim())
  set('fullName', f.fullName.trim())
  if (!sameStatuses(f.statuses, DEFAULT_FILTERS.statuses)) sp.set('status', f.statuses.length ? f.statuses.join(',') : ALL_STATUSES)
  set('project', f.projectId)
  set('flow', f.flowId)
  set('version', f.workflowVersion)
  set('claim', f.claim)
  set('from', f.createdFrom)
  set('to', f.createdTo)
  set('risk', f.riskResults.join(','))
  set('updatedBy', f.lastUpdatedBy)
  if (p.sort) sp.set('sort', `${p.sort.by}.${p.sort.dir}`)
  if (p.page > 1) sp.set('page', String(p.page))
  if (p.pageSize !== DEFAULT_PAGE_SIZE) sp.set('size', String(p.pageSize))
  return sp
}

export function isDefaultView(f: ListFilters): boolean {
  return JSON.stringify({ ...f, statuses: [...f.statuses].sort() }) === JSON.stringify(DEFAULT_FILTERS)
}

/**
 * `inView` = the header's project switcher (DEC-73): one project, or all the user's projects. A Project filter only
 * narrows within it; the service scopes to the user's projects anyway (DEC-72).
 */
export function toQuery(p: ListParams, inView?: readonly string[]): VerificationQuery {
  const f = p.filters
  const projectIds = f.projectId && (!inView || inView.includes(f.projectId)) ? [f.projectId] : inView ? [...inView] : undefined
  return {
    verificationId: f.verificationId || undefined,
    referenceId: f.referenceId || undefined,
    fullName: f.fullName || undefined,
    statuses: f.statuses.length ? f.statuses : undefined,
    projectIds,
    flowId: f.flowId || undefined,
    workflowVersion: f.workflowVersion || undefined,
    claim: f.claim || undefined,
    createdFrom: f.createdFrom ? mytDateToUtcIso(f.createdFrom) : undefined,
    createdTo: f.createdTo ? mytDateToUtcIso(f.createdTo, true) : undefined,
    riskResults: f.riskResults.length ? f.riskResults : undefined,
    lastUpdatedBy: f.lastUpdatedBy || undefined,
    ...(p.sort && { sort: p.sort }),
    page: p.page,
    pageSize: p.pageSize,
  }
}

export function validateFilters(f: ListFilters): string | undefined {
  if (f.createdFrom && f.createdTo && f.createdFrom > f.createdTo) return 'Created “from” date must be on or before the “to” date.'
  return undefined
}
