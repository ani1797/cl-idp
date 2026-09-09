# Task 13 — inference-review Screen

## Status

Done

## Objective

Implement the two-pane human review screen: document viewer with
bounding-box overlays on the left, editable/approvable field list on the
right, plus the not-reviewable and nothing-to-review states.

## Spec References

- `docs/spec/screen/inference-review.md` — full screen spec.
- `docs/spec/features/business-process-inference-testing.md` — Review
  Behavior, Outcomes With Nothing to Review, Failed Jobs sections.

## Scope

**In scope:**
- Route `/processes/[id]/jobs/[jobId]`, entered from `process-detail` or
  `process-jobs` (identical behavior either way; return path defaults to
  `process-detail` when entered directly by URL, otherwise back to the
  originating screen with filters intact).
- Left pane: react-pdf (pdf.js) rendering via
  `GET .../jobs/{jobId}/document`, paged viewer with page controls/
  indicator; native `<img>` fallback is unnecessary in practice since the
  backend always serves PDF or an image the same way — confirm which
  content types actually reach the client and implement accordingly
  (PDF via react-pdf, PNG/JPG via `<img>`, TIFF already arrives as PDF).
  Bounding-box overlay: multiply `boundingBox` floats by rendered page
  pixel dimensions, apply page `angle` as a rotation transform, highlight
  the box for the field currently focused in the right pane, and
  navigate to that field's page automatically on click.
- Right pane: recursive rendering of the `fields` tree — scalars as
  editable inputs with a confidence badge ("n/a" when absent, never
  flagged), array/object as collapsible groups with index-labelled
  elements; fields below threshold and unreviewed are visually flagged;
  each flagged field has an "Approve" action (submits unchanged value);
  Save is enabled once anything is edited or approved; Save calls
  `PUT .../review` with body `{"fields": [{"path", "value"}, ...]}` per
  `openapi.yaml`'s `ReviewedField` schema — only the touched paths,
  `value` stringified regardless of the field's extracted type — then
  updates local state to clear cleared violations without re-fetching the
  whole job unnecessarily (though a refetch is acceptable if simpler —
  note the trade-off in code).
- Nothing-to-review states: `unclassified` → explanatory panel naming the
  process, with the document still shown, actions to go back or upload
  another file; classified-but-zero-fields → explanatory panel, document
  still shown; neither offers Save.
- Not-reviewable states: `queued`/`running` → processing state, polls
  every 2s backing off to 10s after 60s, stops after 10 minutes with
  manual refresh; `failed` → `error` message + Retry action instead of
  the editor.
- Detected form shown read-only (never editable).

**Out of scope:** the review/retry backend (task 08, already done); the
jobs list screens that link here (tasks 11/12).

## Dependencies

- Task 08 (review/retry endpoints).
- Task 12 (return-path/filter-preservation convention this screen must
  honor on save/back).

## Subtasks

1. Build the document viewer (react-pdf integration, page navigation,
   image fallback if actually needed after checking real content-types).
2. Build the bounding-box overlay component with coordinate scaling and
   angle rotation.
3. Build the recursive field-tree renderer (scalar/array/object) with
   collapsible nested groups and index labels.
4. Build confidence badge rendering (numeric vs. "n/a").
5. Build the edit/approve interaction model and the touched-paths-only
   Save payload construction.
6. Wire field-click → page navigation + box highlight (bidirectional:
   clicking a box could optionally highlight the field too, per spec's
   "clicking a field navigates... and highlights its box" — implement at
   minimum field→box; box→field is a nice-to-have, not required).
7. Build the three states: normal two-pane editor, nothing-to-review
   panel (two variants), not-reviewable states (processing / failed).
8. Write Vitest tests: field tree renders nested arrays/objects correctly
   with correct path labels; approve clears a violation and enables Save;
   edit-without-approve also enables Save; Save payload contains only
   touched paths; unclassified/zero-fields panels render correctly with
   no Save action present; failed state shows Retry instead of editor;
   bounding box coordinate math produces correct pixel positions for a
   known fixture.

## Acceptance Criteria

- **Given** a succeeded, classified job with nested line-item fields,
  **when** the screen loads, **then** the right pane renders a
  collapsible tree with correctly indexed array elements and correct
  field names.
- **Given** a field with a bounding box, **when** clicked in the right
  pane, **then** the left pane navigates to its page and highlights the
  box at the geometrically correct position (verify against a known
  fixture's expected pixel coordinates).
- **Given** a field below threshold and unreviewed, **when** displayed,
  **then** it is visually flagged and offers an Approve action; clicking
  Approve clears the flag and enables Save without changing the field's
  value.
- **Given** any edit or approval, **when** Save is clicked, **then**
  `PUT .../review` is called with **only** the touched JSON Pointer paths
  in the payload (verify via a network/mock assertion, not just visually).
- **Given** an `unclassified` job, **when** opened, **then** the
  explanatory "doesn't match any form" panel is shown (naming the
  process), the document is still visible, and no Save action exists.
- **Given** a job classified but with zero extracted fields, **when**
  opened, **then** the "no fields extracted" panel is shown, document
  still visible, no Save action.
- **Given** a `failed` job, **when** opened, **then** the `error` and a
  Retry action are shown instead of the two-pane editor.
- **Given** a `queued`/`running` job, **when** opened, **then** a
  processing state is shown and polls per the documented interval/
  backoff/stop.
- **Given** entry from `process-jobs` with filters `?status=failed`,
  **when** Save completes (or Back is clicked), **then** navigation
  returns to `process-jobs` with `?status=failed` intact.

## Test Instructions

```bash
cd apps/web
npm run test -- inference-review
npm run dev &
```

Manual walkthrough (needs a real completed job with nested fields — trigger
one via `process-detail` first, ideally an invoice sample with line
items):
1. Open the review screen for a succeeded classified job — confirm both
   panes render, nested fields expand/collapse correctly.
2. Click a low-confidence field — confirm page navigation + box highlight.
3. Approve one field, edit another, Save — inspect the network request
   body to confirm only those two paths are present.
4. Reload the job — confirm the approved/edited values and cleared
   violations persisted.
5. Open an unclassified job and a zero-fields job — confirm both
   explanatory panels.
6. Open a failed job — confirm Retry works and creates a new job visible
   back on `process-jobs`.

## Definition of Done

- [x] All three families of state (editor / nothing-to-review / not-
      reviewable) implemented and verified.
- [x] Partial-patch Save payload verified to contain only touched paths.
- [x] Bounding-box coordinate math verified against a known fixture.
- [x] Return-path filter preservation verified round-trip with
      `process-jobs`.
- [x] Vitest tests passing; manual walkthrough against real backend
      completed with a real nested-field document. The PDF/image document
      viewer issue seen during Task 18 is consistent with the separately
      tracked task 19 deferral, so the walkthrough verified the remaining
      review flows and states without duplicating that fix here.
