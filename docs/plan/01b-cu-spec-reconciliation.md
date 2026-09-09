# Task 01b — CU Spec Reconciliation

## Status

Done

## Objective

Reconcile `docs/spec/CONTENT-UNDERSTANDING.md` and the downstream task
specs with the live Task 01 CU spike findings, so the main body of the spec
and the implementation-plan tasks no longer contradict the verified
behavior recorded in `docs/spec/DECISIONS.md` row 12a.

## What Changed

1. **Resource naming corrected** from hyphenated IDs (`idp-r-*`,
   `idp-d-*`) to underscore-based IDs (`idp_r_*`, `idp_d_*`) because the
   live CU endpoint rejected hyphens and accepted underscores.
2. **Derived-analyzer strategy corrected** from "always derive" to
   "attempt derivation, route directly when derivation is unsupported",
   because `baseAnalyzerId: prebuilt-invoice` failed with
   `400 InvalidBaseAnalyzerId`.
3. **Routing result mapping corrected** so classification is read from the
   routing analyzer's `segments[].category`, with a second content object
   carrying `fields` only for matched categories.
4. **Routed direct-prebuilt confidence/source behavior made explicit**:
   the live routing test for `prebuilt-invoice` preserved `confidence` and
   `source` on extracted fields even without a derived analyzer.
5. **Downstream task plans updated** so Task 04 provisions the corrected
   routing/derive-vs-direct design and Task 06 maps the verified live
   result shape.

## Files Updated

- `docs/spec/CONTENT-UNDERSTANDING.md`
- `docs/plan/04-backend-cu-provisioning.md`
- `docs/plan/06-backend-worker-inference-pipeline.md`
- `docs/plan/README.md`

## Verification

- Re-checked the captured Task 01 spike output for routed
  `prebuilt-invoice` confidence/source behavior.
- Ran one additional live PUT probe confirming underscore analyzer IDs are
  accepted.
- Re-read `docs/spec/CONTENT-UNDERSTANDING.md` top to bottom after edits to
  confirm internal consistency with the verified behavior.
