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
| `npm test` | Vitest: business rules, mock data, services and screens (230 tests) |
| `npm run e2e` | Playwright: two-reviewer claim race and the reviewer flow. Uses installed Microsoft Edge; elsewhere run `npx playwright install chromium` and set `PW_CHANNEL=chromium` |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | oxlint |

If `npm` scripts are blocked in PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Demo guide

**Who you are.** There is no real login. Open `/login` and pick a user, use **Dev → Switch user**, or add
`?as=USR-2026-0031` to any link.

| User | Role | Merchant |
|---|---|---|
| Lim Wei Jie (USR-2026-0001) | Platform Admin | all merchants |
| Ali Bin Ahmad (USR-2026-0012) | Merchant Reviewer | Atoz Software Tech (V4) |
| Siti Aminah Binti Yusof (USR-2026-0031) | Merchant Reviewer | Atoz Software Tech (V4) |
| Kavitha A/P Subramaniam (USR-2026-0044) | Merchant Reviewer | Vantage (V1) |

**The Dev menu** (top right, amber) is mock-only:
- **Switch user.**
- **Time warp:** skip ahead to expire claims without waiting 30 minutes.
- **Simulate latency / errors:** see the loading and error states.
- **Skip UI claim checks:** lets a save reach the service's ownership check (S08).
- **Reset demo data:** run this before every UAT session. Claim timers count from when the data was seeded.

**Scenarios.** Home lists S01–S15 with "Open as" links that sign in as the right user. To show the two-reviewer race
(S10), open the same record in two tabs of the same browser, one with `?as=USR-2026-0012` and one with
`?as=USR-2026-0031`, then click **Assign to me** in both.

**Where to look:**

| Screen | What it demonstrates |
|---|---|
| Verifications | 4 statuses only; Claimed By with a live countdown; no PII beyond name; filters in the URL |
| Verification detail | Claim bar, decision overlay (claim owner only), unmasked PII (every open is audited), results by phase, V4 risk panel |
| eKYC Workflow | Settings **per phase**; baseline vs staging canvas; draft → deploy; what-if preview |
| Audit Logs | Every PII view, claim, timeout, decision, conflict, config change and key rotation |
| Overview / System Intelligence / Billing | 3 KPIs, Auto-Clear, retries (user retakes only), threshold lines, every verification charged |

Values tagged **OPEN QUESTION** are placeholders, not signed-off requirements.

## How it is built

React 19 + TypeScript (strict) + Vite + Tailwind v4 + shadcn/ui (Base UI) + React Router + Zustand + Recharts.

```
src/domain/     Pure business rules (no React, no clock): statusRules, claimRules, configRules, permissions, analytics, billing
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
