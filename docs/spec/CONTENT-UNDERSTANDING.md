# Azure AI Content Understanding Integration

This document is the integration contract between the app and **Azure AI
Content Understanding** (CU). It exists because CU's actual object model
differs from the intuitive "train a classifier over some analyzers" mental
model the rest of the spec originally assumed.

**Pinned API version: `2025-11-01` (GA).** All endpoints below include
`?api-version=2025-11-01`. The `2026-06-01-preview` version adds in-page
segmentation and agentic mode; both are out of scope.

## The Core Correction: There Is No Classifier Resource

CU has exactly **one** resource type — the **analyzer**. Classification is
not a separate resource with its own CRUD surface; it is a capability
embedded in an analyzer via `config.contentCategories`, where each category
carries a natural-language `description` and an optional `analyzerId` to
route to. A single `:analyze` call therefore performs classification *and*
field extraction in one operation.

Consequences that ripple through this spec:

- What earlier drafts called "the process's classifier" is a **routing
  analyzer** — a custom CU analyzer this app creates and owns, one per
  business process. Naming across the spec, API, and data model uses
  `routingAnalyzer*` accordingly.
- The routing analyzer is itself a custom analyzer, so it **appears in CU's
  analyzer list**. `GET /analyzers` must filter out app-owned analyzers or
  users would see their own plumbing offered as a choice.
- Analyzer creation is a **long-running operation**, which is what gives us
  the asynchronous `building` → `ready`/`failed` status the UI polls.

## Resource Naming and Ownership

The app creates and owns CU analyzers. All app-owned analyzers use an `idp_`
ID prefix **and** carry a `createdBy: cl-idp` tag, so they can be reliably
identified and excluded from user-facing analyzer lists:

| Purpose            | ID pattern                                    |
|--------------------|-----------------------------------------------|
| Routing analyzer   | `idp_r_{p}` where `p` = first 12 hex chars of the process ID |
| Derived analyzer   | `idp_d_{p}_{a}` where `a` = first 12 hex chars of SHA-256 of the source analyzer ID |

**IDs are deliberately short and hashed.** The live Task 01 spike showed
that hyphens are rejected in analyzer IDs, while underscores are accepted.
The same spike also showed the earlier 64-character limit assumption was
wrong in practice on this endpoint, but we still keep IDs bounded to ~31
characters because short deterministic IDs are easier to reason about and
leave ample headroom if the service tightens validation later. The
authoritative mapping from source analyzer ID to derived analyzer ID is
persisted on the process document (`derivedAnalyzerIds`), so the hash never
has to be reversed.

IDs are deterministic, so re-provisioning targets the same resources rather
than accumulating orphans. Because CU's create-or-replace **defaults to
refusing to overwrite an existing analyzer**, every provisioning `PUT` must
pass `allowReplace=true`:

```http
PUT {endpoint}/contentunderstanding/analyzers/{analyzerId}?api-version=2025-11-01&allowReplace=true
```

## Derived Analyzers: Attempt When Supported, Route Directly Otherwise

The original design assumed every selected analyzer should be wrapped in a
derived analyzer so `estimateFieldSourceAndConfidence: true` could be forced
on uniformly. The live Task 01 spike disproved that assumption:

- `PUT` with `baseAnalyzerId: "prebuilt-invoice"` failed with
  `400 InvalidBaseAnalyzerId`, so at least some prebuilts **cannot** be
  derived from on this GA API/resource combination.
- A direct `prebuilt-invoice:analyzeBinary` call still returned
  `confidence` and `source` on extracted leaf fields.
- A routing analyzer category whose `analyzerId` pointed **directly** at
  `prebuilt-invoice` also returned `confidence` and `source` in the routed
  extraction object.

So the corrected provisioning strategy is:

1. **Attempt derivation** for a selected analyzer using a deterministic
   `idp_d_{p}_{a}` ID and `estimateFieldSourceAndConfidence: true`.
2. **If derivation succeeds**, route that category to the derived analyzer.
3. **If derivation is rejected as unsupported for that base analyzer**
   (for example `InvalidBaseAnalyzerId` on `prebuilt-invoice`), route the
   category **directly** to the original analyzer ID instead.

Derived analyzers are therefore an optimization/compatibility layer when CU
accepts them, not a universal invariant of the system. The process document
still stores `derivedAnalyzerIds`, but only for analyzers that were
successfully created; categories routed directly to the user's selected
analyzer simply have no derived entry.

