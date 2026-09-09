# Task 25 — Custom Analyzer Authoring: Frontend (List + Training Workbench)

## Status

Not Started

## Why This Exists

This is the frontend build for the two screens spec'd in this planning
pass: `docs/spec/screen/custom-analyzers-list.md` (browse/manage custom
analyzers) and `docs/spec/screen/analyzer-training.md` (the three-pane
schema authoring/testing/publishing workbench). Together they let an admin
train a new custom Content Understanding analyzer entirely from the web
UI and immediately use it from `process-form`'s existing allowed-analyzers
picker — closing the loop that today requires running
`apps/api/scripts/train_custom_analyzers.py` by hand. Depends on task 24
for the backend surface both screens call.

## Spec References

- `docs/spec/screen/custom-analyzers-list.md` — full screen spec (layout,
  status semantics, creation modal, search/filter, polling, delete/
  deprecate).
- `docs/spec/screen/analyzer-training.md` — full screen spec (three panes,
  schema/settings/knowledge/test tabs, save-draft-vs-publish semantics,
  grounding/bounding-box reuse from `inference-review`).
- `docs/assets/references/custom-analyzers-list.html` /
  `.png` and `docs/assets/references/analyzer-training.html` / `.png` —
  visual reference mockups for both screens (the analyzer-training mockup
  was user-provided; the custom-analyzers-list mockup was authored locally
  during this planning pass to match the same design system/tokens). The
  Stitch project's `analyzer-training` screen has been superseded by a
  **"(Refined)"** variant (screen id `803d373359ca47d38a5a5211da391849` in
  Stitch project `15423991453421027014`) that corrects the original
  mockup's "Partially labeled" per-sample chip (→ "Partially extracted",
  with a caption noting it reflects the last Test & Run outcome, not a
  manual label), adds a "Extraction preview — read only" badge to the
  document header, and adds a Suggest accept/reject popover — build
  against that refined screen, not the original. **Do not build a
  click/draw-to-label interaction on the document canvas**; see
  `analyzer-training.md`'s "Design principle" section — boxes are
  read-only Test-run results only, and fields are authored exclusively in
  the Schema tab's table.
- `docs/spec/screen/process-form.md` — updated in this planning pass with a
  note that only `ready` analyzers (prebuilt or custom) are ever offered in
  the allowed-analyzers picker; this task must make that true in practice.
- `docs/spec/screen/inference-review.md` — the grounding/bounding-box/
  paged-viewer conventions `analyzer-training`'s middle pane and Test & Run
  results reuse; do not reimplement a second overlay system, reuse/extract
  shared components where practical.
- `apps/web/components/app-shell.tsx` — the real sidebar/nav component;
  this task adds the new **Custom Analyzers** top-level nav item here.
- Task 17 (`docs/plan/17-ui-shell-reconciliation.md`) — the shared app
  shell both new screens must render inside, matching the same sidebar/
  header chrome as every other screen (not a standalone layout).

## Scope

**In scope:**

- New route(s) for `custom-analyzers-list` (e.g. `/custom-analyzers`) and
  `analyzer-training` (e.g. `/custom-analyzers/{analyzerId}`, plus a "new"
  variant for a freshly created draft), added to the real app shell/router
  alongside the existing Processes route (`apps/web/components/
  app-shell.tsx` today has only **Processes** enabled and a disabled
  **Settings** placeholder in the sidebar — there is no top-level **Jobs**
  item to mirror; job lists are nested under a specific process at
  `/processes/{id}/jobs`).
- New **Custom Analyzers** sidebar nav item in `apps/web/components/
  app-shell.tsx`, inserted above the disabled **Settings** placeholder,
  with active-route highlighting matching the existing pattern.
- The list screen: summary cards, search/status-filter (URL-synced),
  table/card-collapse responsive layout, row actions per status, the "New
  Analyzer" modal (client-side ID-rule validation per
  `custom-analyzers-list.md`), empty states, and `training`-row polling.
- The training workbench: left sample-document panel (upload/list/status/
  remove, with test-outcome chips — `not tested`/`fully extracted`/
  `partially extracted`/`no fields extracted`, never "labeled"), middle
  paged document preview (reusing the existing PDF/image viewer components
  from `inference-review` rather than forking them; no overlays until a
  Test has run, then read-only extraction-result boxes only), right
  tabbed panel (Schema grid with nested object/array editing, an add-field
  toolbar including **Suggest** for AI-assisted candidate fields with an
  accept/reject review list, Settings, Knowledge, Test), header status
  badge + Save Draft / Test & Run / Train-Publish actions, and the full
  draft/training/ready/failed lifecycle including polling and manual-
  refresh fallback after the 10-minute cap.
