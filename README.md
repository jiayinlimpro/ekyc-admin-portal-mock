# eKYC Admin Portal — clickable mock

A front-end-only mock of the eKYC Admin Portal. **Fake data, no backend, not production.** It runs the real business
rules, including per-phase thresholds, the V4 risk gate, attempt limits, claim expiry, the save-time ownership check and
audit on every action. Stakeholders can use it to see behaviour, QA can run UAT scenarios against it, and engineers get
a draft API contract.

- Rules and decisions: [docs/DECISIONS.md](docs/DECISIONS.md) (overrides the FRS and old Axure)
- Placeholder values still to confirm: [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)
- UAT scenarios S01–S33: [docs/SCENARIOS.md](docs/SCENARIOS.md)
- Engineering handoff: [docs/HANDOFF.md](docs/HANDOFF.md)
- Access control (users, roles, permissions) for engineers: [docs/ACCESS_CONTROL.md](docs/ACCESS_CONTROL.md)

## Run it (Windows)

Needs Node.js 20.19+ or 22.12+ (developed on Node 24) and Git.

```powershell
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm test` | Vitest: business rules, mock data, services and screens |
| `npm run e2e` | Playwright: two-reviewer claim race and the reviewer flow. Uses installed Microsoft Edge; elsewhere run `npx playwright install chromium` and set `PW_CHANNEL=chromium` |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | oxlint |

If `npm` scripts are blocked in PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Demo guide

