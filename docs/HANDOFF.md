# Engineering handoff

What the mock gives engineering, and what the real backend must do that a mock cannot.

## 1. Draft contract

- **Types:** `src/domain/types.ts`. Merchant → Project → Flow (FlowSettings, FlowRevision) → Verification
  (VerificationSummary for lists: no PII; VerificationDetail), UserAccount (level + RoleAssignment[]), Role, RegistryEntry,
  ProjectApiKey, ProjectWebhook, AuditEntry, Decision, Paged. Treat it as a first draft of the API/DB schema.
- **Access control:** the full model for engineers (account types, permissions, roles, scopes, the check algorithm,
  every endpoint's check, invariants, a suggested schema and test accounts) is in **`docs/ACCESS_CONTROL.md`**.
- **Account types (DEC-99, DEC-104):** super admin (outside the role system); platform staff (one platform role, no
  scope: every merchant); merchant user (one merchant role for the whole merchant, plus project roles from Members).
  No masking: View list (no personal data) and View details are separate permissions, enforced by the API; log every
  case page open. Access rows have no end date (DEC-74).
- **Identifiers (DEC-97):** every stored record has a prefixed cuid2 ID (`prj_…`, `flw_…`, `vrf_…`, `att_…`, `usr_…`, `rol_…`,
  `asg_…`, `inv_…`, `key_…`, `whk_…`, `wfv_…`, `rev_…`, `file_…`, `evt_…`, `mer_…`); sort lists by created time, never by ID.
  The **Verification ID** (`verificationId`, DEC-114) addresses a case in URLs, the API and webhooks; the **Reference ID**
  (`referenceId`) is the merchant's own value, stored beside it (OQ-17, OQ-28). Only flow, verification, API key (masked) and webhook event IDs are shown in the UI. The mock makes
  cuid2-shaped IDs itself (`src/lib/ids.ts`); use the cuid2 library (or UUIDv7) in the backend. Secrets are random
  tokens stored hashed, never IDs.
- **Endpoints:** each file in `src/services/` starts with the REST shape it stands in for. Error codes map to HTTP
  status in `src/services/errors.ts`.

| Area | Endpoint (draft) | Notes |
|---|---|---|
| Verifications | `GET /verifications?…` | Returns summaries only: no NRIC, passport, address or client metadata (DEC-40). `sort` = `referenceNo` / `status` / `riskLevel` / `lastUpdatedAt` + `asc` / `desc`; omitted = Last updated, oldest first (DEC-100) |
| | `GET /verifications/{verificationId}` | Full PII + client metadata, `idCapture`, per-attempt `telemetry` and `faceImage`, `duplicateUser` (information only), `riskScores` (four categories, 0–100, higher = more genuine) and `riskResult` (`CLEAR` / `FLAGGED`, DEC-107); the **server** writes `SENSITIVE_PII_VIEW` for every open (DEC-41). Engine thresholds: `ENGINE_THRESHOLDS` in `domain/telemetry.ts` |
| | `POST /verifications/{verificationId}/claim` | 409 `ALREADY_CLAIMED` / `NOT_CLAIMABLE`; claim is not a status (DEC-20) |
| | `DELETE /verifications/{verificationId}/claim` | Owner only; 409 `NOT_CLAIM_OWNER`; no supervisor release (DEC-23) |
| | `POST /verifications/{verificationId}/decision` | Body `{ outcome, reasonCodes, note? }`. Re-checks ownership at save; 409 `OWNERSHIP_CONFLICT`, audited `CASE_DECISION_BLOCKED` (DEC-24); 422 unless Reject has one or more and Approve exactly one active reason of the case's project, or when a chosen reason needs a note (DEC-31, DEC-106). The case keeps `decidedReasons` (code and name at the time). `GET` returns the project's active reasons as `reasonOptions` |
| Projects | `GET /projects/mine`, `GET /projects`, `POST /merchants/{id}/projects`, `PATCH /projects/{id}`, `POST …/archive` | Access from scoped role assignments; "not found" outside the user's projects (DEC-72) |
| | `PATCH /projects/{id}/general`, `PATCH …/review-ops` | Branding, language; `claimTimeoutSec` in seconds, >= 60 (the UI enters whole minutes and sends × 60) (DEC-53, DEC-54) |
| | `POST /projects/{id}/decision-reasons`, `PATCH …/{code}`, `POST …/{code}/status` | Custom decision reasons (code generated, never deleted); System Default ones only turn off; "Other" stays on; 422 for a duplicate name per outcome; audited `PROJECT_SETTING_CHANGED` (DEC-106) |
| Integration | `GET /projects/{id}/integration`, `POST …/api-keys`, `POST /api-keys/{id}/rotate`, `DELETE /api-keys/{id}`, `PUT …/webhook`, `PUT …/access-lists` | Manage API keys and webhook, and Platform Admin (DEC-75); secrets returned once, only a hint stored |
| Flows | `GET /projects/{id}/flows`, `GET /flows/{id}`, `POST …/flows`, `PUT /flows/{id}`, `POST /flows/{id}/activate | retire | duplicate` | Saving an Active flow needs a reason and creates `<Version>-R<n>` for new sessions only (DEC-51, DEC-52). No default flow: create-session requires `flowId` (DEC-95) |
| Registry | `GET /registry`, `GET /registry/selectable?merchantId=` (DEC-56: Internal testing for internal users, Limited release for `accessMerchantIds`), `POST /registry`, `PUT /registry/{code}`, `POST …/status`, `POST …/default`, `GET …/flows` | Platform Admin; only Active versions selectable (DEC-56, DEC-57) |
| Users | `GET /users`, `GET /users/{id}`, `POST /merchants/{id}/users`, `POST /users/{id}/invitation`, `PUT /users/{id}/role`, `POST /users/{id}/suspend | reactivate`, `GET|POST|DELETE /projects/{id}/members` | One merchant role per user (Member by default); project roles only in Members, never with merchant-wide permissions; grant only what you hold; one Owner remains; changes release claims (DEC-74, DEC-77, DEC-104) |
| Platform Users (platform staff) | `GET /staff`, `GET /staff/{id}`, `POST /staff`, `POST /staff/{id}/invitation`, `PUT /staff/{id}/role`, `POST /staff/{id}/suspend | reactivate` | Super admin only, "not found" otherwise; one platform role, no scope; company staff domain (OQ-31). The list includes the one super admin (`fixed: true`), and any change to it is 422: created by the seed, never changed (DEC-110). A platform role holds every merchant module too (users, roles, projects, members… in every merchant) (DEC-99, DEC-104) |
| Roles | `GET /roles`, `GET /projects/{id}/roles`, `GET /merchants/{id}/roles/assignable[?projectId=]`, `POST /merchants/{id}/roles` (with `projectId`: a project role), `PUT /roles/{id}`, `POST /roles/{id}/status` | Two tables (DEC-104): merchant roles (level MERCHANT; Users) and project roles (level PROJECT; one project's Members; System Default ones in every project, Custom ones in their project). System Default locked; edits apply to every holder at once; a role still held can't be deactivated (DEC-76) |
| Merchants | `GET/POST /merchants`, `PATCH /merchants/{id}`, `POST /merchants/{id}/status`, `POST /merchants/{id}/invitation` | Super admin, or staff with Merchants View / Create / Suspend; FRS fields, registration number unique per country (SSM 12-digit for Malaysia); status changes need a reason; Suspended / Terminated must revoke the merchant's sessions and API keys at once; no delete (DEC-98); a new merchant gets a Default project, a Draft "First flow" and owner (DEC-92) |
| Audit | `GET /audit?…` | Append-only; project entries for whoever has Audit log in that project, merchant-level entries for Audit log through the merchant role (or staff), platform entries for the super admin only (`docs/ACCESS_CONTROL.md` §9) |
| Analytics | `GET /analytics/filters`, `/analytics/overview`, `/analytics/intelligence`, `GET /billing` | Every role, data scoped (DEC-86); tokens per liveness submission (DEC-60) |

## 2. Executable business rules

`src/domain/*Rules.ts` plus their Vitest files are the rules as code. The backend must **re-implement them
server-side**. The tests (Given/When/Then names) are a shared spec; port or mirror them.

- `permissionMatrix.ts`: every permission as a module View or action (DEC-102), and what each action implies.
- `roles.ts`: System Default roles, grants from assignments, scope / grant / last-owner rules.
- `access.ts`: each action's permission; `canInProject`, `canInMerchant` (merchant role only), `hasProject` (a role that gives nothing, like Member, opens no project).
- `checkRules.ts`: per-check thresholds, retries per phase (`FlowSettings.retries`: DOCUMENT, SELFIE, LIVENESS; DEC-108), the last attempt decides (DEC-15, DEC-16), risk gate. `telemetry.caseInputOf` turns a stored case into its evaluation input.
- `checkRules.evaluateRisk`: Low risk when every category ≥ its minimum (`FlowSettings.risk.minimums`); the registry's `riskMinimumsPerFlow` decides whether a flow may change them (W5) or they stay `DEFAULT_RISK_MINIMUMS` (W4) (DEC-107).
- `telemetry.ts`: engine thresholds and the metric rows shown on the case page (DEC-105); the duplicate-user result is never an input to `checkRules`.
- `claimRules.ts`: claim, cancel, expiry, overlay enablement, save-time ownership check, decisions (DEC-31).
- `flowSettings.ts`, `flowRules.ts`, `thresholds.ts`: presets / Advanced, validation, revisions, lifecycle, cooldowns (after Rejected, after Unsuccessful: `cooldownFor`).
- `caseSessions.ts`: a returning Reference ID (DEC-113). `decideSessionStart` = new case / continue / refused (flow not active, in progress, in review, approved, cooldown with `allowedFrom`); `continueCase` moves the ended session into `Verification.sessions` (status, reason, by, tokens, attempts) and resets the case to PROCESSING by SYSTEM; audit `CASE_RESUMED`. Billing has one line per session (`dashboards.billingLines`).
- `registryRules.ts`, `projectSettings.ts`, `conditions.ts`: registry statuses and who may choose a version (`selectableForNewFlow`, DEC-56), settings validation, reason catalogue.
- `dashboards.ts`: KPI definitions (Auto-Clear = SYSTEM approvals; retries = submissions after the first in every phase; tokens =
  document + W1 selfie + liveness submissions, DEC-60 / OQ-35).

## 3. What the mock cannot prove — backend must do

| Concern | In the mock | Real requirement |
|---|---|---|
| Claim concurrency | Tabs share data through localStorage; last writer wins, so two tabs can briefly both "win" | Atomic conditional write (e.g. `UPDATE … WHERE claimed_by IS NULL OR claim_expires_at < now()`), one winner, 409 for the other |
| Claim expiry | Swept lazily on each call | Server time is authoritative; the client countdown is display only |
| Permissions | UI hides actions; services resolve the account's assignments against the current roles (`accessGuard`) | Enforce on every endpoint; project scoping in queries |
| PII view logging | Written by the mock service | Server writes `SENSITIVE_PII_VIEW` itself; audit store is immutable |
| Session | Pick a user; sessionStorage | Real authentication; `Secure; HttpOnly; SameSite` cookie |
| Secrets | Fake `sk_mock_…` in the bundle | Secrets never reach the browser except a one-time reveal after step-up auth |
| Settings "new sessions only" | Each case stores its flow and `configRevision` | Same: evaluate with the revision active when the session started |

## 4. Also hand over

- `docs/DECISIONS.md` (with the conflict register), `docs/OPEN_QUESTIONS.md` and `docs/SCENARIOS.md` (UAT cases with
  stable Reference IDs and Verification IDs).
- UI code is reusable but **not production-hardened**: no real auth, no network error boundaries or retries beyond the
  mock, and no performance work (lists are filtered in memory).
