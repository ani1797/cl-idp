# Task 10 — process-list & process-form Screens

## Status

Done

## Objective

Implement the two entry-point screens: the landing list of business
processes and the create/edit form, including analyzer selection, stale-
analyzer flagging, and threshold percentage conversion.

## Spec References

- `docs/spec/screen/process-list.md` — full screen spec.
- `docs/spec/screen/process-form.md` — full screen spec.
- `docs/spec/features/onboarding-business-process.md` — validation rules,
  uniqueness, stale analyzer handling.

## Scope

**In scope:**
- `process-list` (`/`): table/list from `GET /processes`, columns per
  spec, empty state, row → `process-detail` link, "New Process" →
  `process-form` create mode, per-row Edit/Delete actions (Delete confirms
  before calling `DELETE /processes/{id}` and warns about cascading job/
  document deletion).
- `process-form` (`/processes/new` and `/processes/[id]/edit`): single
  shared component for create/edit.
  - Fields: name, description, allowed-analyzers multi-select (populated
    from `GET /analyzers`, showing friendly name + description, `502`
    surfaced inline), confidence threshold (0-100% input, converted to/
    from 0-1 float at the API boundary), owner email.
  - react-hook-form + Zod client-side validation matching the spec's
    rules (required fields, at least 1 analyzer, threshold bounds, email
    format).
  - `409` on save (name collision) surfaced as a field-level error on the
    name input; other `4xx` surfaced via the shared error mechanism from
    task 09 using the body's `message`.
  - Edit mode pre-loads via `GET /processes/{id}`; any `allowedAnalyzerIds`
    entry absent from the current `GET /analyzers` response renders as a
    flagged, removable chip with an explanation.
  - On save success, navigate to `process-detail` for the saved process.
  - "Cancel" returns to `process-list` without saving.

**Out of scope:** upload/trigger UI and routing-analyzer status polling
(task 11 — process-form only *saves* the process, it doesn't poll
provisioning status); jobs table (task 12); review UI (task 13).

## Dependencies

- Task 03 (real `GET/POST/PUT/DELETE /processes`, `GET /analyzers`
  endpoints — can start against a stubbed/mocked API client before 03 is
  fully live, but full acceptance needs the real backend).
- Task 09 (scaffold, shared components, API client).

## Subtasks

1. Build `process-list` page: fetch, render table, empty state, Delete
   confirmation dialog wired to the real delete call.
2. Build the shared `ProcessForm` component with react-hook-form + Zod
   schema matching validation rules.
3. Wire the allowed-analyzers multi-select to `GET /analyzers`, rendering
   friendly name + description, excluding nothing extra (backend already
   filters `idp_` analyzers).
4. Implement threshold percentage ↔ float conversion at form submit/load
   boundaries.
5. Implement stale-analyzer chip rendering in edit mode (diff
   `allowedAnalyzerIds` against the fetched analyzer list).
6. Wire create/update submit handlers with `409`/other-`4xx` error
   surfacing.
7. Write Vitest component tests for: empty list state, populated list,
   delete confirmation flow, form validation errors, stale-analyzer chip
   rendering, threshold conversion round-trip.

## Acceptance Criteria

- **Given** no processes exist, **when** `process-list` loads, **then**
  the empty-state prompt is shown instead of an empty table.
- **Given** processes exist, **when** `process-list` loads, **then** each
  row shows name, description, allowed analyzers (from denormalized
  names), threshold as a percentage, owner email, and routing analyzer
  status.
- **Given** the "New Process" flow, **when** a valid form is submitted,
  **then** `POST /processes` is called with the threshold converted to a
  0-1 float, and on success the user lands on `process-detail`.
- **Given** a name that collides with an existing process, **when** save
  is attempted, **then** the name field shows a "name already in use"
  inline error without navigating away.
- **Given** an edit-mode load where a previously selected analyzer no
  longer appears in `GET /analyzers`, **when** the form renders, **then**
  that selection is shown as a flagged, removable chip with an
  explanation.
- **Given** a process row, **when** Delete is clicked and confirmed,
  **then** `DELETE /processes/{id}` is called and the row disappears from
  the list; canceling the confirmation makes no API call.

## Test Instructions

```bash
cd apps/web
npm run test -- process-list process-form
npm run dev &
```

Manual walkthrough (requires backend from tasks 02/03 running):
1. Open `http://localhost:3000` — confirm empty state.
2. Click "New Process", fill the form, submit — confirm redirect to
   `process-detail` and the new process appears back on `/`.
3. Try creating a second process with the same name — confirm the inline
   `409` error.
4. Edit the process, remove an analyzer, save — confirm
   `routingAnalyzerStatus` reset is visible on the next screen (task 11
   will render it, but the save call itself should succeed here).
5. Delete the process — confirm the confirmation dialog text names the
   process and warns about jobs/documents, then confirm removal.

## Definition of Done

- [x] Both screens implemented per spec with no scope bleed into upload/
      polling (task 11).
- [x] Client-side validation matches every rule in the feature spec.
- [x] Stale-analyzer chip behavior verified against a real removed
      analyzer (delete a custom analyzer in CU, or use a fixture ID).
- [x] Vitest component tests passing.
- [x] Manual walkthrough against the real backend completed and confirmed.
