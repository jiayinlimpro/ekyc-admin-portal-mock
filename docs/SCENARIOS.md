# Named scenarios (UAT test cases)

Each scenario is a fixture in `src/mocks/fixtures/edgeCases.ts` with a fixed Reference ID (the merchant's reference)
and a fixed case ID, so deep links stay stable (the `260901` date part is fixed on purpose; see MOCK-05). Case URLs use the
case ID (`/verifications/ver_…`, DEC-97): open scenarios from the UAT page (Dev menu), or type the Reference ID in the
header search. Default users: **Ali Bin Ahmad (ali.ahmad@atoz.example)** and
**Siti Aminah Binti Yusof (siti.yusof@atoz.example)**, both Members with the Reviewer role in Atoz Software Tech's Default
project (Project › Members); the Owner **Tan Mei Ling (meiling.tan@atoz.example)** sees every Atoz project. The super admin **Lim Wei Jie (weijie.lim@ekyc-platform.example)** can do everything in every merchant, cases
included (DEC-75); every case he opens is audited.

Thresholds come from each case's flow revision and the presets (OQ-02). Atoz "Malaysian onboarding" (V4-R2):
face match reject < 85 / approve ≥ 95, liveness reject < 70 / approve ≥ 85, 3 retries per phase (Document, Selfie on V1,
Liveness; up to 4 submissions each, DEC-108). A result below approve sends the user to retry; when retries run out, the last
submission decides (DEC-15, DEC-16); a document that still fails is rejected.

Claim-timed scenarios (S07, S08, S09) and cooldown (S18) are relative to the moment the data was seeded. Use **Reset demo
data** before a UAT run.

## Access scenarios (DEC-74, DEC-76, DEC-77, DEC-104, DEC-109)

Where things are (DEC-109): **Users** and **Roles** (and the merchant's Billing and Audit log) are tabs of **Merchant
settings**, the ⚙ on the merchant's row of the Merchants page. **Platform staff** (staff and platform roles), **Super
admins** and **Workflow Registry** are in the Merchants page's menu. Project screens (Verifications, Flows, Project
Settings, dashboards) open after **Go to project** on a project card.

| # | As | Do | Expected |
|---|---|---|---|
| A1 | Tan Mei Ling (`?as=meiling.tan@atoz.example`) | Users › New user | Merchant role list: Owner, Admin, Billing, Auditor, Member, User Coordinator (no project roles); Member by default with the help text; listed as Pending, Merchant role "Member" |
| A2 | Tan Mei Ling | New user, merchant role Auditor | Preview: the case list and audit log "in every project (including new ones)", merchant reports for the whole merchant; Merchant role "Auditor" (no scope) |
| A3 | Tan Mei Ling | Project Settings › Members (Default): remove Ali's Reviewer | Ali's claim on S07 is released (audited); Default leaves his project switcher |
| A4 | Lim Wei Jie (`?as=weijie.lim@ekyc-platform.example`) | Users › Tan Mei Ling: Change role, or Suspend | Both disabled: at least one active Owner is required |
| A5 | Hafiz (`?as=hafiz.rahman@atoz.example`) | Project Settings › Members (SME app): add Siti as Reviewer | Project role list: Project Admin, Reviewer, Developer, Viewer, Release Tester (SME app's roles only); Tan Mei Ling and Lee Jia Hui listed inherited · read-only |
| A6 | Tan Mei Ling | Users › Ali | Merchant role Member with Change role; Project access lists Reviewer · Default and Viewer · SME app (read-only, managed in Members) |
| A7 | Tan Mei Ling | Roles; then New role | Merchant roles only (Owner … Member, User Coordinator), System Default read-only; New role shows every module; ticking Approve / reject ticks Claim / release, View details and View list |
| A8 | Tan Mei Ling | Users › Ali › Effective access, choose SME app | View list, View details, Flows View and reports, each "Comes from" Viewer · SME app |
| A9 | Muthu (`?as=muthu.rajan@atoz.example`) | Go to project Default | Billing role: lands on Billing (no Overview tab); no Verifications or Flows in the menu |
| A10 | Lim Wei Jie | Platform › Super admins | Lim and Nor Aisyah only (not on Users); Suspend disabled on his own row; New admin starts Pending |
| A11 | Lim Wei Jie | Merchants › New merchant: Malaysia, registration no `1312525-A` | "Malaysian registration numbers have 12 digits"; with `202101012345` it is created as Onboarding, with its Default project and a Pending Owner |
| A12 | Lim Wei Jie | Merchants › Tesla ⚙ › General › Change status › Suspended, with a reason | Tesla shows Suspended; Wong Kah Heng can no longer be picked in Switch user; its API keys show "Stopped"; the audit log has the reason |
| A13 | Tan Mei Ling | Roles › New role (save it); then ⋮ on Reviewer and on the new role | The dialog opens with a generated Role ID (read-only), one Permissions table (no sections) and a Status field; Reviewer's Deactivate is disabled with the reason; the new role (nobody holds it) can be deactivated and activated again |
| A14 | Lim Wei Jie | Platform staff › Platform roles › New role | Type Platform (internal); no Merchant field; one Permissions table of 15 rows: the platform modules plus every merchant module (Projects, Users, Roles … Project roles) with the same wording |
| A15 | Lim Wei Jie | Platform staff › New staff member | Type Platform; name, company email and one Staff role (Platform Admin, Support, Implementation, Finance); no merchant scope; a non-company email is refused |
| A16 | Daniel Tan (`?as=daniel.tan@ekyc-platform.example`) | Go to project on any card; open any case; Flows; Project Settings › Integration | Lands on Verifications (Support has no dashboards); the full case page, no masking, audited; flows and keys read-only; no Super admins, Platform staff or New merchant |
| A17 | Tan Mei Ling | Merchant settings › Users; Roles; try `/platform-staff` | No platform staff or platform roles anywhere; Platform staff is "No access" |
| A18 | Tan Mei Ling | Project Settings › Roles (SME app); then Default | SME app: Project Admin, Reviewer, Developer, Viewer, Release Tester; Default has Fraud Checker instead. New role shows project modules only (no Users, Roles, Billing) |
| A19 | Tan Mei Ling | Project Settings › Roles (SME app) › Duplicate from another project › Default › Fraud Checker | "Copy of Fraud Checker" opens with its permissions; saved, it exists in SME app only |
| A20 | Grace Lim (`?as=grace.lim@atoz.example`) | Verifications in Default, then in SME app | Auditor + Viewer in SME app: both lists show the project's cases; Reference IDs link only in SME app |
| A22 | Rizal Hakim (`?as=rizal.hakim@ekyc-platform.example`) | Vantage ⚙ › Users; Roles; Vantage Default ⚙ › Members | Platform Admin: manages Vantage's users, merchant roles, project roles and members; Daniel (Support) has none of these |
| A21 | Aaron Teoh (`?as=aaron.teoh@atoz.example`) | Users › New user | User Coordinator: he can invite, giving only Member or his own User Coordinator role (nothing he doesn't hold, DEC-74); no Change role or Suspend on other users |
| A23 | Tan Mei Ling, project Default | Project Settings › Review operations › Decision reasons | System Default reasons have no Edit and only a switch; "Other" is always on; Atoz's own "Customer on internal watchlist" (Reject, note required) and "Identity confirmed by video call" (Approve) can be edited. Turn off "Below minimum age" → it is no longer offered on S10; audited as a project setting (DEC-106) |
| A24 | Ali Bin Ahmad (`?as=ali.ahmad@atoz.example`) | S10: Assign to me, then Decision | Reject: reasons by group, one or more; Confirm Manual Pass: exactly one reason; choosing "Other" makes the note required. On Vantage cases (Kavitha) "Nationality or residency not accepted" is not offered (turned off there) (DEC-106) |
| A25 | Lim Wei Jie (`?as=weijie.lim@ekyc-platform.example`) | Platform › Workflow Registry | V5 is **Limited release** (1 merchant: Atoz; Edit › Merchant access) and V6 **Internal testing**; Change status offers every other status. As Tan Mei Ling, New flow offers V5 but not V6; as Kavitha (Vantage), neither; as the super admin, both in any project (DEC-56) |
| A26 | Lim Wei Jie, then Tan Mei Ling | Atoz › Default: Flows; Verifications (all statuses); Billing | The super admin sees **Next engine trial** (V6, Internal testing) and its test session S26 (0 tokens); Tan Mei Ling sees neither, and S26's link is "not found" for her (DEC-56) |

| ID | Reference ID | Project › Flow | Scenario | Expected behaviour |
|---|---|---|---|---|
| S01 | KYC-260901-900001 | Vantage Default › Standard onboarding (V1) | Both checks ≥ Auto-Pass | APPROVED · SYSTEM; no risk panel |
| S02 | KYC-260901-900002 | Atoz Default › Malaysian onboarding (V4) | Checks pass, High risk | PENDING_REVIEW, reason "Risk Assessment: high risk"; every category below the fixed minimum 50 (EXIF 32, Noise 18, Email Validity 20, OSINT 10) (DEC-107) |
| S03 | KYC-260901-900003 | Atoz Default › Malaysian onboarding (V4) | Face match 80.4 → 82.1 → 84.0 → 88.5 | PENDING_REVIEW, "Liveness face does not match ID face (Retry Not Allowed)" |
| S04 | KYC-260901-900004 | Atoz Default › Malaysian onboarding (V4) | Liveness below Auto-Reject on all 4 submissions | REJECTED · SYSTEM, "Face not live (Retry Not Allowed)" |
| S05 | KYC-260901-900005 | Atoz Default › Malaysian onboarding (V4) | Stopped at ID capture, no submission yet | PROCESSING; read-only; ID capture shows why: image 300 × 240 and Address not read (both fail) |
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
| S19 | KYC-260901-900019 | Vantage Default › Standard onboarding (V1, Advanced face match 82/93) | Face match (ID vs selfie) 70.0, retry pending | PROCESSING; a selfie that failed its quality check would use a Selfie retry (DEC-108) |
| S20 | KYC-260901-900020 | Vantage Default › Standard onboarding (V1, accepts Driving License) | Driving License; face match 80.1 → 84.0 → 86.2 → 88.0 | PENDING_REVIEW, "ID face and Selfie face do not match (Retry Not Allowed)"; End-user data shows IC, licence class and validity |
| S22 | KYC-260901-900022 | Vantage Default › Standard onboarding (V1) | Selfie too dark (brightness 14.2 ≤ 25); the user stopped | PROCESSING; Selfie "Fail: not compared with the ID"; Telemetry shows the rejected selfie and "Face match: Not run"; no duplicate-user search (DEC-105) |
| S23 | KYC-260901-900023 | Atoz Default › Premium accounts (V5, own minimums EXIF 40 · Noise 60 · Email 50 · OSINT 30) | Checks pass; OSINT 22 | PENDING_REVIEW, "OSINT Score 22 < 30"; the other categories are OK against this flow's minimums (DEC-107) |
| S24 | KYC-260901-900024 | Atoz Default › Premium accounts (V5) | Checks pass; EXIF 45 | APPROVED · SYSTEM: Low risk under this flow's EXIF minimum 40, though V4's fixed 50 would flag it (DEC-107) |
| S25 | KYC-260901-900025 | Atoz Default › Malaysian onboarding (V4) | Three ID images failed; the 4th is still 300 × 240 | REJECTED · SYSTEM, "ID image smaller than 320x320 (Retry Not Allowed)"; Checks shows 3 of 3 document (OCR) retries used; 4 document tokens (DEC-108, DEC-60) |
| S26 | KYC-260901-900026 | Atoz Default › Next engine trial (V6, Internal testing) | Platform test session, both checks pass | APPROVED · SYSTEM; not charged (0 tokens); seen by super admins and platform staff only (DEC-56, DEC-60) |
| S21 | KYC-260901-900021 | Atoz Default › Malaysian onboarding (V4) | Face match 86.0 → 87.5 → 88.0 → 89.2; face search finds an existing user (97.6) | PENDING_REVIEW for the face match only; "Existing user found" is shown for information and changes nothing (DEC-105) |
