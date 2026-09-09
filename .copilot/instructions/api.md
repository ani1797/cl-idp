---
applyTo: "docs/spec/api/**"
---

# API Spec Convention

All backend API contracts are defined as **OpenAPI 3.0** documents (YAML) in
`docs/spec/api/`.

- `openapi.yaml` — the single source of truth for the REST API surface
  (business processes, analyzers, pipeline trigger, jobs, review/approve).
  Split into additional files (e.g., via `$ref`) only if the spec grows
  large enough to warrant it.
- Schemas/paths should stay consistent with the feature specs in
  `docs/spec/features/` and the screens in `docs/spec/screen/` that consume
  them — update all three together when the contract changes.
- No authentication schemes are defined, per `TECHNOLOGY.md` (no auth for
  this demo).
