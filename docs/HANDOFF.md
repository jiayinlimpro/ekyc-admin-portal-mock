# Engineering handoff

What the mock gives engineering, and what the real backend must do that a mock cannot.

## 1. Draft contract

- **Types:** `src/domain/types.ts`. Merchant → Project → Flow (FlowSettings, FlowRevision) → Verification
  (VerificationSummary for lists: no PII; VerificationDetail), UserAccount (level + RoleAssignment[]), Role, RegistryEntry,
  ProjectApiKey, ProjectWebhook, AuditEntry, Decision, Paged. Treat it as a first draft of the API/DB schema.
- **Endpoints:** each file in `src/services/` starts with the REST shape it stands in for. Error codes map to HTTP
  status in `src/services/errors.ts`.

| Area | Endpoint (draft) | Notes |
|---|---|---|
| Verifications | `GET /verifications?…` | Returns summaries only: no NRIC, passport, address or client metadata (DEC-40) |
| | `GET /verifications/{ref}` | Full PII + client metadata; the **server** writes `SENSITIVE_PII_VIEW` for every open (DEC-41) |
| | `POST /verifications/{ref}/claim` | 409 `ALREADY_CLAIMED` / `NOT_CLAIMABLE`; claim is not a status (DEC-20) |
| | `DELETE /verifications/{ref}/claim` | Owner only; 409 `NOT_CLAIM_OWNER`; no supervisor release (DEC-23) |
| | `POST /verifications/{ref}/decision` | Re-checks ownership at save; 409 `OWNERSHIP_CONFLICT`, audited `CASE_DECISION_BLOCKED` (DEC-24); 422 for a Reject without a catalogue reason (DEC-31); Approve needs no reason; the note is optional |
| Projects | `GET /projects/mine`, `GET /projects`, `POST /merchants/{id}/projects`, `PATCH /projects/{id}`, `POST …/archive` | Access from scoped role assignments; "not found" outside the user's projects (DEC-72) |
| | `PATCH /projects/{id}/general`, `PATCH …/review-ops` | Branding, language; claim timeout >= 1 min (DEC-53, DEC-54) |
| Integration | `GET /projects/{id}/integration`, `POST …/api-keys`, `POST /api-keys/{id}/rotate`, `DELETE /api-keys/{id}`, `PUT …/webhook`, `PUT …/access-lists` | Merchant-only (DEC-75); secrets returned once, only a hint stored |
| Flows | `GET /projects/{id}/flows`, `GET /flows/{id}`, `POST …/flows`, `PUT /flows/{id}`, `POST /flows/{id}/activate | retire | default | duplicate | preview` | Saving an Active flow needs a reason and creates `<Version>-R<n>` for new sessions only (DEC-51, DEC-52) |
| Registry | `GET /registry`, `GET /registry/selectable`, `POST /registry`, `PUT /registry/{code}`, `POST …/status`, `POST …/default`, `GET …/flows` | Platform Admin; only Active versions selectable (DEC-56, DEC-57) |
| Users | `GET /users`, `GET /users/{id}`, `POST /merchants/{id}/users`, `POST /users/{id}/invitation`, `POST|PUT|DELETE /users/{id}/assignments[/{aid}]`, `POST /users/{id}/suspend | reactivate`, `GET|POST|DELETE /projects/{id}/members` | Grant only what you hold; merchant-level roles only for All projects; one Merchant Owner remains; removal releases claims (DEC-74, DEC-77) |
| Roles | `GET /roles`, `GET /merchants/{id}/roles/assignable`, `POST /merchants/{id}/roles`, `PUT /roles/{id}`, `POST /roles/{id}/status` | System Default locked; edits apply to every holder at once; no deactivation while assigned (DEC-76) |
| Merchants | `GET/POST /merchants`, `PATCH/DELETE /merchants/{id}` | Platform Admin; a new merchant gets a Default project, default flow and owner (DEC-92) |
| Audit | `GET /audit?…` | Append-only; Platform Admin all, Merchant Owner the merchant, Project Admin own projects (DEC-70) |
| Analytics | `GET /analytics/filters`, `/analytics/overview`, `/analytics/intelligence`, `GET /billing` | Every role, data scoped (DEC-86); tokens per liveness submission (DEC-60) |

## 2. Executable business rules

`src/domain/*Rules.ts` plus their Vitest files are the rules as code. The backend must **re-implement them
server-side**. The tests (Given/When/Then names) are a shared spec; port or mirror them.

- `roles.ts`: permission catalogue, System Default roles, grants from assignments, scope / grant / last-owner rules.
- `access.ts`: each action's permission; `canInProject`, `canInMerchant` (All projects grants only), `hasProject`.
- `checkRules.ts`: per-check thresholds, retries, the last attempt decides (DEC-15, DEC-16), V4 risk gate.
- `claimRules.ts`: claim, cancel, expiry, overlay enablement, save-time ownership check, decisions (DEC-31).
- `flowSettings.ts`, `flowRules.ts`, `thresholds.ts`: presets / Advanced, validation, revisions, lifecycle, cooldown.
- `registryRules.ts`, `projectSettings.ts`, `conditions.ts`: registry lifecycle, settings validation, reason catalogue.
- `dashboards.ts`: KPI definitions (Auto-Clear = SYSTEM approvals; retries = face match + liveness only; tokens =
  liveness submissions).

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
  stable Reference Nos).
- UI code is reusable but **not production-hardened**: no real auth, no network error boundaries or retries beyond the
  mock, and no performance work (lists are filtered in memory).
