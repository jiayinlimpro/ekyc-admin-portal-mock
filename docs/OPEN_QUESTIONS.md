# Open questions

Each question is a **parameter**, not a fact. The mock uses the default below. In code the value lives in
`src/domain/openQuestions.ts` (or on the project or flow, for per-project / per-flow values), and the UI must label it
**OPEN QUESTION**. When the product owner answers, move the answer into `DECISIONS.md` and update the default.
"MS OQ-n" = open question n in the Module Specification "Projects & Flows" (2026-10-19).

| ID | Question | Mock default | Where it lives |
|---|---|---|---|
| OQ-01 | How do check results combine? Does a reject in one check outweigh a review in another? (MS OQ-5) | `REJECT_WINS`: any reject → REJECTED, else any review → PENDING_REVIEW | `POLICY.phaseCombination` |
| OQ-02 | Low / Standard / High preset values (reject below / approve at or above) | Face match: Low 80/90, Standard 85/95, High 90/97 · Liveness: Low 60/80, Standard 70/85, High 80/92 | `THRESHOLD_PRESETS` |
| OQ-03 | Range for "Retries allowed" per phase (default 3, DEC-108) | 1–5 | `RETRY_LIMITS` |
| OQ-04 | Default auto-release claim timeout and warning time (MS OQ-4) | 30 min timeout, warning 5 min before expiry | Project `claimTimeoutSec` (seconds; entered in minutes, DEC-53) / `POLICY.claimWarningMin` |
| OQ-09 | Final role names, System Default roles and the permission list (MS OQ-3; the FRS "User Access Matrix" spreadsheet). Also: are separate read and edit permissions needed (e.g. see users without changing them)? | System Default: Merchant Owner, Project Admin, Reviewer, Viewer; permissions as in DEC-70, one per area (no read-only variants) | `src/domain/roles.ts` |
| OQ-11 | Does a claim end when the reviewer logs out or closes the tab? | No: only Release, timeout, decision or removal from the project | `claimRules.ts` |
| OQ-12 | Can a reviewer re-claim straight after their own claim times out? | Yes | `claimRules.ts` |
| OQ-13 | What does the page show if the claim expires while the reviewer is typing? | Buttons disable; save fails with "This case is no longer assigned to you"; typed text is kept | Detail page |
| OQ-14 | Price per token (by contract tier) | RM 0.50 per liveness submission | `TOKEN_PRICE` |
| OQ-17 | Is Reference ID unique per merchant or per project? (MS OQ-1) | Per project; the Project column makes duplicates across projects clear | Project setting (shown read-only) |
| OQ-19 | Default session expiry and accepted documents for a new flow (MS OQ-4) | Required fields with no default on a new flow; seeded flows use 30 min and MyKad + Passport | Flow Detail |
| OQ-21 | Project data retention period | Not set; shown as a placeholder | Project Settings › General |
| OQ-22 | Cooldown after a rejection (DEC-26): how is the "same end user" identified, and does the wait apply to this flow only or the whole project? | Same ID document number (NRIC / passport no.), same flow | Flow `cooldownMin`, `flowRules.ts` |
| OQ-24 | Does the claim timeout run from claim time or from the last activity? (FRS TBC) | From claim time | `claimRules.ts` |
| OQ-25 | How does the engine compute and normalise each risk category to 0–100 (EXIF tag points, ELA and wavelet values, email points, OSINT social score 0–10)? (DEC-107) | The engine returns the four 0–100 scores; the portal shows them as given | `Verification.riskScores` |
| OQ-27 | On a project's Members tab (DEC-77), can a user with Manage project members invite someone new, or only add existing users of the merchant? | Existing users only; new people are invited on the Users screen (Manage users and roles) | `userAdminService.addMember` |
| OQ-28 | Must the merchant always send a Reference ID when creating a session (DEC-97)? If not, does the platform generate one? | Required; the mock always has one | `Verification.referenceNo` |
| OQ-29 | How long are a Terminated merchant's cases and audit log kept, and are they then archived or deleted? Keeping them is required for compliance; the PDPA says not longer than needed (DEC-98) | Kept; nothing is deleted | — (backend policy) |
| OQ-30 | Are invoices issued from this portal? If so, merchants also need registered address, TIN, SST number and a billing email (MyInvois) (DEC-98) | No; only the FRS fields | `Merchant` |
| OQ-33 | EXIF edge cases: (a) the modern-maker list has no Samsung, Xiaomi, Huawei or Realme, so their photos get 0 for the maker; (b) a missing Megapixels value; (c) a missing DateTimeOriginal or FileModifyDate | (a) 0 points as listed; (b) 0 points; (c) counts as "differ" (−4) | `exifScore` in `src/domain/riskSignals.ts` |
| OQ-34 | Default minimum per risk category: V4's fixed minimums and V5's starting values (DEC-107) | 50 for each category | `DEFAULT_RISK_MINIMUMS` in `src/domain/openQuestions.ts` |
| OQ-32 | The engine sets FacePixelSizeThreshold = 50, but its Selfie Quality Check doesn't apply it. Should a selfie face smaller than 50 px fail? | Not checked; shown as information | `selfieMetrics` in `src/domain/telemetry.ts` |
| OQ-36 | Test and live API keys (sandbox). An Onboarding merchant is "sandbox only" (DEC-98), but nothing says how a sandbox works. Separate test keys (`sk_test_…`) whose sessions use no tokens, aren't billed, are kept apart from real cases and get simulated results? Or a separate sandbox environment? (DEC-111) | Not modelled: one kind of key; Onboarding is a label only (MOCK) | Project Settings › Integration (not built) |
| OQ-31 | The company staff email domain (DEC-99): platform staff and super admins must use it; merchant users may not | `ekyc-platform.example` | `STAFF_EMAIL_DOMAIN` in `src/domain/openQuestions.ts` |

