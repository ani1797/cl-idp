# Task 29 — Enforce roleLabel-based RBAC and Fix Broken Analyzer Picker

## Status

Done

## Why This Exists

Two issues were reported together:

1. `roleLabel` on users was a free-text, display-only field — anyone could
   type any string (e.g. "Operations Lead") and it had zero effect on
   what the UI or API allowed them to do. The user asked for **proper
   RBAC** built on this field.
2. The "New Process" form's analyzer picker (`process-form.tsx`) got
   permanently stuck showing nothing useful whenever
   `GET /analyzers` failed (e.g. Content Understanding unavailable) —
   there was no retry affordance, so a transient/backing-service failure
   permanently blocked process creation until a full page reload.

## Permission Matrix (adopted)

Three canonical role labels, enforced identically on the backend and
mirrored on the frontend:

| Capability | IT Admin | Reviewer | End User |
|---|---|---|---|
| View dashboard / processes | ✅ | ✅ | ✅ |
| Create / edit / delete processes | ✅ | ❌ | ❌ |
| Upload documents / trigger a run | ✅ | ✅ | ✅ |
| View Form Models | ✅ | ✅ | ❌ |
| View Review Queue | ✅ | ✅ | ❌ |
| Approve / reject / reset / retry a job | ✅ | ✅ | ❌ (read-only job view) |
| View API & Integrations | ✅ | ❌ | ❌ |
| Manage users (`/admin/users`) | ✅ | ❌ | ❌ |

This was adopted without an explicit user confirmation round-trip (the
`ask_user` prompt for it went unanswered); flag for review if the actual
intent differs.

## What Changed

### Backend (`apps/api`)

- `UserRole` `StrEnum` (`IT Admin` / `Reviewer` / `End User`) is now the
  canonical type for `roleLabel` everywhere it's stored or returned.
- `app/authz.py`: `current_user` dependency (session cookie or
  `SERVICE_API_TOKEN`) + `require_roles(*roles)` dependency factory.
- Gated with 403 (existing error envelope):
  - `routers/users.py` — all user CRUD requires `IT Admin`.
  - `main.py` — `POST/PUT/DELETE /processes` requires `IT Admin`.
  - `routers/jobs.py` — `PUT .../review` and `POST .../retry` require
    `IT Admin` or `Reviewer`.
- Read-only aggregation endpoints (`GET /analyzers`,
  `GET /processes/{id}/jobs`, individual job reads) are **not**
  backend-restricted by role — they're shared across pages with
  different visibility rules, and enforcement for those views is
  frontend-only (nav + route guard). Anything mutating is backend-enforced;
  this is the real security boundary.
- `apps/api/tests/test_rbac.py` — 10 new tests covering allow/deny for
  each mutating endpoint per role, plus the service-token bypass path.

### Frontend (`apps/web`)

- `lib/roles.ts` — `USER_ROLES`, `UserRole`, `Capability` union
  (`processes:write`, `users:manage`, `review:act`, `form-models:view`,
  `review-queue:view`, `integrations:view`), `ROLE_CAPABILITIES` map,
  `hasCapability()`. Single source of truth for all frontend gating.
- `lib/navigation.ts` — nav items carry a `capability`; added
  `navItemsForRole()` (drives sidebar filtering) and
  `capabilityForPath()` (drives route-guard redirects).
- `components/app-shell.tsx` — `AppSidebar` takes a `role` prop, filters
  nav via `navItemsForRole`, hides "New Process" unless
  `hasCapability(role, "processes:write")`.
- `components/providers/route-guard.tsx` — redirects unauthenticated
  users to `/login`; redirects authenticated users lacking the
  capability required for the current path to `/`.
- `lib/api.ts` — `AuthUser` / `CreateUserInput` / `UpdateUserInput`
  `roleLabel` typed as `UserRole` (was `string`).
