# Access control: users, roles and permissions

How the eKYC Admin Portal decides who can see and do what, written for the engineers (and their AI assistants) building
the real backend. Everything here is taken from the working prototype; the code it comes from is linked in every
section, and the prototype's tests are an executable spec of the same rules.

- **Source of truth order:** `docs/DECISIONS.md` (DEC-70, 72, 74, 76, 77, 99, 102, 104, 109, 110) → this file →
  the code. If this file and DECISIONS.md disagree, DECISIONS.md wins; please report the difference.
- **The prototype checks access in two places.** The UI hides what you can't do (convenience only). The services
  (`src/services/*`) check again on every call, the way the real API must. Port the **service** behaviour, not the UI.
- **Open parameters:** OQ-09 (final role names and permission list) and OQ-31 (staff email domain) in
  `docs/OPEN_QUESTIONS.md`. Treat both as configuration, not constants.

---

## 1. The model in one picture

```
                        ┌──────────────────────────── Platform (internal) ───────────────────────────┐
                        │ Super admin (exactly 1, seeded, fixed, outside roles)                      │
                        │ Platform staff ── 1 platform role ── applies to EVERY merchant (no scope)  │
                        └────────────────────────────────────────────────────────────────────────────┘

Merchant ── Project ── Flow ── Case (verification)
   │           │
   │           └─ Project roles ── given in Project › Members ── that project only   (0..n per user)
   └─ Merchant role ── given on Users ── whole merchant, all projects incl. future     (exactly 1 per user)

Merchant user's access in project P  =  permissions(merchant role)  ∪  permissions(project roles in P)
                                         (union, no deny rules, no end dates, no masking)
```

Five ideas carry the whole design:

1. **Three account types**, fixed at creation: Super admin, Platform staff, Merchant user (§2).
2. **A permission is one module action** (e.g. `CLAIM_CASES`). Roles are named sets of permissions (§3, §4).
3. **Where a role applies is decided by where it is given**, not by the role: on Users = whole merchant; in
   Members = one project; on Platform Users = every merchant (§5).
4. **Code asks for an action**, never a role name: `canInProject(user, 'decideCase', project)` (§6, §7). The action
   maps to "any of these permissions".
5. **Outside your scope things don't exist (404); inside your scope but not allowed is 403** (§9).

---

## 2. Account types

`AccessLevel = 'SUPER_ADMIN' | 'PLATFORM_STAFF' | 'MERCHANT_USER'` (`src/domain/types.ts`). Set at creation, never
changed (no conversion between types).

| | Super admin | Platform staff (UI: "platform users") | Merchant user |
|---|---|---|---|
| Belongs to a merchant | No | No | Exactly one (`merchantId` required) |
| How many | **Exactly one**, created by the seed (DEC-110) | Any | Any |
| Roles | None: fixed full access, outside the role system | **Exactly one platform role**, scope `ALL_MERCHANTS` | **Exactly one merchant role** (`ALL_PROJECTS`) + 0..n project roles (`PROJECTS`, one project each) |
| Managed in | Nowhere: can't be invited, edited, suspended or deleted; listed read-only on Platform Users | Platform › Platform Users (super admin only) | Merchant settings › Users, and Project › Members |
| Email | Company domain (OQ-31) | Company domain (OQ-31) | Must **not** be the company domain |
| Sees | Everything | Every merchant, limited by their role's permissions | Their merchant only, limited by their roles |

User status: `PENDING` (invited, not accepted) → `ACTIVE` → `SUSPENDED` (reversible). Users are never deleted.

---

## 3. Permissions

A permission is one cell of the matrix **module × (View | action)**. The Roles screen shows them as a table:
Module | View | Actions. Defined in `src/domain/types.ts`, laid out in `src/domain/permissionMatrix.ts`.

### 3.1 Merchant-role and project-role permissions (37)

**Merchant-level** (15). They only count when they come from the **merchant role**, never from a project role:

| Module | View | Actions |
|---|---|---|
| Projects | (none: everyone sees the projects they reach) | `CREATE_PROJECTS`, `RENAME_PROJECTS`, `ARCHIVE_PROJECTS` |
| Users | `VIEW_USERS` | `INVITE_USERS` (and resend), `CHANGE_USER_ROLE` (the merchant role), `SUSPEND_USERS` (and reactivate) |
| Roles | `VIEW_ROLES` | `CREATE_ROLES` (and duplicate), `EDIT_ROLES`, `CHANGE_ROLE_STATUS` |
| Billing and contract | `VIEW_BILLING` | `MANAGE_BILLING` |
| Merchant reports | `VIEW_MERCHANT_REPORTS` | `EXPORT_MERCHANT_REPORTS` |

**Project-level** (22). A project role may hold only these; a merchant role may hold these too (then they apply in
every project):

