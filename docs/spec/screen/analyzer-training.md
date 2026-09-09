---
page: analyzer-training
---

## Status: not yet implemented

Nothing in this spec exists in the app today: no `/custom-analyzers` route
in `apps/web`, no `/custom-analyzers` router in `apps/api` (only `jobs.py`
and `trigger.py` exist there), no analyzer/sample persistence. Custom
analyzers are currently created entirely out-of-band by running
`apps/api/scripts/train_custom_analyzers.py` directly against Content
Understanding. This spec, `custom-analyzers-list.md`, and their two backing
plan docs (`docs/plan/24-custom-analyzer-authoring-api.md`,
`docs/plan/25-custom-analyzer-authoring-ui.md`) are one coherent design —
they are written and must evolve together. There is no `.bak`/deferred
prior draft anymore: an earlier planning pass produced two divergent
versions (a minimal single-page one and a three-pane one closer to the
visual mockup); this revision reconciles them into a single target design,
scoped to real backend work rather than to what happens to exist in
`apps/web/components/ui` today.

## Design principle: schema-defined extraction, not manual labeling

**This is the load-bearing correction in this revision.** Azure AI Content
Understanding's schema-based custom analyzers (the kind
`train_custom_analyzers.py` already proves out) are configured entirely by
a `fieldSchema` — each field has a `type`, `method`
(`extract`/`generate`), and `description`; CU locates and extracts values
itself. There is **no manual bounding-box labeling step**, unlike
classic trained-per-example document-model products. The reference mockup
(`docs/assets/references/analyzer-training.html`) visually implies the
opposite — hand-drawn-looking labeled boxes on the document canvas and a
per-sample "Partially labeled" status — borrowed from that older paradigm.
This spec corrects it:

- **Fields are authored exclusively in the Schema tab's table**, never by
  clicking or drawing on the document canvas.
- **Bounding boxes on the document canvas are read-only extraction
  results**, populated only after a **Test** run against a real (or
  temporary) analyzer, using the exact same grounding conventions
  `inference-review` already implements (`boundingBox` as eight 0–1
  page-relative floats, page `angle` correction, click-a-field-to-highlight
  navigation). Before any successful test, the canvas shows the document
  with no overlays at all.
- Per-sample status language reflects **test outcomes**, not "labeling":
  `not tested` / `fully extracted` / `partially extracted` / `no fields
  extracted` (definitions under Left pane below) — not "labeled" /
  "partially labeled".
- The mockup must be corrected to match (see the companion Stitch-screen
  update); do not build the "click the canvas to draw a field box" flow
  described nowhere in the backend and contradicted by how CU actually
  works.

## Goal

