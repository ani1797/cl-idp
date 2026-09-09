# Feature: Business Process Inference Testing Flow

## Summary

Allow a user to test a business process by uploading a document and running it
through the inference pipeline, then reviewing the extracted results in a
side-by-side viewer.

## Description

1. User uploads a file, which triggers inference against the configured
   business process pipeline.
2. The pipeline runs and produces:
   - **Classification** — the document type is classified into one of the
     process's allowed analyzers, or into a catch-all meaning "none of
     them."
   - **Extraction** — field values are extracted from the document.
3. Results are presented in a two-pane review UI:
   - **Left pane** — original document, with bounding boxes highlighting the
     location of each extracted field.
   - **Right pane** — editable fields for human review, allowing the user to
     verify/correct extracted values, with confidence scores shown alongside
     each field.

## Supported File Types

PDF and common image formats (PNG, JPG, TIFF). Uploads are limited to a
single file, at most 20 MB and 20 pages.

TIFF is converted to PDF server-side for display only, since browsers cannot
render TIFF and multi-page TIFFs must stay navigable in the paged viewer;
the original is what is stored and analyzed.

## Extracted Field Shape

Fields are **typed and can nest**, mirroring what Content Understanding
returns: scalars (string, date, time, number, integer, boolean) plus arrays
and objects, so structures like invoice line items are represented
faithfully rather than flattened into strings. Nested values are addressed
by **JSON Pointer** path (e.g. `/items/0/description`), which is how they
appear in confidence violations and in review submissions. Only **leaf**
fields are addressable for review; array and object containers are not.

A field's **confidence may be absent** — Content Understanding omits it for
generated rather than extracted values. Those fields display "n/a" and are
never counted as threshold violations; an absent score is not treated as
zero.

## Review Behavior

- Corrections made in the right pane are for human review/approval only —
  they do **not** feed back into the pipeline, and nothing is retrained or
  rebuilt as a result.
- Manual reclassification is not supported; classification is not
  user-editable in this flow.
- Confidence scores are shown alongside each extracted field.
- A **save/approve** action is available once review is complete, persisting
  the reviewed/corrected values. Saving is a **partial update**: only the
  fields actually edited **or explicitly approved** are submitted, the
  original extracted value is kept alongside the corrected one for audit,
  and review can be performed in several passes.
- **Approving without editing is a first-class case.** A low-confidence
  field is often correct as extracted; the reviewer approves it, which
  submits the unchanged value and clears the violation. The save action is
  therefore enabled by an approval as well as by an edit — not only when a
  value has changed.
- Approving a field's reviewed value removes it from the job's
  `confidenceViolations` list — the list reflects only fields that are
  still low-confidence *and* unreviewed. This does not resend the owner
  notification email (see Notifications in the Addressable Pipeline
  Trigger API feature).
- The job records `reviewedAt` (timestamp of the first review action) so
  jobs that have ever been human-reviewed can be identified/filtered,
  independent of whether violations remain. No per-reviewer attribution
  (no authentication in this demo). Concurrent reviews of the same job are
  last-write-wins.

## Outcomes With Nothing to Review

Two outcomes complete successfully but have no fields to edit, and the
review screen states plainly which one occurred rather than showing an
empty editor:

- **Unmatched document** — the document didn't match any form the process
  allows (an invoice uploaded to an ID-document process, say). The job is
  `succeeded` with `unclassified: true`; the screen explains that the
  document doesn't belong to this process and offers to upload a different
  one. This is deliberately not a failure — the pipeline worked correctly.
- **No fields extracted** — the document was classified, but the analyzer
  found no field values. The screen says so explicitly.

## Failed Jobs

A `failed` job (Content Understanding error, timeout, or exhausted retries)
shows its `error` rather than a review link, and offers a **Retry** action.
Retrying re-runs the same already-uploaded document as a **new** job linked
back to the original, so the failure stays visible in history.

## Browsing and Reviewing Past Jobs

Review is not limited to the job just triggered. Every job for a business
process is browsable from a dedicated per-process jobs screen
(`process-jobs`, at `/processes/{processId}/jobs`), filterable by status,
detected form, outstanding confidence violations, reviewed state,
unclassified state, file name, and submitted date range. Selecting any
`succeeded` job from that list opens the **same** two-pane review UI
described above, with the same edit/save-approve semantics — so a human can
work through a backlog of low-confidence jobs exactly as they would review a
freshly uploaded one. Jobs that are still `queued`/`running` are not
reviewable yet, and `failed` jobs surface their `error` and a retry action
instead of a review link.

## Status

Ready for implementation.
