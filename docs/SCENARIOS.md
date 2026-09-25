# Named scenarios (UAT test cases)

Each scenario is a fixture in `src/mocks/fixtures/edgeCases.ts` with a fixed Reference No, so deep links stay stable
(the `260901` date part is fixed on purpose; see MOCK-05). Default users: **Ali Bin Ahmad (USR-2026-0012)** and
**Siti Aminah Binti Yusof (USR-2026-0031)**, both reviewers at Atoz Software Tech (V4); admin **Lim Wei Jie (USR-2026-0001)**.

Claim-timed scenarios (S07, S08, S09) are relative to the moment the data was seeded. Use **Reset demo data** before a UAT run.

| ID | Reference No | Merchant | Scenario | Expected behaviour |
|---|---|---|---|---|
| S01 | KYC-260901-900001 | Vantage (V1) | All phases ≥ Auto-Pass | APPROVED · SYSTEM; no risk panel |
| S02 | KYC-260901-900002 | Atoz (V4) | All phases ≥ Auto-Pass, risk HIGH | PENDING_REVIEW, reason "Risk Assessment not passed" |
| S03 | KYC-260901-900003 | Atoz (V4) | Face Match 83.5 (Reject 70 / Pass 85) | PENDING_REVIEW, reason "Between thresholds" |
| S04 | KYC-260901-900004 | Atoz (V4) | Liveness below Auto-Reject | REJECTED · SYSTEM |
| S05 | KYC-260901-900005 | Atoz (V4) | Aborted run, attempts left | PROCESSING; read-only; overlay disabled with reason |
| S06 | KYC-260901-900006 | Atoz (V4) | Attempt limit reached on Liveness | PENDING_REVIEW "Attempt limit reached – Liveness"; 3 attempts, same Ref |
| S07 | KYC-260901-900007 | Atoz (V4) | Claimed by Ali, ~2 min left | As Ali: overlay enabled + warning. As Siti: overlay disabled "Claimed by Ali Bin Ahmad" |
| S08 | KYC-260901-900008 | Atoz (V4) | Claimed by Ali, expires mid-review | Time-warp past expiry → overlay disables ("Assign to me to review") and a toast warns. To prove the **service-side** check: Dev → *Skip UI claim checks*, fill the form, time-warp, save → "Your claim expired. No changes saved."; CLAIM_TIMEOUT + OWNERSHIP_CONFLICT audited |
| S09 | KYC-260901-900009 | Atoz (V4) | Claimed by Siti | As Ali: view allowed, overlay disabled "Claimed by Siti Aminah Binti Yusof" |
| S10 | KYC-260901-900010 | Atoz (V4) | Unclaimed; two reviewers click Assign | Two browser tabs as Ali and Siti (`?as=`), or the Dev *simulate another reviewer* box. First wins; second gets "Already claimed by …"; the other tab refreshes live |
| S11 | KYC-260901-900011 | Atoz (V4) | Manually approved | APPROVED · "Ali Bin Ahmad (USR-2026-0012)"; overlay disabled "Decision is final" |
| S12 | KYC-260901-900012 | Atoz (V4) | In flight when a new config was deployed | PROCESSING; keeps the old `configVersion` (v1.0.0) |
| S13 | KYC-260901-900013 | Vantage (V1) | Two user retakes, then approved | 3 attempts; Retry KPI counts 2; billing "Cost of Retries" depends on OQ-07 |
| S14 | — | Empty Demo Merchant | Merchant with 0 records / filter with no results | Empty state |
| S15 | KYC-260901-900015 | Vantage (V1) | Passport (non-MyKad) | OCR panel shows passport fields; no NRIC |