- Schema import/export as the exact `fieldSchema` JSON shape (round-trips
  with `train_custom_analyzers.py`'s payload shape).
- Test & Run results rendering reusing `inference-review`'s
  value/confidence/grounding/bounding-box components against the temporary
  test-analyzer results from task 24's API.
- Component and integration tests (Vitest) for both screens: list
  rendering/filtering/polling, creation modal validation, schema grid
  add/edit/delete/nested editing, save-draft vs publish state transitions,
  test-run result rendering, and error/timeout states.
- Confirming (manually or via the existing e2e conventions from task 15a)
  that a newly published `ready` custom analyzer actually appears and is
  selectable in the real `process-form` allowed-analyzers picker — this is
  the concrete proof the loop is closed.

**Out of scope:**

- The backend API itself (task 24) — this task consumes it.
- Any change to `process-form.md`'s existing analyzer-picker behavior
  beyond confirming the already-spec'd "only `ready` analyzers appear"
  note holds true against real custom analyzers.
- Building a UI to adopt/migrate the two script-created task-20 analyzers
  into the new draft/publish model — they can remain script-managed.
- CI dispatch (15b) — this task's verification follows the same
  local-only convention already established for every prior frontend task.

## Dependencies

- Task 24 (backend control-plane API).
- Task 13 (inference-review's viewer/grounding components, reused here).
- Task 17 (shared app shell, nav pattern).

## Subtasks

1. Add the `Custom Analyzers` route(s) and sidebar nav entry to
   `apps/web/components/app-shell.tsx` and the router.
2. Build `custom-analyzers-list`: summary cards, filter/search bar (URL-
   synced), table/card list, status badges, row actions, "New Analyzer"
   modal with client-side validation, empty states, `training`-row polling
   (5s interval, 10-minute cap, manual refresh after).
3. Build `analyzer-training`'s left pane (sample upload/list/status/remove)
   and middle pane (reuse/extract the PDF/image viewer from
   `inference-review` rather than duplicating it).
4. Build the Schema tab: field grid with type/method/description columns,
   add/delete/reorder, nested `object`/`array` expansion editors, `enum`/
   `examples` editing, import/export JSON round-tripping the exact
   `fieldSchema` shape, and the **Suggest** action (calls task 24's
   `suggest-fields` endpoint against the selected sample, renders returned
   candidates in an accept/reject review list, appends accepted rows to
   the grid as normal editable fields — never auto-applies).
5. Build the Settings tab (ID immutability after first save, reserved-
   prefix validation, base-analyzer read-only display) and the Knowledge
   tab (per-field long-form description/examples/enum editor writing back
   into the same schema object, per the spec's "no separate payload"
   decision).
6. Build the Test & Run flow: trigger, poll, and render results using
   `inference-review`'s existing value/confidence/grounding components
   against the normalized test-run response from task 24.
7. Build the Save Draft / Train-Publish header actions and the full status-
   badge lifecycle with polling/timeout/manual-refresh, matching
   `process-detail`'s established routing-analyzer polling pattern.
8. Tests: component/integration tests per the Scope section above.
9. Manual verification: create a real custom analyzer end-to-end through
   the UI against the live CU resource, publish it to `ready`, and confirm
   it is selectable in a real `process-form` session.

## Acceptance Criteria

- **Given** the app shell, **when** a user clicks the new **Custom
  Analyzers** nav item, **then** they land on the list screen matching
  `custom-analyzers-list.md`.
- **Given** the "New Analyzer" modal, **when** submitted with valid input,
  **then** the user lands on `analyzer-training` in a fresh draft state
  seeded with the submitted metadata.
- **Given** a draft with an authored schema and an uploaded sample, **when**
  "Test & Run" is used, **then** extracted fields render with confidence/
  grounding overlays on the document preview, matching
  `inference-review`'s conventions.
- **Given** a sample with no schema fields defined yet, **when** **Suggest**
  is used, **then** candidate fields are shown in a review list and only
  accepted ones are added to the schema grid — nothing is added
  automatically and no CU analyzer call is made.
- **Given** a draft, **when** "Train/Publish" is used, **then** the header
  status transitions `training` → `ready` (or `failed` with an inline CU
  error), polling and stopping per the documented cap.
- **Given** a `ready` custom analyzer created through this UI, **when** a
  user opens `process-form`'s allowed-analyzers picker, **then** the new
  analyzer is selectable, proving the authoring loop is fully closed.

## Test Instructions

```bash
cd apps/web
npm run test -- custom-analyzers analyzer-training
```

Manual (requires the full stack + task 24's API + live CU credentials):

```bash
docker compose up -d
cd apps/api && uv run uvicorn app.main:app --reload &
cd ../web && npm run dev &
```

Open `http://localhost:3000/custom-analyzers`, create a new analyzer,
upload a sample, define a small schema, Test & Run it, then Train/Publish
and confirm it reaches `ready`. Open `http://localhost:3000/processes/new`
and confirm the new analyzer appears in the allowed-analyzers picker.

## Definition of Done

- [ ] Both screens implemented and navigable from the real app shell.
- [ ] Schema grid supports the full nested object/array field model with
      import/export round-tripping `train_custom_analyzers.py`'s shape.
- [ ] Test & Run renders real extracted results with grounding overlays
      reused from `inference-review`.
- [ ] Save Draft / Train-Publish lifecycle and polling/timeout behavior
      verified.
- [ ] Component/integration tests pass for both screens.
- [ ] A real analyzer authored end-to-end through the UI reached `ready`
      and was confirmed selectable in `process-form`.