**Who you are.** There is no real login. Open `/login` and pick a user, use **Dev → Switch user**, or add
`?as=siti.yusof@atoz.example` to any link (the user's email).

| User | Merchant role (Users) · project roles (Members) | Merchant |
|---|---|---|
| Lim Wei Jie (weijie.lim@ekyc-platform.example) | Super admin: everything in every merchant (DEC-75, DEC-99) | — |
| Rizal Hakim (rizal.hakim@ekyc-platform.example) | Platform staff · Platform Admin (all platform and merchant data) | — |
| Daniel Tan (daniel.tan@ekyc-platform.example) | Platform staff · Support (case list and pages, read-only flows and keys, audit log) | — |
| Priya Nair (priya.nair@ekyc-platform.example) | Platform staff · Support | — |
| Marcus Lee (marcus.lee@ekyc-platform.example) | Platform staff · Implementation (merchants, flows, keys, registry, levels) | — |
| Hannah Lee (hannah.lee@ekyc-platform.example) | Platform staff · Finance (billing and reports, no customer data) | — |
| Tan Mei Ling (meiling.tan@atoz.example) | Owner | Atoz Software Tech |
| Lee Jia Hui (jiahui.lee@atoz.example) | Admin (users, roles, projects; every project) | Atoz Software Tech |
| Muthu A/L Rajan (muthu.rajan@atoz.example) | Billing | Atoz Software Tech |
| Grace Lim (grace.lim@atoz.example) | Auditor · Viewer in SME app (case list everywhere, case pages in SME app only) | Atoz Software Tech |
| Aaron Teoh (aaron.teoh@atoz.example) | User Coordinator (Custom merchant role: view and invite users, view roles) | Atoz Software Tech |
| Ali Bin Ahmad (ali.ahmad@atoz.example) | Member · Reviewer in Default, Viewer in SME app | Atoz Software Tech |
| Siti Aminah Binti Yusof (siti.yusof@atoz.example) | Member · Reviewer in Default | Atoz Software Tech |
| Zainab Hassan (zainab.hassan@atoz.example) | Member · Fraud Checker in Default (Custom project role) | Atoz Software Tech |
| Hafiz Bin Rahman (hafiz.rahman@atoz.example) | Member · Project Admin in SME app | Atoz Software Tech |
| Nurul Huda Binti Kamaruddin (nurul.huda@atoz.example) | Member · Reviewer in SME app | Atoz Software Tech |
| Kenneth Ooi (kenneth.ooi@atoz.example) | Member · Developer in SME app (keys, no cases) | Atoz Software Tech |
| Chong Pei Shan (peishan.chong@atoz.example) | Member · Viewer in Default (Pending) | Atoz Software Tech |
| Yap Li Wen (liwen.yap@atoz.example) | Member · Reviewer in Default (Suspended) | Atoz Software Tech |
| Ahmad Faiz Bin Zulkifli (faiz.zulkifli@vantage.example) | Owner | Vantage |
| Kavitha A/P Subramaniam (kavitha.s@vantage.example) | Auditor · Reviewer in Default | Vantage |
| Wong Kah Heng (kahheng.wong@tesla.example) | Owner | Tesla |
| Farah Binti Ismail (farah.ismail@boring.example) | Owner | The Boring Company |
| Ng Chee Keong (cheekeong.ng@3nova.example) | Owner | 3Nova |
| Lim Siew Mei (siewmei.lim@3nova.example) | Member · Reviewer in Wallet app and in Pilot 2025 (archived, read-only) | 3Nova |
| Rajesh A/L Muthu (rajesh.muthu@emptydemo.example) | Owner (merchant still Onboarding) | Empty Demo Merchant |

Access (DEC-104): two role tables. **Merchant roles** (Roles screen) are given on Users, one per user, and apply to the
whole merchant and all its projects. **Project roles** (each project's Roles screen) are given in Project › Members
and apply in that project only. **Member** (the default merchant role) gives nothing by itself. Platform staff have one platform role, for every merchant. No masking: View list, View details,
Claim / release, Approve / reject; every case page open is audited.

**Two layers (DEC-109).** The portal opens on the **Merchants** page: one row per merchant (platform users see every
merchant, merchant users their own), its projects as cards. **Go to project** opens the project portal: every screen there
shows that one project, the header reads `Merchant ▾ / Project ▾` to switch, and the menu follows your permissions in it.
A card's ⚙ opens Project Settings; a row's ⚙ opens **Merchant settings** (General, Users, Roles, Billing and Audit log for
the whole merchant). Platform Users and Workflow Registry are in the Merchants page's menu only. Links can
carry `?project=<project ID>` to open a screen in that project; case links select the case's project themselves.

**The Dev menu** (top right, amber) is mock-only:
- **Switch user.**
- **Time warp:** skip ahead to expire claims without waiting 30 minutes.
- **Simulate latency / errors:** see the loading and error states.
- **Skip UI claim checks:** lets a save reach the service's ownership check (S08).
- **Reset demo data:** run this before every UAT session. Claim timers count from when the data was seeded.

**Scenarios.** Dev menu → "UAT scenarios & data coverage" lists S01–S33 with "Open as" links that sign in as the right user. To show the two-reviewer race
(S10), open the same record in two tabs of the same browser, one with `?as=ali.ahmad@atoz.example` and one with
`?as=siti.yusof@atoz.example`, then click **Assign to me** in both.

**Where to look:**

| Screen | What it demonstrates |
|---|---|
| Merchants page (outer) | Rows = merchants, cards = projects (archived dimmed); Search projects; New merchant (platform), New project, ⚙ Merchant settings, 👥 Users; Go to project |
| Overview / System Intelligence / Billing | Every role, data of the project in the header; by flow and version; retry KPIs and drop-off; tokens per document, V1 selfie and liveness submission. Billing for the whole merchant is in Merchant settings |
| Verifications | Pending Review in the project, oldest first; flow / claim-state filters; no PII beyond name |
| Verification detail | Hybrid layout (DEC-105): header strip, claim bar, reason with target vs actual; evidence side by side, extracted data, checks (duplicate user for information), risk Low risk / High risk with four category scores against their minimums (DEC-107); every engine metric with its threshold; client metadata at the top right; attempts, rules applied (revision); sticky decision panel |
| Project Settings | Rename, archive (create on the Merchants page); branding, API keys (shown once), webhook, claim timeout, decision reasons (DEC-106) |
| Flows / Flow Detail | Low / Standard / High with a 0–100 band bar, Advanced thresholds (super admin, staff with Calibrate), retries 1–5 per phase in their own card (Document, Selfie on V1, Liveness; DEC-108), revisions; read-only for Flows View |
| Merchant settings › Users / Roles | FRS lists (Users: merchant role only; project roles in the details); invite (Pending, resend); Access table with Add / Edit / Remove and a plain-language preview; Effective access with "Comes from"; suspend; permission matrix (module × View × actions, a module box ticks the row; DEC-102), System Default roles locked, Duplicate, "Affects N users in M projects" |
| Project › Members (sidebar) | Project roles for this project (add / remove; roles without merchant-wide permissions); merchant-role users listed as inherited (read-only) |
| Audit Log | DEC-42 events of the project, with actor role; the whole merchant's in Merchant settings › Audit log |
| Merchant settings › General | Details for everyone with access; super admins and staff with Merchants permissions edit, per the FRS: registration number, country, contact; Onboarding → Active → Suspended → Terminated with reasons (suspension locks the merchant's users out and stops its API keys); never deleted; a new merchant gets a Default project and owner |
| Workflow Registry | Versions and flows using them (read-only with Registry View); statuses Draft, Internal testing (internal users only), Limited release (ticked merchants, Merchant access in Edit), Active, Deprecated (DEC-56) |
| Platform Users | Users (platform staff: one platform role, every merchant) and Roles (platform roles), created by super admins; the one super admin is listed first, read-only (created at setup, never changed, DEC-110); merchant users get one merchant role (Member by default) in Merchant settings |
| Project › Roles (sidebar) | The project's role table: System Default project roles and its own Custom roles; New role, Duplicate from another project |

Values tagged **OPEN QUESTION** are placeholders, not signed-off requirements.

## How it is built

React 19 + TypeScript (strict) + Vite + Tailwind v4 + shadcn/ui (Base UI) + React Router + Zustand + Recharts.

```
src/domain/     Pure business rules (no React, no clock): access, checkRules, claimRules, flowSettings, flowRules, dashboards …
src/services/   API-shaped async functions: the only way screens reach data
src/mocks/      Seeded Malaysian fake data (deterministic), the in-memory DB (persisted to localStorage)
src/pages/      Screens              src/components/  Shared UI, layout, charts
src/stores/     Session (per tab), dev flags, UI prefs    docs/  Decisions, open questions, scenarios, handoff
```

Screens never import `src/mocks`. To connect a real API, give each service in `src/services` an HTTP
implementation with the same interface (endpoints are listed in each file and in `docs/HANDOFF.md`), and the pages don't
change.

Working with an AI assistant: [CLAUDE.md](CLAUDE.md) (Claude Code) and [.cursor/rules/ekyc.mdc](.cursor/rules/ekyc.mdc)
(Cursor) hold the non-negotiable rules. Edit CLAUDE.md first, then mirror the change.

## Deploy a demo

Static hosting works because it is a single-page app; rewrites are already configured:
- **Vercel:** import the repo (framework: Vite). `vercel.json` rewrites every path to `index.html`.
- **Netlify:** build `npm run build`, publish `dist`. `public/_redirects` handles routing.

Turn on the host's password or deployment protection for stakeholder links. Pages carry `noindex`.

## Safety notes

- All personal data is synthetic. NRICs use a `999G` serial, IPs are from RFC 5737 documentation ranges, images are
  "SAMPLE – NOT REAL". Never load real IC data or selfies, even for a demo (PDPA 2010).
- API keys are fake (`sk_mock_…`). Anything in a front-end bundle is public, so never put real secrets in `.env`.
- Hiding buttons by role is UI only. Permissions, ownership checks, audit immutability and secure cookies must be
  enforced by the real backend.
- UAT on this mock confirms behaviour and wording. It does not prove security, performance or integration.
