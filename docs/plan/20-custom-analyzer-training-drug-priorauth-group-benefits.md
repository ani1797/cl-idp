# Task 20 — Custom Analyzer Training: Drug Prior Auth & Group Benefits

## Status

Done

## Objective

Design field schemas for two real-world document types found under
`samples/`, and use them to create and verify two **custom, schema-based**
Azure AI Content Understanding analyzers against the live CU resource:

1. **`drug_prior_auth_glp1`** — trained against
   `samples/drug-prior-authorization/*.pdf` (Canada Life "Drug Prior
   Authorization Form", GLP-1 medications: Ozempic, Rybelsus, Wegovy,
   Mounjaro).
2. **`group_benefits_application`** — trained against
   `samples/group-benefits/*.pdf` (Canada Life "Selectpac – Application for
   Group Benefits").

These are the first analyzers this project creates via a **user-defined
field schema** rather than by wrapping an existing prebuilt (contrast with
the `idp_d_*` derived analyzers in `CONTENT-UNDERSTANDING.md`). Task 21
consumes the two analyzer IDs produced here to stand up two business
processes.

## Spec References

- `docs/spec/CONTENT-UNDERSTANDING.md` — analyzer creation mechanics
  (`PUT .../analyzers/{id}?allowReplace=true`), ID validation rules
  (hyphens rejected, underscores accepted), analyzer discovery/filtering
  rules in `GET /analyzers`.
- `apps/api/app/cu/catalog.py` — `list_available_analyzers` /
  `APP_OWNED_ANALYZER_PREFIX` — **read this before naming anything**; it
  filters out any analyzer whose ID starts with `idp_` or whose tags
  contain `createdBy: cl-idp`. The two analyzers built in this task must
  *not* match either rule, or the process-form's analyzer picker will
  never offer them.
- `docs/plan/01-cu-verification-spike.md` — reuse the same
  scratch-script-against-real-credentials conventions (env vars only, no
  hardcoded resource name/secrets).
- `apps/api/app/cu/client.py`, `provisioning.py` — existing CU client to
  reuse for the PUT/poll/analyzeBinary calls instead of hand-rolling HTTP.

## Scope

**In scope:**

- Reading every page of the sample PDFs (`pdftotext -layout`, or opening
  them directly) and enumerating the fields worth extracting for each
  document type. Starting point (refine while iterating against real
  responses):

  **`drug_prior_auth_glp1`** (5-page form):
  - `planMemberName`, `patientName` (string)
  - `planNumber`, `planMemberIdNumber` (string)
  - `patientDateOfBirth` (date)
  - `patientAddress` (string)
  - `requestedDrug` (string, one of Ozempic/Rybelsus/Wegovy/Mounjaro)
  - `healthCanadaIndication` (string, e.g. Type II Diabetes Mellitus /
    Chronic Weight Management / Other)
  - `prescribingPhysicianName`, `physicianSpecialty` (string)
  - `physicianAddress`, `physicianTelephone`, `physicianFax` (string)
  - `treatmentLocation` (string)
  - `medicalRationale` (string, generative summary)
  - `drugTreatmentHistory` (array of object: `drugOrTreatment`,
    `dosingRegimen`, `startDate`, `endDate`, `outcome`)
  - `hba1cGreaterThan7`, `inadequateGlycemicControl`,
    `metforminInadequateResponse` (boolean)
  - `currentBodyWeightKg`, `currentBmi` (number)
  - `comorbidities` (array of string)

  **`group_benefits_application`** (9-page form):
  - `requestedEffectiveDate` (date)
  - `groupPolicyNumber` (string)
  - `language` (string, English/French)
  - `groupApplicantLegalName`, `streetAddress`, `city`, `province`,
    `postalCode` (string)
  - `planAdministratorLastName`, `planAdministratorFirstName`,
    `planAdministratorTitle`, `planAdministratorEmail`,
    `planAdministratorTelephone` (string)
  - `subsidiaryCompanies` (array of string)
  - `billBySeparateDivision` (boolean)
  - `divisions` (array of object: `divisionName`, `contactLastName`,
    `contactFirstName`, `contactTitle`, `streetAddress`, `city`,
    `province`, `postalCode`, `telephone`, `email`)

- A script under `apps/api/scripts/` (reusing `CuClient`/`provisioning.py`
  helpers, not raw `requests`) that:
  1. `PUT`s both analyzers with `allowReplace=true`, a `config.fieldSchema`
     per above, `baseAnalyzerId: "prebuilt-document"`, and **no** `idp_`
     prefix / `createdBy: cl-idp` tag.
  2. Polls each until `status` is `succeeded`/`ready`.
  3. Calls `:analyzeBinary` against every sample file in both `samples/`
     subfolders and prints the extracted `fields` + `confidence` per file.
- Iterating the schema against the real responses: fields that
  consistently come back empty or garbled across multiple samples should
  be reworded (better `description`) or reconsidered (type, method), not
  silently left broken.
- Confirming both analyzers show up in the app's own
  `GET /analyzers` endpoint (friendly name/description, not raw CU
  metadata) — proves `list_available_analyzers` doesn't filter them out.
- Appending findings (final schemas, analyzer IDs, any CU quirks
  encountered) to `docs/spec/CONTENT-UNDERSTANDING.md` under a new
  "Custom Trained Analyzers" subsection, and a `DECISIONS.md` row if
  behavior diverged from what's documented (e.g. field-schema size limits,
  handwriting confidence).

