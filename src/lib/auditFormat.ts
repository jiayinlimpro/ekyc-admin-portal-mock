// Human-readable one-line summary of an audit entry's details, per action. Pure (unit-tested).
import type { AuditEntry, ClaimHolder, SettingChange } from '@/domain/types'
import { formatMyt } from './format'

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function summarizeAudit(e: AuditEntry): string {
  const d = e.details
  switch (e.action) {
    case 'SENSITIVE_PII_VIEW':
      return 'Opened the case page (personal data)'
    case 'CASE_CLAIMED': {
      const until = str(d.claimExpiresAt)
      return until ? `Claim expires ${formatMyt(until)} MYT` : 'Claimed for review'
    }
    case 'CASE_RELEASED':
      return 'Reviewer released their claim'
    case 'CASE_CLAIM_EXPIRED': {
      const who = d.claimedBy as ClaimHolder | undefined
      return `Claim by ${who ? who.fullName : 'unknown'} expired${str(d.claimExpiresAt) ? ` at ${formatMyt(str(d.claimExpiresAt)!)} MYT` : ''}`
    }
    case 'CASE_DECISION_APPROVED':
    case 'CASE_DECISION_REJECTED': {
      const outcome = d.outcome === 'APPROVE' ? 'Approved' : d.outcome === 'REJECT' ? 'Rejected' : String(d.outcome)
      const reasons = str(d.reasons) // REJECT only (DEC-31)
      return `${str(d.fromStatus) ?? '?'} → ${outcome}${reasons ? ` · ${reasons}` : ''}${str(d.note) ? ` · “${str(d.note)}”` : ''}`
    }
    case 'CASE_DECISION_BLOCKED':
      return `Save refused (${d.attempted === 'APPROVE' ? 'approve' : d.attempted === 'REJECT' ? 'reject' : 'decision'}): ${str(d.reason) ?? 'claim not held'}`
    case 'API_KEY_ROTATED':
      return `API key rotated${str(d.keyId) ? ` (${str(d.keyId)})` : ''}`
    default: {
      // Events whose details carry the changed fields (DEC-42 "old and new value").
      const changes = d.changes as SettingChange[] | undefined
      if (changes?.length) return changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(' · ')
      return str(d.summary) ?? ''
    }
  }
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)

/** CSV of audit entries (MYT times). */
export function auditCsv(entries: AuditEntry[], merchantName: (id?: string) => string): string {
  const header = ['Event ID', 'Time (MYT)', 'Action', 'Actor', 'Actor ID', 'Merchant', 'Reference ID', 'Case ID', 'IP', 'Summary']
  const rows = entries.map((e) => [
    e.id,
    formatMyt(e.at),
    e.action,
    e.actor.kind === 'SYSTEM' ? 'SYSTEM' : e.actor.fullName,
    e.actor.kind === 'SYSTEM' ? 'SYSTEM' : e.actor.userId,
    merchantName(e.merchantId),
    e.referenceNo ?? '',
    e.caseId ?? '',
    e.ip,
    summarizeAudit(e),
  ])
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}
