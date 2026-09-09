---
page: process-list
---

Landing screen for the demo. Shows a table/list of all onboarded business
processes (name, description, allowed analyzers, confidence threshold, owner
email, routing analyzer status). Each row links to `process-detail` for that
process. A prominent "New Process" action navigates to `process-form` in
create mode.

- **Data**: `GET /processes` (list) from the backend/Cosmos DB store.
  Analyzer names come from each process's denormalized `allowedAnalyzers`,
  so the list renders without a live Content Understanding call.
- **Empty state**: friendly prompt to create the first process when none
  exist.
- **Interactions**: row click → `process-detail`; "New Process" button →
  `process-form` (create mode); each row also exposes an "Edit" action →
  `process-form` (edit mode, pre-filled) and a "Delete" action, which
  confirms before calling `DELETE /processes/{processId}` and warns that the
  process's jobs and uploaded documents go with it.
