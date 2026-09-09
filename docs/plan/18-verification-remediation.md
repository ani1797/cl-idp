# Task 18 — Verification Remediation (Unchecked Definition-of-Done Items)

## Status

Done

## Why This Exists

A post-implementation audit found that several tasks were marked `Done`
in `docs/plan/` with **unchecked Definition of Done checkboxes** —
meaning specific verification steps the task files call for were never
actually performed, only implicitly assumed covered by adjacent checks
(e.g. an automated test suite passing was treated as sufficient even when
the DoD item asked for a distinct manual/real-environment check). Marking
a task `Done` without ticking every DoD box it defines is exactly the gap
this task exists to close. Found instances (line numbers as of the audit
that created this task — re-check against current file state, they may
shift):

- `docs/plan/00-repo-foundation-devex.md`: `.devcontainer` "Reopen in
  Container" never actually exercised; CI-on-a-test-PR never verified
  (this one is **also blocked** on the same no-git-repo gap as task 15b —
  treat as deferred alongside it, not a new blocker); root `README.md`
  quickstart never followed verbatim by a genuinely fresh perspective.
- `docs/plan/09-frontend-scaffold.md`: "Generated API client callable with
  full type safety" unchecked.
- `docs/plan/10-frontend-process-list-form.md`: "Stale-analyzer chip
  behavior verified against a real removed analyzer" unchecked.
- `docs/plan/11-frontend-process-detail.md`: polling behaviors (routing-
  analyzer and job) not verified against a real timed run; job history
  preview badges not verified against real violation/status data; the
  combined "Vitest + manual walkthrough against real backend" item
  unchecked.
- `docs/plan/12-frontend-process-jobs.md`: filter parameters not verified
  against the real backend; URL sync not verified via an actual manual
  refresh; return-path filter preservation not verified round-trip.
- `docs/plan/13-frontend-inference-review.md`: the combined "Vitest +
  manual walkthrough against real backend" item unchecked.

## Objective

Go back through each task above and **actually perform** the specific
unchecked verification step (not a substitute or a re-run of what already
passed) against the real running system (docker-compose emulators + real
CU credentials, per established project practice), then check the box —
or, if a real defect is found while verifying, **do not just check the
box**: fix the defect (small, surgical fix within that task's own scope)
or, if it's large enough to need its own task, stop and create a new plan
item following the same pattern as tasks 01b/15a/15b/17 (do not silently
patch around something that indicates a deeper design problem).

## Dependencies

- Task 17 (UI shell reconciliation) — several of these manual walkthroughs
  involve navigating between screens; do them against the corrected shell/
  nav, not the old placeholder header, so the walkthrough evidence
  reflects the real final UI.

## Subtasks

1. **Task 00 remediation**: Attempt the devcontainer rebuild
   (`devcontainer up` / VS Code "Reopen in Container" via CLI equivalent
   if available in this environment; if no devcontainer CLI/tooling is
   available in this environment, document that limitation explicitly
   rather than silently skipping — do not fabricate a pass). Follow root
   `README.md`'s quickstart literally, command by command, as if
   unfamiliar with the repo, and fix any inaccuracies found. Leave the
   CI-on-a-test-PR item unchecked with a note pointing to task 15b (same
   underlying blocker — no git remote yet).
2. **Task 09 remediation**: Write/run a small real check that the
   generated TS client (`packages/shared/src/generated/api.ts`) is
   callable with full type safety — e.g. a `tsc --noEmit` pass on a
   snippet exercising a couple of generated types/functions, or confirm
   existing frontend code already does this implicitly and cite exactly
   where/how. Check the box only once you have concrete evidence, not
   inference.
3. **Task 10 remediation**: Using the real backend, create a process with
   an analyzer, then remove/rename that analyzer out from under it (via
   direct Cosmos edit or the real CU analyzer-list changing) so the
   process now references a stale/missing analyzer ID, and confirm the
   UI's stale-analyzer chip behavior renders as designed.
4. **Task 11 remediation**: Trigger a real job and watch (not just assert
   in a mocked test) the routing-analyzer and job polling intervals/
   backoff/stop behavior in a real browser or via repeated real network
   calls over the documented time window. Verify job history preview
   badges against jobs with real violation/status combinations (succeeded
   clean, needs-review, failed, unclassified). Perform one real end-to-end
   manual walkthrough against the real backend and record what you did.
5. **Task 12 remediation**: Verify each filter parameter (status, form,
   needs-review, search) actually changes the real backend query/response
   (not just the mocked Vitest assertions), confirm the URL updates and a
   literal browser refresh preserves the filter state, and confirm the
   `?from=` return-path convention round-trips correctly between
   `process-jobs` and `inference-review` in a real navigation, not just a
   unit-test mock.
6. **Task 13 remediation**: Perform the real manual walkthrough this task
   file's Test Instructions describe (a real completed job with nested
   line-item fields, approve/edit/Save, reload-persistence check,
   unclassified/zero-fields/failed states) against the real backend.
7. Update every affected task file's DoD checkboxes (only the ones
   genuinely verified) and `## Status` line if anything changed as a
   result of a fix. Update this task file's own status when finished.

## Acceptance Criteria

- **Given** each unchecked DoD item listed above, **when** this task
  completes, **then** it is either checked with concrete verification
  evidence recorded (command output, description of manual steps and
  observed results), or left unchecked with an explicit note explaining
  why (e.g. environment limitation, deferred to another task) — never
  silently left ambiguous.
- **Given** any real defect discovered during verification, **when**
  found, **then** it is fixed (if small) or spun into a new tracked plan
  task (if large), never silently ignored to preserve a "Done" status.

## Test Instructions

```bash
# Backend + emulators
docker compose up -d
cd apps/api && uv run uvicorn app.main:app --reload --port 8000 &

# Frontend
cd apps/web && npm run dev &

# Then manually work through subtasks 1-6 above against
# http://localhost:3000, using the real backend for every check.
```

## Definition of Done

- [x] Task 00's devcontainer/README quickstart items resolved (checked or
      explicitly noted as environment-limited); CI-on-PR item left
      explicitly deferred alongside task 15b.
- [x] Task 09's generated-client type-safety item resolved with concrete
      evidence.
- [x] Task 10's stale-analyzer chip item verified against a real removed
      analyzer.
- [x] Task 11's polling/badge/walkthrough items verified against the real
      backend.
- [x] Task 12's filter/URL-sync/return-path items verified against the
      real backend.
- [x] Task 13's manual walkthrough item verified against the real
      backend.
- [x] Any real defects found during the above are fixed or spun into new
      tracked tasks, not silently left in place.
