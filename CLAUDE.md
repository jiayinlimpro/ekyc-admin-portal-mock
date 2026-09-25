# eKYC Admin Portal — FRONT-END MOCK ONLY

Clickable mock of the eKYC Admin Portal. Fake data, no backend. Its purpose is to run the real business rules so
stakeholders can see behaviour, and to hand engineering a draft contract (`src/domain/types.ts`, `src/services/*`).

Source of truth: `docs/DECISIONS.md` (it overrides the FRS and old Axure). Open parameters: `docs/OPEN_QUESTIONS.md`.
UAT scenarios: `docs/SCENARIOS.md`.

## Commands
- `npm run dev` — start the app
- `npm test` — Vitest (domain rules, mock data, services)
- `npm run typecheck` — `tsc -b`
- `npm run build` — typecheck + production build

## Hard constraints
- No backend, no DB, no real API calls, no auth provider, no Supabase/Firebase. Data = seeded fixtures in `src/mocks`,
  reached only through `src/services` (Promise + simulated delay).
- Pages and components NEVER import `src/mocks` directly; only through `src/services`.
- Stack: React + TS (strict) + Vite + Tailwind v4 + shadcn/ui + React Router + Zustand. Don't add libraries without asking.
- Domain logic in `src/domain` is pure TS: no React, no stores, no `Date.now()`. Time is passed in as `now: Date`.
  Services get time from `src/lib/clock.ts` (supports the dev time warp).

## Domain rules (details and IDs in docs/DECISIONS.md)
- VerificationStatus is EXACTLY: PROCESSING | PENDING_REVIEW | APPROVED | REJECTED. Never add MANUAL_APPROVED, ERROR,
  EXPIRED, CLAIMED, IN_REVIEW.
- Manual vs automated = `lastUpdatedBy` (SYSTEM or user fullName + userId). It changes ONLY when status changes
  (never on claim, release or view).
- Thresholds are PER PHASE (DOCUMENT, SELFIE, FACE_MATCH, LIVENESS; RISK_ASSESSMENT for V4 only), each capture phase with
  autoPass & autoReject. Never per individual metric. Metrics are display-only, grouped by phase.
- `>= autoPass` → pass; `< autoReject` → reject; between → review. V4 only: APPROVED also requires risk pass,
  else PENDING_REVIEW.
- Incomplete / aborted / timed-out / failed retake with attempts left → PROCESSING. Attempt limit → PENDING_REVIEW,
  reason "Attempt limit reached – [Phase]". Retries keep the same referenceNo.
- PROCESSING records are read-only. Decisions are final (no reopen, no resubmission).
- Claim is NOT a status: `claimedBy` / `claimedAt` / `claimExpiresAt`. One owner, per-merchant timeout, ends only by
  Cancel, timeout or decision. No supervisor reassign or force-release. Ownership re-checked at save.
- Anyone with access can view any record; only the Decision Overlay enables/disables. No lock on open.
- List view: no PII beyond name/ref, no client metadata (`VerificationSummary`). Detail: full unmasked PII + client
  metadata; every open writes a PII_VIEW audit entry.
- Every mutation writes an audit entry.
- Config: draft → deploy with audit; applies to new sessions only.
- 2 roles only. No Manual Review Queue screen. No Drop-off KPI. Webhooks = "On hold" placeholder.
- Open questions must be parameters (`src/domain/openQuestions.ts` or `MerchantConfig`) with an "OPEN QUESTION" label in
  the UI, never hard-coded values in components.

## Layout
```
src/domain/     types.ts, openQuestions.ts, statusRules.ts, claimRules.ts, permissions.ts, configRules.ts, audit.ts (+ tests)
src/mocks/      malaysia.ts, builders.ts, seed.ts, mockDb.ts, fixtures/ (merchants, users, edgeCases)
src/services/   verificationService, configService, auditService, merchantService, devService (dev-only),
                claimSweep, network (latency/errors), errors (ServiceError + HTTP status map)
src/stores/     sessionStore (current actor, merchant; sessionStorage = per tab), devFlagsStore (latency, errors, time warp)
src/lib/        clock.ts, utils.ts (shadcn)
src/test/       factories.ts (unit-test builders, independent of src/mocks)
docs/           DECISIONS.md, OPEN_QUESTIONS.md, SCENARIOS.md
```

## Build status
- Done: scaffold, domain rules + tests, seeded mock data (S01–S15), service layer + tests. **No UI screens yet.**
- Next (one prompt each): App shell (sidebar, top bar, tab strip, dev menu: Switch user / Time warp / Reset demo data)
  → Verifications List → Detail (read) → Claim bar + Decision overlay → eKYC Configuration (per phase) → Audit Logs.
- shadcn components: add as needed with `npx shadcn@latest add <name>`.

## Working style
- One feature per task. Show a plan first, list files to change, then implement.
- Add or update Vitest tests for `src/domain/*` and services. Name tests Given/When/Then.
- Tag rule implementations with `// REQ: DEC-xx`.
- Don't invent fields, statuses or screens. If a requirement is unclear, ask or add it to `docs/OPEN_QUESTIONS.md`.
- Keep diffs small. If a change touches more than ~8 files, stop and split it.
- Keep `.cursor/rules/ekyc.mdc` in sync when these rules change.
