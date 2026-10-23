# eKYC Admin Portal — FRONT-END MOCK ONLY

Clickable mock of the eKYC Admin Portal. Fake data, no backend. Its purpose is to run the real business rules so
stakeholders can see behaviour, and to hand engineering a draft contract (`src/domain/types.ts`, `src/services/*`).

Source of truth: `docs/DECISIONS.md` (it overrides the "Projects & Flows" module spec, which overrides the FRS 05/10/26;
anything the module spec does not cover follows the FRS). Open parameters: `docs/OPEN_QUESTIONS.md`.
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
- Merchant → Project → Flow → Case. Each setting lives at exactly one level (DEC-91). Access (DEC-104): roles are a
  permission matrix (module × View × actions). **Two role tables**: merchant roles (Roles screen; one per user, given
  on Users; applies merchant-wide and in all projects) and project roles (Project Settings › Roles, per project; given
  in Project › Members, that project only). Union, no deny. **Member** = no permissions (default). Every page checks access to the
  project; a case outside the user's projects is "not found".
- Three account types (DEC-99, DEC-104): **Super admin** (everything; outside the role system; Platform › Super admins),
  **Platform staff** (no merchant; one platform role, no scope: applies to every merchant), **Merchant user**. Roles and
  users have a Type (Platform / Merchant), set by super admins and never changed; merchant admins never see platform
  roles or staff. No access end dates. **No masking**: Verifications = View list → View details → Claim / release →
  Approve / reject; every case page open is audited. Staff email domain: OQ-31.
- IDs (DEC-97): every stored record gets a prefixed cuid2-shaped ID from `src/lib/ids.ts` (`newId`; seeded records
  `fx('PRJ-0001')` / `stableId`, stable across resets). Never sort by ID, never show user / role / audit IDs. A case is
  addressed by `caseId` (`ver_…`); `referenceNo` is the merchant's Reference ID.
- Only FACE_MATCH and LIVENESS have thresholds: autoReject/autoPass, chosen as a Low/Standard/High preset, or Advanced
  (custom, super admin or staff with Calibrate). Never per individual metric. Every engine metric is shown on the case page with its fixed threshold (DEC-105).
  Risk for V4/V5 only; categories EXIF / Noise / Email Validity / OSINT.
- `>= autoPass` → pass; `< autoReject` → reject; between → review. Below autoPass with retries left → retry, case stays
  PROCESSING. Retries used up → the last attempt decides. V4/V5: APPROVED also requires risk pass, else PENDING_REVIEW.
- "Retries allowed" = retries after the first submission (default 3), face match and liveness only. ID capture and
  selfie retakes are unlimited and free. Tokens = liveness submissions. Retries keep the same referenceNo.
- PROCESSING records are read-only. Decisions are final (no reopen, no resubmission). Reasons come from the project's
  decision reasons (DEC-106), not the engine conditions (DEC-35): Reject one or more, Approve exactly one; note optional
  unless the reason requires it (Other).
- Claim is NOT a status: `claimedBy` / `claimedAt` / `claimExpiresAt`. One owner, per-project timeout, ends only by
  Release, timeout, decision or removal from the project. No supervisor reassign or force-release. Ownership re-checked
  at save.
- Any project member can view its cases; only the decision buttons enable/disable. No lock on open.
- List view (View list): name, ref and the DEC-40 columns only; no client metadata, no duplicate-user info
  (`VerificationSummary`). Detail (View details): full PII + client metadata + all telemetry + duplicate-user result
  (information only); every open writes a SENSITIVE_PII_VIEW audit entry.
- Every mutation writes an audit entry (DEC-42 event names).
- Config lives on each flow; saving an active flow needs a reason and creates a revision; applies to new sessions only.
- No Home page; everyone lands on Overview. Overview, System Intelligence and Billing are for every role, data scoped to
  the user (no separate Reports screen). Merchants and Workflow Registry are for super admins and staff with those permissions. No Manual Review Queue.
- Open questions must be parameters (`src/domain/openQuestions.ts`, or on the project/flow) with an "OPEN QUESTION" label
  in the UI, never hard-coded values in components.