```json
PUT /contentunderstanding/analyzers/idp_d_{p}_{a}?allowReplace=true
{
  "baseAnalyzerId": "{selectedAnalyzerId}",
  "tags": { "createdBy": "cl-idp", "processId": "{processId}" },
  "config": {
    "estimateFieldSourceAndConfidence": true
  }
}
```

Later worker logic therefore must not assume a routed category always lands
on an app-owned derived analyzer; it may land either on `idp_d_*` **or**
directly on the selected analyzer such as `prebuilt-invoice`.

## The Routing Analyzer

Created after the per-category target analyzers are known (some derived,
some direct):

```json
PUT /contentunderstanding/analyzers/idp_r_{p}?allowReplace=true
{
  "baseAnalyzerId": "prebuilt-document",
  "models": { "completion": "gpt-5-mini" },
  "tags": { "createdBy": "cl-idp", "processId": "{processId}" },
  "config": {
    "enableSegment": false,
    "omitContent": false,
    "contentCategories": {
      "prebuilt-invoice": {
        "description": "Supplier invoices and utility bills",
        "analyzerId": "prebuilt-invoice"
      },
      "prebuilt-receipt": {
        "description": "Point-of-sale and dining receipts",
        "analyzerId": "idp_d_{p}_{a2}"
      },
      "other": {
        "description": "Any document not matching the categories above"
      }
    }
  }
}
```

- **Category keys are the user's selected analyzer IDs**, so the classified
  category maps back to a `detectedForm` without a lookup table. `other` is
  therefore a reserved key: an analyzer whose ID is literally `other` cannot
  be selected, and the API rejects it.
- **Category descriptions are auto-derived**, never entered by the user. For
  prebuilt analyzers the description comes from the curated catalog (see
  below); for custom analyzers it comes from the analyzer's own description,
  falling back to its ID. CU enforces a **120-character limit on name +
  description combined**, so the app truncates to fit.
- **The `other` category is always injected.** Without it, CU forces every
  document into one of the defined categories, which would silently
  mis-classify unrelated uploads. It has no `analyzerId`, so it classifies
  without extracting. Because it consumes one of CU's 200 category slots, a
  process may select at most **199** analyzers.
- **Routing analyzers on this resource need an explicit completion model.**
  The live spike showed that omitting `models.completion` caused runtime
  analysis failure (`This analyzer needs a 'completion' model deployment...`).
  Provisioning therefore sets a supported logical completion model name
  (currently `gpt-5-mini`), which CU resolves through the resource's
  default deployment mapping.
- **`enableSegment: false`** — one upload is treated as exactly one
  document. Multi-document files (a scanned batch of several invoices) are
  out of scope; the whole file gets a single classification.
- **`omitContent: false`** — the routing analyzer's own content object is
  **retained**, because it is what reports the classified category. Omitting
  it would leave nothing at all in the response for a document classified as
  `other`, since that category routes to no sub-analyzer — exactly the case
  the app must detect and explain.

### Single-Analyzer Optimization — Deliberately Not Taken

When a process allows exactly one analyzer, the classification step could be
skipped. We build the routing analyzer anyway, so that the `other` category
still catches documents that don't belong to the process at all. Uniform
behavior beats a marginal latency saving here.

## Analysis Flow

Documents are sent as **bytes**, not URLs:

```http
POST /contentunderstanding/analyzers/idp_r_{p}:analyzeBinary?api-version=2025-11-01
Content-Type: application/octet-stream
```

CU is a cloud service and cannot reach a blob in local Azurite, so the
URL-based input is unusable in development. `analyzeBinary` works
identically in dev and production, so the app uses it in both — the worker
streams the blob from storage and posts the bytes.

The call returns `202` with an `Operation-Location` header; poll
`GET /contentunderstanding/analyzerResults/{operationId}` until `status` is
`Succeeded` or `Failed`. CU's guidance is to wait at least one second
between polls; see `DATA-MODEL.md` for the app's poll interval and timeout
values.

## Result Shape

```json
{
  "status": "Succeeded",
  "result": {
    "contents": [
      {
        "kind": "document",
        "analyzerId": "idp_r_{p}",
        "unit": "pixel",
        "startPageNumber": 1,
        "endPageNumber": 1,
        "pages": [
          { "pageNumber": 1, "width": 1743, "height": 878, "angle": -0.09 }
        ],
        "segments": [
          {
            "segmentId": "segment1",
            "category": "prebuilt-invoice"
          }
        ]
      },
      {
        "kind": "document",
        "category": "prebuilt-invoice",
        "analyzerId": "prebuilt-invoice",
        "unit": "pixel",
        "startPageNumber": 1,
        "endPageNumber": 1,
        "fields": {
          "VendorName": {
            "type": "string",
            "valueString": "Contoso",
            "confidence": 0.996,
            "source": "D(1,774,72,974,70,974,111,774,113)",
            "spans": [{ "offset": 0, "length": 7 }]
          }
        }
      }
    ]
  }
}
```

