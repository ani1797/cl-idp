# Feature: Onboarding a New Business Process

## Summary

Allow a user to define a new business process within the IDP solution.

## Description

Users should be able to onboard a new business process by providing:

- **Name** — a human-readable identifier for the process.
- **Description** — a summary of what the process does / represents.
- **Allowed analyzers** — the set of Azure AI Content Understanding
  analyzers (prebuilt and/or custom) the process accepts; a document
  uploaded against the process is classified into one of these analyzers.
  The user picks analyzers only — the natural-language category
  descriptions that drive classification are derived automatically from the
  analyzer catalog, never typed by the user.
- **Overall confidence threshold** — a single required confidence threshold
  for the process (used to decide whether a succeeded classified job needs
  review). The backend compares this threshold to the arithmetic mean of all
  present confidence-bearing leaf fields in the extracted result; missing
  confidence values are excluded, and a classified result with no
  confidence-bearing leaves never requires review. Stored/sent to the API as
  a 0–1 float; the UI collects/displays it as a 0–100% value and converts
  to/from the stored float.
- **Business owner email** — an email address notified whenever a form is
  uploaded with a succeeded extraction whose aggregate confidence falls
  below the configured threshold.

## Routing Analyzer Provisioning

Saving a process asynchronously provisions a **routing analyzer** in
Content Understanding — one derived analyzer per selected analyzer (to
enable confidence scores and bounding boxes, which prebuilt analyzers do not
return by default), plus a routing analyzer that classifies an uploaded
document into one of those categories or into a catch-all `other`. The
mechanics are specified in
[`CONTENT-UNDERSTANDING.md`](../CONTENT-UNDERSTANDING.md).

Provisioning is asynchronous, so saving does not make the process
immediately ready for testing; the process exposes
`routingAnalyzerStatus` (`building` / `ready` / `failed`) and, on failure,
`routingAnalyzerError`. Uploads are rejected with `409` until it is `ready`.

Earlier drafts of this spec described "training a classifier." Content
Understanding has no separate classifier resource — the terminology and API
field names were corrected accordingly.

## Permissions

Any user may onboard a new business process — no authentication is
implemented in this demo (no special role or sign-in required). Anyone can
likewise edit or delete any process.

## Editing / Versioning

Processes can be updated/changed after creation. No versioning is required
for this demo — edits simply overwrite the existing configuration.

The routing analyzer is **rebuilt only when the set of allowed analyzers
changes**. Correcting a description, threshold, or owner email leaves the
process `ready` and continuously usable, rather than taking it offline for a
rebuild it doesn't need.

There is no optimistic concurrency: two people editing the same process at
once resolve last-write-wins, silently. Accepted as a demo limitation.

## Deleting

A process can be deleted, which also deletes all of its jobs and all of its
uploaded documents. The Content Understanding analyzers provisioned for it
are deliberately left in place (identifiable by their `idp_` prefix) rather
than risking a partially-failed cascade across two systems.

## Stale Analyzer Selections

An analyzer selected by a process can later be deleted from the Content
Understanding account. This is detected when the routing analyzer is next
built: provisioning fails with a `routingAnalyzerError` naming the missing
analyzer, and the edit form flags it inline so the user can remove it and
re-save.

## Uniqueness

Process **name** must be unique (case-insensitive) across all business
processes. Creating or renaming (via edit) a process to a name that
collides with another existing process is rejected with `409 Conflict`.

## Status

Ready for implementation.