## Answered (kept for traceability)
| ID | Question | Answer |
|---|---|---|
| OQ-18 | Are routing rules and percentage splits set only through the API, or also edited in the portal? (MS OQ-2) | Neither: no routing. Every session names its flow (`flowId` required) (DEC-95) [PO 2026-11-20] |
| OQ-35 | Does a submitted V1 selfie also cost a token (DEC-60)? | Yes: everything submitted costs a token, a rejected selfie included [PO 2026-10-27] |
| OQ-07 | Are retakes charged per attempt? | Tokens per liveness submission; ID capture and selfie retakes are free (DEC-60) |
| OQ-08 | Can Platform Admin claim and decide? | Yes, changed 2026-10-21 (DEC-75); was No (DEC-70) |
| OQ-20 | Can internal staff (Platform Admin) view merchant cases for support? (MS OQ-7) | Yes; every open is audited (DEC-75) |
| OQ-05 | V4 risk by level or by scores? V5 per component? Can risk reject? | Four category scores with a minimum each; V4 fixed, V5 per flow; risk never rejects (DEC-107) |
| OQ-06 | Risk score → level bands | No levels any more: Low risk / High risk (DEC-107) |
| OQ-10 | Decision reason code list | Changed 2026-10-23: per-project decision reasons, Reject one or more, Approve exactly one (DEC-106); was DEC-35 conditions, no approve code |
| OQ-26 | Which reason rejects a case in review only for risk (DEC-13)? | "Risk not acceptable after review" (DEC-106) |
| OQ-15 | Which 3 KPIs does the Overview show? | Total Submissions, Auto-Clear Rate, Active Review Queue ([FRS], DEC-85) |
| OQ-16 | Should user and merchant changes be audited? | Yes (DEC-42) |
| OQ-23 | Can Platform Admin use Draft registry versions for test flows? | Changed 2026-10-27: test flows use an Internal testing version (internal users only); Draft can't be chosen by anyone (DEC-56) |
| MS OQ-8 | Is rejection reason free text or a fixed list? | Fixed list plus optional note (DEC-31) |