## Layout
```
src/domain/     types, openQuestions, roles (permissions, assignments, grant rules), access (actions → permissions),
                checkRules (status), claimRules, conditions,
                thresholds, flowSettings, flowRules, flowImpact (what-if), registryRules, projectSettings, dashboards, audit
src/mocks/      malaysia.ts, builders.ts, seed.ts, mockDb.ts, fixtures/ (catalog: registry/projects/flows, merchants,
                users: accounts, edgeCases: S01–S20)
src/services/   verification, project, flow, registry, integration, userAdmin (Users, project Members), role, admin (Admins), merchantAdmin,
                merchant, user, audit, analytics, liveUpdates, devService (dev-only), claimSweep, network
                (latency/errors), errors (ServiceError + HTTP status map), accessGuard (the account behind the session
                decides access; the session is only who you are)
src/app/        nav.ts (menu + access rule per screen), routes.tsx, access.tsx (account, my projects, selected project)
src/stores/     sessionStore (current actor + selected project; sessionStorage = per tab), devFlagsStore (latency, errors,
                time warp)
src/lib/        clock.ts, utils.ts (shadcn)
src/test/       factories.ts (unit-test builders, independent of src/mocks)
docs/           DECISIONS.md, OPEN_QUESTIONS.md, SCENARIOS.md
```

## Build status
- **Projects & Flows restructure done** (DEC-85 screens): Overview, System Intelligence, Billing (every role, scoped),
  Verifications List + Detail, Projects, Project Settings (General, Integration, Review operations, Routing, Members),
  Flows List, Flow Detail (presets, band bar, retries, Advanced thresholds, what-if, history), Users, Roles (both with
  Type = Platform / Merchant), Audit Log; Platform: Merchants, Super admins, Workflow Registry. Header: project switcher + roles in the current project.
  Mock Login.
  No Home page: `/` opens Overview; UAT scenario links and data coverage are on the mock-only `/uat` page (Dev menu).
- Retired (DEC-85): eKYC Workflow, Developers, Merchant Workflow Directory, the merchant-level config, the two-role
  model and the one-role-per-project Users and Access screen (replaced by Users + Roles, DEC-74 / DEC-76).
- Tests: Vitest (`npm test`) for rules, data, services and screens; Playwright (`npm run e2e`) for the claim race and the
  reviewer flow.
- Next work comes from answered OPEN QUESTIONS (update `docs/DECISIONS.md` first) and stakeholder feedback.

## UI conventions
- Routes, menu, breadcrumb and tab titles all come from `src/app/nav.ts`. To ship a screen: create the page, register it
  in `PAGES` in `src/app/routes.tsx`, set `built: true` in `nav.ts`.
- shadcn here is the **base-nova** style on Base UI (not Radix): use the `render` prop instead of `asChild`, e.g.
  `<DropdownMenuTrigger render={<Button />} />`; `DropdownMenuLabel` must sit inside `DropdownMenuGroup`.
  Add components with `npx shadcn@latest add <name>`.
- Pages fetch through services with `useLoad` keyed on the actor (switching user must refetch). Use `useNow()` for
  anything time-based (claim countdowns) so the time warp applies.
- Hide what the user can never do with their access; disable with a tooltip what the current state blocks (DEC-78).
  Access is always shown as a `Role · Scope` chip (DEC-74).
- Every screen declares an access rule in `nav.ts` (project or platform action from `src/domain/access.ts`); the menu and
  `Guarded` use it, and the service checks again. Settings pages work on the header's project (`RequireProject`).
- List filters live in the URL (see `src/pages/verifications/listQuery.ts`); apply on Search, not per keystroke.
  Forms with custom validation use `noValidate` so our message shows instead of the browser tooltip.
- Shared UI: `components/common/` (StatusBadge, RiskBadge, NativeSelect, ToggleChips, Pagination, States, Switch,
  OpenQuestionTag). Charts: `components/charts/` — follow the dataviz rules: status colours only for statuses, in
  `STATUS_STACK` order (validated for colour-blindness), every chart has a table view.
- Screens are lazy-loaded (`src/app/routes.tsx`); tests must `await screen.findBy…` the first element.
- Status/role labels: `src/lib/labels.ts`. Dates: `formatMyt()` in `src/lib/format.ts`. Toasts: `sonner` (bottom-right).
- Session and tabs live in sessionStorage (per browser tab); demo data, dev flags and UI prefs in localStorage.
- UAT deep links: `?as=siti.yusof@atoz.example` signs in as that user (email; the internal user ID works too).

## Working style
- One feature per task. Show a plan first, list files to change, then implement.
- Add or update Vitest tests for `src/domain/*` and services. Name tests Given/When/Then.
- Tag rule implementations with `// REQ: DEC-xx`.
- Don't invent fields, statuses or screens. If a requirement is unclear, ask or add it to `docs/OPEN_QUESTIONS.md`.
- Keep diffs small. If a change touches more than ~8 files, stop and split it.
- Keep `.cursor/rules/ekyc.mdc` in sync when these rules change.