Interpretation rules, in order:

1. **Classification** comes from the routing analyzer's own content object,
   specifically the `category` carried on `segments[]`. By our naming
   convention the category name **is** the user's selected analyzer ID, so
   it maps directly onto `detectedForm` with no lookup table.
2. **Extraction** comes from the content object carrying `fields` — the one
   produced by the routed analyzer target, which may be either a derived
   analyzer or the original selected analyzer.
3. If the category is `other`, there is no routed analyzer and therefore no
   extraction result; see "Unclassified Documents".

The live routing spike returned **two** content objects for a matched
document (`contents[0]` = routing object with `segments[].category`,
`contents[1]` = extracted fields object) and **one** content object for an
`other` result. The mapping logic should still locate classification and
fields **by inspection** rather than hard-coding indexes: find the routing
content whose `segments` carry a category, and separately find the content
object with `fields`.

### Field Value Types

`fields` is a map of field name → discriminated union keyed on `type`:

| `type`    | Value property | Notes                                  |
|-----------|----------------|----------------------------------------|
| `string`  | `valueString`  |                                        |
| `date`    | `valueDate`    | ISO 8601 `YYYY-MM-DD`                  |
| `time`    | `valueTime`    | ISO 8601 `hh:mm:ss`                    |
| `number`  | `valueNumber`  | float                                  |
| `integer` | `valueInteger` | 64-bit signed                          |
| `boolean` | `valueBoolean` |                                        |
| `array`   | `valueArray`   | array of fields (recursive)            |
| `object`  | `valueObject`  | map of name → field (recursive)        |

The app models this **recursively and faithfully**, including arrays and
objects (line items on an invoice are an `array` of `object`), rather than
flattening to strings. The API mirrors the shape with a `type`
discriminator, `items` for arrays, and `properties` for objects, and every
node carries a **JSON Pointer path** for unambiguous addressing. See
`DATA-MODEL.md`.

### Confidence

- Float in `[0, 1]`, observed in live tests on direct `prebuilt-invoice`
  output both standalone and when routed through a routing analyzer.
- May still be **absent** on generative (`generate`-method) fields, where
  the model synthesizes rather than extracts a verbatim value.
- May also be absent on analyzers/field types that do not emit grounded
  extraction metadata; the app treats absence as "n/a", not `0`.
- A field with **no confidence** is treated as **not evaluable against the
  threshold** — it is never added to `confidenceViolations`, and the UI
  shows "n/a" instead of a confidence badge rather than implying `0`.
- Threshold comparison applies to **leaf** fields; a parent `array`/`object`
  has no confidence of its own.

### Grounding: `source` and Coordinates

```
source: "D(pageNumber, x1,y1, x2,y2, x3,y3, x4,y4)"
```

A four-vertex polygon (TL → TR → BR → BL), origin top-left.

**Units differ by input type**: `inch` for PDFs, `pixel` for images. The
`unit` is on the content object; `width`/`height`/`angle` are per page.

**The backend normalizes before the value ever reaches the API.** It parses
`source`, divides x by that page's `width` and y by its `height`, and emits
a flat array of 8 floats in `0–1` page-relative space. The frontend then
scales by whatever size it happens to render the page at, without knowing or
caring whether the original was inches or pixels.

Each job also carries a `pages` array (`page`, `width`, `height`, `unit`,
`angle`) so the viewer can set correct aspect ratios and compensate for page
skew — CU returns polygons in the rotated (as-printed) frame, so a non-zero
`angle` matters when overlaying on a de-skewed render.

Fields also carry `spans` (offsets into the result markdown). The app does
not currently use them; they are noted here as the extension point for
text-level highlighting.

## Unclassified Documents

If the classified category is `other`, the document did not match any
analyzer allowed by the process. The job still completes as **`succeeded`**
with `unclassified: true`, `detectedForm: null`, an empty `fields` array,
and no confidence violations. The review screen shows an explanatory state
instead of the two-pane editor. This is a legitimate, expected outcome —
not an error — and is deliberately distinguished from a `failed` job, where
something actually went wrong.

The same explanatory state covers a matched document that yields **zero
extracted fields**.

## Analyzer Discovery

