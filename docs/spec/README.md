# Spec: Enterprise IDP — Demo with Azure AI Content Understanding

## Background

This demo showcases the use of **Azure AI Content Understanding** in building an
enterprise-grade **Intelligent Document Processing (IDP)** solution.

## What This Demo Does

Users onboard a **business process** (name, description, allowed analyzers,
confidence threshold, business owner email). Documents can then be uploaded
against that process — either through the web UI or the addressable trigger
API — to be classified and have fields extracted via Azure AI Content
Understanding. Extractions are reviewed side-by-side against the source
document, with low-confidence fields flagged and the business owner notified
by email. Every job belonging to a process can be browsed and filtered from
that process's jobs screen, and any completed job can be re-opened in the
same human review UI.

## Spec Index

- [`TECHNOLOGY.md`](./TECHNOLOGY.md) — technology stack (backend, frontend,
  data storage, local dev tooling, testing/CI, observability, security
  posture, and the dev-to-production path).
- [`CONTENT-UNDERSTANDING.md`](./CONTENT-UNDERSTANDING.md) — the Azure AI
  Content Understanding integration contract: routing/derived analyzers,
  result shape, confidence and bounding-box handling, and service limits.
  Read this before implementing anything that touches the service.
- [`DATA-MODEL.md`](./DATA-MODEL.md) — control-plane/data-plane persistence
  design: Cosmos DB containers, blob layout, queue message shape, reliability
  semantics, and the worker model.
- [`DECISIONS.md`](./DECISIONS.md) — log of resolved open questions and the
  reasoning behind each choice.
- [`features/`](./features) — feature specs:
  - [Onboarding a New Business Process](./features/onboarding-business-process.md)
  - [Business Process Inference Testing Flow](./features/business-process-inference-testing.md)
  - [Addressable Pipeline Trigger API](./features/pipeline-trigger-api.md)
- [`screen/`](./screen) — screen-level UI specs, including `process-jobs`, the
  per-process filterable jobs list that opens any completed job in the human
  review UI.
- [`api/`](./api) — the REST API contract as an OpenAPI 3.0 spec. This
  document is hand-written and authoritative; the backend implements it and
  the frontend client is generated from it.

## Prerequisite

Unlike every other dependency, **Azure AI Content Understanding has no local
emulator**. Running this project — including its tests — requires a real
Azure Content Understanding resource. See `TECHNOLOGY.md`.

## Conventions

- Feature specs live in `docs/spec/features/` as one Markdown file per
  feature, each ending with a `## Status` section.
- Screen specs live in `docs/spec/screen/` as one Markdown file per screen,
  with YAML frontmatter carrying a unique `page: <id>` (e.g. `process-form`,
  `inference-review`) followed by a free-form body describing the screen's
  purpose, layout, backend integrations, and user interactions.
- API specs live in `docs/spec/api/` as an OpenAPI 3.0 document.

## Status

Actively evolving. Technology stack, feature specs, screen specs, the
OpenAPI contract, the data model, and the Content Understanding integration
contract are defined, and the open questions raised in review are resolved in
`DECISIONS.md`. Two Content Understanding behaviors remain to be verified
against a live account during the first implementation spike — see the
Verification Backlog in `CONTENT-UNDERSTANDING.md`.
