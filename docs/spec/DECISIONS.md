# Decisions Log

Open questions raised against the spec and the answers given, so that later
readers can see *why* a thing is the way it is without re-litigating it.
Grouped by theme; the "Where" column points at the document that now carries
the detail.

## Content Understanding Integration

| # | Question | Decision | Where |
|---|----------|----------|-------|
| 1 | How does local dev work without a CU emulator? | **Real Azure CU account required.** No fake provider, no offline mode — CU has no emulator and the demo's value is the real service. | `TECHNOLOGY.md` |
| 2 | How does a "classifier" map onto CU's object model? | There is no classifier resource. A **routing analyzer** with `contentCategories` per selected analyzer, plus an injected `other` catch-all, routed to derived analyzers. | `CONTENT-UNDERSTANDING.md` |
| 3 | Where do category descriptions come from? | **Auto-derived** — curated catalog text for prebuilts, the analyzer's own description for customs. Never entered by the user. | `CONTENT-UNDERSTANDING.md` |
| 4 | How do we guarantee confidence + bounding boxes? | Auto-create a **derived analyzer** per selection with `estimateFieldSourceAndConfidence: true`; prebuilts are immutable and return neither by default. | `CONTENT-UNDERSTANDING.md` |
| 5 | Multi-document files? | `enableSegment: false` — one upload is one document. Segmentation is out of scope. | `CONTENT-UNDERSTANDING.md` |
| 6 | Bounding box coordinate system? | Backend **normalizes to 0–1 page-relative** (CU returns inches for PDF, pixels for images) and also returns per-page `width`/`height`/`unit`/`angle`. | `DATA-MODEL.md` |
| 7 | How is the document sent to CU? | **`:analyzeBinary`** with raw bytes, in both dev and prod — CU cannot reach a local Azurite blob URL. | `CONTENT-UNDERSTANDING.md` |
| 8 | What does `GET /analyzers` return? | Curated prebuilt catalog **+** custom analyzers from CU, with app-owned (`idp_`) analyzers filtered out. | `CONTENT-UNDERSTANDING.md` |
| 9 | Documents matching no allowed form? | Job **succeeds** with `unclassified: true`, `detectedForm: null`, empty fields; the review screen explains it. Not a failure. | `DATA-MODEL.md` |
| 10 | Field value types? | **Full recursive model** — scalars with a `type` discriminator, plus `array` and `object`. Not flattened to strings. | `DATA-MODEL.md` |
| 11 | Naming: classifier vs analyzer? | Renamed throughout to **`routingAnalyzerStatus` / `routingAnalyzerError` / `routingAnalyzerId`** to match CU reality. | `api/openapi.yaml` |
| 12 | CU authentication? | **`DefaultAzureCredential` by default**, static API key as a configured fallback. | `TECHNOLOGY.md` |
| 12a | What changed after the live CU verification spike? | Task 01 found several divergences from the earlier assumptions: **prebuilts do appear in `GET /analyzers`; `prebuilt-invoice` cannot be used as a `baseAnalyzerId`; direct `prebuilt-invoice` already returns `confidence` + `source`; routing classification for the top-level analyzer lands in `contents[0].segments[].category`; routing analyzers on this resource needed an explicit completion model (`gpt-5-mini`, resolved by defaults to deployment `gpt-5-mini-405642`); and analyzer IDs cannot contain hyphens while the practical length ceiling is far above 64 chars (accepted to 987, 988 returned 500).** Impact: task 04 must revise analyzer naming/provisioning and explicit model binding; task 06 must map classification from routing segments and support direct-prebuilt routing instead of assuming derived analyzers. | `CONTENT-UNDERSTANDING.md` |
| 12b | What changed after live testing of schema-based custom analyzers? | Task 20 verified that **custom analyzers are created with top-level `fieldSchema` on `prebuilt-document`, also need a completion model on this resource, and grounded extract fields need `estimateSourceAndConfidence: true` per field. It also showed that unanswered fields may still come back as typed nodes with `confidence` but no `value*`, so downstream logic must check for a value before treating a field as populated.** | `CONTENT-UNDERSTANDING.md` |

## API Surface

