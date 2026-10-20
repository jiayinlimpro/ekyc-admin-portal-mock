# Named scenarios (UAT test cases)

Each scenario is a fixture in `src/mocks/fixtures/edgeCases.ts` with a fixed Reference No, so deep links stay stable
(the `260901` date part is fixed on purpose; see MOCK-05). Default users: **Ali Bin Ahmad (USR-2026-0012)** and
**Siti Aminah Binti Yusof (USR-2026-0031)**, both Reviewers in Atoz Software Tech's Default project; admin
**Lim Wei Jie (USR-2026-0001)**.

Thresholds come from each case's flow revision and the presets (OQ-02). Atoz "Malaysian onboarding" (FLW-0001, V4-R2):
face match reject < 85 / approve ≥ 95, liveness reject < 70 / approve ≥ 85, 3 retries (up to 4 submissions). A result
below approve sends the user to retry; when retries run out, the last submission decides (DEC-15, DEC-16).

Claim-timed scenarios (S07, S08, S09) and cooldown (S18) are relative to the moment the data was seeded. Use **Reset demo
data** before a UAT run.

| ID | Reference No | Project › Flow | Scenario | Expected behaviour |
|---|---|---|---|---|
| S01 | KYC-260901-900001 | Vantage Default › Standard onboarding (V1) | Both checks ≥ Auto-Pass | APPROVED · SYSTEM; no risk panel |
| S02 | KYC-260901-900002 | Atoz Default › Malaysian onboarding (V4) | Checks pass, risk HIGH | PENDING_REVIEW, reason "Risk Assessment not passed" |
| S03 | KYC-260901-900003 | Atoz Default › Malaysian onboarding (V4) | Face match 80.4 → 82.1 → 84.0 → 88.5 | PENDING_REVIEW, "Liveness face does not match ID face (Retry Not Allowed)" |
| S04 | KYC-260901-900004 | Atoz Default › Malaysian onboarding (V4) | Liveness below Auto-Reject on all 4 submissions | REJECTED · SYSTEM, "Face not live (Retry Not Allowed)" |
| S05 | KYC-260901-900005 | Atoz Default › Malaysian onboarding (V4) | Stopped at ID capture, no submission yet | PROCESSING; read-only |
| S06 | KYC-260901-900006 | Atoz Default › Malaysian onboarding (V4) | Liveness retries used up, last 74.5 (review band) | PENDING_REVIEW, "Face not live (Retry Not Allowed)"; 4 submissions, same Ref |
| S07 | KYC-260901-900007 | Atoz Default › Malaysian onboarding (V4) | Claimed by Ali, ~2 min left | As Ali: decision enabled + warning. As Siti: disabled "Claimed by Ali Bin Ahmad" |
| S08 | KYC-260901-900008 | Atoz Default › Malaysian onboarding (V4) | Claimed by Ali, expires mid-review | Time-warp past expiry → decision disables and a toast warns. To prove the **service-side** check: Dev → *Skip UI claim checks*, fill the form, time-warp, save → refused; claim timeout and blocked decision audited |
| S09 | KYC-260901-900009 | Atoz Default › Malaysian onboarding (V4) | Claimed by Siti | As Ali: view allowed, decision disabled "Claimed by Siti Aminah Binti Yusof" |
| S10 | KYC-260901-900010 | Atoz Default › Malaysian onboarding (V4) | Unclaimed; two reviewers click Assign | Two browser tabs as Ali and Siti (`?as=`). First wins; second gets "Already claimed by …"; the other tab refreshes live |
| S11 | KYC-260901-900011 | Atoz Default › Malaysian onboarding (V4) | Manually approved | APPROVED · "Ali Bin Ahmad (USR-2026-0012)"; decision is final |
| S12 | KYC-260901-900012 | Atoz Default › Malaysian onboarding (V4) | Started on V4-R1; R2 saved 2 h ago | PROCESSING; still evaluated with R1 (DEC-52); retry pending |
| S13 | KYC-260901-900013 | Vantage Default › Standard onboarding (V1) | Liveness 55.0 → 66.2 → 90.1 | APPROVED · SYSTEM; 2 retries counted |
| S14 | — | Empty Demo Merchant | Merchant with 0 records / filter with no results | Empty state |
| S15 | KYC-260901-900015 | Vantage Default › Standard onboarding (V1) | Passport (non-MyKad) | OCR panel shows passport fields; no NRIC |
| S16 | KYC-260901-900016 | Atoz SME app › SME director check (V3) | Liveness retries used up (2 retries), last 72.3 | PENDING_REVIEW. Ali is a **Viewer** in SME app: may view, may not claim (from Phase 4); Nurul Huda (Reviewer) may claim |
| S17 | KYC-260901-900017 | Boring Default › Express (pilot) (V3, **Retiring**) | First liveness failed, retry pending | PROCESSING; the flow stays Retiring until this case is decided |
| S18 | KYC-260901-900018 | Atoz Default › Foreigner onboarding (V4, High face match) | Face match below 90 on all 4 submissions | REJECTED · SYSTEM; 120-min cooldown: same end user may start a new case only 2 h after rejection (DEC-26) |
| S19 | KYC-260901-900019 | Vantage Default › Standard onboarding (V1, Advanced face match 82/93) | Face match (ID vs selfie) 70.0, retry pending | PROCESSING; selfie retakes are free and unlimited |
