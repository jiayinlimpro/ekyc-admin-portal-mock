# Decisions — source of truth

**Precedence:** this file > Module Specification "Projects & Flows" (2026-10-19, **[MS]**) > FRS 05/10/26 revision (**[FRS]**)
> old Axure. Where [MS] covers a topic it wins; anything it does not cover follows [FRS]. Answers given by the product owner
in review are marked **[PO]** with the date. If code, [MS], [FRS] or Axure disagree with this file, this file wins.

Each rule has an ID (`DEC-xx`). Tag code that implements a rule with `// REQ: DEC-xx` so QA and devs can trace it.
Rules changed on 2026-10-20 (Projects & Flows restructure) are marked **(changed)**; replaced rules are listed under
"Superseded" at the end so old `REQ:` tags can still be traced.

---

## Structure: Merchant → Project → Flow → Case
- **DEC-90** Four levels: a Merchant has 1..N Projects; a Project has 1..N Flows; every Case belongs to exactly one Flow
  (and so one Project). Each project has its own members, cases and settings ("Option C"). [MS]
- **DEC-91** Each setting lives at exactly one level. [PO 2026-10-20]

  | Level | Settings |
  |---|---|
  | Merchant | Contract, plan, billing · user accounts · portal login security · default branding and language |
  | Project | Members and roles · auto-release claim timeout · API keys, webhook · redirect URLs, allowed web origins, IP allowlist · branding override, language · data retention (OQ-21) |
  | Flow | Workflow version (locked once active) · check thresholds · retries allowed, cooldowns (after Rejected, after Unsuccessful) · accepted documents · risk thresholds (V4, V5) · session expiry |

- **DEC-92** Every merchant starts with a **Default** project. Creating a merchant also creates its Default project with one
  Draft flow, "First flow", built on the registry's default version (DEC-57), and its first user as Merchant Owner (FRS
  "Option B"). [MS][FRS] **(changed 2026-11-20)** It is no longer a "default flow" (DEC-95). [PO 2026-11-20]
- **DEC-93** Projects: create (name required), rename, archive. Archived = no new sessions; existing cases stay reviewable.
  The Default project cannot be archived while it is the merchant's only active project. Projects are never deleted. [MS]
- **DEC-94** Flows: status `Draft`, `Active`, `Retiring` (in-flight cases only), `Inactive`. Actions: create (pick a
  workflow version → Flow Detail), duplicate, activate, retire. Flows are never deleted, so past cases keep their flow. The
  workflow version is locked once a flow is active; to change version, create a new flow. [MS]
  **(changed 2026-11-20)** No default flow (every session names its flow, DEC-95): no Default badge, no Set as default, and
  any Active flow can be retired. Retiring warns that new sessions sent with its Flow ID are refused from then on, so the
  merchant must switch their `flowId` first. [PO 2026-11-20]
- **DEC-95** **(changed 2026-11-20)** **No routing: every session names its flow.** Each create-session request must send
  `flowId` (required; the Flow ID is on Flows and Flow Detail). It is refused when `flowId` is missing or unknown, belongs
  to another project than the API key's, or the flow is not Active (Draft, Retiring, Inactive), or the project is
  archived. No routing rules or percentage shares, and no Routing tab in Project Settings (answers OQ-18). [PO 2026-11-20]
- **DEC-96** **(superseded by DEC-109: always one project)** Case lists may span all of a user's projects ("All my projects"). Settings pages always work on one selected
  project. [MS]

## Statuses
- **DEC-01** **(changed 2026-11-23)** `VerificationStatus` is exactly: `PROCESSING`, `PENDING_REVIEW`, `APPROVED`,
  `REJECTED`, `UNSUCCESSFUL` (DEC-112). No other status exists (no MANUAL_APPROVED, ERROR, EXPIRED, CLAIMED, IN_REVIEW, BLOCKED,
  FAILED). [PO 2026-11-22, 2026-11-23]
- **DEC-02** Manual vs automated is read from `lastUpdatedBy`: `SYSTEM`, or the reviewer's Full Name + User ID.
- **DEC-03** `lastUpdatedBy` / `lastUpdatedAt` change **only when the status changes**. Claiming, releasing or viewing never touch them.
- **DEC-04** Lifecycle timestamps are `createdAt` (session started) and `lastUpdatedAt` (latest status change), plus the claim
  fields. **(changed)** [MS]
