# Engineering handoff

What the mock gives engineering, and what the real backend must do that a mock cannot.

## 1. Draft contract

- **Types:** `src/domain/types.ts`. Verification, VerificationSummary (list: no PII), VerificationDetail, MerchantConfig
  (per phase), AuditEntry, Decision, Paged. Treat it as a first draft of the API/DB schema (convert to OpenAPI).
- **Endpoints:** each file in `src/services/` starts with the REST shape it stands in for. Error codes map to HTTP
  status in `src/services/errors.ts`.

| Area | Endpoint (draft) | Notes |
|---|---|---|
| Verifications | `GET /verifications?…` | Returns summaries only: no NRIC, passport, address or client metadata (DEC-40) |
| | `GET /verifications/{ref}` | Full PII + client metadata; the **server** writes `SENSITIVE_PII_VIEW` for every open (DEC-41) |
| | `POST /verifications/{ref}/claim` | 409 `ALREADY_CLAIMED` / `NOT_CLAIMABLE`; claim is not a status (DEC-20) |
| | `DELETE /verifications/{ref}/claim` | Owner only; 409 `NOT_CLAIM_OWNER`; no supervisor release (DEC-23) |
| | `POST /verifications/{ref}/decision` | Re-checks ownership at save; 409 `OWNERSHIP_CONFLICT`, audited `CASE_DECISION_BLOCKED` (DEC-24); 422 for a Reject without a catalogue reason (DEC-31); Approve needs no reason; the note is optional |
| Config | `GET/PUT/DELETE /merchants/{id}/config/draft`, `POST …/deploy`, `GET …/versions` | Per phase (DEC-50); deploy bumps minor version and applies to new sessions only (DEC-52) |
| | `POST /merchants/{id}/config/preview` | What-if on finished sessions, read-only |
| Audit | `GET /audit?…` | Append-only; scoped to own merchant for reviewers |
| Analytics | `GET /analytics/overview`, `GET /analytics/intelligence`, `GET /billing` | Aggregate server-side |
| UAM | `/merchants`, `/users` | 2 roles (DEC-70); UAM auditing is OQ-16 |
| Credentials | `GET/POST /merchants/{id}/credentials[/reveal|/rotate]` | Rotation audited as `API_KEY_ROTATED` |

## 2. Executable business rules

`src/domain/*Rules.ts` plus their Vitest files are the rules as code. The backend must **re-implement them
server-side**. The tests (Given/When/Then names) are a shared spec; port or mirror them.

- `statusRules.ts`: per-phase thresholds, phase combination (OQ-01), V4 risk gate, attempt limit.
- `claimRules.ts`: claim, cancel, expiry, overlay enablement, save-time ownership check.
- `configRules.ts`: validation, diff, version bump, what-if.
- `permissions.ts`: role → permission flags.
- `analytics.ts`, `billing.ts`: KPI definitions (Auto-Clear = SYSTEM approvals; Retry KPI = user retakes only; every
  verification charged).

## 3. What the mock cannot prove — backend must do

| Concern | In the mock | Real requirement |
|---|---|---|
| Claim concurrency | Tabs share data through localStorage; last writer wins, so two tabs can briefly both "win" | Atomic conditional write (e.g. `UPDATE … WHERE claimed_by IS NULL OR claim_expires_at < now()`), one winner, 409 for the other |
| Claim expiry | Swept lazily on each call | Server time is authoritative; the client countdown is display only |
| Permissions | UI hides actions; services check `can()` | Enforce on every endpoint; merchant scoping in queries |
| PII view logging | Written by the mock service | Server writes `SENSITIVE_PII_VIEW` itself; audit store is immutable |
| Session | Pick a user; sessionStorage | Real authentication; `Secure; HttpOnly; SameSite` cookie |
| Secrets | Fake `sk_mock_…` in the bundle | Secrets never reach the browser except a one-time reveal after step-up auth |
| Config "new sessions only" | Each record stores `configVersion` | Same: evaluate with the version active when the session started |

## 4. Also hand over

- `docs/DECISIONS.md` (with the conflict register), `docs/OPEN_QUESTIONS.md` and `docs/SCENARIOS.md` (UAT cases with
  stable Reference Nos).
- UI code is reusable but **not production-hardened**: no real auth, no network error boundaries or retries beyond the
  mock, and no performance work (lists are filtered in memory).
