# Task 17 — UI Shell Reconciliation Against Reference Mockups

## Status

Done

## Why This Exists

A post-implementation audit (after tasks 00-15a) compared the running
frontend against the reference mockups in `docs/assets/references/`
(`process-list`, `process-form`, `process-detail`, `process-jobs`,
`inference-review` — both `.html` and image renders). Every mockup shows a
consistent **app shell**:

- A persistent **left sidebar**: `CL-IDP` / "ADMIN CONSOLE" branding, a
  primary "+ New Process" button, and nav items **Processes**, **Jobs**,
  **Settings** (with active-state highlighting).
- A **top bar**: a search input ("Search processes...", "Search..."),
  notification bell, help icon, and user avatar.

The actual implementation never built this shell. Every screen still
renders under `apps/web/components/app-header.tsx`, a **placeholder** left
over from task 09 (frontend scaffold) — a simple horizontal nav bar with
generic links, including a literal **hardcoded stub link**
(`{ href: "/processes/abc/jobs", label: "Jobs Stub" }`) that was never
replaced once real routes existed. This was not caught during tasks
10-13's verification because those tasks' Vitest suites test their own
page content in isolation (mocking the API), not the surrounding shell,
and manual walkthroughs focused on functional behavior rather than
pixel/structural comparison against `docs/assets/references/`.

Per-screen **content** structure (summary cards on process-jobs, two-pane
document+fields on inference-review, upload dropzone + recent-jobs table
on process-detail, etc.) was found to reasonably match the mockups'
information architecture already — this task is scoped to the **shell**
only, not a full redesign of already-working screen internals. If the
screen-by-screen detailed comparison in Subtask 3 below finds additional
structural mismatches beyond the shell, note them but only fix
low-risk/high-confidence visual deviations here; escalate anything
ambiguous or large rather than silently redesigning further (create
another follow-up task item, following the same reconciliation pattern
used for 01b/15a/15b, if scope grows materially).

## Spec References

- `docs/assets/references/*.html` and `*.jpg`/`*.png` — the authoritative
  visual reference for this task (open the `.html` files directly too;
  they may have cleaner markup/CSS to lift structure/spacing/color values
  from than reverse-engineering the raster images).
- `docs/spec/screen/*.md` — one file per screen; confirm the shell
  requirement is (or should be) reflected there. If the screen specs
  don't mention the shell explicitly, note that as a spec gap but still
  implement per the mockups (the mockups are the more concrete source of
  truth for shared chrome).
- `apps/web/components/app-header.tsx` — the current placeholder to
  replace.

## Scope

**In scope:**
- A new shared shell component (e.g. `apps/web/components/app-shell.tsx`
  or split into `app-sidebar.tsx` + `app-topbar.tsx`), applied in
  `apps/web/app/layout.tsx` so every route gets it automatically (do not
  hand-add it per-page).
- Sidebar: branding lockup, "+ New Process" primary button (links to
  `/processes/new`), nav items **Processes** (`/`), **Jobs** (needs a
  sensible target — there is no global cross-process jobs list route
  today; either link it to the most-recently-viewed process's jobs view,
  or treat it as a disabled/placeholder nav item with a tooltip
  explaining jobs are viewed per-process, whichever is more honest — do
  not fabricate a fake working link; note your choice and reasoning),
  **Settings** (same treatment — no settings screen exists in scope per
  `docs/plan/README.md`'s task index; either omit it, or add a clearly
  marked "not implemented in this demo" state — do not silently invent a
  settings screen). Active-route highlighting.
- Top bar: search input (can be a non-functional/UI-only affordance if no
  spec'd global search endpoint exists — check `docs/spec/api/openapi.yaml`
  first; if there's truly no backend for it, implement it as a disabled/
  placeholder control with a clear visual "not wired up" treatment rather
  than a fake input that silently does nothing when submitted), plus
  notification/help icons and a user avatar (static/placeholder content is
  fine — there's no auth/user system in scope).
- Remove the old `app-header.tsx` placeholder and its stub nav array
  entirely; update `apps/web/app/layout.tsx` and any tests
  (`app-header.test.tsx`) accordingly — replace with tests for the new
  shell component(s).
- Re-run every existing Vitest suite to confirm no regressions from the
  layout change (page-level tests should be unaffected since they test
  page content, but confirm).
- A visual/structural pass on each of the 5 screens against its reference
  image, fixing any additional high-confidence, low-risk deviations found
  (e.g. obviously wrong badge colors, spacing, missing icons) — but see
  the scope note above about not silently over-redesigning.

**Out of scope:** any new backend functionality (search, notifications,
settings) — this is a frontend chrome task only; a full pixel-perfect
redesign of already-functionally-correct screen internals.

## Dependencies

- Task 13 (all 5 screens' functional content must exist first).

## Subtasks

1. Read every reference mockup (`docs/assets/references/*.html` +
   images) side by side.
2. Build the shared shell component(s) and wire into `app/layout.tsx`.
3. Do a screen-by-screen comparison of each live route against its
   reference image; log every deviation found (shell and otherwise) in
   your summary, and fix the shell ones plus any other high-confidence/
   low-risk ones inline.
4. Remove the old placeholder header/nav and its tests; add new tests for
   the shell (nav links present, active-state highlighting, New Process
   button present and correctly linked).
5. Full regression: `npm run test`, `npm run lint`, `npx tsc --noEmit`.
6. Update `docs/plan/09-frontend-scaffold.md`'s DoD/status note to record
   that its placeholder header was superseded by task 17 (don't rewrite
   history — just add a note), and update this task's own file to Done.

## Acceptance Criteria

- **Given** any of the 5 implemented routes, **when** loaded, **then** the
  persistent left sidebar (branding, New Process, Processes/Jobs/Settings
  nav with correct active-state) and top bar (search/notification/help/
  avatar) are present, matching the reference mockups' structure.
- **Given** the old hardcoded `/processes/abc/jobs` "Jobs Stub" link,
  **when** the shell is rebuilt, **then** it no longer exists anywhere in
  the codebase.
- **Given** the full Vitest suite, **when** run after this change,
  **then** all tests pass (updated/replaced as needed for the removed
  header, unchanged for page-content tests).

## Test Instructions

```bash
cd apps/web
npm run test
npm run lint
npx tsc --noEmit
npm run dev
# Manually load each of the 5 routes and compare against
# docs/assets/references/*.{html,jpg,png} side by side.
```

## Definition of Done

- [x] Shared shell component built and applied via `app/layout.tsx` to
      all routes.
- [x] Old placeholder header/nav and its stub link fully removed.
- [x] Screen-by-screen comparison against every reference mockup
      performed and documented; high-confidence deviations fixed.
- [x] Full Vitest/lint/tsc regression passes.
