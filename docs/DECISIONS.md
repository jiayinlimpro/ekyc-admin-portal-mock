# Decisions — source of truth

**Precedence:** this file > latest change summary > FRS (sections above "Archive" only) > old Axure.
Everything from "Archive" onward in the FRS is ignored. If code, FRS or Axure disagree with this file, this file wins.

Each rule has an ID (`DEC-xx`). Tag code that implements a rule with `// REQ: DEC-xx` so QA and devs can trace it.
When FRS IDs are available, add them next to the DEC ID (e.g. `DEC-20 / FRS VER-CLAIM-03`).

---

## Statuses
- **DEC-01** `VerificationStatus` is exactly: `PROCESSING`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`. No other status exists
  (no MANUAL_APPROVED, ERROR, EXPIRED, CLAIMED, IN_REVIEW).
- **DEC-02** Manual vs automated is read from `lastUpdatedBy`: `SYSTEM`, or the reviewer's Full Name + User ID.
- **DEC-03** `lastUpdatedBy` / `lastUpdatedAt` change **only when the status changes**. Claiming, releasing or viewing never touch them.
- **DEC-04** The only lifecycle timestamp is `lastUpdatedAt` (plus the claim fields). The "Submitted" date used by filters is derived
  from the first attempt's `startedAt`; it is not a stored field.

## Automated evaluation (per phase)
- **DEC-10** Thresholds are **per phase**, never per individual metric. Phases: DOCUMENT (Capture & OCR), SELFIE, FACE_MATCH,
  LIVENESS, and RISK_ASSESSMENT (internal engine, **V4 only**). Individual metrics are display-only, grouped by phase.
- **DEC-11** Each capture phase has `autoPass` and `autoReject`: score `>= autoPass` → pass; `< autoReject` → reject;
  in between → review.
- **DEC-12** Phase results combine into a status: any reject → `REJECTED`; otherwise any review → `PENDING_REVIEW`;
  otherwise all pass. *(Precedence is OQ-01 and is configurable.)*
- **DEC-13** V4 only: all capture phases passing is not enough; Risk Assessment must also pass, otherwise `PENDING_REVIEW`
  with reason "Risk Assessment not passed".
- **DEC-14** A system approval is `APPROVED` with `lastUpdatedBy = SYSTEM` ("Auto-Clear").

## Attempts & retries
- **DEC-15** A run that is incomplete, aborted or timed out, or a failed retake, with attempts left → `PROCESSING`.
- **DEC-16** Attempt limit reached → `PENDING_REVIEW` with reason `Attempt limit reached – [Phase]`.
- **DEC-17** Retries keep the same `referenceNo`; each retry is appended to `attempts[]`, never a new record.
- **DEC-18** The Retry KPI counts **user retakes only** (`isUserRetake = true`).

## Claim
- **DEC-20** Claim is **not** a status. It is stored as `claimedBy`, `claimedAt`, `claimExpiresAt`.
- **DEC-21** One owner at a time. Only `PENDING_REVIEW` records can be claimed.
- **DEC-22** Claim timeout is set per merchant (`claimTimeoutMin`). A claim ends only by **Cancel**, **timeout** or **decision**.
- **DEC-23** No supervisor assign, reassign or force-release.
- **DEC-24** Ownership is re-checked **at save time**. If the claim expired, belongs to someone else, or the status is no longer
  `PENDING_REVIEW`, nothing is saved and an `OWNERSHIP_CONFLICT` audit entry is written.
- **DEC-25** Anyone with access to the merchant can **view** any record; opening a record never locks it. Only the Decision
  Overlay is enabled or disabled.

## Decisions
- **DEC-30** The Decision Overlay is enabled only for the active claim owner on a `PENDING_REVIEW` record.
  "Confirm Manual Pass" → `APPROVED`; "Maintain Automated Rejection" → `REJECTED`; `lastUpdatedBy` = the reviewer.
- **DEC-31** A decision requires a Reason Code and an Audit Comment.
- **DEC-32** Decisions are final: no reopen, no "Request Resubmission".
- **DEC-33** `PROCESSING` records are read-only.

## Visibility, PII & audit
- **DEC-40** List view: no PII beyond Full Name and Reference No, and no client metadata. Enforced by the `VerificationSummary` type.
- **DEC-41** Detail view: full unmasked PII + client metadata. **Every** open writes a `PII_VIEW` audit entry.
- **DEC-42** Every mutation writes an audit entry. Audit actions: `PII_VIEW`, `CLAIM`, `CLAIM_RELEASE`, `CLAIM_TIMEOUT`,
  `DECISION`, `OWNERSHIP_CONFLICT`, `CONFIG_DRAFT_SAVE`, `CONFIG_DISCARD`, `CONFIG_DEPLOY`, `CREDENTIAL_ROTATION`.

## Configuration (eKYC Workflow)
- **DEC-50** Configured **per phase**: enabled, Auto-Pass, Auto-Reject, max attempts, cooldown. Risk settings appear for V4 only.
  Claim timeout is a merchant-level setting.
- **DEC-51** Draft → Deploy. Save Draft, Discard Draft and Deploy are each audited; Deploy logs the diff and bumps the minor version.
- **DEC-52** Deployed config applies to **new sessions only**. Each record stores the `configVersion` it was evaluated with.
- **DEC-53** Validation: `0 <= autoReject < autoPass <= 100`, `maxAttempts >= 1`, `cooldownSec >= 0`, `claimTimeoutMin >= 1`.

## Charging
- **DEC-60** Every verification is charged when the end user enters the flow (`charged: true`). Billing column is "Verification Status".
  Whether retakes are charged per attempt is OQ-07.

## Roles
- **DEC-70** Two roles only: Platform Admin and Merchant Reviewer. Permissions are flags checked through one `can(actor, flag)` helper.
- **DEC-71** Client-side permission checks are UI only, not security. The real backend must enforce them.

## Removed / on hold / backlog
- **DEC-80** Manual Review Queue screen: **removed** (replaced by List + claim on Detail).
- **DEC-81** Drop-off KPI: **removed**.
- **DEC-82** Webhooks: **on hold**, shown as a placeholder only.
- **DEC-83** Backlog (greyed "Backlog" chip or omitted): stuck-in-PROCESSING reason, duplicate-face PROCESSING, System Re-Process.

---

## Mock-only design choices (not business decisions)
These keep the mock runnable. They are not signed-off requirements; change them freely.

- **MOCK-01** Attempt counting: each `Attempt` records the phase where it stopped. The limit is reached when the last attempt is
  not `COMPLETED` and the number of attempts that stopped at that phase is `>= maxAttempts` for that phase.
- **MOCK-02** Risk gate: V4 risk passes when `riskLevel <= risk.maxAllowedLevel`. Risk never auto-rejects. *(See OQ-05.)*
- **MOCK-03** Claim expiry is lazy: every service call sweeps expired claims and writes one `CLAIM_TIMEOUT` per expired claim.
- **MOCK-04** Time is read from an injectable clock (`src/lib/clock.ts`) with a dev "time warp" offset, so expiry can be demoed
  without waiting.
- **MOCK-05** Seeded data is deterministic (`faker.seed(2026)`), with dates relative to the moment of seeding. Scenario
  records (S01–S15) have fixed Reference Nos (`KYC-260901-9000NN`) so UAT deep links stay stable.
- **MOCK-06** Fake identity data: NRIC serials always use the `999G` pattern, IPs come from the RFC 5737 documentation ranges,
  and images are "SAMPLE – NOT REAL" placeholders.
- **MOCK-07** Deactivated users (UAM) are refused by the services for claim, cancel and decide, and are not offered as
  reviewers. Their open claims still end by timeout.
- **MOCK-08** Cross-tab sync uses localStorage (last writer wins). It demonstrates the race; the real API needs an atomic
  conditional write (see docs/HANDOFF.md).
- **MOCK-09** Creating a merchant deploys a default config v1.0.0, audited as its first CONFIG_DEPLOY.
- **MOCK-10** The eKYC Workflow what-if preview re-runs `deriveStatus` over the merchant's finished sessions. It is
  read-only and never changes decided records.

## Conflict register (old FRS / Axure → latest decision)
| Topic | Old FRS / Axure | Latest decision |
|---|---|---|
| Statuses | MANUAL_APPROVED, ERROR, EXPIRED | 4 statuses only (DEC-01) |
| Manual vs auto | Separate status | `lastUpdatedBy` (DEC-02) |
| Workflow canvas | High/Mid/Low per metric | Settings per phase (DEC-10, DEC-50) |
| Detail buttons | "Maintain Automated Rejection" / "Confirm Manual Pass" | Kept as overlay actions for the claim owner (DEC-30) |
| Review queue | Separate screen | Removed (DEC-80) |
| Supervisor actions | Assign / reassign / force-release | None (DEC-23) |
| Drop-off KPI | Present | Removed (DEC-81) |
| Webhooks W1–W2 | Configurable | On hold (DEC-82) |
| Roles | 7-role catalogue | 2 roles (DEC-70) |
| Timestamps | Extra fields | `lastUpdatedAt` only (DEC-04) |
| "System Failure Reason" banner | Red banner | "Reason" banner for PENDING_REVIEW / REJECTED (DEC-16) |
