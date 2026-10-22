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
  | Project | Members and roles · auto-release claim timeout · API keys, webhook · redirect URLs, allowed web origins, IP allowlist · branding override, language · default flow and routing method · Reference ID scope (OQ-17) · data retention (OQ-21) |
  | Flow | Workflow version (locked once active) · check thresholds · retries allowed, cooldown · accepted documents · risk thresholds (V4, V5) · routing rule or % share · session expiry |

- **DEC-92** Every merchant starts with a **Default** project. Creating a merchant also creates its Default project with one
  default flow built on the registry's default version (DEC-57), and its first user as Merchant Owner (FRS "Option B"). [MS][FRS]
- **DEC-93** Projects: create (name required), rename, archive. Archived = no new sessions; existing cases stay reviewable.
  The Default project cannot be archived while it is the merchant's only active project. Projects are never deleted. [MS]
- **DEC-94** Flows: status `Draft`, `Active`, `Retiring` (in-flight cases only), `Inactive`. Exactly one default flow per
  project. Actions: create (pick a workflow version → Flow Detail), duplicate, set as default, activate, retire. Retiring the
  default flow requires choosing a new default first. Flows are never deleted, so past cases keep their flow. The workflow
  version is locked once a flow is active; to change version, create a new flow. [MS]
- **DEC-95** Routing (which flow a new session uses) is set by the merchant through the API. The portal shows the routing
  method, rules (priority, conditions, target flow) and percentage shares **read-only** (OQ-18). [MS]
- **DEC-96** Case lists may span all of a user's projects ("All my projects"). Settings pages always work on one selected
  project. [MS]