`GET /analyzers` (our API) composes its response from two sources:

1. **A curated static catalog of prebuilt analyzers** — ID, friendly name,
   and a short description (which doubles as the routing category
   description). The live list endpoint did return prebuilts, but the
   catalog is still useful because the raw IDs are not presentable and the
   app wants stable curated descriptions. The catalog lives in backend
   configuration and covers the document-relevant prebuilts:
   `prebuilt-invoice`, `prebuilt-receipt`, `prebuilt-purchaseOrder`,
   `prebuilt-bankStatement.us`, `prebuilt-idDocument`,
   `prebuilt-creditCard`, `prebuilt-tax.us.1040`, `prebuilt-document`.
2. **Custom analyzers from `GET /contentunderstanding/analyzers`**, with
   every app-owned analyzer removed (ID starts with `idp_` or
   `tags.createdBy == "cl-idp"`), and CU's paging followed to completion.

If CU is unreachable, the endpoint returns `502` with the shared error
schema; the process form surfaces it rather than silently showing only
prebuilts.

## Stale Analyzer References

A user can select an analyzer that is later deleted from the CU account. On
create/update, the app validates every `allowedAnalyzerIds` entry against
the composed analyzer list; unknown IDs fail the routing-analyzer build with
`routingAnalyzerStatus: "failed"` and a `routingAnalyzerError` naming the
missing analyzer. The process form flags the missing entry inline so the
user can remove it and re-save.

## Service Limits (`2025-11-01`)

| Limit                                  | Value                        |
|----------------------------------------|------------------------------|
| Max file size (async)                  | 200 MB                       |
| Max pages (async)                      | 300                          |
| Max categories per document analyzer   | 200 (so ≤199 selectable analyzers, since `other` takes one) |
| Category name + description            | 120 characters combined      |
| Analyzer ID validation (live spike)    | Hyphen rejected; underscore/alphanumeric accepted; 987 chars accepted, 988 returned `500` |
| Max custom analyzers per resource      | 100,000                      |

The app enforces **stricter** limits than the service (20 MB / 20 pages) to
keep demo runs fast and cheap; see `features/pipeline-trigger-api.md`.

CU accepts many more formats than this app does (DOCX, XLSX, HTML, EML…).
The app deliberately restricts uploads to PDF, PNG, JPG, and TIFF.

## Connectivity, Auth, and Cost

- **Resource**: a **Microsoft Foundry** resource (CU is a plane within it,
  not a standalone service), with a completion model deployment available
  for generative field extraction.
- **Endpoint**: `https://{resource-name}.services.ai.azure.com/`
- **Auth**: `DefaultAzureCredential` by default (scope
  `https://cognitiveservices.azure.com/.default`, RBAC role **Cognitive
  Services User**); `az login` locally, managed identity in production. A
  static API key (`Ocp-Apim-Subscription-Key`) is supported as a fallback
  when `CU_API_KEY` is configured.
- **Model deployment mapping**: routing analyzers need a completion model;
  the live resource resolved logical model `gpt-5-mini` to deployment
  `gpt-5-mini-405642` via `GET /contentunderstanding/defaults`.
- **Regions**: CU is available in a limited set (approximately
  `australiaeast`, `eastus`, `eastus2`, `japaneast`, `southcentralus`,
  `southeastasia`, `swedencentral`, `uksouth`, `westeurope`, `westus`,
  `westus3`). The resource must live in one of them.
- **No emulator, no offline mode, no free tier.** This is why local
  development requires a real CU account.
- **Cost**: billed per page (content extraction + contextualization), plus
  model tokens on the Foundry deployment. Order of a few cents per
  document at demo scale — cheap, but not free, which is why CI does not
  run the live suite on every pull request.

## SDK

- **`azure-ai-contentunderstanding`** (Python, v1.1.0, GA, targets
  `2025-11-01`). This supersedes the earlier, incorrect reference to
  `azure-ai-documentintelligence` — a different service.
- Because classification is embedded in the analyzer, the SDK's analyze
  operations cover the entire classify-then-extract flow; there are no
  separate classifier methods to look for.
- Anything the SDK does not cover falls back to direct REST via `httpx`
  against the endpoints listed above.

## Custom Trained Analyzers

Task 20 added and live-verified two **schema-based** custom analyzers that
are intentionally **not** app-owned (`idp_`-prefixed / `createdBy: cl-idp`)
so they remain visible in our `GET /analyzers` picker:

