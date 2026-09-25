// Human-readable one-line summary of an audit entry's details, per action. Pure (unit-tested).
import type { ConfigChange } from '@/domain/configRules'
import { reasonLabel } from '@/domain/openQuestions'
import type { AuditEntry, ClaimHolder } from '@/domain/types'
import { formatMyt } from './format'

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function summarizeAudit(e: AuditEntry): string {
  const d = e.details
  switch (e.action) {
    case 'PII_VIEW':
      return 'Opened the record with unmasked personal data'
    case 'CLAIM': {
      const until = str(d.claimExpiresAt)
      return until ? `Claim expires ${formatMyt(until)} MYT` : 'Claimed for review'
    }
    case 'CLAIM_RELEASE':
      return 'Reviewer cancelled their claim'
    case 'CLAIM_TIMEOUT': {
      const who = d.claimedBy as ClaimHolder | undefined
      return `Claim by ${who ? `${who.fullName} (${who.userId})` : 'unknown'} expired${str(d.claimExpiresAt) ? ` at ${formatMyt(str(d.claimExpiresAt)!)} MYT` : ''}`
    }
    case 'DECISION': {
      const outcome = d.outcome === 'APPROVE' ? 'Approved' : d.outcome === 'REJECT' ? 'Rejected' : String(d.outcome)
      const reason = reasonLabel(str(d.reasonCode) ?? '') ?? str(d.reasonCode) ?? '—'
      return `${str(d.fromStatus) ?? '?'} → ${outcome} · ${reason}${str(d.comment) ? ` · “${str(d.comment)}”` : ''}`
    }
    case 'OWNERSHIP_CONFLICT':
      return `Save refused (${d.attempted === 'APPROVE' ? 'approve' : d.attempted === 'REJECT' ? 'reject' : 'decision'}): ${str(d.reason) ?? 'claim not held'}`
    case 'CONFIG_DRAFT_SAVE': {
      const n = (d.changes as ConfigChange[] | undefined)?.length ?? 0
      return `Draft ${str(d.draftVersion) ?? ''} saved · ${n} change(s) vs production`
    }
    case 'CONFIG_DISCARD':
      return `Draft ${str(d.draftVersion) ?? ''} discarded`
    case 'CONFIG_DEPLOY': {
      const n = (d.changes as ConfigChange[] | undefined)?.length ?? 0
      return d.fromVersion ? `${str(d.fromVersion)} → ${str(d.toVersion)} · ${n} change(s)` : `Initial deployment ${str(d.toVersion)}`
    }
    case 'CREDENTIAL_ROTATION':
      return `API key rotated${str(d.keyId) ? ` (${str(d.keyId)})` : ''}`
  }
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)

/** CSV of audit entries (MYT times). */
export function auditCsv(entries: AuditEntry[], merchantName: (id?: string) => string): string {
  const header = ['Audit ID', 'Time (MYT)', 'Action', 'Actor', 'Actor ID', 'Merchant', 'Reference No', 'IP', 'Summary']
  const rows = entries.map((e) => [
    e.id,
    formatMyt(e.at),
    e.action,
    e.actor.kind === 'SYSTEM' ? 'SYSTEM' : e.actor.fullName,
    e.actor.kind === 'SYSTEM' ? 'SYSTEM' : e.actor.userId,
    merchantName(e.merchantId),
    e.referenceNo ?? '',
    e.ip,
    summarizeAudit(e),
  ])
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}
