# Named scenarios (UAT test cases)

Each scenario is a fixture in `src/mocks/fixtures/edgeCases.ts` with a fixed Reference ID (the merchant's reference)
and a fixed case ID, so deep links stay stable (the `260901` date part is fixed on purpose; see MOCK-05). Case URLs use the
case ID (`/verifications/ver_…`, DEC-97): open scenarios from the UAT page (Dev menu), or type the Reference ID in the
header search. Default users: **Ali Bin Ahmad (ali.ahmad@atoz.example)** and
**Siti Aminah Binti Yusof (siti.yusof@atoz.example)**, both Reviewers in Atoz Software Tech's Default project; Merchant Owner
**Tan Mei Ling (meiling.tan@atoz.example)** sees every Atoz project. The super admin **Lim Wei Jie (weijie.lim@ekyc-platform.example)** can do everything in every merchant, cases
included (DEC-75); every case he opens is audited.

Thresholds come from each case's flow revision and the presets (OQ-02). Atoz "Malaysian onboarding" (V4-R2):
face match reject < 85 / approve ≥ 95, liveness reject < 70 / approve ≥ 85, 3 retries (up to 4 submissions). A result
below approve sends the user to retry; when retries run out, the last submission decides (DEC-15, DEC-16).

Claim-timed scenarios (S07, S08, S09) and cooldown (S18) are relative to the moment the data was seeded. Use **Reset demo
data** before a UAT run.

## Access scenarios (DEC-70, DEC-74, DEC-76, DEC-77)

| # | As | Do | Expected |
|---|---|---|---|
| A1 | Tan Mei Ling (`?as=meiling.tan@atoz.example`) | Users › New user, role Reviewer, Selected projects › SME app | Listed as Pending, Access "Reviewer (SME app)"; audit USER_INVITED in SME app |
| A2 | Tan Mei Ling | New user, role Merchant Owner | "Selected projects" is unavailable: merchant-level permissions only for All projects |
| A3 | Tan Mei Ling | Users › Ali › edit Reviewer (Default) to Viewer | Ali's claim on S07 is released (audited); he can still view Default cases |
| A4 | Lim Wei Jie (`?as=weijie.lim@ekyc-platform.example`) | Users › Tan Mei Ling › remove Merchant Owner, or Suspend | Refused: the merchant needs at least one Merchant Owner (All projects) |
| A5 | Hafiz (`?as=hafiz.rahman@atoz.example`) | Project Settings › Members (SME app): add Siti as Reviewer | Siti appears; Tan Mei Ling is listed as Merchant Owner · inherited, not removable; Merchant Owner is not offered |
| A6 | Ahmad Faiz (`?as=faiz.zulkifli@vantage.example`) | Roles › Compliance Auditor | "Affects 1 user"; removing View audit log takes Kavitha's Audit Log away at once |
| A7 | Tan Mei Ling | Roles › Reviewer | Read-only (System Default); New role with Claim cases ticks View cases |
| A8 | Tan Mei Ling | Users › Ali › Effective access, choose SME app | Only View cases and View project reports, each "Comes from" Viewer · SME app |
| A9 | Lim Wei Jie | Users › Tan Mei Ling | Remove and Suspend are disabled; hovering says at least one Merchant Owner (All projects) is required |
| A10 | Lim Wei Jie | Platform › Admins | Lim and Nor Aisyah only (not on Users); Suspend disabled on his own row; New admin starts Pending |
| A11 | Lim Wei Jie | Merchants › Add Merchant: Malaysia, registration no `1312525-A` | "Malaysian registration numbers have 12 digits"; with `202101012345` it is created as Onboarding, with its Default project and a Pending owner |
| A12 | Lim Wei Jie | Merchants › Tesla › ⋮ › Change status › Suspended, with a reason | Tesla shows Suspended; Wong Kah Heng can no longer be picked in Switch user; its API keys show "Stopped"; the audit log has the reason |
| A13 | Tan Mei Ling | Roles › New role; then ⋮ on Reviewer and on Fraud Analyst | The dialog opens with a generated Role ID (read-only) and a Status field; Reviewer's Deactivate is disabled with the reason; Fraud Analyst (nobody holds it) can be deactivated and activated again |
| A14 | Lim Wei Jie | Roles › New role, Type = Platform (internal) | No Merchant field; permissions by module; ticking Claim / approve / reject also ticks both Verifications views |
| A15 | Lim Wei Jie | Users › New user, Type = Platform; role Finance, then Support | Finance hides Merchant access ("no merchant access permissions"); Support offers All merchants (default) or Selected; a non-company email is refused |
| A16 | Daniel Tan (`?as=daniel.tan@ekyc-platform.example`) | Open any case; then Flows, Project Settings › Integration | The case is masked (ID number, address, images hidden); flows and keys are read-only; no Users, Roles or Billing |
| A17 | Tan Mei Ling | Users; Roles; try `/users?user=<Daniel's ID>` | No platform staff or platform roles anywhere; the staff member is "not found" |

| ID | Reference ID | Project › Flow | Scenario | Expected behaviour |
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
| S11 | KYC-260901-900011 | Atoz Default › Malaysian onboarding (V4) | Manually approved | APPROVED · "Ali Bin Ahmad"; decision is final |
| S12 | KYC-260901-900012 | Atoz Default › Malaysian onboarding (V4) | Started on V4-R1; R2 saved 2 h ago | PROCESSING; still evaluated with R1 (DEC-52); retry pending |
| S13 | KYC-260901-900013 | Vantage Default › Standard onboarding (V1) | Liveness 55.0 → 66.2 → 90.1 | APPROVED · SYSTEM; 2 retries counted |
| S14 | — | Empty Demo Merchant | Merchant with 0 records / filter with no results | Empty state |
| S15 | KYC-260901-900015 | Vantage Default › Standard onboarding (V1) | Passport (non-MyKad) | OCR panel shows passport fields; no NRIC |
| S16 | KYC-260901-900016 | Atoz SME app › SME director check (V3) | Liveness retries used up (2 retries), last 72.3 | PENDING_REVIEW. Ali is a **Viewer** in SME app: may view, may not claim; Nurul Huda (Reviewer) may claim, with SME app's 45-min claim timeout |
| S17 | KYC-260901-900017 | Boring Default › Express (pilot) (V3, **Retiring**) | First liveness failed, retry pending | PROCESSING; the flow stays Retiring until this case is decided |
| S18 | KYC-260901-900018 | Atoz Default › Foreigner onboarding (V4, High face match) | Face match below 90 on all 4 submissions | REJECTED · SYSTEM; 120-min cooldown: same end user may start a new case only 2 h after rejection (DEC-26) |
| S19 | KYC-260901-900019 | Vantage Default › Standard onboarding (V1, Advanced face match 82/93) | Face match (ID vs selfie) 70.0, retry pending | PROCESSING; selfie retakes are free and unlimited |
| S20 | KYC-260901-900020 | Vantage Default › Standard onboarding (V1, accepts Driving License) | Driving License; face match 80.1 → 84.0 → 86.2 → 88.0 | PENDING_REVIEW, "ID face and Selfie face do not match (Retry Not Allowed)"; End-user data shows IC, licence class and validity |
