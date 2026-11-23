// REQ: DEC-113 / DEC-26 — one case per end user: a returning Reference ID continues its case in a new session.
// Pure: the caller finds the case (same merchant, same project, same Reference ID) and passes the time in.
import { cooldownFor, newSessionAllowedAt } from './flowRules'
import { sessionTokens } from './dashboards'
import type { Flow, FlowSettings, Verification } from './types'

export type SessionStartRefusal = 'FLOW_NOT_ACTIVE' | 'IN_PROGRESS' | 'IN_REVIEW' | 'APPROVED' | 'COOLDOWN'

export type SessionStart =
  | { kind: 'NEW_CASE' }
  | { kind: 'CONTINUE_CASE' }
  | { kind: 'REFUSED'; code: SessionStartRefusal; message: string; allowedFrom?: string }

/**
 * What a create-session request with this Reference ID does.
 * `existing` = the case with the same Reference ID in the target flow's project (another project starts a new case: OQ-37).
 * `rulesOfLastSession` = the settings of the revision the existing case's last session ran on (its cooldowns, DEC-26).
 */
export function decideSessionStart(
  existing: Pick<Verification, 'status' | 'lastUpdatedAt'> | undefined,
  target: Pick<Flow, 'status'>,
  rulesOfLastSession: Pick<FlowSettings, 'cooldownMin' | 'unsuccessfulCooldownMin'> | undefined,
  now: Date,
): SessionStart {
  if (target.status !== 'ACTIVE') return { kind: 'REFUSED', code: 'FLOW_NOT_ACTIVE', message: 'The flow is not active.' } // DEC-95
  if (!existing) return { kind: 'NEW_CASE' }
  // REQ: OQ-38 — not expected; refused until the PO says otherwise.
  if (existing.status === 'PROCESSING') return { kind: 'REFUSED', code: 'IN_PROGRESS', message: 'This Reference ID already has a session in progress.' }
  if (existing.status === 'PENDING_REVIEW') return { kind: 'REFUSED', code: 'IN_REVIEW', message: 'This Reference ID is waiting for review.' }
  if (existing.status === 'APPROVED') return { kind: 'REFUSED', code: 'APPROVED', message: 'This Reference ID is already approved.' }
  // REJECTED or UNSUCCESSFUL: the cooldown its status picks (DEC-26).
  const until = rulesOfLastSession ? newSessionAllowedAt(existing.lastUpdatedAt, cooldownFor(existing.status, rulesOfLastSession)) : undefined
  if (until && now < until) return { kind: 'REFUSED', code: 'COOLDOWN', message: 'Cooldown running.', allowedFrom: until.toISOString() }
  return { kind: 'CONTINUE_CASE' }
}

/**
 * REQ: DEC-113 — the new session on a REJECTED or UNSUCCESSFUL case: the ended session goes into the history (status, reason,
 * by whom, tokens, attempts), the case is PROCESSING by SYSTEM again with fresh retries, on the given flow of its project.
 */
export function continueCase(v: Verification, target: Pick<Flow, 'flowId' | 'projectId' | 'workflowVersion'> & { configRevision: number }, now: Date): Verification {
  if (v.status !== 'REJECTED' && v.status !== 'UNSUCCESSFUL') throw new Error(`Only a Rejected or Unsuccessful case continues (was ${v.status})`)
  if (target.projectId !== v.projectId) throw new Error('A flow in another project starts a new case (OQ-37)')
  const current = v.sessions.at(-1)!
  const at = now.toISOString()
  return {
    ...v,
    status: 'PROCESSING',
    statusReason: undefined,
    statusDetail: undefined,
    decidedReasons: undefined,
    lastUpdatedBy: { kind: 'SYSTEM' }, // REQ: DEC-03 — the status changed
    lastUpdatedAt: at,
    claimedBy: undefined,
    claimedAt: undefined,
    claimExpiresAt: undefined,
    // Fresh retries: nothing submitted yet in the new session (DEC-108).
    attempts: [],
    submissions: {},
    idCaptureSoftRejects: 0,
    idCapture: undefined,
    riskScores: undefined,
    riskResult: undefined,
    duplicateUser: undefined,
    flowId: target.flowId,
    workflowVersion: target.workflowVersion as Verification['workflowVersion'],
    configRevision: target.configRevision,
    sessions: [
      ...v.sessions.slice(0, -1),
      { ...current, ended: { status: v.status, reason: v.statusReason, at: v.lastUpdatedAt, by: v.lastUpdatedBy, ...sessionTokens(v), attempts: v.attempts } },
      { sessionNo: current.sessionNo + 1, startedAt: at, flowId: target.flowId, workflowVersion: target.workflowVersion as Verification['workflowVersion'], configRevision: target.configRevision },
    ],
  }
}

/** REQ: DEC-42 / DEC-113 — details of the CASE_RESUMED audit entry (SYSTEM). */
export function resumedAuditDetails(before: Verification, after: Verification, flowName: (flowId: string) => string) {
  return {
    fromStatus: before.status,
    toStatus: after.status,
    sessionNo: after.sessions.at(-1)!.sessionNo,
    fromFlowId: before.flowId,
    toFlowId: after.flowId,
    fromFlowName: flowName(before.flowId),
    toFlowName: flowName(after.flowId),
    configRevision: after.configRevision,
  }
}
