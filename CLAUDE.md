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
- Merchant → Project → Flow → Case. Each setting lives at exactly one level (DEC-91). Access = [FRS] Users + Roles with
  scoped assignments (DEC-70): a role (permission checkboxes, merchant-level / project-level) is given to a user for All
  projects (incl. future ones) or Selected projects; permissions are the union, no deny. Merchant-level permissions only
  via All projects. System Default roles (locked): Merchant Owner, Project Admin, Reviewer, Viewer; Platform Admin is
  internal with a fixed set. Every page checks access to the project; a case outside the user's projects is "not found".
- Only FACE_MATCH and LIVENESS have thresholds: autoReject/autoPass, chosen as a Low/Standard/High preset, or Advanced
  (custom, Platform Admin only). Never per individual metric; granular metrics are never shown. Risk for V4/V5 only.
- `>= autoPass` → pass; `< autoReject` → reject; between → review. Below autoPass with retries left → retry, case stays
  PROCESSING. Retries used up → the last attempt decides. V4/V5: APPROVED also requires risk pass, else PENDING_REVIEW.
- "Retries allowed" = retries after the first submission (default 3), face match and liveness only. ID capture and
  selfie retakes are unlimited and free. Tokens = liveness submissions. Retries keep the same referenceNo.
- PROCESSING records are read-only. Decisions are final (no reopen, no resubmission). Reject needs a reason from the
  condition catalogue (DEC-35); the note is optional.
- Claim is NOT a status: `claimedBy` / `claimedAt` / `claimExpiresAt`. One owner, per-project timeout, ends only by
  Release, timeout, decision or removal from the project. No supervisor reassign or force-release. Ownership re-checked
  at save.
- Any project member can view its cases; only the decision buttons enable/disable. No lock on open.
- List view: name, ref and the DEC-40 columns only; no client metadata, no duplicate-user info (`VerificationSummary`).
  Detail: full unmasked PII + client metadata; every open writes a SENSITIVE_PII_VIEW audit entry.
- Every mutation writes an audit entry (DEC-42 event names).
- Config lives on each flow; saving an active flow needs a reason and creates a revision; applies to new sessions only.
- No Home page; everyone lands on Overview. Overview, System Intelligence and Billing are for every role, data scoped to
  the user (no separate Reports screen). Merchants and Workflow Registry are Platform Admin only. No Manual Review Queue.
- Open questions must be parameters (`src/domain/openQuestions.ts`, or on the project/flow) with an "OPEN QUESTION" label
  in the UI, never hard-coded values in components.

## Layout
```
src/domain/     types, openQuestions, roles (permissions, assignments, grant rules), access (actions → permissions),
                checkRules (status), claimRules, conditions,
                thresholds, flowSettings, flowRules, flowImpact (what-if), registryRules, projectSettings, dashboards, audit
src/mocks/      malaysia.ts, builders.ts, seed.ts, mockDb.ts, fixtures/ (catalog: registry/projects/flows, merchants,
                users: accounts, edgeCases: S01–S20)
src/services/   verification, project, flow, registry, integration, userAdmin (Users, project Members), role, merchantAdmin,
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
  Flows List, Flow Detail (presets, band bar, retries, Advanced for Platform Admin, what-if, history), Users, Roles,
  Audit Log; Platform Admin: Merchants, Workflow Registry. Header: project switcher + roles in the current project.
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
- UAT deep links: `?as=USR-2026-0031` signs in as that user.

## Working style
- One feature per task. Show a plan first, list files to change, then implement.
- Add or update Vitest tests for `src/domain/*` and services. Name tests Given/When/Then.
- Tag rule implementations with `// REQ: DEC-xx`.
- Don't invent fields, statuses or screens. If a requirement is unclear, ask or add it to `docs/OPEN_QUESTIONS.md`.
- Keep diffs small. If a change touches more than ~8 files, stop and split it.
- Keep `.cursor/rules/ekyc.mdc` in sync when these rules change.
