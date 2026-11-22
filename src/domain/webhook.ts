// REQ: DEC-55 — what the project's webhook receives when a case changes status.
import type { Verification, WebhookEvent } from './types'

/** The delivery for a case's current status, or none while it is still PROCESSING (only end and review states are sent). */
export function webhookEventFor(v: Pick<Verification, 'verificationId' | 'flowId' | 'referenceId' | 'status' | 'lastUpdatedBy' | 'lastUpdatedAt'>): WebhookEvent | undefined {
  if (v.status === 'PROCESSING') return undefined
  return {
    event: 'verification.status_changed',
    verificationId: v.verificationId,
    flowId: v.flowId,
    referenceId: v.referenceId,
    status: v.status,
    lastUpdatedBy: v.lastUpdatedBy.kind === 'SYSTEM' ? { kind: 'SYSTEM' } : { kind: 'USER', fullName: v.lastUpdatedBy.fullName },
    occurredAt: v.lastUpdatedAt,
  }
}
