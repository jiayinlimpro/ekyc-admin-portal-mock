# Open questions

Each question is a **parameter**, not a fact. The mock uses the default below. In code the value lives in
`src/domain/openQuestions.ts` (or on the project or flow, for per-project / per-flow values), and the UI must label it
**OPEN QUESTION**. When the product owner answers, move the answer into `DECISIONS.md` and update the default.
"MS OQ-n" = open question n in the Module Specification "Projects & Flows" (2026-10-19).

| ID | Question | Mock default | Where it lives |
|---|---|---|---|
| OQ-01 | How do check results combine? Does a reject in one check outweigh a review in another? (MS OQ-5) | `REJECT_WINS`: any reject → REJECTED, else any review → PENDING_REVIEW | `POLICY.phaseCombination` |
| OQ-02 | Low / Standard / High preset values (reject below / approve at or above) | Face match: Low 80/90, Standard 85/95, High 90/97 · Liveness: Low 60/80, Standard 70/85, High 80/92 | `THRESHOLD_PRESETS` |
| OQ-03 | Range for "Retries allowed" (default 3) | 1–5 | `RETRY_LIMITS` |
| OQ-04 | Default auto-release claim timeout and warning time (MS OQ-4) | 30 min timeout, warning 5 min before expiry | Project `claimTimeoutMin` / `POLICY.claimWarningMin` |
| OQ-05 | Is V4 Risk configured by a maximum allowed level (mock) or by scores? Can risk auto-reject? V5: per-component thresholds or only the final action? (MS OQ-6) | V4: max allowed level `MEDIUM`, risk never auto-rejects. V5 risk form not built | Flow `risk` |
| OQ-06 | Risk score → level bands, and risk weighting | score < 40 LOW, < 70 MEDIUM, else HIGH; weighting not modelled | `POLICY.riskBands` |
| OQ-09 | Final role names, System Default roles and the permission list (MS OQ-3; the FRS "User Access Matrix" spreadsheet). Also: are separate read and edit permissions needed (e.g. see users without changing them)? | System Default: Merchant Owner, Project Admin, Reviewer, Viewer; permissions as in DEC-70, one per area (no read-only variants) | `src/domain/roles.ts` |
| OQ-11 | Does a claim end when the reviewer logs out or closes the tab? | No: only Release, timeout, decision or removal from the project | `claimRules.ts` |
| OQ-12 | Can a reviewer re-claim straight after their own claim times out? | Yes | `claimRules.ts` |
| OQ-13 | What does the page show if the claim expires while the reviewer is typing? | Buttons disable; save fails with "This case is no longer assigned to you"; typed text is kept | Detail page |
| OQ-14 | Price per token (by contract tier) | RM 0.50 per liveness submission | `TOKEN_PRICE` |
| OQ-17 | Is Reference ID unique per merchant or per project? (MS OQ-1) | Per project; the Project column makes duplicates across projects clear | Project setting (shown read-only) |
| OQ-18 | Are routing rules and percentage splits set only through the API, or also edited in the portal? (MS OQ-2) | API only; portal shows them read-only | Project Settings › Routing |
| OQ-19 | Default session expiry and accepted documents for a new flow (MS OQ-4) | Required fields with no default on a new flow; seeded flows use 30 min and MyKad + Passport | Flow Detail |
| OQ-21 | Project data retention period | Not set; shown as a placeholder | Project Settings › General |
| OQ-22 | Cooldown after a rejection (DEC-26): how is the "same end user" identified, and does the wait apply to this flow only or the whole project? | Same ID document number (NRIC / passport no.), same flow | Flow `cooldownMin`, `flowRules.ts` |
| OQ-24 | Does the claim timeout run from claim time or from the last activity? (FRS TBC) | From claim time | `claimRules.ts` |
| OQ-25 | Risk components shown on Verification Detail (DEC-44: "each component's 0–100 score and reason codes"): which components, and which reason codes? | Overall risk score and level only; the components area is labelled OPEN QUESTION | Verification Detail › Risk |
| OQ-26 | A case in review only because Risk Assessment did not pass (DEC-13): which reason does a reviewer give to Reject it? The DEC-35 catalogue has no risk condition | Any catalogue condition may be chosen | `conditions.REJECT_REASONS` |
| OQ-27 | On a project's Members tab (DEC-77), can a user with Manage project members invite someone new, or only add existing users of the merchant? | Existing users only; new people are invited on the Users screen (Manage users and roles) | `userAdminService.addMember` |
| OQ-28 | Must the merchant always send a Reference ID when creating a session (DEC-97)? If not, does the platform generate one? | Required; the mock always has one | `Verification.referenceNo` |
| OQ-29 | How long are a Terminated merchant's cases and audit log kept, and are they then archived or deleted? Keeping them is required for compliance; the PDPA says not longer than needed (DEC-98) | Kept; nothing is deleted | — (backend policy) |
| OQ-30 | Are invoices issued from this portal? If so, merchants also need registered address, TIN, SST number and a billing email (MyInvois) (DEC-98) | No; only the FRS fields | `Merchant` |

## Answered (kept for traceability)
| ID | Question | Answer |
|---|---|---|
| OQ-07 | Are retakes charged per attempt? | Tokens per liveness submission; ID capture and selfie retakes are free (DEC-60) |
| OQ-08 | Can Platform Admin claim and decide? | Yes, changed 2026-10-21 (DEC-75); was No (DEC-70) |
| OQ-20 | Can internal staff (Platform Admin) view merchant cases for support? (MS OQ-7) | Yes; every open is audited (DEC-75) |
| OQ-10 | Decision reason code list | Reject: conditions from DEC-35; approve: no code; note optional (DEC-31) |
| OQ-15 | Which 3 KPIs does the Overview show? | Total Submissions, Auto-Clear Rate, Active Review Queue ([FRS], DEC-85) |
| OQ-16 | Should user and merchant changes be audited? | Yes (DEC-42) |
| OQ-23 | Can Platform Admin use Draft registry versions for test flows? | No; Draft versions cannot be chosen by anyone (DEC-56) |
| MS OQ-8 | Is rejection reason free text or a fixed list? | Fixed list plus optional note (DEC-31) |