- `components/users-admin-page.tsx` — role field is now a locked
  3-option `Select` (`IT Admin` / `Reviewer` / `End User`), replacing the
  old freeform input with ad-hoc suggestions like "Operations Lead" /
  "Claims Lead" that had no backing meaning.
- Capability gating added to `process-list-page.tsx` (New Process,
  per-row Edit/Delete), `process-detail-page.tsx` (Edit/Delete),
  `process-jobs-page.tsx` (Retry), `inference-review-page.tsx`
  (`canReview` threaded into `FieldTree`/`ReviewPanel` — disables
  per-field approve + inputs, hides the Reject/Reset/Apply & Approve
  footer entirely for read-only roles with an explanatory message
  instead).
- `components/process-form.tsx` — fixed the reported bug: the analyzer
  picker's error state now renders a working **"Try again"** button that
  re-triggers the `GET /analyzers` fetch, instead of leaving the form
  permanently stuck.

### Tests added/updated

- `apps/api/tests/test_rbac.py` (new, 10 tests).
- `apps/web/components/providers/route-guard.test.tsx` — capability
  redirect cases (End User denied `/admin/users`, IT Admin allowed).
- `apps/web/components/app-shell.test.tsx` — nav filtering per role.
- `apps/web/components/users-admin-page.test.tsx` — role selector
  offers exactly the 3 canonical options.
- Fixed 4 pre-existing test files that rendered pages with
  `renderWithQueryClient` (no session context) instead of
  `renderWithSession`, which broke once those pages started calling
  `useSession()` for capability checks.
- `apps/web/vitest.setup.ts` — jsdom polyfills for `scrollIntoView` and
  pointer-capture APIs, required by Radix `Select` in tests (benefits any
  future Radix popover/select test).

## Verification

- API: `uv run pytest -q` → 168 passed, 13 skipped (pre-existing
  `@pytest.mark.live` CU-dependent skips).
- Web: `npx tsc --noEmit` clean; `npx vitest run` → 76/76 passed;
  `npm run lint` clean; `npm run build` succeeded.
- Full `docker compose --profile app` rebuild + `up`; at the time this
  section was first written, `seed` failed on CU analyzer training and
  was assumed to be an unfixable sandbox network limitation. That
  assumption was **wrong** and was corrected in a follow-up pass (see
  task 30) — the real cause was a misconfigured `CU_ENDPOINT`. With the
  fix, `seed` completes with exit code 0 and every custom analyzer
  trains successfully against live CU.
- Live Playwright pass logged in as each of the 3 demo users
  (`it.admin@canadalife.demo`, `reviewer@canadalife.demo`,
  `end.user@canadalife.demo`, all `DemoPass123!`):
  - End User: nav hides Users/Review Queue/Form Models/Integrations and
    "New Process"; `/admin/users` and `/processes/new` redirect to `/`;
    process detail hides Edit/Delete but keeps upload; review workbench
    is fully read-only.
  - Reviewer: nav shows Form Models + Review Queue but not Users; review
    workbench is fully editable (Reject/Reset/Apply & Approve present).
  - IT Admin: full nav; `/processes/new` analyzer picker correctly shows
    the loading → error → **working retry** sequence (confirms the
    reported bug is fixed); `/admin/users` list renders all users;
    **created a new user end-to-end** through the dialog (role dropdown
    → submit → toast → appears in table) confirming the full RBAC round
    trip.
  - Direct `curl` check confirmed backend enforcement independent of the
    UI: logged in as End User, `GET /users` → 403, `DELETE /processes/{id}`
    → 403.

## Follow-ups / Open Items

- The permission matrix above was adopted without explicit user
  sign-off; re-confirm if requirements differ (e.g. whether Reviewers
  should see Integrations, or End Users should see Form Models
  read-only).
- No user-delete endpoint exists — deactivation (`PATCH /users/{id}`)
  is the only lifecycle operation; this was pre-existing and out of
  scope here.