**Out of scope:**
- Any change to app/backend code — the app already supports arbitrary
  custom analyzers from the CU account without modification.
- Creating the two business processes that use these analyzers (task 21).
- A UI for authoring analyzer schemas — this is a one-time setup script.
- Perfect accuracy on every field of every sample; the goal is a usable,
  reviewable schema, not 100% extraction (imperfect handwritten-sample
  fields are expected and exactly what the review screen exists for).

## Dependencies

- Task 01 / 01b (CU behavior already verified: ID rules, `allowReplace`,
  polling contract).
- Task 04 (`CuClient`/provisioning helpers already exist to reuse).
- Real CU credentials in the environment (same as task 01).
- `samples/drug-prior-authorization/` and `samples/group-benefits/` (both
  already present in the repo).

## Subtasks

1. Extract and read the text of every sample PDF
   (`pdftotext -layout <file> -`) to finalize the field lists above.
2. Write the two `fieldSchema` JSON definitions (field `type`, `method`
   — `extract` for grounded string/date/number fields, `generate` for the
   free-text `medicalRationale` summary — and a short `description` per
   field, since CU uses it as extraction guidance).
3. Write `apps/api/scripts/train_custom_analyzers.py` implementing the PUT
   → poll → analyzeBinary loop described above, safely re-runnable
   (`allowReplace=true` makes re-running a no-op-if-unchanged update).
4. Run it against the live CU resource; inspect output for every sample
   file in both folders, including the group-benefits "issue"/handwritten
   samples.
5. Revise the schema for any field that is systematically broken, re-run,
   and confirm improvement.
6. Verify via the app's real `GET /analyzers` (not the raw CU API) that
   both analyzers appear with a sensible name/description and are
   selectable.
7. Update `docs/spec/CONTENT-UNDERSTANDING.md` (+ `DECISIONS.md` if
   applicable) with the finalized schemas and analyzer IDs.

## Acceptance Criteria

- **Given** the live CU resource, **when**
  `train_custom_analyzers.py` is run, **then** both `drug_prior_auth_glp1`
  and `group_benefits_application` build successfully and reach a ready
  status.
- **Given** each sample document, **when** it is analyzed through its
  matching analyzer, **then** the majority of schema fields are populated
  with plausible values (verified by eyeballing printed output against the
  source PDF), and confidence is present on grounded fields.
- **Given** the app's `GET /analyzers` endpoint, **when** called after
  provisioning, **then** both new analyzers appear in the response
  (proving they are not app-owned-filtered).
- **Given** `docs/spec/CONTENT-UNDERSTANDING.md`, **when** reviewed after
  this task, **then** it documents both analyzer IDs, their schemas (or a
  pointer to where the schema lives), and any new CU behavior observed.

## Test Instructions

```bash
cd apps/api
# .env must have CU_ENDPOINT (and CU_API_KEY if not using az login)
uv run python scripts/train_custom_analyzers.py
```

Expected output: two "analyzer ready" confirmations, followed by one
extraction summary per sample file (8 files total: 2 in
`drug-prior-authorization/`, 6 in `group-benefits/`), each showing
populated field values and confidence where applicable.

```bash
curl -s http://localhost:8000/analyzers | jq '.[] | select(.id == "drug_prior_auth_glp1" or .id == "group_benefits_application")'
```

Expected: both entries present with friendly `name`/`description`.

## Definition of Done

- [x] Both custom analyzers created, built, and confirmed `ready` against
      the live CU resource.
- [x] `train_custom_analyzers.py` committed under `apps/api/scripts/` and
      safely re-runnable.
- [x] Every sample file in both `samples/` subfolders analyzed at least
      once with reviewed, plausible output.
- [x] Both analyzers confirmed visible via the app's own `GET /analyzers`.
- [x] `docs/spec/CONTENT-UNDERSTANDING.md` updated with the final schemas
      and analyzer IDs; `DECISIONS.md` updated if any assumption changed.
