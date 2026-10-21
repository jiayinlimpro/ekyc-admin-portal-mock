# eKYC Admin Portal — clickable mock

A front-end-only mock of the eKYC Admin Portal. **Fake data, no backend, not production.** It runs the real business
rules, including per-phase thresholds, the V4 risk gate, attempt limits, claim expiry, the save-time ownership check and
audit on every action. Stakeholders can use it to see behaviour, QA can run UAT scenarios against it, and engineers get
a draft API contract.

- Rules and decisions: [docs/DECISIONS.md](docs/DECISIONS.md) (overrides the FRS and old Axure)
- Placeholder values still to confirm: [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)
- UAT scenarios S01–S15: [docs/SCENARIOS.md](docs/SCENARIOS.md)
- Engineering handoff: [docs/HANDOFF.md](docs/HANDOFF.md)

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
`?as=USR-2026-0031` to any link.

| User | Access (role · scope) | Merchant |
|---|---|---|
| Lim Wei Jie (USR-2026-0001) | Platform Admin: everything in every merchant, cases included (DEC-75) | — |
| Nor Aisyah Binti Hamid (USR-2026-0005) | Platform Admin (second one, for the Admins screen) | — |
| Tan Mei Ling (USR-2026-0002) | Merchant Owner · All projects | Atoz Software Tech |
| Ali Bin Ahmad (USR-2026-0012) | Reviewer · Default; Viewer · SME app | Atoz Software Tech |
| Siti Aminah Binti Yusof (USR-2026-0031) | Reviewer · Default | Atoz Software Tech |
| Hafiz Bin Rahman (USR-2026-0020) | Project Admin · SME app | Atoz Software Tech |
| Nurul Huda Binti Kamaruddin (USR-2026-0033) | Reviewer · SME app | Atoz Software Tech |
| Ahmad Faiz Bin Zulkifli (USR-2026-0045) | Merchant Owner · All projects | Vantage |
| Kavitha A/P Subramaniam (USR-2026-0044) | Reviewer · Default; Compliance Auditor (Custom role) · All projects | Vantage |

Access follows the [FRS] Users and Roles method with **scoped assignments** (DEC-70): a role says what you may do, the
scope says where (All projects, including new ones, or selected projects). The header's project switcher picks one
project or "All my projects", and the menu follows your permissions there.

**The Dev menu** (top right, amber) is mock-only:
- **Switch user.**
- **Time warp:** skip ahead to expire claims without waiting 30 minutes.
- **Simulate latency / errors:** see the loading and error states.
- **Skip UI claim checks:** lets a save reach the service's ownership check (S08).
- **Reset demo data:** run this before every UAT session. Claim timers count from when the data was seeded.

**Scenarios.** Dev menu → "UAT scenarios & data coverage" lists S01–S20 with "Open as" links that sign in as the right user. To show the two-reviewer race
(S10), open the same record in two tabs of the same browser, one with `?as=USR-2026-0012` and one with
`?as=USR-2026-0031`, then click **Assign to me** in both.

**Where to look:**

| Screen | What it demonstrates |
|---|---|
| Overview / System Intelligence / Billing | Every role, data scoped; by project, flow and version; retry KPIs and drop-off; tokens per liveness submission |
| Verifications | Pending Review in your projects, oldest first; project / flow / claim-state filters; no PII beyond name |
| Verification detail | Claim bar, Reject with catalogue reasons, rules applied (revision), checks with retries, activity timeline |
| Projects / Project Settings | Create, rename, archive; branding, API keys (shown once), webhook, claim timeout, read-only routing |
| Flows / Flow Detail | Low / Standard / High with a 0–100 band bar, Advanced for Platform Admin, retries 1–5, what-if, revisions |
| Users / Roles | FRS lists with `Role · Scope` chips; invite (Pending, resend); Access table with Add / Edit / Remove and a plain-language preview; Effective access with "Comes from"; suspend; grouped permission checkboxes, System Default roles locked, Duplicate, "Affects N users in M projects" |
| Project Settings › Members | Everyone with access to the project (All projects users inherited); add or remove for this project |
| Audit Log | DEC-42 events with project and actor role |
| Merchants / Admins / Workflow Registry | Platform Admin only: new merchant = Default project + owner; Platform Admin accounts; versions and flows using them |

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