| Module | View | Actions |
|---|---|---|
| Verifications | `VIEW_CASE_LIST` ("View list": no personal data) | `VIEW_CASE_DETAILS` (case page: name, ID number, images; every open audited) → `CLAIM_CASES` (claim / release) → `DECIDE_CASES` (approve / reject) |
| Flows | `VIEW_FLOWS` | `CREATE_FLOWS` (and duplicate), `EDIT_FLOWS`, `ACTIVATE_FLOWS` (activate, retire, set default), `CHANGE_VERIFICATION_LEVEL` (thresholds, retries, risk minimums) |
| Project settings | `VIEW_PROJECT_SETTINGS` | `MANAGE_PROJECT_SETTINGS` |
| API keys and webhook | `VIEW_INTEGRATION` | `MANAGE_INTEGRATION` |
| Members | `VIEW_MEMBERS` | `MANAGE_MEMBERS` (add / remove) |
| Project roles | `VIEW_PROJECT_ROLES` | `CREATE_PROJECT_ROLES`, `EDIT_PROJECT_ROLES`, `CHANGE_PROJECT_ROLE_STATUS` |
| Project reports | `VIEW_PROJECT_REPORTS` | `EXPORT_PROJECT_REPORTS` |
| Audit log | `VIEW_AUDIT_LOG` | — |

### 3.2 Platform-role permissions (42)

Prefixed `P_`. **Platform-level** (11): `P_MERCHANTS_VIEW / _CREATE / _SUSPEND`, `P_REGISTRY_VIEW / _MANAGE`,
`P_LEVELS_VIEW / _CALIBRATE`, `P_BILLING_VIEW / _MANAGE`, `P_REPORTS_VIEW / _EXPORT`.

**Merchant data** (31), the same modules and wording as §3.1, applying **in every merchant**: `P_PROJECTS_*`,
`P_USERS_*`, `P_ROLES_*`, `P_CASES_LIST / _DETAILS / _CLAIM / _DECIDE`, `P_FLOWS_VIEW / _CREATE / _EDIT / _ACTIVATE /
_LEVEL`, `P_SETTINGS_VIEW / _EDIT`, `P_INTEGRATION_VIEW / _MANAGE`, `P_MEMBERS_VIEW / _MANAGE`, `P_PROJECT_ROLES_*`,
`P_AUDIT_VIEW`. (Billing and contract is covered by Platform billing; Merchant/Project reports by Usage reports.)

**Not a permission at all:** managing platform staff, platform roles and the super admin. Only the super admin does
that (action `manageStaff`). No platform role can be given it, so nobody can escalate to it.

### 3.3 Implied permissions (`IMPLIES` in `permissionMatrix.ts`)

- Every action implies its module's View (`EDIT_FLOWS` → `VIEW_FLOWS`).
- Verifications is a chain: `DECIDE_CASES` → `CLAIM_CASES` → `VIEW_CASE_DETAILS` → `VIEW_CASE_LIST` (same for `P_CASES_*`).
- `CHANGE_VERIFICATION_LEVEL` → `EDIT_FLOWS` (it is done in the flow editor). Same for `P_FLOWS_LEVEL` → `P_FLOWS_EDIT`.

The server **normalises on save** (`withImpliedPermissions`): the stored role always contains what its actions imply.
The UI ticks the implied ones and locks them; unticking a permission clears everything that depends on it.

---

## 4. Roles

```ts
interface Role {
  roleId: string                 // rol_… (cuid2)
  audience: 'PLATFORM' | 'MERCHANT'   // the form's "Type"; never changes
  level?: 'MERCHANT' | 'PROJECT'      // merchant roles only: which of the two tables
  merchantId?: string            // Custom merchant/project roles only
  projectId?: string             // Custom project roles only: the one project it belongs to
  name: string
  type: 'SYSTEM_DEFAULT' | 'CUSTOM'
  permissions: Permission[]
  status: 'ACTIVE' | 'INACTIVE'
  createdAt, createdBy, updatedAt, updatedBy
}
```

### 4.1 The three role tables

| Table | Holds | Lives on | Given on | System Default roles |
|---|---|---|---|---|
| Platform roles (`audience PLATFORM`) | §3.2 | Platform Users › Roles | Platform Users (one per staff member) | Platform Admin, Support, Implementation, Finance |
| Merchant roles (`MERCHANT` / `level MERCHANT`) | §3.1, all 37 | Merchant settings › Roles | Merchant settings › Users (one per user) | Owner, Admin, Billing, Auditor, Member |
| Project roles (`MERCHANT` / `level PROJECT`) | §3.1 project-level 22 only | Project › Roles (each project) | Project › Members | Project Admin, Reviewer, Developer, Viewer |

System Default roles are shared by every merchant and every project (no `merchantId` / `projectId`) and are locked.
A Custom project role belongs to the project it was created in; "Duplicate from another project" copies one.

### 4.2 System Default roles (OQ-09 may still rename them)