Let an admin define a custom analyzer's field schema, iterate on it against
real sample documents, and publish it to Content Understanding — entirely
from the web UI, closing the loop that today requires running the Python
script by hand. Entered from `custom-analyzers-list` via **New Analyzer**
(see that spec's creation dialog), which hands off analyzer ID, display
name, base analyzer, and description, then creates a draft and navigates
here.

## Interaction model at a glance

Two persistence layers, kept deliberately distinct so an admin can safely
iterate without every keystroke touching the live CU resource:

1. **Draft** (app-owned, `customAnalyzers` container + sample blobs):
   holds in-progress schema edits, uploaded sample documents, and cached
   test-run summaries. Editing anywhere on this screen mutates the draft in
   memory; **Save Draft** persists it. No CU call happens on save.
2. **Live analyzer** (CU-owned, addressed by the immutable analyzer ID):
   only touched by **Test & Run** (against a hidden, app-owned *temporary*
   analyzer derived from the draft) and **Train / Publish** (against the
   real, user-visible analyzer ID). Both use
   `create_or_replace_analyzer(..., allowReplace=true)`, the same call
   `train_custom_analyzers.py` already uses.

This mirrors how `process-detail`/`process-form` already separate editable
process config from the provisioned routing analyzer, so the mental model
is consistent across the app rather than novel to this screen.

## Layout

Three panes, matching the mockup's structure (not its labeling semantics):
left sample library, middle document preview, right tabbed schema/settings/
knowledge/test workspace. Rendered inside the shared app shell (task 17),
not a standalone layout.

- **Header**: breadcrumb `Processes > Custom Analyzers > Train Form Model`;
  editable display-name title; immutable analyzer-ID subtitle once the
  draft has been saved the first time. Status badge reflects the real
  lifecycle: `draft` (exists only in app storage, never published),
  `training` (`create_or_replace_analyzer` submitted for the live ID,
  polling in flight), `ready` (live analyzer provisioned and selectable by
  processes), `failed` (last publish attempt ended in a terminal CU error,
  **Retry Publish** stays available). A `ready` analyzer with unsaved draft
  edits shows `ready` plus an inline "unsaved changes" note rather than a
  separate status.
- **Actions**: **Export Schema**, **Save Draft**, **Test & Run** (disabled
  until at least one sample is uploaded and the schema passes client-side
  validation; see Schema tab), **Train / Publish** (primary).

## Left pane — sample documents

A persistent sample-library sidebar belonging to the draft, not the live
analyzer.

- **Upload**: drag-and-drop zone plus **Browse** button. Accepts PDF, PNG,
  JPG, TIFF; same 20 MB / 20 page limits and validation wording as
  `process-detail`.
- **Storage**: samples belong to the draft record and remain available
  across sessions so an admin can keep a stable regression set while
  iterating on the schema. Removing a sample deletes only the app-stored
  fixture, never anything in CU.
- **Row content**: filename, page count, last-test-outcome chip, selected
  state. The selected row drives the middle preview and is the default
  target for **Test & Run**.
- **Per-sample test-outcome chip** (populated once the draft has a schema
  and has been tested at least once against this sample):
  - `not tested` — no completed test run against the current draft
    revision.
  - `fully extracted` — every defined top-level field produced a
    non-empty value.
  - `partially extracted` — at least one top-level field produced a
    non-empty value, but at least one other came back empty.
  - `no fields extracted` — CU returned no populated top-level values.

  Population uses the same emptiness rule as the training script: a field
  object with a `confidence` but no populated `value*` counts as empty.
- **Sample actions**: remove, replace file, re-run latest test.
- **Empty state**: explains that samples are optional for publish but
  required for **Test & Run** and for the **Suggest** action (below).

## Middle pane — document preview

Reused conceptually from `inference-review`, pointed at sample documents
and draft test results instead of completed job results.

- **Rendering**: PDFs via the same paged pdf.js/react-pdf path as
  `inference-review`; PNG/JPG via the native-image path; TIFF via the same
  PDF-converted-document endpoint convention already used for job review.
  Extracting `PdfDocumentViewer`/`ImageDocumentViewer` out of
  `inference-review-page.tsx` into a shared component is in scope here
  since both screens now need them.
- **Controls**: page navigation, page indicator, zoom, fit-to-width,
  rotate; multi-page samples keep the selected page when switching tabs.
- **No test yet**: the viewer renders the plain document with **no
  overlays** — there is nothing to overlay before a schema has been tested.
- **After a successful Test**: the viewer overlays extracted field
  locations, read-only, using `inference-review`'s exact grounding
  conventions: `boundingBox` as eight 0–1 page-relative floats, page
  `angle` applied for rotated/skewed scans, clicking a field row in the
  Test tab navigates to its page and highlights its box. Fields with no
  bounding box are listed but not highlightable. `generate` fields show
  value-only results (no box, no confidence).
- The canvas is **never** a click-or-drag input surface for defining
  fields; all schema authoring happens in the right pane.

## Right pane — tabs

### Schema tab

The primary editor, owning the exact `fieldSchema` object CU expects,
matching `field_definition(...)` in `train_custom_analyzers.py`
field-for-field.

- **Toolbar**: **Add field**, **Suggest**, **Import**, **Export**, **Schema
  settings**.
  - **Add field**: appends an empty row to the table.
  - **Suggest** *(new in this revision)*: sends the currently selected
    sample document to
    `POST /custom-analyzers/{analyzerId}/suggest-fields`, which asks the
    resolved completion model (`resolve_completion_model_name()`) to
    propose candidate fields (`name`, `type`, `method`, `description`,
    inferred `enum`/`examples` where obvious) from the document's visible
    content. Results open in a **review list** (not auto-applied): each
    suggestion shows name/type/description with **Accept** / **Reject**
    per row and an **Accept all** action; accepted suggestions are appended
    to the schema table as normal, editable rows. Requires at least one
    uploaded sample; disabled otherwise with an inline hint. This is
    explicitly an authoring aid, not a training input — it never talks to
    the live or temporary analyzer, only the completion model.
  - **Import**: accepts a `fieldSchema` JSON file/paste, validates it, and
    normalizes the grounding convention (`extract` →
    `estimateSourceAndConfidence: true`).
  - **Export**: downloads the exact `fieldSchema` JSON so it can be pasted
    directly into `train_custom_analyzers.py` or checked in as an artifact.
    This is the same action as the header's **Export Schema** button.
  - **Schema settings**: opens the top-level `fieldSchema.name` /
    `fieldSchema.description` fields (defaulting to the analyzer's display
    name/description).
- **Table columns**: field name, description, value type
  (`string | date | number | boolean | array | object`), method
  (`extract | generate`), and a derived **Source & Confidence** indicator
  (checkbox/read-only marker showing `Extract → source + confidence`,
  `Generate → none`) — not independently toggleable, since every `extract`
  field is always serialized with `estimateSourceAndConfidence: true` and
  `generate` fields never carry it.
- **Ordering**: add, delete, and drag-reorder rows; export preserves table
  order so a schema round-trips predictably with the Python script.
- **Nested fields**: `object`/`array` rows show a **view nested schema**
  icon that expands a child sub-table for `properties`/`items`, letting an
  admin build genuinely nested trees (for example arrays of objects, such
  as line items) rather than only the flat + inline-JSON-escape-hatch model
  from the earlier draft of this spec.
- **Method constraint**: `generate` is only allowed on leaf fields (no
  `properties`/`items`); `array`/`object` are `extract`-only, enforced
  client-side before Test/Publish.
- **Validation**: field names required/unique among siblings; descriptions
  required; `enum` only on scalar leaf fields; `array` requires `items`;
  `object` requires at least one property before Test/Publish.

### Settings tab

- **Analyzer ID**: editable only until the first successful **Save Draft**;
  immutable after. Alphanumeric + underscore only, no hyphens; blocks
  `idp_*` prefix, `other`, and any `createdBy: cl-idp` tag collision,
  matching `apps/api/app/cu/catalog.py` / `ids.py`.
  - **Display name**, **description**.
- **Base analyzer**: fixed to `prebuilt-document`, read-only — the only
  base the app's working analyzers use.
- **System-managed callouts** (read-only): resolved completion model
  (`resolve_completion_model_name()`), last published timestamp, last CU
  error, and a reminder that UI-managed tags must not collide with
  `createdBy: cl-idp` or the analyzer would be filtered out of
  `GET /analyzers`.

### Knowledge tab

A focused, larger-form editor for the currently selected field's
long-form hints — not a second source of truth, and not an unrelated
document-library/RAG feature despite the tab name inherited from the
mockup.

- Long-form description editor, ordered `examples` list editor, `enum`
  value list editor (when closed-set), a read-only preview of the exact
  JSON fragment that will be emitted for that field, and — for
  object/array fields — a tree view to navigate child properties/items.
- Writes back into the same `fieldSchema` object the Schema tab edits;
  there is no separate Knowledge payload or API resource.

### Test tab

Renders results from the most recent **Test & Run** against the currently
selected sample (see "Test & Run" below for the flow). Leaf `extract`
fields show value + confidence badge + click-to-highlight; object/array
results render as collapsible groups; `generate` fields show value with
`n/a` confidence; a field returned as a typed object with confidence but
no value is shown as empty, not as a success (matching the script's
`has_value()` rule).

## Test & Run

Validates the **draft** against a stored sample before deciding to
publish.

- **Save-before-test**: if there are unsaved schema/settings changes,
  **Test & Run** first saves the draft locally, so sample statuses and
  overlays are always reproducible against a persisted revision.
- **Flow**, against a hidden, app-owned **temporary** analyzer derived from
  the draft (never the user-visible published ID, so draft experimentation
  never disturbs a `ready` analyzer already in use by processes):
  1. `create_or_replace_analyzer(temporaryTestAnalyzerId, payload,
     allowReplace=true)` — same payload shape as publish
     (`baseAnalyzerId: "prebuilt-document"`, resolved completion model,
     current `fieldSchema`). The temporary ID uses the app-owned
     `idp_*` / `createdBy: cl-idp` convention so it never appears in
     `GET /analyzers`.
  2. Poll `wait_for_analyzer_terminal_status` equivalent every ~2 seconds,
     capped at 10 minutes with manual-retry fallback.
  3. `analyze_binary(temporaryTestAnalyzerId, fileBytes, contentType)` on
     the selected sample.
  4. Poll `get_analyzer_result(operationId)` every ~2 seconds until
     `Succeeded`/`Failed`, same 10-minute cap.
  5. Render results in the Test tab and as overlays in the middle pane;
     update the sample's test-outcome chip in the left pane.
- **Failure states**: temporary-analyzer provisioning failure and analysis
  failure both show the CU error body `message` inline; timeout stops
  polling and offers manual refresh/retry.

## Train / Publish

- **Action**: submits the current draft's `fieldSchema` and description via
  `create_or_replace_analyzer(analyzerId, payload, allowReplace=true)` —
  the real, user-visible analyzer ID — exactly mirroring
  `AnalyzerSpec.payload()` in the script.
- **Polling**: badge flips to `training`; poll every ~2 seconds, cap at 10
  minutes with manual refresh, land on `ready` or `failed`.
- **Ready**: only `ready` means `GET /analyzers` returns this analyzer and
  `process-form` can select it.
- **Retry**: from `failed`, retry repeats create-or-replace unchanged or
  after edits. A failed republish of an already-`ready` analyzer leaves the
  last successfully published definition live and usable by existing
  processes — the failure is an admin action item, not a forced outage.

## Data / API needs

New, additive endpoints — no change to `GET /analyzers`'s existing
filtering contract beyond what's noted in `custom-analyzers-list.md`.

- **Draft resource**: `POST /custom-analyzers` (create shell from the list
  screen's hand-off), `GET /custom-analyzers/{analyzerId}`,
  `PUT /custom-analyzers/{analyzerId}` (save schema/metadata).
- **Samples**: `POST /custom-analyzers/{analyzerId}/samples`,
  `DELETE /custom-analyzers/{analyzerId}/samples/{sampleId}`,
  `GET /custom-analyzers/{analyzerId}/samples/{sampleId}/document`.
- **Suggest**: `POST /custom-analyzers/{analyzerId}/suggest-fields` — body
  references an uploaded `sampleId`; returns a list of candidate field
  definitions for review (never mutates the draft directly).
- **Test**: `POST /custom-analyzers/{analyzerId}/test-run` (save-if-needed,
  create/replace temporary analyzer, run `analyze_binary`, return a
  pollable run resource), `GET /custom-analyzers/{analyzerId}/test-run/{runId}`.
- **Publish**: `POST /custom-analyzers/{analyzerId}/publish`,
  `GET /custom-analyzers/{analyzerId}/publish-status` (reopening mid-
  operation after a reload).

These must stay consistent with `apps/api/app/cu/catalog.py`'s existing
`idp_*` prefix / `createdBy: cl-idp` exclusion rules, and are specified in
full (container shape, blob layout, OpenAPI paths) in
`docs/plan/24-custom-analyzer-authoring-api.md`.

## Validation, errors, and concurrency

- **Client-side blocking validation**: invalid analyzer ID syntax/reserved
  prefixes, empty display name/description, invalid imported schema JSON,
  incomplete array/object definitions at Test/Publish time, no selected
  sample for **Test & Run** or **Suggest**.
- **CU-side failures surfaced inline** (shared error `message` shape, per
  `process-form`'s convention): ID conflict/replace semantics error,
  invalid schema payload, unsupported field combinations, quota/service
  availability failures, analyzer build failure details.
- **Polling end-state UX**: both Test and Publish polling stop after ten
  minutes and switch to manual refresh/retry rather than spinning forever.
- **Concurrency**: no optimistic concurrency. Draft saves are last-write-
  wins; Test/Publish are serialized per analyzer draft so two open tabs
  cannot provision competing temporary/live analyzers simultaneously.

## Deferred to a later iteration (not v1)

- Bulk/regression testing across the entire sample library in one action
  (today: one sample selected at a time).
- Schema version history / diffing between draft revisions.
- Migrating the two script-created task-20 analyzers into this draft model
  (they remain script-managed).
