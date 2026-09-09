# Task 01 — CU Verification Spike

## Status

Done

## Objective

Confirm, against a **real** Azure AI Content Understanding resource, the
behaviors the spec explicitly flags as unverified — before any provisioning
or worker code is built on top of assumptions. This task produces findings
that update `docs/spec/CONTENT-UNDERSTANDING.md` (or a follow-up decisions
entry) if reality differs from what's written.

## Spec References

- `docs/spec/CONTENT-UNDERSTANDING.md` — read in full, especially the
  **Verification Backlog** section at the end (4 numbered items).
- `docs/spec/TECHNOLOGY.md` — Azure AI Content Understanding section (SDK,
  auth, API version).

## Scope

**In scope:** a throwaway/scratch script (not production code) using the
`azure-ai-contentunderstanding` SDK against the user's real CU resource
(`aif-idp-dev-isfpt7snlrame`, endpoint/credentials from `.env` — **never
hardcode the resource name or any credential in code or docs**; read from
env vars only) that:

1. Calls `GET /contentunderstanding/analyzers` and checks whether prebuilt
   analyzers (`prebuilt-invoice`, etc.) appear in the response.
2. Creates a derived analyzer (`baseAnalyzerId: prebuilt-invoice`,
   `estimateFieldSourceAndConfidence: true`) and confirms: it builds
   successfully, and an `:analyzeBinary` call against it returns
   `confidence` and `source` on extracted fields.
3. Creates a routing analyzer with 1-2 categories routed to derived
   analyzers plus the injected `other` category, submits a sample document
   (from `docs/spec/assets/references` or any local PDF), and inspects the
   raw JSON response to determine exactly how `contents[]` is arranged
   (one object or two; where `category` and `fields` each land; what
   `other`-classified output looks like).
4. Confirms the exact analyzer ID length limit and the working
   create-or-replace mechanism (`allowReplace=true` query param, or
   whatever the live API actually accepts/requires) by attempting to
   re-`PUT` an existing analyzer ID.

**Out of scope:** any production backend code, error handling beyond what's
needed to observe results, retry/polling robustness (that's task 06).

## Dependencies

- Task 00 (need Python/uv environment to run the script).
- Real CU credentials available via environment variables (already
  confirmed available to the user).

## Subtasks

1. Add `CU_ENDPOINT`, `CU_API_KEY` (optional), `CU_MODEL_DEPLOYMENT` to
   local `.env` (not committed) per `.env.example` from task 00.
2. Write `apps/api/scripts/cu_spike.py` (or a Jupyter-free plain script)
   that runs the 4 checks above sequentially, printing raw JSON responses
   and a plain-English summary of each finding.
3. Run it against the live resource; capture the actual responses (redact
   nothing sensitive is expected here — no document content, just analyzer
   config/shape).
4. Write findings back into `docs/spec/CONTENT-UNDERSTANDING.md`'s
   Verification Backlog section (replace "unverified" wording with
   confirmed behavior), and add a new row to `docs/spec/DECISIONS.md` for
   any behavior that diverged from the original assumption, noting the
   impact on later tasks (04 provisioning, 06 result mapping).
5. Delete or clearly mark the spike script as scratch (e.g. move to
   `apps/api/scripts/spikes/` with a header comment) — it is not part of
   the production worker, but keeping it is useful for future debugging
   against the live account.

## Acceptance Criteria

- **Given** the live CU resource, **when** `GET /analyzers` is called,
  **then** the spike documents definitively whether prebuilts are present
  in the response.
- **Given** a derived analyzer built from `prebuilt-invoice` with
  `estimateFieldSourceAndConfidence: true`, **when** a sample invoice is
  analyzed through it, **then** the spike confirms `confidence` and
  `source` are present on extracted fields (or documents that they are
  not, with the raw response as evidence).
- **Given** a routing analyzer with 2 real categories + `other`, **when** a
  matching and a non-matching document are each analyzed, **then** the
  spike documents the exact `contents[]` shape for both cases with raw
  JSON captured in the findings.
- **Given** an existing analyzer ID, **when** re-`PUT` with the same ID,
  **then** the spike confirms the exact override mechanism that succeeds
  (e.g. `allowReplace=true`) versus what fails.
- **Given** the findings, **when** `CONTENT-UNDERSTANDING.md`'s
  Verification Backlog is reviewed afterward, **then** all 4 items are
  updated from "unverified" to a concrete, evidenced statement.

## Test Instructions

```bash
cd apps/api
# .env must have CU_ENDPOINT (and CU_API_KEY if not using az login)
uv run python scripts/spikes/cu_spike.py
```

Expected observable output: four clearly labeled sections in stdout, one
per verification item, each ending with a one-line verdict (e.g.
"VERDICT: prebuilt analyzers ARE present in GET /analyzers response").
Reviewer checks the verdicts against the raw JSON printed above them to
confirm the conclusion is actually supported by the response, then checks
that `CONTENT-UNDERSTANDING.md` was updated to match.

## Definition of Done

- [x] All 4 verification items have a concrete, evidenced answer.
- [x] `docs/spec/CONTENT-UNDERSTANDING.md` Verification Backlog section
      updated (or a note added that it was re-verified and confirmed as
      originally written).
- [x] Any divergence from original assumptions logged as a new row in
      `docs/spec/DECISIONS.md` with impact noted for tasks 04 and 06.
- [x] Spike script committed under `apps/api/scripts/spikes/` for future
      reference, with no hardcoded resource names/secrets.
- [x] No production code was written as part of this task.