| Role | Table | Permissions |
|---|---|---|
| **Platform Admin** | Platform | All 42 platform permissions. (Still can't manage platform users or roles: that is super admin only.) |
| **Support** | Platform | `P_CASES_LIST`, `P_CASES_DETAILS`, `P_FLOWS_VIEW`, `P_INTEGRATION_VIEW`, `P_AUDIT_VIEW` |
| **Implementation** | Platform | `P_MERCHANTS_VIEW/_CREATE`, `P_REGISTRY_VIEW/_MANAGE`, `P_LEVELS_VIEW/_CALIBRATE`, `P_FLOWS_*` (all 5), `P_INTEGRATION_VIEW/_MANAGE` |
| **Finance** | Platform | `P_BILLING_VIEW/_MANAGE`, `P_REPORTS_VIEW/_EXPORT` |
| **Owner** | Merchant | All 37. At least one active Owner per merchant must remain. |
| **Admin** | Merchant | All 37 **except** `VIEW_BILLING`, `MANAGE_BILLING` |
| **Billing** | Merchant | `VIEW_BILLING`, `MANAGE_BILLING` |
| **Auditor** | Merchant | `VIEW_MERCHANT_REPORTS`, `EXPORT_MERCHANT_REPORTS`, `VIEW_CASE_LIST`, `VIEW_AUDIT_LOG` |
| **Member** | Merchant | **None.** The default on New user; such a user reaches projects only through Members. |
| **Project Admin** | Project | All 22 project permissions |
| **Reviewer** | Project | `VIEW_CASE_LIST`, `VIEW_CASE_DETAILS`, `CLAIM_CASES`, `DECIDE_CASES`, `VIEW_FLOWS`, `VIEW_PROJECT_REPORTS`, `EXPORT_PROJECT_REPORTS` |
| **Developer** | Project | `VIEW_FLOWS`, `VIEW_INTEGRATION`, `MANAGE_INTEGRATION` (no case access) |
| **Viewer** | Project | `VIEW_CASE_LIST`, `VIEW_CASE_DETAILS`, `VIEW_FLOWS`, `VIEW_PROJECT_REPORTS`, `EXPORT_PROJECT_REPORTS` |

Source: `SYSTEM_DEFAULT_ROLES`, `PLATFORM_DEFAULT_ROLES` in `src/domain/roles.ts`.

### 4.3 Role rules (`validateRole`, `validateRoleStatus`)

- Name required; **unique (case-insensitive) within its table** (the merchant's merchant roles, one project's
  project roles, or the platform roles).
- At least one permission. Only permissions its table allows (`permissionsFor(audience, level)`); a project role with a
  merchant-level permission is refused.
- System Default roles can't be edited or deactivated.
- Roles are never deleted. A role that is still assigned to anyone can't be deactivated (422).
- An inactive role grants nothing (`grantsOf` skips it).
- **Editing a role applies at once to everyone holding it.** Holders who lose Claim or Approve/reject lose their open
  claims (§8).
- **"A role is a grant waiting to happen":** a merchant user can't create or edit a role with permissions they don't
  hold themselves (same rule as §6.3). Platform roles: super admin only.

---

## 5. Assignments and scope

```ts
type AssignmentScope =
  | { kind: 'ALL_PROJECTS' }                       // a merchant role: whole merchant, current and future projects
  | { kind: 'PROJECTS'; projectIds: string[] }     // a project role: always exactly ONE project id
  | { kind: 'ALL_MERCHANTS' }                      // a platform role: every merchant

interface RoleAssignment { assignmentId /* asg_… */; roleId; scope; addedBy; addedAt }
interface UserAccount   { userId; level; merchantId?; assignments: RoleAssignment[]; status; email; … }
```

Valid combinations (`validateAssignment` in `roles.ts`):

| Role | Allowed scope | Where | Refused with |
|---|---|---|---|
| Platform role | `ALL_MERCHANTS` only | Platform Users | "Platform roles are for platform users; merchant roles are for that merchant's users." |
| Merchant role (`level MERCHANT`) | `ALL_PROJECTS` only | Users | in Members: "Merchant roles are given on Users, not in Project › Members." |
| Project role (`level PROJECT`) | `PROJECTS`, one open project | Members | on Users: "Project roles are given in Project › Members, not on Users."; Custom role of another project: "This role belongs to another project."; archived project: "Archived projects keep their members but take no new ones." |
| Inactive role | — | — | "This role is inactive." |

The `projectIds` array in the prototype always has one element. **In the database, store a single nullable
`project_id`.**

---

## 6. Deciding access (the algorithm)

All of this is pure code in `src/domain/access.ts` and `src/domain/roles.ts`. It ports almost line for line.

### 6.1 Build the principal on every request

```
account  = load account by session user id          → missing: 403
merchant = account.merchantId ? load merchant : none
if merchant and merchant.status in (SUSPENDED, TERMINATED): 403 "…can't sign in" (every request, at once)
grants   = for each assignment: join its role; keep only ACTIVE roles
           → { roleId, roleName, permissions, scope }
```

Do this **per request**, or cache it with invalidation on every role and assignment change. Role edits must take
effect immediately (§4.3), so **don't bake permissions into a long-lived JWT.**

For any **mutation**, the account must also be `ACTIVE` (Pending and Suspended accounts change nothing).

### 6.2 Permissions in a project (merchant users)

```ts
// roles.ts permissionsIn: union of grants covering the project; merchant-level permissions count ONLY
// from the ALL_PROJECTS grant (the merchant role), never from a project role.
permissionsIn(grants, projectId) =
  ∪ { g.permissions.filter(p => g.scope.kind === 'ALL_PROJECTS' || !MERCHANT_LEVEL.has(p))
      for g in grants if covers(g.scope, projectId) }

covers(scope, projectId) = scope.kind === 'ALL_PROJECTS'
                        || (scope.kind === 'PROJECTS' && scope.projectIds.includes(projectId))
```

**Reaching a project at all** (`hasProject`): some grant covers it **and has at least one permission**. So a user
whose only role is Member reaches no project. Outside the projects they reach, a project and its cases are
"not found".

```ts
hasProject(user, project):
  SUPER_ADMIN    → true
  PLATFORM_STAFF → their role allows at least one project action (staff reach every project of every merchant)
  MERCHANT_USER  → user.merchantId === project.merchantId && some grant covers it with ≥1 permission
```

### 6.3 The four checks

```ts
canInProject(user, action, project):     // anything inside one project
  SUPER_ADMIN    → true
  PLATFORM_STAFF → any(staffPermissions, STAFF_NEEDS[action])          // same in every merchant
  MERCHANT_USER  → user.merchantId === project.merchantId && any(permissionsIn(grants, project), NEEDS[action])

canInMerchant(user, action, merchantId): // merchant-wide: Users, Roles, create project, merchant audit, billing
  SUPER_ADMIN    → true
  PLATFORM_STAFF → any(staffPermissions, STAFF_NEEDS[action])
  MERCHANT_USER  → user.merchantId === merchantId && any(merchantWidePermissions(grants), NEEDS[action])
                   // merchantWidePermissions = union of the ALL_PROJECTS grants = the merchant role

canOnPlatform(user, action):             // Merchants, Workflow Registry, Platform Users
  SUPER_ADMIN    → true
  PLATFORM_STAFF → any(platformLevelPermissions, STAFF_PLATFORM_NEEDS[action])   // manageStaff: never
  MERCHANT_USER  → false

projectsWhere(user, action, projects) = projects.filter(p => canInProject(user, action, p))
  // use it to scope every list query: WHERE project_id IN (…)
```

`NEEDS[action]` and `STAFF_NEEDS[action]` are **"any of"** lists. A View action is met by any permission of its
module (§7), so a user who can edit flows can always view them.

### 6.4 Granting rules ("give only what you hold", DEC-74)

```ts
canGrant(granter, permissions, scope):
  granter is SUPER_ADMIN or PLATFORM_STAFF → true   // internal accounts aren't limited by it
  scope ALL_MERCHANTS                       → false  // only super admins give platform access
  scope ALL_PROJECTS → every p in permissions ∈ merchantWidePermissions(granter.grants)
  scope PROJECTS     → for each project: every p ∈ permissionsIn(granter.grants, project)
```

It applies when giving a role (Users, Members) **and** when creating or editing a role (§4.3).

---

## 7. Action → permission map

The prototype checks **actions** (`PROJECT_ACTIONS`, `PLATFORM_ACTIONS` in `access.ts`). Each needs **any one** of the
listed permissions. "Checked with" says which function: P = `canInProject`, M = `canInMerchant`, PL = `canOnPlatform`.

| Action | Checked with | Merchant user needs any of | Platform staff needs any of |
|---|---|---|---|
| viewDashboards (Overview, System Intelligence) | P | VIEW_PROJECT_REPORTS, VIEW_MERCHANT_REPORTS | P_REPORTS_VIEW |
| viewBilling | P / M | VIEW_PROJECT_REPORTS, VIEW_MERCHANT_REPORTS, VIEW_BILLING, MANAGE_BILLING | P_BILLING_VIEW |
| exportReports | P | EXPORT_PROJECT_REPORTS, EXPORT_MERCHANT_REPORTS | P_REPORTS_EXPORT |
| createProjects | M | CREATE_PROJECTS | P_PROJECTS_CREATE |
| renameProjects / archiveProjects | P (merchant-level: merchant role only) | RENAME_PROJECTS / ARCHIVE_PROJECTS | P_PROJECTS_RENAME / _ARCHIVE |
| viewUsers | M | VIEW_USERS, INVITE_USERS, CHANGE_USER_ROLE, SUSPEND_USERS | P_USERS_* (any) |
| inviteUsers / changeUserRole / suspendUsers | M | INVITE_USERS / CHANGE_USER_ROLE / SUSPEND_USERS | P_USERS_INVITE / _CHANGE_ROLE / _SUSPEND |
| viewRoles | M | VIEW_ROLES, CREATE_ROLES, EDIT_ROLES, CHANGE_ROLE_STATUS | P_ROLES_* (any) |
| createRoles / editRoles / changeRoleStatus | M | CREATE_ROLES / EDIT_ROLES / CHANGE_ROLE_STATUS | P_ROLES_CREATE / _EDIT / _STATUS |
| manageBilling | M | MANAGE_BILLING | P_BILLING_MANAGE |
| viewMerchantReports | M | VIEW_MERCHANT_REPORTS | P_REPORTS_VIEW |
| viewMembers / manageMembers | P | VIEW_MEMBERS, MANAGE_MEMBERS / MANAGE_MEMBERS | P_MEMBERS_VIEW, _MANAGE / P_MEMBERS_MANAGE |
| viewProjectRoles | P | VIEW_PROJECT_ROLES, CREATE_/EDIT_/CHANGE_PROJECT_ROLE(_STATUS) | P_PROJECT_ROLES_* (any) |
| createProjectRoles / editProjectRoles / changeProjectRoleStatus | P | the matching one | the matching P_ one |
| viewIntegration / manageIntegration | P | VIEW_INTEGRATION, MANAGE_INTEGRATION / MANAGE_INTEGRATION | P_INTEGRATION_VIEW, _MANAGE / P_INTEGRATION_MANAGE |
| viewProjectSettings / manageProjectSettings | P | VIEW_PROJECT_SETTINGS, MANAGE_PROJECT_SETTINGS / MANAGE_PROJECT_SETTINGS | P_SETTINGS_VIEW, _EDIT / P_SETTINGS_EDIT |
| viewFlows | P | any Flows permission | any P_FLOWS_* |
| createFlows / editFlows / activateFlows | P | CREATE_FLOWS / EDIT_FLOWS / ACTIVATE_FLOWS | P_FLOWS_CREATE / _EDIT / _ACTIVATE |
| changeVerificationLevel | P | CHANGE_VERIFICATION_LEVEL | P_FLOWS_LEVEL |
| **setAdvancedThresholds** (custom thresholds) | P | **never** (merchant users can't) | P_LEVELS_CALIBRATE |
| viewRouting | P | any Flows or Project settings permission | any P_SETTINGS_* or P_FLOWS_* |
| viewCases (list) | P | VIEW_CASE_LIST, VIEW_CASE_DETAILS, CLAIM_CASES, DECIDE_CASES | P_CASES_* (any) |
| viewCaseDetails | P | VIEW_CASE_DETAILS, CLAIM_CASES, DECIDE_CASES | P_CASES_DETAILS, _CLAIM, _DECIDE |
| claimCase | P | CLAIM_CASES, DECIDE_CASES | P_CASES_CLAIM, _DECIDE |
| decideCase | P | DECIDE_CASES | P_CASES_DECIDE |
| viewAudit | P / M | VIEW_AUDIT_LOG | P_AUDIT_VIEW |
| viewMerchants / createMerchants / changeMerchantStatus | PL | — | P_MERCHANTS_VIEW (or _CREATE, _SUSPEND) / P_MERCHANTS_CREATE / P_MERCHANTS_SUSPEND |
| viewRegistry / manageRegistry | PL | — | P_REGISTRY_VIEW (or _MANAGE) / P_REGISTRY_MANAGE |
| manageStaff (platform users and roles) | PL | — | **never** (super admin only) |

---

## 8. Endpoints: what each one checks

Draft REST shapes are at the top of each `src/services/*Service.ts`. Error codes → HTTP in `src/services/errors.ts`:
`VALIDATION` 422, `FORBIDDEN` 403, `NOT_FOUND` 404, `NOT_CLAIMABLE` / `ALREADY_CLAIMED` / `NOT_CLAIM_OWNER` /
`OWNERSHIP_CONFLICT` 409.

| Endpoint (draft) | Check | Notes |
|---|---|---|
| `GET /verifications` | rows only from `projectsWhere(viewCases)` | Summary fields only (no personal data). Merchant users never see Internal-testing sessions (§9). |
| `GET /verifications/{caseId}` | 404 unless viewCases in the case's project; then 403 unless viewCaseDetails | Server writes `SENSITIVE_PII_VIEW` for **every** open. |
| `POST /verifications/{caseId}/claim` | claimCase | 409 if not PENDING_REVIEW or someone else holds an active claim. |
| `DELETE /verifications/{caseId}/claim` | ACTIVE account, case visible to you, and you hold the active claim | No supervisor force-release. |
| `POST /verifications/{caseId}/decision` | decideCase **and** an active claim of your own, re-checked at save | 409 `OWNERSHIP_CONFLICT` (audited `CASE_DECISION_BLOCKED`). |
| `GET /projects/mine` | `hasProject` | Drives the Merchants page and the header switchers. |
| `GET /projects/{id}` | `hasProject`, else 404 | |
| `POST /merchants/{id}/projects` | createProjects (M) | |
| `PATCH /projects/{id}` rename / `POST …/archive` | renameProjects / archiveProjects | Merchant-level: from the merchant role only. |
| Project settings, review operations, decision reasons (writes) | manageProjectSettings | Reads: viewProjectSettings. |
| `GET /projects/{id}/integration` / key, webhook and list writes | viewIntegration / manageIntegration | Response carries `canManage`. |
| `GET /projects/{id}/flows`, `GET /flows/{id}` | viewFlows | Hidden Internal-testing flows: 404 for merchant users. |
| `POST …/flows`, duplicate | createFlows | |
| `PUT /flows/{id}` | editFlows; **plus** changeVerificationLevel if thresholds, retries or risk minimums change; **plus** setAdvancedThresholds for custom (Advanced) values | Saving an active flow needs a reason and creates a revision. |
| `POST /flows/{id}/activate · retire · default` | activateFlows | |
| `GET /registry/selectable` | createFlows in some project | Who may pick a version: Active → everyone; Internal testing → internal users; Limited release → internal users + listed merchants (`selectableForNewFlow`). |
| `GET /registry`, `GET …/flows` / registry writes | viewRegistry / manageRegistry (PL) | |
| `GET/POST/PATCH /merchants`, status, owner invitation | viewMerchants / createMerchants / changeMerchantStatus (PL) | `GET /merchants/{id}`: internal users any merchant, merchant users their own, else 404. |
| `GET /users?merchantId=` / `GET /users/{id}` | viewUsers (M) | A user of another merchant: 404. Internal accounts are never listed here. |
| `POST /merchants/{id}/users` | inviteUsers (M) + `canGrant` for the chosen merchant role | Default role Member. Email rules (OQ-31). |
| `POST /users/{id}/invitation` | inviteUsers (M) | Pending users only; a resend replaces the old link. |
| `PUT /users/{id}/role` | changeUserRole (M) + `canGrant` + not yourself + last Owner remains | Releases lost claims. |
| `POST /users/{id}/suspend · reactivate` | suspendUsers (M) + not yourself + last Owner remains | Suspending releases all the user's claims. |
| `GET /projects/{id}/members` | 404 unless `hasProject`; 403 unless viewMembers | Lists project roles and the merchant-role users who reach the project ("inherited", read-only). |
| `POST /projects/{id}/members` | manageMembers + `canGrant` (that project) + not yourself + project ACTIVE | Project roles only. |
| `DELETE /projects/{id}/members/{uid}/{aid}` | manageMembers + not yourself + project ACTIVE | Only a project-role assignment of this project; the merchant role is changed on Users. Releases lost claims. |
| `GET /roles?merchantId=` | viewRoles (M) | Platform roles only for super admins. |
| `GET /projects/{id}/roles` | 404 unless `hasProject`; viewProjectRoles | System Default project roles + this project's Custom ones. |
| `POST /merchants/{id}/roles` (with `projectId` = project role) | createRoles (M) / createProjectRoles (P) + `canGrant` | Platform role (`audience PLATFORM`): manageStaff. |
| `PUT /roles/{id}`, `POST /roles/{id}/status` | editRoles / changeRoleStatus (or the project-role ones) | Platform roles: manageStaff (else 404). |
| `GET/POST /staff…` | manageStaff (super admin only), else **404** | The super admin appears as a fixed row; any change to it is 422. |
| `GET /audit` | see §9 | |
| `GET /analytics/*`, `GET /billing` | rows from `projectsWhere(viewDashboards)` / `projectsWhere(viewBilling)` | |

---

## 9. Visibility rules (what exists for whom)

- **404 vs 403.** Outside your scope (another merchant, a project you don't reach, a case in such a project, a hidden
  flow) → **404 "not found"**, so existence isn't revealed. Inside your scope without the permission → **403**.
  Example: a case in your project that you may list but not open → 403 "You can see this case in the list, but not its
  details."
- **Internal testing (DEC-56).** Merchant users never see flows on an `INTERNAL_TESTING` registry version, nor the test
  sessions run on one (`charged === false`): 404 everywhere, excluded from lists and filters. Internal users see both
  (`internalTestsFilter` in `accessGuard.ts`).
- **Audit log.** An entry with a project → visible with viewAudit in that project. An entry with only a merchant →
  visible with viewAudit at merchant level (merchant role, or staff). An entry with neither (platform events) → super
  admin only. Nobody with no viewAudit anywhere may call it (403).
- **Merchant admins never see platform things:** platform roles, platform staff and the super admin don't exist for
  them (404).
- **Archived projects** keep their members but are read-only: no adding or removing members.

---

## 10. Invariants and side effects

| Rule | Where in the prototype |
|---|---|
| Nobody changes their own access (role, suspend, members). | `notSelf` in `userAdminService.ts` |
| At least one Owner who isn't suspended must remain per merchant (Pending counts); a merchant that has none yet isn't blocked. | `lastOwnerError` in `roles.ts` |
| Exactly one merchant role per merchant user; exactly one platform role per staff member. | `setRole` replaces the assignment |
| A user who loses Claim/Approve in a project loses their open claims there; a suspended user loses all of them. Each release is audited `CASE_RELEASED`. Triggers: role change, suspend, member removed, **role edited**. | `releaseLostClaims` |
| A suspended or terminated merchant: every request of its users is refused at once (and its API keys stop). | `accountOf` in `accessGuard.ts` |
| Pending and suspended accounts can't change anything. In the real system, Pending can't sign in until the invitation is accepted. | `requireActive` |
| The super admin can't be created, changed or removed in the portal; recovery is an operations procedure. | `staffService.loadStaff` (422) |
| Every mutation writes an audit entry; access events: `USER_INVITED`, `USER_INVITATION_RESENT`, `USER_ACCESS_ADDED`, `USER_ACCESS_CHANGED`, `USER_ACCESS_REMOVED`, `USER_SUSPENDED`, `USER_REACTIVATED`, `ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_STATUS_CHANGED`; case page opens: `SENSITIVE_PII_VIEW`. Entries record the actor's role names in the project (`actorRole`, e.g. "Reviewer" or "Super admin"). | `src/domain/audit.ts`, `AUDIT_GROUPS` in `types.ts` |

**Deliberately not in the model** (don't build them): deny rules, access end dates, data masking, supervisor
reassign or force-release of claims, per-flow access, a "Project" role type, a role per user per project on the Users
screen, cross-merchant views for merchant users.

---

## 11. Suggested backend schema (not in the prototype; a starting point)

```sql
accounts (
  id            text primary key,          -- usr_…
  level         text not null check (level in ('SUPER_ADMIN','PLATFORM_STAFF','MERCHANT_USER')),
  merchant_id   text references merchants, -- required for MERCHANT_USER, null otherwise
  email         citext unique not null,
  full_name     text not null,
  status        text not null check (status in ('PENDING','ACTIVE','SUSPENDED')),
  invitation_id text, invited_at timestamptz not null, last_active_at timestamptz,
  check ((level = 'MERCHANT_USER') = (merchant_id is not null))
);
-- plus a partial unique index so only one SUPER_ADMIN row can exist

roles (
  id          text primary key,             -- rol_…
  audience    text not null check (audience in ('PLATFORM','MERCHANT')),
  level       text check (level in ('MERCHANT','PROJECT')),   -- null for PLATFORM
  merchant_id text references merchants,    -- null for System Default and platform roles
  project_id  text references projects,     -- Custom project roles only
  name        text not null,
  type        text not null check (type in ('SYSTEM_DEFAULT','CUSTOM')),
  status      text not null check (status in ('ACTIVE','INACTIVE')),
  created_at, created_by, updated_at, updated_by
  -- unique lower(name) per table: (audience, level, merchant_id, project_id)
);

role_permissions (role_id text references roles, permission text not null, primary key (role_id, permission));

role_assignments (
  id          text primary key,             -- asg_…
  account_id  text not null references accounts,
  role_id     text not null references roles,
  scope_kind  text not null check (scope_kind in ('ALL_PROJECTS','PROJECTS','ALL_MERCHANTS')),
  project_id  text references projects,     -- only for PROJECTS
  added_by    text not null, added_at timestamptz not null,
  check ((scope_kind = 'PROJECTS') = (project_id is not null))
);
-- one ALL_PROJECTS row per merchant user; one ALL_MERCHANTS row per staff member (partial unique indexes)
```

**Enforcement pattern that matches the prototype:**

1. Middleware builds the principal (§6.1) and rejects suspended merchants and unknown accounts.
2. One `authorize(principal, action, resource)` module mirrors `access.ts`. If the backend is TypeScript, port
   `access.ts`, `roles.ts` and `permissionMatrix.ts` as-is (they are pure, with no React and no I/O) together with
   their tests.
3. Handlers call `authorize` with an **action**, never a role name, then scope queries with
   `project_id IN projectsWhere(action)`.
4. Return 404 or 403 per §9. Write the audit entry in the same transaction as the change.

---

## 12. Pitfalls we already hit (read before coding)

1. **Checking role names.** Never `if (role === 'Reviewer')`. Roles are data and merchants create their own; check
   actions/permissions.
2. **Member is not "no account".** A Member reaches nothing until added in Members; the UI shows "You don't have
   access to any project yet".
3. **Merchant-level permissions from a project role.** They must be ignored even if one slips into the data (the
   prototype both refuses them on save and filters them at check time).
4. **Platform Admin ≠ Super admin.** The Platform Admin role can do everything **except** manage platform users and
   platform roles.
5. **Staff have no scope.** Their one role applies in every merchant, including future ones; there is no "selected
   merchants" anymore.
6. **Caching permissions.** A role edit, role change, suspension or member removal must take effect on the next
   request, and must release claims.
7. **Leaking existence.** Return 404, not 403, for anything outside the user's merchant or projects.
8. **Trusting the UI.** The mock's hidden buttons are convenience. Every endpoint must check again.
9. **Advanced thresholds.** Merchant users can never set custom threshold values, whatever their role.
10. **View implied by actions.** Checks accept any permission of the module for its View, so a stored role missing
    its View still behaves correctly.

---

## 13. Test accounts and expected results

Sign in to the prototype with `?as=<email>` on any URL (`npm run dev`). Expected behaviour, useful as backend test
cases:

| User | Access | Expect |
|---|---|---|
| Lim Wei Jie `weijie.lim@ekyc-platform.example` | Super admin | Everything; listed read-only on Platform Users; any change to him → 422 |
| Rizal Hakim `rizal.hakim@ekyc-platform.example` | Staff · Platform Admin | Everything in every merchant; Platform Users → 404/"No access" |
| Daniel Tan `daniel.tan@ekyc-platform.example` | Staff · Support | Any case page in any merchant (audited); can't claim; merchant administration and the registry refused |
| Marcus Lee `marcus.lee@ekyc-platform.example` | Staff · Implementation | Flows in any merchant (incl. Advanced thresholds); cases → 404 |
| Hannah Lee `hannah.lee@ekyc-platform.example` | Staff · Finance | Billing and reports only; no customer data |
| Tan Mei Ling `meiling.tan@atoz.example` | Owner (Atoz) | Everything in Atoz; can't change her own access; last Owner can't be removed |
| Lee Jia Hui `jiahui.lee@atoz.example` | Admin | Users, roles, projects, every project; sees Billing (through merchant reports) but can't manage billing |
| Muthu A/L Rajan `muthu.rajan@atoz.example` | Billing | Billing only |
| Grace Lim `grace.lim@atoz.example` | Auditor · Viewer in SME app | Case list in every Atoz project; case page in SME app only; Default case page → 403 |
| Aaron Teoh `aaron.teoh@atoz.example` | Custom "User Coordinator" | View and invite users, view roles; can't change roles |
| Ali Bin Ahmad `ali.ahmad@atoz.example` | Member · Reviewer in Default, Viewer in SME app | Claim and decide in Default; read-only in SME app; other merchants → 404 |
| Hafiz Bin Rahman `hafiz.rahman@atoz.example` | Member · Project Admin in SME app | Manages SME app (members, project roles, flows, keys); can't create projects (merchant-level) |
| Kenneth Ooi `kenneth.ooi@atoz.example` | Member · Developer in SME app | API keys; cases → 404 |
| Zainab Hassan `zainab.hassan@atoz.example` | Member · Fraud Checker in Default (Custom project role) | Only what that role holds |
| Chong Pei Shan `peishan.chong@atoz.example` | Pending | Can't change anything |
| Yap Li Wen `liwen.yap@atoz.example` | Suspended | Can't change anything |
| Lim Siew Mei `siewmei.lim@3nova.example` | Member · Reviewer in Wallet app and archived Pilot 2025 | Pilot 2025 members read-only |

More scenarios (A1–A26) with exact steps are in `docs/SCENARIOS.md`. Run the rules' tests with `npm test`
(`src/domain/access.test.ts`, `roles.test.ts`, `permissionMatrix.test.ts`, `src/services/accessGuard.test.ts`,
`staff.test.ts`, `userAdmin.test.ts`).

---

## 14. Where it lives in the prototype

| File | What it holds |
|---|---|
| `src/domain/types.ts` | `AccessLevel`, `Permission` lists, `Role`, `RoleAssignment`, `AssignmentScope`, `Grant`, `UserAccess`, `UserAccount` |
| `src/domain/permissionMatrix.ts` | The Roles-screen layout (modules × View × actions) and `IMPLIES` |
| `src/domain/roles.ts` | System Default roles, `grantsOf`, `permissionsIn`, `canGrant`, `validateAssignment`, `validateRole`, last-Owner rule |
| `src/domain/access.ts` | Actions, `NEEDS` / `STAFF_NEEDS`, `hasProject`, `canInProject`, `canInMerchant`, `canOnPlatform`, `projectsWhere` |
| `src/services/accessGuard.ts` | Principal per request (`accountOf`, `requireActive`), suspended merchants, internal-testing filter |
| `src/services/userAdminService.ts` | Users and Members endpoints with all their checks; `releaseLostClaims` |
| `src/services/roleService.ts` | The three role tables' endpoints |
| `src/services/staffService.ts` | Platform Users endpoints; the fixed super admin |
| `src/services/errors.ts` | Error codes → HTTP status |
| `src/app/nav.ts`, `src/app/access.tsx`, `src/app/Guarded.tsx` | UI only: which screen needs which action, menu hiding, "No access" page |

---

## 15. Notes for an AI coding assistant

- Read §6 and §7 before writing any authorization code; the functions there are the contract.
- Don't invent permissions, roles, statuses or scopes. If something isn't covered, ask, or add it to
  `docs/OPEN_QUESTIONS.md`.
- Always check an **action** against the principal; never compare role names or account emails.
- Keep 404 for "outside scope" and 403 for "in scope, not allowed".
- Every mutation: require an ACTIVE account, check the action, apply the invariants in §10, write the audit entry.
- Port the prototype's tests as the acceptance spec; their names are Given/When/Then.