| Analyzer ID | Purpose | Final field set |
|-------------|---------|-----------------|
| `drug_prior_auth_glp1` | Canada Life GLP-1 drug prior authorization form | `planMemberName`, `patientName`, `planNumber`, `planMemberIdNumber`, `patientDateOfBirth`, `patientAddress`, `requestedDrug` |
| `group_benefits_application` | Canada Life Selectpac application for group benefits | `requestedEffectiveDate`, `language`, `groupApplicantLegalName`, `streetAddress`, `city`, `province`, `postalCode`, `planAdministratorLastName`, `planAdministratorFirstName`, `planAdministratorTitle`, `planAdministratorEmail`, `planAdministratorTelephone`, `subsidiaryCompanies[]`, `billBySeparateDivision` |

The authoritative schema definitions live in
`apps/api/scripts/train_custom_analyzers.py`, which provisions both
analyzers with:

- `PUT /contentunderstanding/analyzers/{id}?allowReplace=true`
- `baseAnalyzerId: "prebuilt-document"`
- top-level `fieldSchema` definitions
- `models.completion` resolved from `GET /contentunderstanding/defaults`
- `estimateSourceAndConfidence: true` on grounded extract fields

Live verification findings from Task 20 on **2026-09-05**:

1. **Schema-based analyzers on this resource also need a completion model.**
   Reusing the defaults-resolved logical model name (currently
   `gpt-5-mini`) worked for both custom analyzers.
2. **Grounded extract fields returned `confidence` + `source` when
   `estimateSourceAndConfidence: true` was enabled per field.**
3. **Unanswered fields may still be emitted as typed field objects with a
   `confidence` but no `value*`.** Downstream logic therefore must treat
   missing `valueString` / `valueDate` / etc. as "empty" even if a
   confidence is present.
4. **Sample-driven pruning mattered.** The initial candidate schemas were
   narrowed to fields that were actually populated across the live sample
   set: `groupPolicyNumber`, billing `divisions`, and most physician /
   eligibility sections on the GLP-1 samples were omitted because the
   provided forms left them blank and CU returned systematic empties.
5. **Custom analyzers are visible through our API exactly as intended.**
   `GET /analyzers` returned both IDs as `kind: "custom"` with their
   configured descriptions; the current list path uses the analyzer ID as
   `name` when CU does not surface a separate display name.

## Verification Backlog

Task 01's live spike against the real CU account confirmed the following
behavior on **2026-09-04**:

1. **Prebuilt analyzers do appear in `GET /contentunderstanding/analyzers`.**
   The live response included `prebuilt-invoice`, `prebuilt-receipt`, and
   many other prebuilts. A curated catalog is still useful for friendly
   labels/descriptions, but it is no longer required just to discover that
   the prebuilts exist.
2. **`baseAnalyzerId: prebuilt-invoice` did not derive successfully.**
   `PUT /analyzers/{id}?allowReplace=true` returned `400 InvalidBaseAnalyzerId`
   with `Unsupported 'baseAnalyzerId' value: 'prebuilt-invoice'`. However,
   a direct `prebuilt-invoice:analyzeBinary` call on the same synthetic
   sample invoice returned `confidence` and `source` on extracted leaf
   fields such as `CustomerName`, `InvoiceDate`, `InvoiceId`, and
   `AmountDue.Amount`. So, for this GA API/resource combination, direct
   prebuilt routing already preserves the confidence/grounding signals this
   app needs.
3. **Routing results are two-object for a match and one-object for `other`,
   and the routing classification lands on `segments[].category`.** For a
   routed invoice, `contents[0]` was the routing analyzer's own document
   content object with `segments[0].category == "prebuilt-invoice"` and no
   `fields`; `contents[1]` was the routed analyzer output with top-level
   `category == "prebuilt-invoice"` and the extracted `fields`. For a
   non-matching memo classified as `other`, the result contained only the
   routing analyzer's content object, again with the classification in
   `segments[0].category`, and there was no second content object and no
   `fields`.
4. **`allowReplace=true` is the working override, but the earlier ID rules
   were wrong.** Re-`PUT` without `allowReplace=true` returned
   `409 Conflict` / `ModelExists`; the same request with `allowReplace=true`
   returned `201`. Hyphenated analyzer IDs were rejected with
   `The 'analyzerId' cannot contain '-'`. The earlier 64-character limit
   assumption was also false in practice on this endpoint: alphanumeric IDs
   were accepted at least through 987 characters, while a 988-character ID
   returned `500 InternalServerError`.

## Status

Ready for implementation, verification items 1-4 confirmed against the live
CU resource on 2026-09-04.