## Statuses
- **DEC-01** `VerificationStatus` is exactly: `PROCESSING`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`. No other status exists
  (no MANUAL_APPROVED, ERROR, EXPIRED, CLAIMED, IN_REVIEW).
- **DEC-02** Manual vs automated is read from `lastUpdatedBy`: `SYSTEM`, or the reviewer's Full Name + User ID.
- **DEC-03** `lastUpdatedBy` / `lastUpdatedAt` change **only when the status changes**. Claiming, releasing or viewing never touch them.
- **DEC-04** Lifecycle timestamps are `createdAt` (session started) and `lastUpdatedAt` (latest status change), plus the claim
  fields. **(changed)** [MS]

## Automated evaluation
- **DEC-10** **(changed)** Only two checks have configurable thresholds: **Face match** and **Liveness**, each with an
  Auto-Reject / Auto-Pass pair. ID capture and Selfie have no configurable thresholds; their quality checks are fixed by the
  engine. Granular metrics (pitch, yaw, sharpness, brightness, face confidence …) are never shown in the portal. Risk
  Assessment runs for V4 and V5 only. [MS][FRS][PO 2026-10-19]
- **DEC-11** For face match and liveness: score `>= autoPass` → pass; `< autoReject` → reject band; in between → review band.
- **DEC-12** When every check has a final result, they combine: any reject → `REJECTED`; otherwise any review →
  `PENDING_REVIEW`; otherwise all pass. *(Precedence is OQ-01 and is configurable.)*
- **DEC-13** **(changed)** V4 and V5: all checks passing is not enough; Risk Assessment must also pass, otherwise
  `PENDING_REVIEW` with reason "Risk Assessment not passed". V5's per-component risk thresholds are OQ-05.
- **DEC-14** A system approval is `APPROVED` with `lastUpdatedBy = SYSTEM` ("Auto-Clear").
- **DEC-19** Threshold presets. **(new)** [PO 2026-10-20]
  - Each of face match and liveness offers **Low**, **Standard** and **High** presets. Low = lenient (more automatic
    approvals); High = strict. Preset values are OQ-02.
  - **Advanced** = custom Auto-Reject / Auto-Pass numbers, set by **Platform Admin only**. A merchant sees a read-only
    "Advanced (set by platform)" chip with the numbers and may switch back to a preset, but cannot edit the numbers.
  - A 0–100 band bar shows the Reject / Review / Approve bands and updates when a preset or custom values are chosen.

## Retries
- **DEC-15** **(changed)** A face match or liveness result below Auto-Pass, with retries left, sends the user to retry; the case
  stays `PROCESSING`. An incomplete, aborted or timed-out run also stays `PROCESSING`. [PO 2026-10-20]
- **DEC-16** **(changed)** When retries run out, the **last attempt** decides: below Auto-Reject → `REJECTED`; review band →
  `PENDING_REVIEW`. The reason is the matching condition from DEC-35 (e.g. "Liveness face does not match ID face (Retry Not
  Allowed)"). [PO 2026-10-20]
- **DEC-17** Retries keep the same case (case ID and Reference ID); each retry is appended to `attempts[]`, never a new record.
- **DEC-18** **(changed)** "**Retries allowed**" is set per check (face match, liveness) per flow: the number of retries after
  the first submission. Default 3 = up to 4 submissions. Range is OQ-03. ID capture and Selfie retakes are **unlimited, not
  counted and free**. The retry KPIs (First-Attempt Pass Rate, Average Retries) count face match and liveness retries only.
  [PO 2026-10-20][FRS]
- **DEC-26** **(new)** Cooldown (per flow, minutes, default 0): after a case is `REJECTED`, the **same end user** cannot start
  a new case until the cooldown ends. 0 = no wait. How "same end user" is identified, and whether the wait covers only this
  flow or the whole project, is OQ-22. Verification Detail shows "New case allowed from …" on rejected cases. [PO 2026-10-20]

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
- **DEC-31** **(changed)** Reject requires at least one reason from the DEC-35 failure conditions. Approve needs no reason
  code. The note is optional for both. [MS][PO 2026-10-20]
- **DEC-32** Decisions are final: no reopen, no "Request Resubmission".
- **DEC-33** `PROCESSING` records are read-only.
- **DEC-35** Condition catalogue. **(new)** [PO 2026-10-20] Used for the reason banner on Verification Detail
  (`PENDING_REVIEW` / `REJECTED`), the Top-5 failure reasons charts and the Reject reason list.

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

  - The **record-only** condition never changes the status, is never shown on the list or detail screens ([MS]: no
    duplicate-user information) and is not a Reject reason.
  - "(Retry Allowed)" conditions keep the case `PROCESSING`; "(Retry Not Allowed)" conditions are the final reason (DEC-16).

## Visibility, PII & audit
- **DEC-40** **(changed)** Verifications List columns: Reference ID, Full Name, Project (when more than one project is in view),
  Flow, Workflow version, Document type, Status, Risk level (only when a flow in view runs risk), Claimed by (or "Unclaimed"),
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
    `CASE_DECISION_REJECTED`, `CASE_DECISION_BLOCKED`
  - Flows: `FLOW_CREATED`, `FLOW_ACTIVATED`, `FLOW_RETIRED`, `FLOW_DEFAULT_CHANGED`, `FLOW_SETTING_CHANGED`
  - Projects: `PROJECT_CREATED`, `PROJECT_RENAMED`, `PROJECT_ARCHIVED`, `PROJECT_SETTING_CHANGED`
  - Integration: `API_KEY_CREATED`, `API_KEY_ROTATED`, `API_KEY_REVOKED`, `WEBHOOK_CHANGED`
  - Users: `USER_INVITED`, `USER_INVITATION_RESENT`, `USER_ACCESS_ADDED`, `USER_ACCESS_CHANGED`, `USER_ACCESS_REMOVED`,
    `USER_SUSPENDED`, `USER_REACTIVATED`
  - Roles: `ROLE_CREATED`, `ROLE_UPDATED` (permissions or name), `ROLE_STATUS_CHANGED`
  - Registry (Platform Admin only): `WORKFLOW_REGISTERED`, `WORKFLOW_UPDATED`, `WORKFLOW_STATUS_CHANGED`, `WORKFLOW_DEFAULT_CHANGED`
  - Merchants (Platform Admin only): `MERCHANT_CREATED`, `MERCHANT_UPDATED`, `MERCHANT_STATUS_CHANGED`
  [MS][FRS]
- **DEC-43** **(new)** Verifications List filters: project, flow, workflow version, status, claim state (unclaimed / mine /
  others), risk level, date range; search by Reference ID and Full Name. Default view: `PENDING_REVIEW` cases in the user's
  projects, oldest first. [MS][FRS]
- **DEC-44** **(new)** Verification Detail sections: header (Reference ID, case ID with copy (DEC-97), status, project, flow, workflow version,
  configuration revision, created, last updated) · claim panel · end-user data (email for V4/V5) · ID capture (images, result,
  soft rejects) · Selfie (V1 only: image, result) · Face match (result, threshold applied, score, retries used / allowed) ·
  Liveness (result, threshold applied, retries used / allowed, cooldown applied) · Risk (V4/V5: each component's 0–100 score
  and reason codes, overall) · Rules applied (settings snapshot at session start) · Activity timeline. [MS]

## Configuration
- **DEC-50** **(changed)** Settings live on each **flow** (Flow Detail). The form shows only what applies to the flow's version:

  | Section | V1 | V3 | V4 | V5 |
  |---|---|---|---|---|
  | General: name, description, workflow version (locked once active) | ✓ | ✓ | ✓ | ✓ |
  | Thresholds: face match, liveness (DEC-19) | ✓ | ✓ | ✓ | ✓ |
  | Retries allowed: face match, liveness (DEC-18) · cooldown (DEC-26) | ✓ | ✓ | ✓ | ✓ |
  | Accepted documents (MyKad, Passport, Driving License) | ✓ | ✓ | ✓ | ✓ |
  | Session expiry | ✓ | ✓ | ✓ | ✓ |
  | Risk thresholds and resulting action | | | ✓ | OQ-05 |
  | Requirements: "Email required at session creation" | | | ✓ | ✓ |
  | Developer info: flow ID, sample create-session request | ✓ | ✓ | ✓ | ✓ |
  | History: who, when, old and new value | ✓ | ✓ | ✓ | ✓ |
  [MS][PO 2026-10-20]
- **DEC-51** **(changed)** No staged draft/deploy. A Draft flow is edited freely. On an Active flow, Save requires a
  "Reason for change" (min 10 characters), warns that changes apply to new sessions only, and creates a new **configuration
  revision** `<Version>-R<n>` (running number per flow, never reset). Each save is audited with old and new values. [MS][FRS]
- **DEC-52** Saved settings apply to **new sessions only**. Each case stores its flow and configuration revision, shown as
  "Rules applied".
- **DEC-53** **(changed)** Validation: `0 <= autoReject < autoPass <= 100`; retries allowed within OQ-03; cooldown `>= 0`
  minutes; claim timeout `>= 1` minute; reason for change `>= 10` characters.
- **DEC-54** **(new)** Project Settings tabs: **General** (name, branding override, language; blank branding inherits the
  merchant default) · **Integration** (API keys: name, created, last used, status, create / rotate / revoke, key shown once;
  webhook URL (HTTPS), signing secret, events; redirect URLs; allowed web origins; IP allowlist) · **Review operations**
  (auto-release claim timeout) · **Routing** (read-only, DEC-95; default flow). Changes are audited with old and new values. [MS]
- **DEC-55** **(new)** Webhook delivery: on a change to `PENDING_REVIEW`, `APPROVED` or `REJECTED`, POST
  `verification.status_changed` (Reference ID, new status, Last Updated By, timestamp), signed with the project's signing
  secret; non-2xx → up to 3 retries at increasing intervals, each attempt audited. Mock: deliveries are simulated only. [FRS]

## Workflow Registry
- **DEC-56** **(changed)** Statuses `Draft`, `Active`, `Deprecated`. [FRS][PO 2026-10-20]
  - Allowed: Draft → Active (all mandatory fields complete), Draft → Deprecated (withdraw), Active → Deprecated, Deprecated →
    Active (re-activate). Never back to Draft.
  - Only Active versions can be chosen when creating a flow. Draft versions cannot be chosen by anyone; there are no test
    flows. [PO 2026-10-20]
  - Deprecated versions cannot be chosen for new flows; existing flows keep running and show a "version deprecated" warning.
  - No hard delete. Once a version has been Active, only name, description, state machine references and release notes can be
    edited; anything else needs a new version code.
- **DEC-57** **(new)** Exactly one version is "**Default for new merchants**" and it must be Active. It cannot be deprecated
  while it is the default. Changing the default affects new merchants only. [PO 2026-10-20]
- **DEC-58** **(new)** Versions: V1 (ID → Selfie → Liveness; face match ID vs Selfie; default), V3 (ID → Liveness; ID vs
  liveness face), V4 (V3 + Risk Assessment; email required), V5 (Draft, TBC). No V2. [FRS][MS]

## Charging
- **DEC-60** **(changed)** Tokens are consumed per **liveness submission**, whatever the final status (including cases still
  `PROCESSING`). ID capture and Selfie retakes are free. "Cost of retries" = tokens from liveness submissions after the first.
  Billing column is "Verification Status". [FRS][PO 2026-10-20]

## Roles and access
- **DEC-70** **(changed again)** Users and roles follow the [FRS] User Management method, extended with **scoped role
  assignments** ("Option C") [PO 2026-10-20]:
  - A **role** is defined once per merchant from permission checkboxes; it says *what* a user may do. An **assignment**
    gives a user a role with a **scope**, *where*: **All projects** (every current and future project; labelled in the UI)
    or **Selected projects**. A user may hold several assignments; where they overlap, permissions are the **union**
    (no deny rules). Flow-level scope is not used (Option D kept in reserve).
  - Permissions, grouped on the Roles screen:

    | Merchant-level (assignable to All projects only) | Project-level |
    |---|---|
    | Manage billing and contract | View cases |
    | Manage users and roles | Claim cases |
    | Create, rename, archive projects | Approve / reject cases (own claim only, DEC-30) |
    | View merchant-wide reports | Manage project settings (branding, auto-release timeout) |
    | | Manage API keys and webhook |
    | | Manage flows (create, activate, retire, set default) |
    | | Change verification level and retries (thresholds, retries allowed, risk level) |
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
- **DEC-71** Client-side permission checks are UI only, not security. The real backend must enforce them.
- **DEC-72** **(changed)** Every page checks the user's access to the project; hiding a menu item is not enough. A case from
  a project the user's assignments don't cover returns "not found" (not "forbidden"). [MS]
- **DEC-73** **(changed)** Global header: project switcher (only projects the user's assignments cover, plus "All my
  projects" for more than one), current project name always visible, menu filtered by the user's permissions in the
  selected project, user menu (name, email, roles in the current project, log out). A user with no assignments can sign in
  but sees "You don't have access to any project yet". [MS][PO 2026-10-20]
- **DEC-74** **(changed again)** **Users** screen ([FRS] User Management › Users): flat list with Full Name, Email,
  Merchant (Platform Admin only), **Access** (assignment summary, e.g. "Reviewer (Retail), Viewer (SME)"), Status, Created
  At; sorted by Created At, newest first; 10 / 20 / 50 per page; "No Records Found". Create: full name, work email,
  merchant (Platform Admin only) and the first assignment; the user starts **Pending** and gets an invitation (Resend while
  Pending). Statuses `Pending`, `Active`, `Suspended`; users are never deleted (Suspend). **User detail**: an Access table
  (Role | Scope | Added by | Date) with Add / Edit / Remove. Rules [PO 2026-10-20]:
  - Only users with Manage users and roles (or Platform Admin) manage users; on a project's Members tab, users with Manage
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
  - Not used [PO 2026-10-21]: per-flow scope. (Access end dates: now used, DEC-99.) Previously also: access end dates, and per-flow scope (DEC-70; two users with the same role
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
  the grouped permission checkboxes (at least one: "Roles require at least one action permission flag"). System Default
  roles are read-only. Editing a role applies at once to everyone holding it, in all their scopes, and shows "Affects N
  users" before saving. Roles are never deleted; deactivating one still assigned is refused: "Operation rejected. This role
  is currently assigned to active records inside the system." Managed by users with Manage users and roles and by Platform
  Admin. [FRS][PO 2026-10-20]
  - **Duplicate** any role (System Default included) into a new Custom role, "Copy of …", to edit from there. The impact
    note reads "Affects N users in M projects". [PO 2026-10-21]
  - The create / edit dialog starts with the **Role ID**: generated when the dialog opens, shown read-only, never edited
    (FRS "auto-generates a unique identity key"). A **Status** field (Active / Inactive) sits in the dialog, and each row
    has an Actions menu (Edit, Duplicate, Activate / Deactivate). Deactivating a role that is assigned, or any System
    Default role (shared by every merchant), is shown disabled with the reason (DEC-78). An inactive role grants nothing
    and can't be given. [PO 2026-10-22]
- **DEC-77** **(new)** Project Settings › **Members** tab: everyone with access to the project and their role, including
  users with All projects access (marked "inherited"). Adding a member creates an assignment scoped to that project. An
  archived project keeps its assignments read-only and leaves the switcher. [PO 2026-10-20] Adding from this tab fixes the
  project (shown, not changeable) and lists only roles the actor may give; inherited rows link to the user's details when
  the actor may open them. [PO 2026-10-21]
- **DEC-78** **(new)** Hide or disable, one rule for every screen [PO 2026-10-21]:
  - **Hide** an action the user can never do with their access (a Reviewer never sees "Add member").
  - **Disable with a tooltip** an action blocked by the current state, where knowing it exists matters (Remove on the last
    Merchant Owner: "At least one Merchant Owner (All projects) is required").
  - Services check every action anyway (DEC-71). Screens a user can't open show "No access"; a case or project outside
    their access is "not found" (DEC-72).
- **DEC-79** **(new; renamed Super admins, DEC-99)** **Admins** (Platform menu, Platform Admin only): the internal Platform Admin accounts, kept apart from
  merchant users. Columns Full Name, Email, Status, Created At, Last active; sorted by Created At, newest first. New admin = full
  name and work email; starts Pending (Resend invitation); Suspend / Reactivate; never deleted. No roles or scopes: Platform
  Admin rights are fixed (DEC-70). At least one active Platform Admin must remain; nobody suspends themselves. Audited with
  the DEC-42 user events. [Dev 2026-10-21]

## Merchants
- **DEC-98** **(new)** **Merchants** screen (Platform Admin) follows [FRS] Merchant Management; DEC-92 still adds the Default
  project, default flow and first owner. [FRS][PO 2026-10-21]
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
- **DEC-99** **(new)** Three account types [PO 2026-10-22]:

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
    has no merchant access permissions", when the role has none) · Access ends: Never (default) or a date.
    **Type = Merchant:** Merchant (locked for merchant admins) · Name · Email (the staff domain is not allowed) · Role
    (that merchant's roles only) · Project access (DEC-70) · Access ends. Changing the merchant resets role and projects.
  - **Access ends** (changes DEC-74 "no end dates") on each access row: from the end of that day (MYT) the row grants
    nothing, shows as "Ended", and claims that needed it are released at the next sweep.
  - **Guardrails:** platform roles only for platform staff; merchant roles only for users of the same merchant. Merchant
    admins can't create, list or open platform roles or staff; a direct URL is "not found". Super admins and the
    Super admins screen stay as they are. Platform staff never manage users or roles.

## Identifiers
- **DEC-97** **(new)** Identifiers [PO 2026-10-21]:
  - Every stored record has an **internal ID**: a type prefix and a cuid2 body, e.g. `prj_k3x9…`. Prefixes: `mer` merchant,
    `prj` project, `flw` flow, `rev` flow revision, `ver` verification case, `att` check attempt, `file` uploaded image, `usr`
    user, `rol` role, `asg` role assignment, `inv` invitation, `key` API key, `whk` webhook endpoint, `wfv` registry version,
    `evt` audit event. Lists sort by created time, never by ID (cuid2 IDs are not time-ordered).
  - Not IDs: secrets (API key value, webhook signing secret, session links) are random tokens stored hashed; workflow
    codes (V1 … V5), statuses and permission keys are fixed values; external IDs (Ballerine, AWS liveness) are stored as given.
  - **Shown on screen** only where people copy or quote them: Flow ID (Flows List and Flow Detail, copy button: merchants
    send it as `flow_id`), case ID (Verification Detail, copy; in webhooks), API key (masked, `key_…a91f`), webhook event
    ID (delivery log; not in the mock). Internal screens may show Merchant ID (Merchants) and Project ID (Projects, for
    developers). Users, assignments, invitations, attempts, files and audit events are never shown; audit exports include
    the event ID. Exceptions [PO 2026-10-22]: the Role ID is shown read-only in the Role dialog (DEC-76), and the User ID
    is the first, read-only field of New user / New admin (generated when the form opens, kept on save) and is shown in
    the user's details (DEC-74, DEC-79). Lists still don't show it. People are identified by name and email, roles by name; "Last updated by" shows the name.
  - **Reference ID** is the **merchant's own reference** for the end user, sent when the session is created. It is stored
    alongside the case ID, searchable, shown in the list, and never used as the key; case URLs and webhooks use the case ID.
    Uniqueness: OQ-17.
  - Supersedes the [FRS] masks `KYC-YYMMDD-XXXXXX` (platform-generated Reference No. as key), `USR-2026-XXXX` and
    `ROL-2026-XXXX` and their columns (DEC-74, DEC-76, DEC-79).

## Screens and navigation
- **DEC-84** **(new)** No Home page. **Everyone lands on Overview.** UAT scenario links are on a mock-only page in the Dev
  menu. [PO 2026-10-20]
- **DEC-85** **(new)** Screens: Overview, System Intelligence, Billing (all roles, DEC-86), Verifications List, Verification
  Detail, Projects, Project Settings, Flows List, Flow Detail, Users, Roles, Audit Log; Platform Admin only: Merchants,
  Workflow Registry, Admins (DEC-79). Replaced: eKYC Workflow → Flows List + Flow Detail; Developers → Project Settings › Integration;
  Users and Access → Users + Roles ([FRS] method, DEC-74, DEC-76); Merchant Workflow Directory → Workflow Registry ("flows using it"); the [MS] Reports
  module → folded into the three dashboards (DEC-86). Overview, System Intelligence, Billing and Merchants otherwise follow
  [FRS]. [MS][PO 2026-10-20]
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
- **MOCK-02** Risk gate: V4 risk passes when `riskLevel <= risk.maxAllowedLevel`. Risk never auto-rejects. *(See OQ-05.)*
- **MOCK-03** Claim expiry is lazy: every service call sweeps expired claims and writes one `CASE_CLAIM_EXPIRED` per expired claim.
- **MOCK-04** Time is read from an injectable clock (`src/lib/clock.ts`) with a dev "time warp" offset, so expiry can be demoed
  without waiting.
- **MOCK-05** Seeded data is deterministic (`faker.seed(2026)`), with dates relative to the moment of seeding. Scenario
  records (S01–S20) have fixed Reference IDs (`KYC-260901-9000NN`) and fixed case IDs, and every seeded record gets the same
  internal ID after each reset, so UAT deep links stay stable. Seeded IDs are derived from a readable fixture handle (e.g.
  `PRJ-0001` → `prj_…`); new records get random IDs. The mock generates cuid2-shaped IDs itself (no library); the backend
  uses cuid2 (or UUIDv7 if engineering prefers time-sortable IDs). Deep links sign in by email: `?as=siti.yusof@atoz.example`.
- **MOCK-06** Fake identity data: NRIC serials always use the `999G` pattern, IPs come from the RFC 5737 documentation ranges,
  and images are "SAMPLE – NOT REAL" placeholders.
- **MOCK-07** Deactivated users are refused by the services for claim, release and decide, and are not offered as reviewers.
  Their open claims still end by timeout.
- **MOCK-08** Cross-tab sync uses localStorage (last writer wins). It demonstrates the race; the real API needs an atomic
  conditional write (see docs/HANDOFF.md).
- **MOCK-09** **(changed)** Creating a merchant creates its Default project, a default flow on the registry default version
  (Draft) and a Merchant Owner user, each audited. Demo registration numbers and phone numbers are made up (Malaysian ones
  follow the SSM format but belong to no company); the mock has no sandbox / live API, so Onboarding is a label on the
  API keys.
- **MOCK-10** **(changed)** Flow Detail's what-if preview re-runs the status rules over the flow's finished sessions. It is
  read-only and never changes decided records.
- **MOCK-11** **(new)** Login, portal login security and webhook delivery are simulated; no real auth or HTTP calls.
- **MOCK-12** **(new)** A new project (DEC-93) starts with one Draft flow, "Default flow", on the registry's default version
  (DEC-57) as its default flow. The project takes sessions once that flow is completed and activated. A new merchant
  (DEC-92) gets the same, plus its first user as an Invited Merchant Owner.
- **MOCK-13** **(new)** Calls made where the decisions are silent [Claude, 2026-10-20]:
  - Project Settings › General and Review operations are edited by the roles that manage flows (Platform Admin, Merchant
    Owner, the project's Project Admin); Integration is merchant-only (superseded: DEC-75 now gives it to Platform Admin).
  - Flows List / Flow Detail: members without the manage-flows right get "No access"; outside the project, "not found".
  - Users and Access: nobody changes their own access; Merchant Owners are not changed there; only Platform Admin or the
    Merchant Owner deactivates (account-wide). Becoming Viewer also releases the user's claims in that project.
  - Dashboards count sessions by `createdAt`; pass rate = Approved / (Approved + Rejected); drop-off = sessions still
    Processing, by the last phase reached.

## Superseded (kept so old `REQ:` tags can be traced)
| Old rule | Was | Now |
|---|---|---|
| DEC-10/11 | Pass/reject per phase for DOCUMENT, SELFIE, FACE_MATCH, LIVENESS; metrics shown per phase | DEC-10, DEC-19 |
| DEC-15/16 | Attempt limit → always `PENDING_REVIEW` "Attempt limit reached – [Phase]" | DEC-15, DEC-16 |
| DEC-18 | Retry KPI counts all user retakes | DEC-18 |
| DEC-22 | Claim timeout per merchant; ends by Cancel, timeout or decision | DEC-22 |
| DEC-31 | Reason code and audit comment required for both decisions | DEC-31 |
| DEC-42 | `PII_VIEW`, `CLAIM`, `CLAIM_RELEASE`, `CLAIM_TIMEOUT`, `DECISION`, `OWNERSHIP_CONFLICT`, `CONFIG_*`, `CREDENTIAL_ROTATION` | DEC-42 |
| DEC-50/51 | One config per merchant, Save Draft / Discard / Deploy | DEC-50, DEC-51 |
| DEC-60 | Charged once when the user enters the flow | DEC-60 |
| DEC-70 | Two global roles: Platform Admin, Merchant Reviewer | DEC-70 |
| DEC-81 | Drop-off KPI removed | Drop-off by phase on System Intelligence (DEC-86) |
| DEC-82 | Webhooks on hold | DEC-54, DEC-55 |

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