- **DEC-112** **(new)** `UNSUCCESSFUL`: **we never got a usable image**, so the person was not judged [PO 2026-11-22]. Shown as
  "Unsuccessful" (**changed 2026-11-23** on stakeholder feedback, was `FAILED` / "Failed"; the Flow setting is now "Cooldown
  after Unsuccessful", `unsuccessfulCooldownMin`) [PO 2026-11-23]. Not "Failed" and not "Blocked" (in eKYC "blocked" reads as a
  block list). Vendors keep this case apart from a rejection too (Persona "Failed", Jumio "not readable", Sumsub "Rejected ·
  RETRY"); none uses "Unsuccessful" as a status, so the reason under it always says what went wrong (e.g. "ID image smaller
  than 320x320 (Retry Not Allowed)"), and filters and reports always keep it apart from Rejected.
  - **Set by SYSTEM only**, when a phase's retries are used up (DEC-108) and its last submission still fails the engine's
    quality checks: the **Document (OCR)** phase (no valid face on the ID, image smaller than 320 × 320, OCR fields not
    detected), or on **V1** the selfie quality check (eyes, covered face, sharpness, brightness, yaw, pitch). The reason is
    the engine's condition with "(Retry Not Allowed)", e.g. "ID image smaller than 320x320 (Retry Not Allowed)".
  - **Not UNSUCCESSFUL:** a face match or liveness score (a judgement of the person) keeps its bands: below Auto-Reject →
    `REJECTED`, review band → `PENDING_REVIEW`, on every version (the V1 selfie's face match too).
  - **V1 selfie: UNSUCCESSFUL only when no selfie of the session was usable.** If any selfie of the session passed the quality
    check and was compared with the ID, the last face match score decides (`REJECTED` / `PENDING_REVIEW`), even when the
    last selfie then failed its quality check. So a deliberately blurry last selfie can't turn a face mismatch into
    `UNSUCCESSFUL` (and its shorter cooldown). [PO 2026-11-22]
  - Never claimed or decided by a reviewer (no decision buttons), like `REJECTED`. It ends only when the same Reference ID
    starts a new session after the Unsuccessful cooldown (DEC-26, DEC-113).
  - Tokens: every submission is charged as before (DEC-60).
  - Webhook: `UNSUCCESSFUL` is sent like the other final statuses (DEC-55).
  - Reports count it **on its own** (its own count and colour), never inside Rejected. It is an ended session that did not
    pass: pass rate = Approved / (Approved + Rejected + Unsuccessful).

## Automated evaluation
- **DEC-10** **(changed)** Only two checks have configurable thresholds: **Face match** and **Liveness**, each with an
  Auto-Reject / Auto-Pass pair. **(2026-10-27)** "Face match" is the configurable band and it judges the **similarity**
  score (the selfie or liveness face compared with the ID photo), the business threshold. The engine's fixed > 90 value is
  **Face detection confidence** (the box contains a face; a quality check, not liveness), never configurable
  [PO 2026-10-27; AWS face liveness and matching whitepaper §3.4, §6.1]. The internal code stays `FACE_MATCH`. ID capture and Selfie have no configurable thresholds; their quality checks are fixed by the
  engine. **(changed 2026-10-23)** Every engine metric (pitch, yaw, sharpness, brightness, face confidence …) is now
  **shown** on Verification Detail with its fixed threshold (DEC-105), but still never configurable. Risk Assessment runs for
  V4 and V5 only. [MS][FRS][PO 2026-10-19][PO 2026-10-23]
- **DEC-11** For similarity and liveness: score `>= autoPass` → pass; `< autoReject` → reject band; in between → review band.
- **DEC-12** When every check has a final result, they combine: any reject → `REJECTED`; otherwise any review →
  `PENDING_REVIEW`; otherwise all pass. *(Precedence is OQ-01 and is configurable.)*
- **DEC-13** **(changed)** V4 and V5: all checks passing is not enough; Risk Assessment must also be Low risk, otherwise
  `PENDING_REVIEW` with reason "Risk Assessment: high risk". The risk model is DEC-107.
- **DEC-107** **(new)** Risk Assessment, V4 and V5 [PO 2026-10-26]. Replaces the risk levels (Low / Medium / High), the
  "maximum allowed risk level" and the overall risk score.
  - The engine returns **four category scores, each 0–100, higher = more genuine**: EXIF, Noise, Email Validity, OSINT.
    How each is computed and normalised (EXIF tag points, ELA and wavelet values, email points, OSINT social score 0–10)
    is not final (OQ-25); the portal shows only the four scores, no breakdown and no reason codes.
  - **Risk result:** **Low risk** when every category is at or above its minimum, otherwise **High risk**. These words are used
    instead of pass / fail so they are never confused with the case statuses. One minimum per category.
  - **V4:** the minimums are fixed by the platform; the merchant sees them read-only. **V5:** the flow sets one minimum per
    category (0–100) in Flow Detail, with the same rules as the thresholds (Change verification level and retries; saving
    an active flow needs a reason and creates a revision). The registry entry says which versions allow it ("Risk minimums
    set per flow"). Default minimums: 50 each (OQ-34).
  - Final status:

    | Biometric result | Risk result | Final status |
    |---|---|---|
    | Approve | Clear | `APPROVED` |
    | Approve | High risk | `PENDING_REVIEW` |
    | Pending review | Any | `PENDING_REVIEW` |
    | Reject | Any | `REJECTED` (from biometrics, not risk) |

  - Risk never rejects. A high-risk case goes to review with the reason "Risk Assessment: high risk" and the categories below
    their minimum, e.g. "OSINT 22 < 30".
  - Verifications List: a **Risk** column and filter with Low risk / High risk (DEC-40, DEC-43, DEC-100). System Intelligence
    counts Low risk vs High risk.
- **DEC-14** A system approval is `APPROVED` with `lastUpdatedBy = SYSTEM` ("Auto-Clear").
- **DEC-19** Threshold presets. **(new)** [PO 2026-10-20]
  - Each of similarity and liveness offers **Low**, **Standard** and **High** presets. Low = lenient (more automatic
    approvals); High = strict. Preset values are OQ-02.
  - **Advanced** = custom Auto-Reject / Auto-Pass numbers, set by **Platform Admin only**. A merchant sees a read-only
    "Advanced (set by platform)" chip with the numbers and may switch back to a preset, but cannot edit the numbers.
  - A 0–100 band bar shows the Reject / Review / Approve bands and updates when a preset or custom values are chosen.

## Retries
- **DEC-15** **(changed)** A similarity or liveness result below Auto-Pass, with retries left, sends the user to retry; the case
  stays `PROCESSING`. An incomplete, aborted or timed-out run also stays `PROCESSING`. [PO 2026-10-20]
- **DEC-16** **(changed)** When retries run out, the **last attempt** decides: below Auto-Reject → `REJECTED`; review band →
  `PENDING_REVIEW`. The reason is the matching condition from DEC-35 (e.g. "Liveness face does not match ID face (Retry Not
  Allowed)"). [PO 2026-10-20] **(added 2026-10-27)** A document (OCR) or V1 selfie submission that still fails its engine
  checks when that phase's retries are used up → `REJECTED` by SYSTEM with the failing condition and "(Retry Not Allowed)",
  e.g. "ID image smaller than 320x320 (Retry Not Allowed)" (DEC-108). **(changed 2026-11-22)** That case is now `UNSUCCESSFUL`,
  not `REJECTED` (DEC-112). [PO 2026-11-22]
- **DEC-17** Retries keep the same case (Verification ID and Reference ID, DEC-114); each retry is appended to `attempts[]`, never a new record.
  **(extended 2026-11-22)** A new session with the same Reference ID also continues the same case (DEC-113).
- **DEC-18** **(changed again by DEC-108)** "**Retries allowed**" is set **per phase** per flow, not per check: the number of
  retries after the first submission. Default 3 = up to 4 submissions. Range is OQ-03. [PO 2026-10-20][FRS][PO 2026-10-27]
- **DEC-108** **(new)** Retries per phase [PO 2026-10-27]. Each phase that sends something to the engine has its own
  "Retries allowed" (default 3), in its own card on Flow Detail, apart from the thresholds:

  | Phase | Versions | A retry is used by |
  |---|---|---|
  | **Document (OCR)** | all | a submitted ID image that fails any engine check (face, size, OCR fields) |
  | **Selfie** | V1 | a submitted selfie that fails its quality check, or a face match below Auto-Pass |
  | **Liveness** | all | a liveness result below Auto-Pass; on V3/V4/V5 also a face match below Auto-Pass (the face match uses the liveness face) |

  - Retaking a photo **before** submitting is free and not counted; every **submitted** attempt that fails, whatever the
    reason in that phase, uses one retry.
  - Retries used up: the last submission decides (DEC-16): face match and liveness by their bands; a document or V1 selfie
    that still fails its engine checks → `UNSUCCESSFUL` (**changed 2026-11-22**, was `REJECTED`; DEC-112).
  - The retry KPIs (First-Attempt Pass Rate, Average Retries) count retries in every phase.
- **DEC-26** **(new)** Cooldown (per flow, minutes, default 0): after a case is `REJECTED`, the **same end user** cannot start
  a new case until the cooldown ends. 0 = no wait. How "same end user" is identified, and whether the wait covers only this
  flow or the whole project, is OQ-22. Verification Detail shows "New case allowed from …" on rejected cases. [PO 2026-10-20]
  **(changed 2026-11-22)** Two kinds of cooldown per flow, each in whole minutes, `>= 0`, default 0 (= at once):
  - **Cooldown after Rejected** (the existing field, relabelled), after a `REJECTED` case.
  - **Cooldown after Unsuccessful**, after an `UNSUCCESSFUL` case (DEC-112), whichever phase failed (Document, or the V1 selfie). One
    value per flow, not per phase [PO 2026-11-22].
  - The case's status picks the cooldown, not the phase: in the V1 selfie stage, no usable selfie (`UNSUCCESSFUL`) uses the
    Unsuccessful cooldown and a face mismatch (`REJECTED`) the Rejected one. Liveness never ends in `UNSUCCESSFUL`. A reviewer's reject
    uses the Rejected cooldown.
  - The same end user is the **same Reference ID** of the same merchant (DEC-113; answers OQ-22). Until the cooldown ends a
    new session with that Reference ID is refused; after it, the session continues the same case. The cooldown that
    applies is the one in the configuration revision of the session that ended. Verification Detail shows "New session
    allowed from …" on `REJECTED` and `UNSUCCESSFUL` cases while a cooldown runs. [PO 2026-11-22]
- **DEC-113** **(new)** **One case per end user: a returning Reference ID continues the same case** [PO 2026-11-22].
  - The **Reference ID** (the merchant's own ID for the end user, DEC-97) identifies the end user **within a project**,
    whatever document they scan: a case is found by merchant + project + Reference ID (**changed 2026-11-22**, was "unique
    per merchant"; answers OQ-17 and OQ-37). The merchant chooses the value and we can't control it, so the same Reference
    ID may appear in several projects of a merchant; each project then has its own case with its own **Verification ID**
    (DEC-114), our unique key. Cases are only ever shown inside their project (DEC-109), so they never mix.
  - A create-session request with a Reference ID whose case is `REJECTED` or `UNSUCCESSFUL`, once its cooldown has ended
    (DEC-26), starts a **new session on the same case** (same Verification ID, DEC-114): the status goes back to `PROCESSING`
    (`lastUpdatedBy` SYSTEM), every phase's retries start again, the earlier sessions and their attempts stay in the case's
    history, and every submission costs a token as before (DEC-60).
  - This includes a case a reviewer rejected: the earlier decision stays in the case's history and the Audit Log.
  - **Another Flow ID in the same project:** the case moves to that flow (it must be Active, DEC-95) and the new session
    uses its current revision.
  - **A flow in another project:** that project's own case for the Reference ID is used: none yet → a **new case** (new
    Verification ID) at once; one exists → the rules above apply to it. Projects are isolated: a case, its status and its
    cooldown in one project never affect another [PO 2026-11-22; answers OQ-37].
  - The same Reference ID while the case is `PROCESSING`, `PENDING_REVIEW` or `APPROVED` is refused (OQ-38; not expected).
  - Audit: `CASE_RESUMED` (SYSTEM) with the previous status, the session number and the flow (old → new when it moved).
  - No webhook for the return to `PROCESSING` (DEC-55 never sends it); the next delivery is the new session's result.
  - Reports count a case once, by its current status, on the day the case was first created; tokens are counted per
    submission, whichever session (DEC-60: one billing line per session).
  - The case page shows the case's sessions: when each started, its flow and revision, and how it ended (status, reason,
    by whom). Shown when the case has more than one session; the attempts of an earlier session are listed under it.
  - **Record** [PO 2026-11-22]: the case keeps a `sessions` list, oldest first, the last one current. The case's own
    fields (flow, revision, scores, attempts, telemetry, status) always describe the **current** session; an ended session
    keeps how it ended (`REJECTED` or `UNSUCCESSFUL`, reason, time, `lastUpdatedBy`), its tokens and its attempts.
  - When a create-session request arrives: no case in the project → a new case; `REJECTED` or `UNSUCCESSFUL` and no cooldown
    running → a new session on the case; in cooldown → refused with "New session allowed from …"; `PROCESSING`,
    `PENDING_REVIEW` or `APPROVED` → refused (OQ-38). The flow must be Active (DEC-95).

## Claim
- **DEC-20** Claim is **not** a status. It is stored as `claimedBy`, `claimedAt`, `claimExpiresAt`.
- **DEC-21** One owner at a time. Only `PENDING_REVIEW` records can be claimed ("Assign to me").
- **DEC-22** **(changed)** The auto-release claim timeout is set **per project**. A claim ends only by **Release**, **timeout**,
  **decision**, or the holder being **removed from the project** (DEC-74). [MS]
- **DEC-23** No supervisor assign, reassign or force-release.
- **DEC-24** **(changed)** Ownership is re-checked **at save time**. If the claim expired, belongs to someone else, or the status
  is no longer `PENDING_REVIEW`, nothing is saved, a `CASE_DECISION_BLOCKED` audit entry is written, and the page shows
  "This case is no longer assigned to you" and refreshes. [MS][FRS]
- **DEC-25** **(changed)** Any member of the case's project can **view** it; opening never locks it. Only the decision
  buttons are enabled or disabled. [MS]

## Decisions
- **DEC-30** **(changed)** Approve ("Confirm Manual Pass") and **Reject** are enabled only for the claim holder on a
  `PENDING_REVIEW` case; `lastUpdatedBy` = the reviewer. Everyone else sees the case read-only with the buttons disabled. [MS][FRS]
- **DEC-31** **(changed again by DEC-106)** Reject requires **one or more decision reasons**; Approve requires **exactly
  one**. The reasons come from the project's decision reason list (DEC-106), not from the DEC-35 conditions. The note is
  optional, except for a reason marked "note required" (e.g. Other). [MS][PO 2026-10-20][PO 2026-10-23]
- **DEC-32** Decisions are final: no reopen, no "Request Resubmission". **(changed 2026-11-22)** A reviewer still never
  reopens a case and there is still no "Request Resubmission"; but a `REJECTED` (or `UNSUCCESSFUL`) case continues when the same
  Reference ID starts a new session after its cooldown (DEC-113). [PO 2026-11-22]
- **DEC-33** `PROCESSING` records are read-only.
- **DEC-35** Condition catalogue. **(new)** [PO 2026-10-20] Used for the reason banner on Verification Detail
  (`PENDING_REVIEW` / `REJECTED` / `UNSUCCESSFUL`) and the Top-5 failure reasons charts. They are produced by the engine and fixed; a
  reviewer's reasons are the separate decision reasons (DEC-106).

  | Stage | Condition |
  |---|---|
  | Onboarding | No valid face in ID detected |
  | Onboarding | No valid face in Selfie detected |
  | OCR | ID image smaller than 320x320 |
  | OCR | No word detected |
  | OCR (NRIC) | IC field not detected · Gender field not detected · Name field not detected · Address field not detected |
  | OCR (Driving License) | IC field not detected · Validity Data field not detected · Name field not detected · Nationality field not detected · Class field not detected · Address field not detected |
  | OCR (Passport) | Unable to detect the 2 lines MRZ field in passport image |
  | Onboarding | ID face and Selfie face do not match (Retry Allowed) · (Retry Not Allowed) |
  | Onboarding | Face already has existing registered user in db — **record-only** |
  | Liveness | Face not live (Retry Allowed) · (Retry Not Allowed) |
  | Liveness | Liveness face does not match ID face (Retry Allowed) · (Retry Not Allowed) |
  | Liveness | All stages passed — success, not a failure |

  - The **record-only** condition never changes the status and is never shown on the list ([MS]: no duplicate-user
    information). **(changed 2026-10-23)** Verification Detail shows the duplicate-user result for information (DEC-105).
    It is not a decision reason; "Duplicate identity" in DEC-106 is the reviewer's own finding.
  - "(Retry Allowed)" conditions keep the case `PROCESSING`; "(Retry Not Allowed)" conditions are the final reason (DEC-16).
    The ID capture (Onboarding "No valid face in ID", OCR) and V1 selfie quality conditions end as `UNSUCCESSFUL` (DEC-112).
- **DEC-106** **(new)** Decision reasons [PO 2026-10-23]. What a reviewer picks on Approve or Reject. Separate from the
  DEC-35 conditions (what the engine found), so reviewer choices can be analysed on their own.
  - **Per project.** Managed in **Project Settings › Review operations**, card "Decision reasons", with the Project
    settings · Edit permission (no new permission). Changes are audited as `PROJECT_SETTING_CHANGED`.
  - **System Default reasons** are the same in every project, with stable codes so reports compare across merchants. They
    are locked: a project can **turn one off**, never rename or delete it.

    | Outcome | Group | Reason (code) |
    |---|---|---|
    | Reject | Document | Type not accepted (`DOC_TYPE_NOT_ACCEPTED`) · Expired (`DOC_EXPIRED`) · Unclear: blur, glare, cropped (`DOC_UNCLEAR`) · Not original: photocopy, screen (`DOC_NOT_ORIGINAL`) · Tampered or forged (`DOC_TAMPERED`) · Data inconsistent, e.g. NRIC vs date of birth (`DOC_DATA_INCONSISTENT`) |
    | Reject | Face & liveness | Face doesn't match ID (`FACE_MISMATCH`) · Spoof suspected: photo, mask, screen, deepfake (`SPOOF_SUSPECTED`) · Face not clearly visible (`FACE_NOT_VISIBLE`) |
    | Reject | Identity & eligibility | Details don't match what the customer submitted (`DETAILS_MISMATCH`) · Below minimum age (`UNDERAGE`) · Nationality or residency not accepted (`NATIONALITY_NOT_ACCEPTED`) |
    | Reject | Fraud & risk | Duplicate identity: same person, different ID (`DUPLICATE_IDENTITY`) · Risk not acceptable after review (`RISK_NOT_ACCEPTABLE`) · Other fraud indicators (`OTHER_FRAUD`) |
    | Reject | Other | Other (`REJECT_OTHER`, note required) |
    | Approve | — | Face confirmed by reviewer, e.g. old ID photo (`FACE_CONFIRMED`) · Image quality low but identity confirmed (`QUALITY_LOW_IDENTITY_CONFIRMED`) · Risk signals reviewed and accepted (`RISK_ACCEPTED`) · Existing user is the same person, re-onboarding (`SAME_PERSON_REONBOARDING`) · Other (`APPROVE_OTHER`, note required) |

  - **Custom reasons:** add (outcome Reject or Approve, a Reject group, name, "note required"), rename, turn off or on.
    Never deleted, because past decisions refer to them. The code is generated (`CUSTOM_…`) and never shown for editing.
    Names are unique per project and outcome.
  - **Decision panel:** Reject = one or more active Reject reasons; Approve = exactly one active Approve reason. The note
    is optional unless a chosen reason requires it. A turned-off reason is not offered; past decisions keep their reasons.
    Every outcome keeps at least one active reason (the "Other" reasons can't be turned off).
  - The case stores the reasons chosen (code and name at the time); the decision audit entry records them.

## Visibility, PII & audit
- **DEC-40** **(changed)** Verifications List columns: Verification ID with the Reference ID on its second line (DEC-114), Full Name, Project (when more than one project is in view),
  Flow, Workflow version, Document type, Status, Risk (Low risk / High risk; only when a flow in view runs risk, DEC-107), Claimed by (or "Unclaimed"),
  Claim expires, Created, Last updated. No other PII, no client metadata, no duplicate-user information. Enforced by the
  `VerificationSummary` type. [MS][FRS][PO 2026-10-20]
  - Layout, same information [PO 2026-10-21]: the list must fit a desktop screen without scrolling sideways, so related
    values share a column on a second line: Flow / version, Claimed by / countdown and expiry time, Last updated / by whom
    (SYSTEM or the user), Project / merchant (only when the rows span merchants, i.e. Platform Admin). Times are MYT (in the
    header). No Actions column: the Reference ID opens the case.
- **DEC-41** Detail view: full unmasked PII + client metadata. **Every** open writes a `SENSITIVE_PII_VIEW` audit entry.
- **DEC-42** **(changed)** Every mutation writes an audit entry (actor or SYSTEM, role, project, event, target, old and new
  value, IP). Event actions:
  - Cases: `SENSITIVE_PII_VIEW`, `CASE_CLAIMED`, `CASE_RELEASED`, `CASE_CLAIM_EXPIRED`, `CASE_DECISION_APPROVED`,
    `CASE_DECISION_REJECTED`, `CASE_DECISION_BLOCKED`, `CASE_RESUMED` (SYSTEM: a returning Reference ID, DEC-113)
  - Flows: `FLOW_CREATED`, `FLOW_ACTIVATED`, `FLOW_RETIRED`, `FLOW_SETTING_CHANGED` (`FLOW_DEFAULT_CHANGED` removed with the default flow, DEC-94)
  - Projects: `PROJECT_CREATED`, `PROJECT_RENAMED`, `PROJECT_ARCHIVED`, `PROJECT_SETTING_CHANGED`
  - Integration: `API_KEY_CREATED`, `API_KEY_ROTATED`, `API_KEY_REVOKED`, `WEBHOOK_CHANGED`
  - Users: `USER_INVITED`, `USER_INVITATION_RESENT`, `USER_ACCESS_ADDED`, `USER_ACCESS_CHANGED`, `USER_ACCESS_REMOVED`,
    `USER_SUSPENDED`, `USER_REACTIVATED`
  - Roles: `ROLE_CREATED`, `ROLE_UPDATED` (permissions or name), `ROLE_STATUS_CHANGED`
  - Registry (Platform Admin only): `WORKFLOW_REGISTERED`, `WORKFLOW_UPDATED`, `WORKFLOW_STATUS_CHANGED`, `WORKFLOW_DEFAULT_CHANGED`
  - Merchants (Platform Admin only): `MERCHANT_CREATED`, `MERCHANT_UPDATED`, `MERCHANT_STATUS_CHANGED`
  [MS][FRS]
- **DEC-43** **(new)** Verifications List filters: project, flow, workflow version, status, claim state (unclaimed / mine /
  others), risk (Low risk / High risk), date range; search by Reference ID and Full Name. Default view: `PENDING_REVIEW` cases in the user's
  projects, oldest first. [MS][FRS]
- **DEC-100** **(new)** Verifications List sorting is on the column names, not in the filters [PO 2026-10-22]. Sortable
  columns, per the FRS: Reference ID, Status, Risk, Last updated (never Full Name or Merchant). Each click on a
  column: ascending → descending → back to the default order (Last updated, oldest first, DEC-43; this replaces the FRS
  default "updatedAt descending" for the review queue). The column shows its state with a small icon (and `aria-sort`).
  Status sorts in lifecycle order (Processing, Pending Review, Approved, Rejected, Unsuccessful); risk Low → High, cases without a risk
  result last either way; ties by Last updated, then Reference ID. A sort applies at once and is kept in the URL
  (`sort=status.asc`); it does not reset the filters. [FRS][PO 2026-10-22]
- **DEC-101** **(new)** The Created filter is one date-range field, not "Created from" and "Created to" [PO 2026-10-22].
  It reads "08 Oct 2026 – 17 Oct 2026" (MYT) and opens a calendar of two months (one on a phone): the first click picks the
  start, the second the end (an earlier day swaps them); the days between are highlighted, and while choosing the end the
  highlight follows the pointer. Future days can't be picked. Quick ranges (FRS "presets"): Today, Last 7 days, Last 30
  days, This month; Clear empties it. Closing with only a start keeps the previous dates. Like every filter it applies on
  Search (DEC-43); the URL still carries `from` / `to`. [FRS][PO 2026-10-22]
- **DEC-44** **(new)** Verification Detail sections: header (Verification ID and Reference ID with copy (DEC-97, DEC-114), status, project, flow, workflow version,
  configuration revision, created, last updated) · claim panel · end-user data (email for V4/V5) · ID capture (images, result,
  soft rejects) · Selfie (V1 only: image, result) · Face match (result, threshold applied, score, retries used / allowed) ·
  Liveness (result, threshold applied, retries used / allowed, cooldown applied) · Risk (V4/V5: each component's 0–100 score
  and reason codes, overall) · Rules applied (settings snapshot at session start) · Activity timeline. [MS]
  **(layout and content changed by DEC-105)**
- **DEC-105** **(new)** Verification Detail layout and content [PO 2026-10-23]. Replaces the section list of DEC-44; the
  original Axure page and the DEC-44 page are combined ("hybrid").
  - **Header strip:** Verification ID (heading, copy), Reference ID (copy), status (DEC-114) · Project › Flow · workflow version and preset (e.g. "V4 ·
    High") and configuration revision · Created · Last updated. No Audit trail link [PO 2026-10-27] (the Audit Log is in the menu); the SDK is in the client metadata box, not repeated here. **Client metadata** (SDK, OS,
    device, IP address, location) sits in a compact box at the top right of the header [PO 2026-10-26]; on narrow screens
    it moves under the title. The claim bar sits directly under the header.
  - **Reason banner** (`PENDING_REVIEW` / `REJECTED` / `UNSUCCESSFUL`): the DEC-35 condition plus **target vs actual**, e.g. "Auto-Reject
    < 75 · Auto-Pass ≥ 85 · Actual 83.5".
  - **Row 1, three columns:** (1) **Evidence**: the document front and the face that was matched (selfie for V1, the
    liveness face for V3/V4/V5) side by side, with the similarity badge; (2) **Extracted data (OCR)**, titled with the
    document type (email for V4/V5); (3) **Checks and telemetry** and **Risk**.
  - **Decision panel:** sticky on the right on wide screens; full width under the content on narrow screens. Buttons
    "Confirm Manual Pass" and "Reject" (DEC-30); never "Maintain Automated Rejection".
  - **Below the fold:** Attempts (each attempt's scores, metrics and images), Rules applied. **No Activity section**
    [PO 2026-10-26]: the case's history is in the Audit Log.
  - **Every number is shown** to everyone who can open the page (View details), per attempt. Each metric shows its value,
    its threshold and pass / fail. No "Set by" column [PO 2026-10-26]: the flow-set similarity and liveness bands read
    "Auto-Reject … · Auto-Pass …"; every other threshold is fixed by the engine. Engine thresholds live in `ENGINE_THRESHOLDS` (`src/domain/telemetry.ts`):

    | Stage | Metric | Engine threshold |
    |---|---|---|
    | ID capture | Faces found | exactly 1 |
    | ID capture | Face detection confidence: a face is clearly detected on the ID (FaceMatchThreshold) | ≥ 90 |
    | ID capture | Eyes open · Face covered | open · not covered |
    | ID capture | Image size | ≥ 320 × 320 px |
    | ID capture | OCR fields detected | every field the document type needs (DEC-35) |
    | Selfie (V1) | Eyes open · Face covered | open · not covered |
    | Selfie (V1) | Sharpness · Brightness | > 25 · > 25 |
    | Selfie (V1) | Yaw · Pitch | within ±30° · within ±30° |
    | Selfie (V1) | Face size | information only: 50 px is configured but not checked (OQ-32) |
    | Face match | Face match (similarity): the selfie (V1) or liveness face (V3/V4/V5) compared with the ID photo | flow band |
    | Face match | Face detection confidence: a face is clearly detected in the compared image (FaceMatchThreshold) | > 90 |
    | Liveness | Liveness confidence | flow band |

  - **Face match** (the flow band on the similarity of the face with the ID photo) and **Face detection confidence** (a face
    is clearly detected; not liveness) are two different numbers and never shown as one [PO 2026-10-26, 2026-10-27].
  - **V1 order** (engine workflow): ID → selfie quality check → face comparison → existing-user search → liveness. A selfie
    that fails its check ends the run ("Invalid selfie"): no similarity, no face match. Once submitted it uses a selfie
    retry (DEC-108) and a token (DEC-60, OQ-35); rejected selfies are shown under Attempts as "Not run".
  - The **existing-user search** runs only after the face comparison passes (or lands in the review band).
  - **Duplicate user:** "New user", or "Existing user found" with the match similarity (≥ 90 = existing). Shown for
    information only: it never changes a check, the status or the decision buttons, and it stays off the list (DEC-40).
  - **Risk** (V4/V5): the result (Low risk / High risk) and the four category scores against their minimums (DEC-107).

## Configuration
- **DEC-50** **(changed)** Settings live on each **flow** (Flow Detail). The form shows only what applies to the flow's version:

  | Section | V1 | V3 | V4 | V5 |
  |---|---|---|---|---|
  | General: name, description, workflow version (locked once active) | ✓ | ✓ | ✓ | ✓ |
  | Thresholds: similarity, liveness (DEC-19) | ✓ | ✓ | ✓ | ✓ |
  | Retries allowed per phase: Document (OCR), Selfie (V1), Liveness (DEC-108) · cooldown after Rejected, cooldown after Unsuccessful (DEC-26) | ✓ | ✓ | ✓ | ✓ |
  | Accepted documents (MyKad, Passport, Driving License) | ✓ | ✓ | ✓ | ✓ |
  | Session expiry | ✓ | ✓ | ✓ | ✓ |
  | Risk minimums per category (DEC-107) | | | read-only (fixed) | ✓ |
  | Requirements: "Email required at session creation" | | | ✓ | ✓ |
  | Developer info: flow ID, sample create-session request | ✓ | ✓ | ✓ | ✓ |
  | History: who, when, old and new value | ✓ | ✓ | ✓ | ✓ |
  [MS][PO 2026-10-20]
- **DEC-51** **(changed)** No staged draft/deploy. A Draft flow is edited freely. On an Active flow, Save requires a
  "Reason for change" (min 10 characters), warns that changes apply to new sessions only, and creates a new **configuration
  revision** `<Version>-R<n>` (running number per flow, never reset). Each save is audited with old and new values. [MS][FRS]
- **DEC-52** Saved settings apply to **new sessions only**. Each case stores its flow and configuration revision, shown as
  "Rules applied".
- **DEC-53** **(changed)** Validation: `0 <= autoReject < autoPass <= 100`; retries allowed within OQ-03; every cooldown `>= 0`
  minutes; claim timeout `>= 1` minute; reason for change `>= 10` characters.
  - **Claim timeout in seconds** [PO 2026-10-23]: the API and data hold `claimTimeoutSec` (seconds, `>= 60`). People
    enter whole **minutes**; the screen shows the seconds it sends in grey beside the field ("(1,800 seconds)"), and
    shows timeouts as minutes elsewhere ("30 min"). Typing minutes avoids a 30-second claim by mistake.
- **DEC-54** **(new)** Project Settings tabs: **General** (name, branding override, language; blank branding inherits the
  merchant default) · **Integration** (API keys: name, created, last used, status, create / rotate / revoke, key shown once;
  webhook URL (HTTPS), signing secret, events; redirect URLs; allowed web origins; IP allowlist) · **Review operations**
  (auto-release claim timeout). No Routing tab (DEC-95). Changes are audited with old and new values. [MS]
- **DEC-55** **(new)** Webhook delivery: on a change to `PENDING_REVIEW`, `APPROVED`, `REJECTED` or `UNSUCCESSFUL` (DEC-112), POST
  `verification.status_changed` (Reference ID, new status, Last Updated By, timestamp), signed with the project's signing
  secret; non-2xx → up to 3 retries at increasing intervals, each attempt audited. Mock: deliveries are simulated only. [FRS]
  **(changed)** One webhook serves all the project's flows, so the body also names the **Verification ID** and the **flow ID**:
  `event, verificationId, flowId, referenceId, status, lastUpdatedBy (SYSTEM, or the reviewer's name; no user ID), occurredAt`
  (`WebhookEvent`, `src/domain/webhook.ts`). IDs only, no personal data. The Reference ID is the merchant's own value; the
  integration guide tells merchants to keep personal data (IC, phone, email) out of it. In the portal, the Verifications
  list's Flow filter does the same job. [PO 2026-11-18]
- **DEC-111** **(new)** Calling the API (industry practice; agreed 2026-11-18, PO to confirm):
  - **Authentication:** the merchant's **server** sends the API key's secret on every call over HTTPS:
    `Authorization: Bearer <secret>`. The Key ID (`key_…`) only names the key on screen and in logs. The secret is never
    put in an app or web page; the user's browser only gets the session link. Shown once; Rotate / Revoke if it leaks.
  - **Redirect:** `redirectUrl` in create-session is optional. If sent, it must **exactly** match one of the project's
    Redirect URLs (no wildcards, no prefix match; as in the OAuth 2.0 security guidance, RFC 9700), else the request is
    refused. If not sent, the user ends on the platform's own "Verification complete" page. An empty list allows no
    redirect.
  - **The redirect is not the result:** a user can open that URL themselves, so the merchant reads the outcome from the
    webhook (DEC-55) or by asking the API for the case.
  - **Which flow:** `flowId` is required in every create-session request (DEC-95).
  - Test and live keys (sandbox): OQ-36.

## Workflow Registry
- **DEC-56** **(changed again 2026-10-27)** Statuses [FRS][PO 2026-10-20][PO 2026-10-27]:

  | Status | Who can choose it for a new flow |
  |---|---|
  | `Draft` | nobody (being registered) |
  | `Internal testing` | internal users only: super admins and platform staff with Flows Create; never a merchant. Sessions on it are not charged (DEC-60) |
  | `Limited release` | internal users, and users of the merchants ticked under **Merchant access** in the version's Edit modal |
  | `Active` | everyone who may create flows |
  | `Deprecated` | nobody; existing flows keep running and show a "version deprecated" warning |

  - **No lifecycle:** a super admin (or staff with Registry Manage) picks any status, with a reason. Only two guards stay: the
    default for new merchants must stay Active (DEC-57), and Internal testing, Limited release and Active need both state
    machine references.
  - A status decides only who can **create new flows** on the version; existing flows keep running whatever it becomes.
  - **Hidden from merchants** [PO 2026-10-27]: a flow whose version is Internal testing, and every session run on an
    Internal testing version (the uncharged test sessions), are seen by internal users only. Merchant users don't see them
    anywhere: Flows, Flow Detail ("not found"), flow filters, Verifications (the case is "not found"), dashboards and
    Billing. If the version moves on (e.g. to Limited release), the flow shows; its earlier test sessions stay internal.
  - Fields lock once the version has been Limited release or Active (merchants may have built on it); Internal testing can
    still be edited.
  - No hard delete. Once a version has been Active, only name, description, state machine references and release notes can be
    edited; anything else needs a new version code.
- **DEC-57** **(new)** Exactly one version is "**Default for new merchants**" and it must be Active. It cannot be deprecated
  while it is the default. Changing the default affects new merchants only. [PO 2026-10-20]
- **DEC-58** **(new)** Versions: V1 (ID → Selfie → Liveness; face match ID vs Selfie; default), V3 (ID → Liveness; ID vs
  liveness face), V4 (V3 + Risk Assessment; email required), V5 (Draft, TBC). No V2. [FRS][MS]

## Charging
- **DEC-60** **(changed again 2026-10-27)** Sessions on an **Internal testing** version (DEC-56) are not charged. Otherwise,
  tokens are consumed per **document (OCR) submission**, per **V1 selfie submission** and per **liveness submission**,
  whatever the final status (including cases still `PROCESSING`) [PO 2026-10-27]: everything submitted costs a token,
  including a selfie the engine rejects (OQ-35 answered) [PO 2026-10-27]. Retakes before submitting are free. "Cost of
  retries" = tokens from submissions after the first in each phase.
  Billing column is "Verification Status". [FRS][PO 2026-10-20]
  **(changed 2026-11-22)** A case that continued (DEC-113) has **one billing line per session**, in the month the session
  started, with that session's flow, version, tokens and how it ended ("Verification Status" = the session's result; the
  current session shows the case's status) [PO 2026-11-22].

## Roles and access
- **DEC-70** **(changed again; scopes and the role list superseded by DEC-104)** Users and roles follow the [FRS] User Management method, extended with **scoped role
  assignments** ("Option C") [PO 2026-10-20]:
  - A **role** is defined once per merchant from permission checkboxes; it says *what* a user may do. An **assignment**
    gives a user a role with a **scope**, *where*: **All projects** (every current and future project; labelled in the UI)
    or **Selected projects**. A user may hold several assignments; where they overlap, permissions are the **union**
    (no deny rules). Flow-level scope is not used (Option D kept in reserve).
  - Permissions, grouped on the Roles screen (**split into module actions by DEC-102**; the table below is the original):

    | Merchant-level (assignable to All projects only) | Project-level |
    |---|---|
    | Manage billing and contract | View cases |
    | Manage users and roles | Claim cases |
    | Create, rename, archive projects | Approve / reject cases (own claim only, DEC-30) |
    | View merchant-wide reports | Manage project settings (branding, auto-release timeout) |
    | | Manage API keys and webhook |
    | | Manage flows (create, activate, retire) |
    | | Change verification level and retries (thresholds, retries allowed, risk minimums) |
    | | Manage project members |
    | | View project reports (Overview, System Intelligence, Billing for those projects) |
    | | View audit log |

  - A role with any merchant-level permission can only be assigned to **All projects**. Claim and Approve / reject need
    View cases, so the Roles screen ticks it automatically. Change verification level and retries works on the flow
    screens, so it is used together with Manage flows; without it those fields are read-only.
  - **System Default roles** (locked, the same for every merchant): **Merchant Owner** (every permission), **Project Admin**
    (every project-level permission), **Reviewer** (view, claim, approve / reject, project reports), **Viewer** (view cases,
    project reports). Merchants add **Custom** roles. Role names are OQ-09.
  - **Platform Admin** (internal; now called **Super admin**, DEC-99) is not a merchant role. **(changed)** It holds **every permission in every merchant**
    (cases, claim and approve / reject, API keys and webhook included), plus Workflow Registry, Merchants, Admins and
    Advanced thresholds (DEC-19) (DEC-75). [PO 2026-10-21]
- **DEC-102** **(new; groups, Verifications and roles updated by DEC-104)** Permissions are a **matrix of modules × View × actions** [PO 2026-10-22]. Each permission is a
  module's View or one of its actions; the Roles form shows one row per module with a View column and an Actions column,
  and a checkbox at the module name that ticks the whole row (partly ticked shows "mixed"; unticking clears the row).
  Ticking an action ticks the module's View, locked while needed. The groups stay: Merchant role = **Merchant-level**
  (only for All projects, DEC-70) and **Project-level**; Platform role = **Platform-level** and **Merchant access** (DEC-99).
  The actions are the ones the product has, so they replace the coarse DEC-70 permissions:

  | Group | Module | View | Actions |
  |---|---|---|---|
  | Merchant-level | Projects | — (everyone sees the projects they work in) | Create · Rename · Archive |
  | | Users | View | Invite (and resend) · Change access (add, edit, remove rows) · Suspend (and reactivate; never delete, DEC-74) |
  | | Roles | View | Create (and duplicate) · Edit · Deactivate (and activate; never delete, DEC-76) |
  | | Billing and contract | View | Manage |
  | | Merchant reports | View | Export |
  | Project-level | Verifications | View | Claim · Approve / reject |
  | | Flows | View | Create (and duplicate) · Edit · Activate / retire · Change verification level (ticks Edit) |
  | | Project settings | View | Edit (General, Review operations) |
  | | API keys and webhook | View | Manage |
  | | Members | View | Add / remove |
  | | Project reports | View | Export |
  | | Audit log | View | — |
  | Platform-level | Merchants | View | Create / edit · Change status |
  | | Workflow Registry | View | Manage |
  | | Verification levels | View | Calibrate |
  | | Platform billing | View | Manage |
  | | Usage reports | View | Export |
  | Merchant access | Verifications | View (masked) | See unmasked ID data · Claim / approve / reject (ticks unmasked) |
  | | Flows | View | Edit |
  | | API keys and webhook | View | Manage |
  | | Audit log | View | — |

  - Every screen and service checks the action itself (e.g. Suspend needs Suspend users, not "manage users"); what the
    user can never do is hidden (DEC-78). View alone is read-only (Users, Roles, Flows, Project settings, Members).
  - The split keeps everyone's access as it was: Merchant Owner and Project Admin hold every permission of their groups;
    Reviewer and Viewer keep project reports **with Export** (the old View project reports included it); the old
    "Manage users and roles" = all Users and Roles permissions, and so on. Names and defaults stay OQ-09.
  - Differences from the reference picture: Users "Deactivate" is **Suspend** and Roles "Delete" is **Deactivate**,
    because users and roles are never deleted (DEC-74, DEC-76).
- **DEC-71** Client-side permission checks are UI only, not security. The real backend must enforce them.
- **DEC-72** **(changed)** Every page checks the user's access to the project; hiding a menu item is not enough. A case from
  a project the user's assignments don't cover returns "not found" (not "forbidden"). [MS]
- **DEC-73** **(changed; the header and "All my projects" superseded by DEC-109)** Global header: project switcher (only projects the user's assignments cover, plus "All my
  projects" for more than one), current project name always visible, menu filtered by the user's permissions in the
  selected project, user menu (name, email, roles in the current project, log out). A user with no assignments can sign in
  but sees "You don't have access to any project yet". [MS][PO 2026-10-20]
- **DEC-74** **(changed again; the Access table and scopes superseded by DEC-104)** **Users** screen ([FRS] User Management › Users): flat list with Full Name, Email,
  Merchant (Platform Admin only), **Access** (assignment summary, e.g. "Reviewer (Retail), Viewer (SME)"), Status, Created
  At; sorted by Created At, newest first; 10 / 20 / 50 per page; "No Records Found". Create: full name, work email,
  merchant (Platform Admin only) and the first assignment; the user starts **Pending** and gets an invitation (Resend while
  Pending). Statuses `Pending`, `Active`, `Suspended`; users are never deleted (Suspend). **User detail**: an Access table
  (Role | Scope | Added by | Date) with Add / Edit / Remove. Rules [PO 2026-10-20]:
  - **(changed 2026-10-27)** The list's Access column is now **Merchant role**: the role name only (e.g. "Auditor",
    "Member"), no scope (a merchant role always covers every project) and no project roles (a merchant can have many
    projects). Project roles show in the user's details (Project access) and on each project's Members tab. On Platform
    staff the column is **Platform role**. [PO 2026-10-27]
  - Only users with the Users permissions (DEC-102: View, Invite, Change access, Suspend) or a super admin manage users; on a project's Members tab, users with Manage
    project members add or remove assignments **for that project**.
  - Nobody grants permissions they don't have themselves (for All projects: held in every project). Platform Admin is
    exempt, so it can set up a merchant's first Merchant Owner (DEC-92).
  - Removing an assignment (or suspending) releases the user's open claims in projects where they can no longer claim.
  - At least one active Merchant Owner (All projects) must remain.
  - Nobody changes their own access.
  - Presentation [PO 2026-10-21]: access is always written as one chip, `Role · Scope` ("Reviewer · SME app",
    "Merchant Owner · All projects"), the same on the Users list, User detail and Members; an archived project shows as
    "SME app (archived)" and its rows are read-only. User detail also shows **Effective access** for a chosen project:
    each permission with a "Comes from" chip naming the access row that grants it. The Add / Edit access dialog shows a
    plain-language preview ("Ali will be able to … in SME app") and lists only roles the actor may give. A user with no
    access shows "No access yet. Add access so they can use the portal." with Add access.
  - Not used [PO 2026-10-21, confirmed 2026-10-22]: access end dates, and per-flow scope (DEC-70; two users with the same role
    can already work in different projects, because the scope belongs to each assignment).
  - The Users screen lists merchant users only; Platform Admins are managed on **Admins** (DEC-79).
- **DEC-75** **(changed)** Platform Admin can do everything a Merchant Owner can, in any merchant, for onboarding and support:
  view cases (OQ-20 answered yes), claim and approve / reject, API keys and webhooks. The list shows no sensitive data
  (DEC-40); every case they open is audited as `SENSITIVE_PII_VIEW` (DEC-41), and their decisions show their name as
  "Last updated by". [PO 2026-10-21]
  - Risk noted for compliance sign-off: under KYC rules the merchant is the accountable party, so a case decided by
    platform staff is decided by a third party. The merchant agreement should allow it.
  - Superseded: "API keys and webhooks stay merchant-only" and "never claim or decide" [PO 2026-10-20].
- **DEC-76** **(new)** **Roles** screen ([FRS] User Management › Roles): Role Name, Merchant
  (Platform Admin only), Role Type (`System Default` / `Custom`), Status, Users, Created At. The detail / create modal holds
  the permission matrix (DEC-102; at least one: "Roles require at least one action permission flag"). System Default
  roles are read-only. Editing a role applies at once to everyone holding it, in all their scopes, and shows "Affects N
  users" before saving. Roles are never deleted; deactivating one still assigned is refused: "Operation rejected. This role
  is currently assigned to active records inside the system." Managed by users with the Roles permissions (DEC-102) and by Platform
  Admin. [FRS][PO 2026-10-20]
  - **Duplicate** any role (System Default included) into a new Custom role, "Copy of …", to edit from there. The impact
    note reads "Affects N users in M projects". [PO 2026-10-21]
  - The create / edit dialog starts with the **Role ID**: generated when the dialog opens, shown read-only, never edited
    (FRS "auto-generates a unique identity key"). A **Status** field (Active / Inactive) sits in the dialog, and each row
    has an Actions menu (Edit, Duplicate, Activate / Deactivate). Deactivating a role that is assigned, or any System
    Default role (shared by every merchant), is shown disabled with the reason (DEC-78). An inactive role grants nothing
    and can't be given. [PO 2026-10-22]
- **DEC-77** **(new; role picker per DEC-104)** Project Settings › **Members** tab: everyone with access to the project and their role, including
  users with All projects access (marked "inherited"). Adding a member creates an assignment scoped to that project. An
  archived project keeps its assignments read-only and leaves the switcher. [PO 2026-10-20] Adding from this tab fixes the
  project (shown, not changeable) and lists only roles the actor may give; inherited rows link to the user's details when
  the actor may open them. [PO 2026-10-21]
  **(changed 2026-11-22) Invite a new person from Members** [PO 2026-11-22; answers OQ-27]. A new person (full name,
  email, project role) is created in one step as a **merchant user** with the **Member** merchant role (no permissions),
  status Pending, invitation sent (simulated), with the project role in this project only. The person then shows on the
  Users screen (Member, Pending; project access in the details) and on Members. Whoever adds them, the merchant role is
  always Member: merchant roles are given on Users only (DEC-104), so adding someone to a project never gives access to
  other projects (Langfuse does the same for project admins: organization role "None").
  - **(changed 2026-11-24) Email + Project role + Add; a dialog only for a new email** [PO 2026-11-24, was "no second
    dialog" 2026-11-23]. One Email field, no tabs (as Langfuse, MongoDB Atlas); typing suggests users of this merchant
    (name · email) for those with Members › Add / remove. **Add checks the email first** (`checkMemberEmail`):
    - A user of this merchant → added at once (toast "… added as Reviewer"), no dialog.
    - Anything that can never be added → refused **under the Email field**, before any dialog: another merchant's user
      ("A user belongs to one merchant only"), a staff email, a suspended user, a role they already hold here, an existing
      user with Users › Invite only, an invalid email, no role.
    - A new email → the dialog **"Invite a new person to {merchant}?"**: "{email} isn't a user of {merchant} yet",
      **Full name** (focused), what will happen (joins {merchant} as Member, no access in other projects · the role in this
      project · an invitation email, Pending until they accept), the access preview, and **Back** / **Send invitation**.
      **Back** (also Esc, ×) keeps the email and role and selects the email: a mistyped email of an existing user is
      the most likely reason. NN/g: a dialog only for the rarer action with wider effects; Google Workspace confirms
      sharing outside the organisation the same way.
  - **No merchant-less account ("third party")** [PO 2026-11-24]: a person added from a project always becomes a user
    of the project's merchant (Member + the project role). An account type that "belongs to no merchant" is not used:
    no merchant could see, suspend or review it, and it breaks one merchant per user (DEC-104). Langfuse does the same: a
    project membership always hangs on an organization membership; an invited person without an account gets an
    invitation carrying an organization role ("None" when a project admin adds them).
  - **Who:** **Members › Add / remove** in the project **or** **Users › Invite** (merchant level). A merchant role holds
    for the whole merchant, so a merchant role with either permission may do it in every project; a project role only in
    its project. Adding an **existing user** and removing stay with Members › Add / remove: with Users › Invite only, the
    email of an existing user is refused ("Already a user of this merchant. Adding an existing user to a project needs
    Members › Add / remove.") [PO 2026-11-23], and the field has no suggestions. The Members screen opens for either
    permission (Users › Invite already sees every user and their project access on the Users screen).
  - The project roles offered are still only those the actor may give (DEC-74 "give only what you hold"), so a role with
    Users › Invite but no project permissions (e.g. Atoz's User Coordinator) has no project role to give here.
  - An email already used by a user of **this** merchant (Members › Add / remove) adds the project role to that user (no second account); one of
    another merchant or a company staff email is refused as on New user (one merchant per user, DEC-104). Suspended users
    are not added. Archived projects take no new members; nobody changes their own access.
  - Audit: `USER_INVITED` (noting the project) and `USER_ACCESS_ADDED` in that project.
- **DEC-78** **(new)** Hide or disable, one rule for every screen [PO 2026-10-21]:
  - **Hide** an action the user can never do with their access (a Reviewer never sees "Add member").
  - **Disable with a tooltip** an action blocked by the current state, where knowing it exists matters (Remove on the last
    Merchant Owner: "At least one Merchant Owner (All projects) is required").
  - Services check every action anyway (DEC-71). Screens a user can't open show "No access"; a case or project outside
    their access is "not found" (DEC-72).
- **DEC-79** **(superseded by DEC-110: one seeded super admin, no Super admins screen)** **Admins** (Platform menu, Platform Admin only): the internal Platform Admin accounts, kept apart from
  merchant users. Columns Full Name, Email, Status, Created At, Last active; sorted by Created At, newest first. New admin = full
  name and work email; starts Pending (Resend invitation); Suspend / Reactivate; never deleted. No roles or scopes: Platform
  Admin rights are fixed (DEC-70). At least one active Platform Admin must remain; nobody suspends themselves. Audited with
  the DEC-42 user events. [Dev 2026-10-21]

## Merchants
- **DEC-98** **(new)** **Merchants** screen (Platform Admin) follows [FRS] Merchant Management; DEC-92 still adds the Default
  project, its first (Draft) flow and first owner. [FRS][PO 2026-10-21]
  - **List:** Merchant ID, Merchant Name, Country, Status (colour badge), Created At, Actions (⋮). Search by name or ID,
    filter by status, applied on Search; newest first; 10 / 20 / 50 per page; "No Records Found". Owner, projects, users
    and cases are in the read-only detail panel.
  - **Create:** Merchant Name\* ("Company name cannot be empty", "Invalid characters detected"), Registration No\*
    ("Business registration number is required", "Registration number already exists" within the same country),
    Country\* (country of incorporation; "Please select a valid base jurisdiction"), Primary contact name\* (added: the first
    owner needs a name), Primary contact email\* ("Email format is incorrect", "Email address already active in system user
    directories"), Contact phone (optional; "Phone number format is invalid"). For Malaysia the registration number is the
    SSM 12-digit format (year, entity type, running number, e.g. `201901000005`); other countries are free text. The
    primary contact becomes the first Merchant Owner (Pending, invited; FRS "Option B").
  - **Edit:** name and contact phone. Registration No, Country and the primary contact email are locked after creation.
  - **Status:** `Onboarding` (new; users can sign in and test, live API calls are refused: sandbox only) → `Active` (live)
    → `Suspended` (temporary freeze: missed payment, suspected fraud) → `Terminated` (contract ended; final). Allowed:
    Onboarding → Active or Terminated; Active → Suspended or Terminated; Suspended → Active or Terminated; Terminated →
    nothing. (The FRS transition table is garbled in the PDF; this is its reading.) Every change needs a reason and is
    audited (`MERCHANT_STATUS_CHANGED`). Suspended or Terminated: the merchant's users can't sign in or act, and its API
    keys stop at once.
  - **No delete:** merchants are never deleted; Terminated keeps the records (retention: OQ-29).
  - **Resend invitation** while the merchant is Onboarding and its first owner is still Pending.
  - Not added for now: registered address, TIN / SST, billing email, compliance contact (OQ-30).

## Internal (platform) staff
- **DEC-99** **(new; merchant scope, masking and the platform roles superseded by DEC-104)** Three account types [PO 2026-10-22]:

  | Type | Belongs to | Managed in | Access |
  |---|---|---|---|
  | **Super admin** (was "Platform Admin") | No merchant | Platform › **Super admins** (DEC-79) | Everything; outside the role system; never created or listed in the Users / Roles forms |
  | **Platform staff** (internal) | No merchant | Users / Roles with Type = Platform | A platform role, given for All merchants (including future ones) or Selected merchants |
  | **Merchant user** | Exactly one merchant | Users / Roles with Type = Merchant | A merchant role, given for All projects or Selected projects (DEC-70) |

  - **Type** is the first field of New role and New user: `Platform (internal)` or `Merchant`. Only super admins choose
    it; merchant admins see it locked as "Merchant · <their merchant>". It can't be changed after creation (no conversion).
  - **Platform permissions** (Roles form, Type = Platform), real actions only:
    - Platform-level: Merchants (View, Create, Suspend) · Workflow Registry (View, Manage) · Verification levels (View,
      Calibrate) · Platform billing (View, Manage) · Usage reports (View, Export).
    - Merchant access, in the merchants the user is given: Verifications (View masked, See unmasked ID data, Claim /
      approve / reject) · Flows (View, Edit) · API keys and webhook (View, Manage) · Audit log (View).
    - Ticked with them: any action ticks its View; See unmasked ticks View masked; Claim / approve / reject ticks both
      View masked and See unmasked (a reviewer must see the documents).
    - Managing staff, platform roles and super admins is not a permission: super admin only.
  - What they open: Merchants View = the list and details; Create = add, edit details, resend invitation; Suspend = every
    status change (DEC-98). Registry View = read-only; Manage = register, edit, status, default. Calibrate = Advanced
    thresholds (DEC-19). Platform billing View = Billing for every merchant. Usage reports View = Overview and System
    Intelligence for every merchant; Export = the CSV exports. Flows View = Flows List / Detail read-only; Edit = save,
    activate, retire. API keys View = Integration read-only; Manage = create, rotate, revoke, webhook. Verification levels
    View and Platform billing Manage have no screen in the mock yet (presets are OQ-02; prices OQ-14).
  - **Masked case view:** without See unmasked ID data, Verification Detail shows the full name but masks the ID number
    (last 4 visible), date of birth (year), address, email and client IP, and hides the images. The open is still audited
    as `SENSITIVE_PII_VIEW` (marked masked). Merchant users keep the full view (DEC-41).
  - **System Default platform roles** (locked, like the merchant ones; Duplicate to adapt):

    | Role | Platform-level | Merchant access | Usually given for |
    |---|---|---|---|
    | Platform Operations | Merchants View, Create, Suspend · Registry View · Levels View · Usage reports View | Verifications View masked · Flows View, Edit · API keys View, Manage · Audit log View | All merchants |
    | Support | Merchants View · Usage reports View | Verifications View masked · Flows View · API keys View · Audit log View | All merchants |
    | Verification Specialist | — | Verifications View masked, See unmasked, Claim / approve / reject · Audit log View | Selected merchants (those that outsource review) |
    | Finance | Merchants View · Platform billing View, Manage · Usage reports View, Export | — | — (no merchant access) |
    | Workflow Engineer | Registry View, Manage · Levels View, Calibrate · Usage reports View | Flows View | All merchants |

    Least privilege: unmasked ID data and decisions only for case review; Finance sees no customer data; only Operations
    changes API keys.
  - **New user, Type = Platform:** Name · Email (the company staff domain, OQ-31) · Staff role (platform roles only) ·
    Merchant access: `All merchants, including future merchants` (default) or `Selected merchants` (hidden, with "This role
    has no merchant access permissions", when the role has none).
    **Type = Merchant:** Merchant (locked for merchant admins) · Name · Email (the staff domain is not allowed) · Role
    (that merchant's roles only) · Project access (DEC-70). Changing the merchant resets role and projects.
  - **No access end dates** [PO 2026-10-22] (the brief's "Access ends" is dropped; DEC-74 stands): not on New user,
    Add access or Edit access, for platform staff or merchant users, and no "Ends" column. Access lasts until it is
    changed or removed, or the user is suspended; each of those releases the user's claims at once.
  - **Guardrails:** platform roles only for platform staff; merchant roles only for users of the same merchant. Merchant
    admins can't create, list or open platform roles or staff; a direct URL is "not found". Super admins and the
    Super admins screen stay as they are. Platform staff never manage users or roles.

- **DEC-104** **(new; replaces the access parts of DEC-70, DEC-74, DEC-77, DEC-99 and DEC-102)** Roles and users,
  the agreed model [PO 2026-10-23]:
  - **Account types.** **Super admin**: **one**, created by the seed and never changed (DEC-110), no merchant, fixed full
    access, outside the role system; manages staff and platform roles. **Platform staff**: internal, no
    merchant, **one platform role and no scope**: it applies to every merchant. **Merchant user**: exactly one merchant;
    one merchant role on New / Edit user, plus project access in **Project › Members**.
  - **Role Type** (Platform (internal) / Merchant) is the first field of the role and user forms; only super admins choose
    it, merchant admins see "Merchant · <their merchant>"; it never changes. Platform roles only for platform staff,
    merchant roles only for that merchant's users. There is no "Project" type: project roles are Merchant roles. System
    Default roles are locked and can be duplicated; merchants create Custom roles.
  - **Two role tables** [PO 2026-10-23, revised]: they don't affect each other; a user's access in a project is the
    **union** of their merchant role and their project role there (no deny).
    - **Merchant roles** (Roles screen; given on **Users**, one per user): every merchant role except Member applies to
      the **whole merchant and all its projects**, including future ones. They may hold merchant-wide and project
      permissions. System Default: Owner, Admin, Billing, Auditor, Member.
    - **Project roles** (Project Settings › **Roles** tab of each project; given in **Project › Members**, that project
      only). They hold project permissions only. System Default (in every project): Project Admin, Reviewer, Developer,
      Viewer. A Custom project role belongs to the project it was made in; **Duplicate from another project** copies one.
      Managed with the project permission **Project roles** (View · Create · Edit · Deactivate).
    - **Member** (merchant role, no permissions) is the default on New user: such a user gets access only through
      Project › Members. Help text on New user: "This role applies to the whole merchant and all its projects. For
      selected projects only, keep Member and add the user in Project › Members."
    - Example: a merchant **Auditor** who is **Viewer in Project A** sees the case list in every project, and case pages
      in Project A only.
    - Members also lists the users who reach the project through their merchant role, marked **inherited (read-only)**.
  - **Personal data: no masking.** Verifications permissions: **View list** (the list; no personal data, DEC-40) →
    **View details** (the case page with name, ID number and images) → **Claim / release** → **Approve / reject**; each
    needs the one before. The API enforces the same rules. Oversight is the audit log: every open of a case page is logged
    (`SENSITIVE_PII_VIEW`: who, which case, when).
  - **Permission layout** (Roles form, both Types): **one table**, module rows, columns Module | View | Actions, "—"
    where none. **No sections** [PO 2026-10-23]: a merchant role shows every module, a project role only the project
    modules, a platform role the platform modules. The same action has the same wording everywhere. Ticking an action ticks what it needs; unticking a permission
    (View included) clears what depends on it. Managing staff, platform roles and super admins is not a permission.
  - **System Default roles** (OQ-09):

    | Type | Role | Usually given on | Access |
    |---|---|---|---|
    | Platform | Platform Admin | Users | Every platform-wide permission; all merchant data and actions |
    | Platform | Support | Users | Merchant data: View list, View details; Flows View; API keys and webhook View; Audit log View. No decisions, no changes |
    | Platform | Implementation | Users | Merchants View, Create; Workflow Registry; Verification levels; Merchant data: Flows (all), API keys and webhook (all) |
    | Platform | Finance | Users | Platform billing; Usage reports |
    | Merchant role | Owner | Users | Everything, in all projects; at least one active Owner required (DEC-74) |
    | Merchant role | Admin | Users | Users, Roles, Projects, Merchant reports; every project permission in all projects |
    | Merchant role | Billing | Users | Billing and contract |
    | Merchant role | Auditor | Users | Merchant reports; Audit log and Verifications View list in all projects; no case pages |
    | Merchant role | Member | Users | Nothing (default) |
    | Project role | Project Admin | Project › Members | Project settings, Project roles, Flows (all), API keys and webhook, Members, all case actions, Project reports, Audit log |
    | Project role | Reviewer | Project › Members | Verifications View list, View details, Claim / release, Approve / reject; Flows View; Project reports |
    | Project role | Developer | Project › Members | API keys and webhook; Flows View; no case access |
    | Project role | Viewer | Project › Members | Verifications View list, View details; Flows View; Project reports |

  - **Platform roles cover every merchant module** [PO 2026-10-23]: a platform role has more rows than a merchant role.
    Rows: Merchants, Workflow Registry, Verification levels, Platform billing, Usage reports (platform-wide), then the
    merchant modules with the same wording, applying in every merchant: Projects, Users, Roles, Verifications, Flows,
    Project settings, API keys and webhook, Members, Project roles, Audit log. Billing and contract is covered by
    Platform billing, and Merchant / Project reports by Usage reports (both already span every merchant).
    - This replaces DEC-99's "platform staff never manage users or roles": staff may manage merchants' users, roles,
      projects and members when their role allows it. Still super admin only: staff and platform roles (DEC-110).
    - "Give only what you hold" (DEC-74) compares merchant permissions; staff hold platform permissions, so like super
      admins they are not limited by it when they have the Users / Roles / Members permission. Nobody changes their own
      access.
  - **Identity and forms** (unchanged): cuid2 IDs; User and Role IDs generated, read-only, shown in forms and detail
    panels, never in lists. Platform users use the company email domain (OQ-31); merchant users can't.
  - **Landing** (refines DEC-84): users land on Overview when they may open it; a role without dashboards (Support,
    Implementation, Billing, Developer, Member) lands on the first screen of its menu, and the pinned Overview tab is
    hidden for it.
  - **Demo data** reviewed [PO 2026-10-23]: every merchant has an Owner (The Boring Company's primary contact Farah is
    Owner); Atoz has a Custom merchant role (User Coordinator) and Custom project roles (Fraud Checker in Default, held;
    Release Tester in SME app, not held); new demo users: Grace Lim (Auditor + Viewer in SME app), Aaron Teoh (User
    Coordinator), Zainab Hassan (Member + Fraud Checker in Default), Lim Siew Mei (3Nova: Reviewer in Wallet app and in
    the archived Pilot 2025).
  - **Superseded:** scopes on a role assignment (Selected projects / flows on New user; DEC-70, DEC-74); merchant scope for
    platform staff (DEC-99); flow-level access; "Project access" on New user; the masked case view (DEC-99); the platform
    roles Platform Operations, Verification Specialist and Workflow Engineer; Merchant Owner (now **Owner**).

## Identifiers
- **DEC-97** **(new)** Identifiers [PO 2026-10-21]:
  - Every stored record has an **internal ID**: a type prefix and a cuid2 body, e.g. `prj_k3x9…`. Prefixes: `mer` merchant,
    `prj` project, `flw` flow, `rev` flow revision, `vrf` verification (was `ver`, DEC-114), `att` check attempt, `file` uploaded image, `usr`
    user, `rol` role, `asg` role assignment, `inv` invitation, `key` API key, `whk` webhook endpoint, `wfv` registry version,
    `evt` audit event. Lists sort by created time, never by ID (cuid2 IDs are not time-ordered).
  - Not IDs: secrets (API key value, webhook signing secret, session links) are random tokens stored hashed; workflow
    codes (V1 … V5), statuses and permission keys are fixed values; external IDs (Ballerine, AWS liveness) are stored as given.
  - **Shown on screen** only where people copy or quote them: Flow ID (Flows List and Flow Detail, copy button: merchants
    send it as `flow_id`), Verification ID (Verifications list, Verification Detail, Billing, Audit Log; copy; in webhooks; DEC-114), API key (masked, `key_…a91f`), webhook event
    ID (delivery log; not in the mock). Internal screens may show Merchant ID (Merchants) and Project ID (Projects, for
    developers). Users, assignments, invitations, attempts, files and audit events are never shown; audit exports include
    the event ID. Exceptions [PO 2026-10-22]: the Role ID is shown read-only in the Role dialog (DEC-76), and the User ID
    is the first, read-only field of New user / New admin (generated when the form opens, kept on save) and is shown in
    the user's details (DEC-74, DEC-79). Lists still don't show it. People are identified by name and email, roles by name; "Last updated by" shows the name.
  - **Reference ID** is the **merchant's own reference** for the end user, sent when the session is created. It is stored
    alongside the Verification ID, searchable, shown in the list, and never used as the key; case URLs and webhooks use the
    Verification ID (DEC-114).
    **(changed 2026-11-22)** It identifies the end user **within a project**: a returning Reference ID continues that
    project's case (DEC-113; answers OQ-17). The value is the merchant's and may repeat across projects; the Verification ID
    is our unique key (DEC-114).
- **DEC-114** **(new)** **Verification ID and Reference ID** [PO 2026-11-22]. The industry keeps two identifiers apart and
  names its own after the object: Persona *Inquiry ID* / *Reference ID*, Sumsub *Applicant ID* / *External user ID*, Jumio
  *Workflow Execution ID*, *Account ID* / *Customer Internal Reference*, *User Reference*, Veriff *Session ID* / *vendorData*,
  Stripe *VerificationSession ID* / *client_reference_id*; both are searchable, and an exact object ID opens the record
  (Persona Omnisearch, Stripe). Ours:
  - **Verification ID**: our own unique ID of a case, `vrf_` + cuid2 (24 characters), e.g. `vrf_tz4a98xxat96iws9zmbrgj3a`.
    It is the key in URLs, the API, webhooks (`verificationId`), audit and billing. It replaces the "case ID" and the `ver_`
    prefix. API / code field `verificationId`.
  - **Reference ID**: the merchant's own ID for the end user (DEC-97, DEC-113). API / code field `referenceId` (was
    `referenceNo`, from the FRS "Reference No.").
  - **Verification ID first, then Reference ID**, wherever both appear (Persona's inquiry Info panel lists the Inquiry ID,
    then the Reference ID).
  - Verifications list: first column **Verification ID** (opens the case) with the **Reference ID** on its second line
    (DEC-40 layout); still sortable by Reference ID (DEC-100), never by Verification ID (DEC-97). Filters: **Verification
    ID** (exact) and **Reference ID**.
  - Header search: an exact Verification ID opens the case; anything else is looked up as a Reference ID.
  - Case page: the heading is the Verification ID (copy), the Reference ID (copy) beside it; the browser tab and breadcrumb
    show the Verification ID.
  - Billing and Audit Log: Verification ID (opens the case) and Reference ID columns; exports name both the same way.
  - The demo Reference IDs keep the `KYC-260901-9000NN` look: they stand for a merchant's value (MOCK-05).
  - Supersedes the [FRS] masks `KYC-YYMMDD-XXXXXX` (platform-generated Reference No. as key), `USR-2026-XXXX` and
    `ROL-2026-XXXX` and their columns (DEC-74, DEC-76, DEC-79).

## Screens and navigation
- **DEC-109** **(new)** Two layers, like Langfuse's organizations and projects [PO 2026-10-27]. Replaces DEC-73's "All my
  projects", DEC-84 (landing), DEC-96, DEC-103 and the cross-project scope of DEC-86.
  - **Outer layer** (where everyone lands, `/`): the **Merchants** page. One row per merchant, each project a card with
    **Go to project** and ⚙ (its Project Settings). The card shows the project name only. Platform users see every
    merchant; a merchant user sees only their merchant and the projects they can reach. Top right: Search projects, and
    **New merchant** for platform users who may create merchants.
    - Row header: ⚙ **Merchant settings** · 👥 **Users** · **+ New project** (each shown only with the permission).
    - **Merchant settings** (outer): General (merchant details; edit and status for platform users) · Users · Roles
      (merchant roles) · Billing (every project of the merchant) · Audit log (the whole merchant).
    - Outer sidebar: Merchants; for platform users with the permission, **Platform Users** (DEC-110; staff users
      and platform roles) and **Workflow Registry**. These platform modules no longer exist inside a project.
  - **Inner layer** (today's portal): always **one project**. Opened by Go to project (or a link to a case, which selects
    that case's project). Header breadcrumb: `Merchant ▾ / Project ▾` switchers; the logo goes back to the Merchants page.
    Menu: Overview, System Intelligence, Billing · Verifications, Flows · Members, Roles · Audit Logs · Project Settings, every one showing
    that project's data only. No "All my projects", no cross-project or cross-merchant views (DEC-86's merchant filter is
    gone), no Projects list (the Merchants page replaces it; rename and archive are in Project Settings › General).
  - Platform-wide billing totals are dropped: billing is per merchant (Merchant settings) and per project.
  - **Members and Roles** of the project are sidebar entries (group User Management), no longer Project Settings tabs
    [PO 2026-10-27]. Project Settings keeps General, Integration and Review operations (Routing removed, DEC-95).
  - **No tab strip** [PO 2026-10-27]: pages don't open as tabs; the sidebar and the breadcrumb are the navigation. The case
    page's breadcrumb still ends with its Reference ID (DEC-97).
  - The outer **Super admins** module is gone (DEC-110): Platform staff lists the super admin too.
- **DEC-110** **(new; replaces DEC-79 and the super admin management of DEC-99 / DEC-104)** One super admin, created by
  the seed [PO 2026-10-28]:
  - There is exactly **one** super admin. It is created when the platform is first set up (the seed) and **nothing about
    it can be changed** in the portal: no invite, rename, email change, suspend, reactivate or delete, and no second
    super admin. Its rights stay fixed and outside the role system (DEC-104).
  - The **Super admins** screen and its API are removed. **Platform › Platform Users** (Users tab) lists the super admin
    as the first row, role "Super admin", marked **Created at setup · can't be changed**; the row opens nothing and the
    staff API refuses any change to it (422).
  - The super admin still manages platform staff, platform roles and everything else it did; only the management of
    super admins is gone ("at least one active super admin" and "nobody suspends themselves" no longer apply to it).
  - Recovering the super admin account (lost access, a person leaving) is an operations procedure outside the portal.
  - The module **Platform staff** is renamed **Platform Users** (`/platform-users`; old links redirect) [PO 2026-10-28].
    Tabs **Users** (page title "Platform users", **New platform user**, field **Platform role**) and **Roles** (page
    title "Platform roles"). The account type is still Platform staff (DEC-99); on screens it reads "platform user".
- **DEC-84** **(superseded by DEC-109)** No Home page. Everyone lands on Overview. UAT scenario links are on a mock-only page in
  the Dev menu (still true). [PO 2026-10-20]
- **DEC-85** **(new)** Screens: Overview, System Intelligence, Billing (all roles, DEC-86), Verifications List, Verification
  Detail, Projects, Project Settings, Flows List, Flow Detail, Users, Roles, Audit Log; Platform Admin only: Merchants,
  Workflow Registry, Admins (DEC-79). Replaced: eKYC Workflow → Flows List + Flow Detail; Developers → Project Settings › Integration;
  Users and Access → Users + Roles ([FRS] method, DEC-74, DEC-76); Merchant Workflow Directory → Workflow Registry ("flows using it"); the [MS] Reports
  module → folded into the three dashboards (DEC-86). Overview, System Intelligence, Billing and Merchants otherwise follow
  [FRS]. [MS][PO 2026-10-20]
- **DEC-103** **(superseded by DEC-109; the collapsed-sidebar flyout stays)** Sidebar menu [PO 2026-10-22]:
  - Groups, in order: **Dashboards** (Overview, System Intelligence, Billing) · **eKYC** (Verifications, Projects) ·
    **User Management** (Users, Roles) · **Governance** (Audit Logs) · **Platform** (Merchants, Super admins, Workflow
    Registry). Group icons: gauge, face scan, people, scroll, cog.
  - **Project Settings and Flows are not menu entries**: they are opened from a project on the Projects screen (its Flows
    and Settings buttons, which also select that project in the header). The breadcrumb shows where they come from
    (eKYC › Projects › Flows), and Projects stays highlighted in the menu while they are open.
  - **Collapsed sidebar**: one icon per group (plus any top-level screen); hovering a group icon, or clicking it or
    pressing Enter on it, opens a flyout to its right with the group's name and its screens. The group of the current
    screen is highlighted. The expanded sidebar keeps the groups that open and close.
- **DEC-86** **(changed)** Overview, System Intelligence and Billing are visible to every role; only the data differs.
  [PO 2026-10-20]
  - **Scope:** Platform Admin = all merchants (merchant filter shown); Merchant Owner = all the merchant's projects;
    Project Admin, Reviewer, Viewer = their own projects. The merchant filter is hidden for merchant users ([FRS]).
  - **Project and flow filters** on all three, following the header's project switcher ("All my projects" or one project).
  - **Overview** adds the [MS] Reports metrics: cases by status by project, flow and version · pass rate (APPROVED out of
    completed) by project and flow · cases waiting in `PENDING_REVIEW` and their age by project · totals across projects
    (Platform Admin, Merchant Owner).
  - **System Intelligence** adds drop-off by phase (ID capture, selfie, liveness) by flow, and the retry KPIs by flow.
  - **Billing** adds tokens and cost by project and flow.
  - Score and reason reporting stays deferred. [MS]

## Removed / backlog
- **DEC-80** Manual Review Queue screen: **removed** (replaced by List + claim on Detail).
- **DEC-83** Backlog (greyed "Backlog" chip or omitted): stuck-in-PROCESSING reason, System Re-Process, "Impersonate merchant
  view", Diagnostics page, advanced configuration methods. [FRS]

---

## Mock-only design choices (not business decisions)
These keep the mock runnable. They are not signed-off requirements; change them freely.

- **MOCK-01** **(changed)** Attempt counting: each `Attempt` records the check where it stopped and its scores. Retries for a
  check = submissions for that check after the first. ID capture and selfie retakes are not recorded as attempts.
- **MOCK-02** Risk gate: Low risk when every category score ≥ its minimum (DEC-107). Risk never auto-rejects.
- **MOCK-03** Claim expiry is lazy: every service call sweeps expired claims and writes one `CASE_CLAIM_EXPIRED` per expired claim.
- **MOCK-04** Time is read from an injectable clock (`src/lib/clock.ts`) with a dev "time warp" offset, so expiry can be demoed
  without waiting.
- **MOCK-05** Seeded data is deterministic (`faker.seed(2026)`), with dates relative to the moment of seeding. Scenario
  records (S01–S33) have fixed Reference IDs (`KYC-260901-9000NN`) and fixed Verification IDs, and every seeded record gets the same
  internal ID after each reset, so UAT deep links stay stable. Seeded IDs are derived from a readable fixture handle (e.g.
  `PRJ-0001` → `prj_…`); new records get random IDs. The mock generates cuid2-shaped IDs itself (no library); the backend
  uses cuid2 (or UUIDv7 if engineering prefers time-sortable IDs). Deep links sign in by email: `?as=siti.yusof@atoz.example`.
- **MOCK-06** Fake identity data: NRIC serials always use the `999G` pattern, IPs come from the RFC 5737 documentation ranges,
  and images are "SAMPLE – NOT REAL" placeholders.
- **MOCK-07** Deactivated users are refused by the services for claim, release and decide, and are not offered as reviewers.
  Their open claims still end by timeout.
- **MOCK-08** Cross-tab sync uses localStorage (last writer wins). It demonstrates the race; the real API needs an atomic
  conditional write (see docs/HANDOFF.md).
- **MOCK-09** **(changed)** Creating a merchant creates its Default project, a Draft "First flow" on the registry default version
  and a Merchant Owner user, each audited. Demo registration numbers and phone numbers are made up (Malaysian ones
  follow the SSM format but belong to no company); the mock has no sandbox / live API, so Onboarding is a label on the
  API keys.
- **MOCK-10** **(removed 2026-10-27)** Flow Detail had a what-if preview; it was removed as not needed [PO 2026-10-27].
- **MOCK-11** **(new)** Login, portal login security and webhook delivery are simulated; no real auth or HTTP calls.
- **MOCK-12** **(changed 2026-11-20)** A new project (DEC-93) starts with one Draft flow, "First flow", on the registry's
  default version (DEC-57); it is a starting point, not a default (DEC-95). The project takes sessions once a flow is
  completed and activated, and each session names that flow's Flow ID. A new merchant
  (DEC-92) gets the same, plus its first user as an Invited Merchant Owner.
- **MOCK-13** **(new)** Calls made where the decisions are silent [Claude, 2026-10-20]:
  - Project Settings › General and Review operations are edited by the roles that manage flows (Platform Admin, Merchant
    Owner, the project's Project Admin); Integration is merchant-only (superseded: DEC-75 now gives it to Platform Admin).
  - Flows List / Flow Detail: members without the manage-flows right get "No access"; outside the project, "not found".
  - Users and Access: nobody changes their own access; Merchant Owners are not changed there; only Platform Admin or the
    Merchant Owner deactivates (account-wide). Becoming Viewer also releases the user's claims in that project.
  - Continuing a case (DEC-113) has no button in the mock [PO 2026-11-22]: the mock has no API, so its rules live in the
    domain (`caseSessions.ts`, with tests) and the demo data holds a record for every status and situation, including
    continued cases, for reference (docs/SCENARIOS.md).
  - Dashboards count sessions by `createdAt`; pass rate = Approved / (Approved + Rejected + Unsuccessful) (DEC-112); drop-off = sessions still
    Processing, by the last phase reached.

## Superseded (kept so old `REQ:` tags can be traced)
| Old rule | Was | Now |
|---|---|---|
| DEC-10/11 | Pass/reject per phase for DOCUMENT, SELFIE, FACE_MATCH, LIVENESS; metrics shown per phase | DEC-10, DEC-19 |
| DEC-15/16 | Attempt limit → always `PENDING_REVIEW` "Attempt limit reached – [Phase]" | DEC-15, DEC-16 |
| DEC-18 | Retry KPI counts all user retakes | DEC-18 |
| DEC-22 | Claim timeout per merchant; ends by Cancel, timeout or decision | DEC-22 |
| DEC-31 | Reason code and audit comment required for both decisions; then (2026-10-20) Reject reasons = DEC-35 conditions, no Approve reason | DEC-31, DEC-106 |
| DEC-10 / DEC-35 | Granular metrics and duplicate-user information never shown | Shown on Verification Detail (DEC-105) |
| DEC-13 / MOCK-02 / OQ-05 / OQ-06 | Risk level Low / Medium / High from a 0–100 score; V4 "maximum allowed level" per flow | Four category scores, Low risk / High risk, minimums fixed (V4) or per flow (V5) (DEC-107) |
| DEC-44 / DEC-105 | Activity timeline on the case page | Removed; history in the Audit Log |
| DEC-42 | `PII_VIEW`, `CLAIM`, `CLAIM_RELEASE`, `CLAIM_TIMEOUT`, `DECISION`, `OWNERSHIP_CONFLICT`, `CONFIG_*`, `CREDENTIAL_ROTATION` | DEC-42 |
| DEC-50/51 | One config per merchant, Save Draft / Discard / Deploy | DEC-50, DEC-51 |
| DEC-60 | Charged once when the user enters the flow | DEC-60 |
| DEC-70 | Two global roles: Platform Admin, Merchant Reviewer | DEC-70 |
| DEC-81 | Drop-off KPI removed | Drop-off by phase on System Intelligence (DEC-86) |
| DEC-82 | Webhooks on hold | DEC-54, DEC-55 |
| DEC-94 / MOCK-12 | Exactly one default flow per project: Set as default, Default badge, retiring the default blocked, `FLOW_DEFAULT_CHANGED` | No default flow; any Active flow can be retired (DEC-94) |
| DEC-95 / OQ-18 | Routing rules and % shares set through the API, shown read-only in Project Settings › Routing | Every session names its flow (`flowId` required); no routing (DEC-95) |
| DEC-01 | Exactly four statuses | Five: `UNSUCCESSFUL` added (DEC-112) |
| DEC-112 / DEC-26 | Status `FAILED`, shown as "Failed"; "Cooldown after Failed" (`failedCooldownMin`) | `UNSUCCESSFUL`, shown as "Unsuccessful"; "Cooldown after Unsuccessful" (`unsuccessfulCooldownMin`) [PO 2026-11-23] |
| DEC-16 / DEC-108 | A document or V1 selfie still failing when its retries are used up → `REJECTED` | `UNSUCCESSFUL` (DEC-112) |
| DEC-97 | Our case ID `ver_…`, labelled "Case ID"; code fields `caseId`, `referenceNo` | Verification ID `vrf_…`; code fields `verificationId`, `referenceId` (DEC-114) |
| DEC-26 / OQ-22 | One cooldown, after a rejection; same end user = same ID document number | Cooldown after Rejected + cooldown after Unsuccessful; same end user = same Reference ID (DEC-26, DEC-113) |
| DEC-32 | Decisions are final; a returning end user gets a new case | No reviewer reopen; a returning Reference ID continues its `REJECTED` or `UNSUCCESSFUL` case after the cooldown (DEC-113) |
| DEC-97 / OQ-17 | Reference ID uniqueness open (mock: per project) | Identifies the end user within a project; may repeat across projects; Verification ID is the unique key (DEC-113, DEC-114) |

## Conflict register (old FRS / Axure → latest decision)
| Topic | Old FRS / Axure | Latest decision |
|---|---|---|
| Statuses | MANUAL_APPROVED, ERROR, EXPIRED | 4 statuses only (DEC-01) |
| Manual vs auto | Separate status | `lastUpdatedBy` (DEC-02) |
| Workflow canvas | High/Mid/Low per metric | Low/Standard/High presets per check + Advanced for Platform Admin (DEC-19) |
| Configuration scope | One per merchant, draft → deploy | Per flow, save creates a revision (DEC-50, DEC-51) |
| Detail buttons | "Maintain Automated Rejection" / "Confirm Manual Pass" | "Reject" / "Confirm Manual Pass" for the claim holder (DEC-30) |
| Review queue | Separate screen | Removed (DEC-80) |
| Supervisor actions | Assign / reassign / force-release | None (DEC-23) |
| Retry limit | Retries per token-consuming phase (V1: selfie and liveness) | Face match and liveness only; selfie unlimited and free (DEC-18) |
| Roles | 7-role catalogue / Platform vs Merchant Admin / custom roles | [FRS] Users + Roles screens with custom roles, assigned with a scope (All / Selected projects) (DEC-70, DEC-74, DEC-76) |
| Developers page | Merchant-level API key and webhook | Per project, Project Settings › Integration (DEC-54) |
| Merchant Workflow Directory | Platform Admin edits merchant thresholds | Removed; Registry shows flows per version (DEC-85) |
| Timestamps | Extra fields | `createdAt` and `lastUpdatedAt` (DEC-04) |
| "System Failure Reason" banner | Red banner | Reason banner from the condition catalogue (DEC-35) |
