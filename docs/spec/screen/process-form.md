---
page: process-form
---

Create/edit screen for a business process, per the Onboarding a New Business
Process feature. A single form (used for both create and edit — edits
overwrite, no versioning) with fields:

- Name (text, required)
- Description (textarea, required)
- Allowed analyzers (multi-select, required) — selected from the set of
  available Azure AI Content Understanding **analyzers** (a curated catalog
  of prebuilt analyzers plus the custom analyzers in the account), not
  manually typed form types. Options show a friendly name and short
  description; the app's own internal analyzers are never offered.
- Overall confidence threshold (numeric percentage input, 0–100%, required)
  — converted to/from a 0–1 float for the API.
- Business owner email (email input, required)

The user never writes classification descriptions — they are derived
automatically from the analyzer catalog.

On save (create or update), the backend asynchronously provisions a
**routing analyzer** over the selected analyzers, so future inference runs
route an uploaded document to the correct analyzer. This means saving does
not make the process immediately ready for testing. On **edit**, this
rebuild happens **only if the selected analyzers changed** — changing only
the name, description, threshold, or email leaves the process usable
throughout.

- **Data**: `GET /analyzers` (backend endpoint composing the prebuilt
  catalog with the account's custom analyzers) populates the
  allowed-analyzers multi-select options; only analyzers whose status is
  `ready` are offered here, so draft / building / failed custom analyzers
  created through `custom-analyzers-list` → `analyzer-training` are
  excluded until publishing succeeds. A `502` from it is surfaced as an
  inline "couldn't reach Content Understanding" error rather than an empty
  list. `POST /processes` (create) or `PUT /processes/{processId}`
  (edit) persists the process and kicks off provisioning; edit mode
  pre-loads via `GET /processes/{processId}`.
- **Validation**: required fields enforced client-side (react-hook-form +
  Zod) before submit; threshold input constrained to 0–100%; at least one
  analyzer must be selected for allowed analyzers; name must be unique
  (case-insensitive) across processes — a `409` from the API on save is
  surfaced inline as a "name already in use" field-level error. Other `4xx`
  responses are surfaced inline using the error body's `message`.
- **Stale analyzers**: in edit mode, an `allowedAnalyzerIds` entry that no
  longer exists in the analyzer list is rendered as a flagged, removable
  chip with an explanation, so the user can drop it and re-save. The same
  condition also shows as `routingAnalyzerError` on `process-detail`.
- **Interactions**: "Save" persists, kicks off routing analyzer
  provisioning where needed, and navigates to `process-detail` for the saved
  process (which surfaces provisioning status); "Cancel" returns to
  `process-list` without saving.
- **Concurrency**: no conflict detection — a save overwrites whatever is
  stored, even if another tab changed it meanwhile.
