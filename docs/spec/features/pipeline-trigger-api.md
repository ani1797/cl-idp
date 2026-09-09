# Feature: Addressable Pipeline Trigger API

## Summary

An addressable API that allows uploading a form/document to trigger the
inference pipeline, returning detected form type, extracted fields, and
confidence violations.

## Description

- **Trigger** — API accepts a file upload (form/document) and kicks off the
  business process pipeline run.
- **Output** — the API response includes:
  - **Detected form** — the classified document/form type, or a flag saying
    the document matched none of the process's allowed forms.
  - **Extracted fields** — field values pulled from the document, along with
    metadata for each field: field name and path, value type, value,
    confidence score, bounding box, page number, and any other grounding
    metadata Azure AI Content Understanding provides for the field. Fields
    are typed and may nest (arrays/objects), and bounding boxes are
    normalized to 0–1 page-relative coordinates by the backend.
  - **Confidence threshold violations** — fields whose extraction confidence
      fell below the process's configured overall threshold, surfaced for UI
      highlighting only when the job's aggregate confidence is below that
      threshold and the job is therefore flagged for review.

## Request Contract

- **Asynchronous** — the API accepts the upload and returns a job ID
  immediately; a separate status/result endpoint is polled for the
  classification/extraction results.
- **Process addressing** — the business process is identified via the URL
  path, e.g. `POST /processes/{processId}/trigger`, followed by
  `GET /processes/{processId}/jobs/{jobId}`.
- **Synchronous validation at trigger time** — checked before any blob
  write, Cosmos document, or queue message is created, so a rejected upload
  never produces a job. All return `400` with the shared error body:
  - **File type** — must be PDF, PNG, JPG, or TIFF (by content-type and
    extension).
  - **Size** — at most 20 MB.
  - **Page count** — at most 20 pages.
  - **Single file** — exactly one file per request; batch upload is out of
    scope.

  These app-level limits are much stricter than Content Understanding's own
  (200 MB / 300 pages), chosen to keep demo runs fast and inexpensive.
- **Readiness check** — returns `409` if the process's routing analyzer is
  not `ready`, rather than queueing a job that cannot succeed.
- **Failures during execution** (the Content Understanding call fails, the
  job exceeds its 10-minute processing timeout, or its retry budget is
  exhausted) surface asynchronously via `status: "failed"` and `error` on
  the job, and can be re-run via
  `POST /processes/{processId}/jobs/{jobId}/retry`, which creates a new job
  over the same document linked back to the original.

## Error Responses

Every 4xx/5xx response carries a uniform body with a stable machine-readable
`code`, a human-readable `message`, and optional structured `details` — so
clients can branch on `code` rather than parsing prose.

## Confidence Thresholds

Configured per business process (a single overall threshold, as defined in
the onboarding feature) — not per field or global. It is evaluated over the
arithmetic mean of all present confidence-bearing leaf fields, after the
full result tree is mapped. Individual low-confidence leaves are listed in
`confidenceViolations` only when that aggregate is **below** the threshold;
when the aggregate is **equal to or above** the threshold,
`confidenceViolations` is empty and the job does not require review even if
some leaves are individually low. Fields for which Content Understanding
returned no confidence score are excluded rather than treated as zero. A
classified result with no confidence-bearing leaves has no aggregate and
never requires review.

## Notifications

When a job's aggregate confidence is below threshold and persistence
produces one or more `confidenceViolations`, the backend job worker sends a
single email (once per job) to the process's configured business owner
email, immediately after the job transitions to `succeeded`. The email
lists every violating field for that job. It is not resent on subsequent
polls, and is not affected by later human review of the job (see the
Business Process Inference Testing Flow feature for how review interacts
with `confidenceViolations`).

Delivery is **best-effort**: if the SMTP send fails, the failure is logged
and the job remains `succeeded` with its notification flag unset. A
notification problem never invalidates a successful extraction.

## Authentication

None for this demo — the API is unauthenticated. Anyone who can reach the
service can upload documents against any process, and can retrieve any
stored document by process/job ID. See the Security Posture section of
`TECHNOLOGY.md`; the service must only be exposed locally or on a trusted
private network.

## Status

Ready for implementation.