| # | Question | Decision |
|---|----------|----------|
| 13 | Missing lifecycle endpoints | Added `DELETE /processes/{id}` (cascade), `POST .../jobs/{jobId}/retry`, `GET .../jobs/summary`, `GET /healthz`. |
| 14 | No error response bodies | Shared **`Error` schema** (`code`, `message`, `details`) on every 4xx/5xx, with one documented exception: `/healthz` returns a `Health` body on 503 so probes get per-dependency detail. |
| 15 | `process-jobs` summary counts | Dedicated **`GET /processes/{id}/jobs/summary`** endpoint that honors the same filters — counts must not be capped by `limit`. |
| 16 | `PUT .../review` semantics | **Partial patch.** Named fields only; writes `reviewedValue` and preserves the original `value`; unknown field names → `400`; repeat calls allowed, `reviewedAt` keeps the first timestamp. |
| 17 | Retry semantics | Creates a **new job** reusing the same blob, linked by `retryOfJobId`. The original stays `failed` for audit. |
| 18 | Delete cascade scope | Deletes the process, its jobs, and its blobs. **CU analyzers are left in place** (orphaned) and documented as such. |
| 19 | When is the routing analyzer rebuilt? | **Only when `allowedAnalyzerIds` changes.** Editing a description or email no longer blocks uploads. |
| 20 | Optimistic concurrency | **None.** Last-write-wins, documented as a demo limitation. *(Judgment call.)* |
| 21 | Analyzer display names | Names **denormalized onto the process at save time** so list screens need no live CU call, refreshed on each save. *(Judgment call.)* |
| 22 | Upload limits | Single file, **20 MB / 20 pages**, `400` on violation — far below CU's 200 MB / 300 pages, to keep demo runs fast and cheap. |

## Operations & Reliability

| # | Question | Decision |
|---|----------|----------|
| 23 | Queue failure handling | Max **3** dequeues → poison queue and job marked `failed`; **5-minute** visibility timeout. |
| 24 | Stuck jobs after restart | **Startup reconciliation** — `running` jobs past the per-job timeout are re-queued once, then failed. |
| 25 | CU polling | Poll `analyzerResults` at **2s, backing off to 5s**; **10-minute** per-job timeout, after which the job fails. |
| 26 | UI polling | **2s** job polling, **5s** routing-analyzer provisioning polling, back off to 10s after 60s, stop after 10 minutes with a manual-refresh prompt. *(Judgment call.)* |
| 27 | Email send failure | **Log and continue** — the job stays `succeeded` with `notificationSent: false`. Notification is best-effort. |
| 28 | Observability | Named spans across the pipeline plus a **correlation ID** propagated from the trigger request through the queue message onto the job. |
| 29 | PII in logs | **Never log field values or document content** — IDs, field names, confidences, and counts only. |

## Delivery

| # | Question | Decision |
|---|----------|----------|
| 30 | Testing vs live CU | **Live-only** — tests exercise the real service; there is no mock layer. |
| 31 | CI | Lint/type-check/unit on every PR; the **live CU suite runs on `main`, nightly, and manual dispatch** with repo secrets. Fork PRs cannot run it. |
| 32 | Frontend stack | **Tailwind CSS + shadcn/ui**, **TanStack Query**, **react-hook-form + Zod**, **react-pdf** for the review pane. |
| 33 | Frontend ↔ backend | Browser calls FastAPI **directly with CORS** configured for the web origin. |
| 34 | OpenAPI ownership | The YAML is **hand-written and authoritative**; FastAPI implements it and the TS client is generated from it. |
| 35 | Document rendering | **pdf.js/react-pdf** for PDFs, native `<img>` for PNG/JPG, **server-side TIFF → PDF** conversion (PDF, not a flat image, so multi-page TIFFs stay navigable). |
| 36 | Multi-page review | **Paged viewer**; clicking a field navigates to its page and highlights the box. |
| 37 | Security posture | Endpoints stay **unauthenticated**, with an explicit "not production-ready" section rather than a silent omission. |
| 38 | Accessibility | **Out of scope** for the demo, stated explicitly. |
| 39 | Seed data | **Seed script + `samples/` documents + `DEMO.md`** walkthrough. |
| 40 | Product name | **Enterprise IDP**. |

## Status

Current as of the spec review that produced `CONTENT-UNDERSTANDING.md`.
