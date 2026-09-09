# Task 09 — Frontend Scaffold

## Status

Done

> Note: Task 17 superseded this task's placeholder `app-header.tsx` with the shared sidebar + topbar shell wired in `app/layout.tsx`.

## Objective

Build the shared frontend infrastructure: API client wiring (generated
from `openapi.yaml` via task 02's codegen), TanStack Query provider setup,
routing shell/navigation, and shared UI primitives (layout, error/loading
states) that every screen task reuses.

## Spec References

- `docs/spec/TECHNOLOGY.md` — Frontend section, Frontend ↔ Backend Wiring,
  API Contract Ownership.
- `docs/spec/spec/README.md` conventions (screen specs use `page:` IDs —
  useful for routing naming).

## Scope

**In scope:**
- `apps/web` App Router structure with route placeholders for all 5
  screens (`/`, `/processes/new`, `/processes/[id]`,
  `/processes/[id]/edit`, `/processes/[id]/jobs`,
  `/processes/[id]/jobs/[jobId]`) — each rendering a "Coming soon" stub if
  its dedicated task hasn't landed yet, so routing exists before content.
- TanStack Query `QueryClientProvider` wired at the root layout with
  sensible defaults (retry policy, stale time) that support the polling
  patterns described in the specs (2s/5s intervals, backoff).
- API client wrapper (`apps/web/lib/api.ts`) built on the generated TS
  client from `packages/shared`, configured with the base URL from an env
  var, exposing typed functions for every operation in `openapi.yaml`.
- Shared UI shell: top nav/header showing "Enterprise IDP" (product name
  per `DECISIONS.md` #40), a shared error boundary/toast mechanism for
  surfacing API `Error` bodies consistently across screens, and a shared
  loading/skeleton component.
- react-hook-form + Zod set up with one example schema (not tied to a
  real screen yet) to prove the pattern compiles and validates.
- Vitest configured with one passing smoke test.

**Out of scope:** any screen's actual content/data-fetching logic (tasks
10-13); Playwright E2E (task 15).

## Dependencies

- Task 00 (Next.js/Tailwind/shadcn already scaffolded).

## Subtasks

1. Set up App Router route files with stub pages.
2. Install/configure TanStack Query provider in the root layout.
3. Wire `apps/web/lib/api.ts` against the generated client, with a
   configurable base URL (`NEXT_PUBLIC_API_BASE_URL`).
4. Build the shared nav/header/layout component.
5. Build a shared error-surfacing mechanism (e.g. a toast provider) that
   any screen can call with an `Error` schema body.
6. Set up Vitest + React Testing Library with one smoke test on the
   layout component.
7. Prove react-hook-form + Zod wiring with a throwaway example form (can
   be deleted once task 10 lands, or left as a documented pattern
   reference).

## Acceptance Criteria

- **Given** the web app started, **when** navigating to each of the 5
  route paths, **then** each renders without a 404 or unhandled error
  (stub content is fine).
- **Given** the API base URL env var pointing at the running backend,
  **when** any page calls a typed API function, **then** it compiles with
  full type safety from the generated client (no `any`).
- **Given** a simulated API error response, **when** a screen surfaces it
  through the shared error mechanism, **then** the `message` from the
  `Error` schema is visibly displayed to the user.
- **Given** `npm run test`, **when** run, **then** the Vitest smoke test
  passes.

## Test Instructions

```bash
cd apps/web
npm run dev &
for path in / /processes/new /processes/abc /processes/abc/edit /processes/abc/jobs /processes/abc/jobs/xyz; do
  curl -s -o /dev/null -w "%{http_code} $path\n" "http://localhost:3000$path"
done
npm run test
npm run lint && npx tsc --noEmit
```

Visually confirm the shared nav/header appears on every stub page and that
the product name "Enterprise IDP" is visible.

## Definition of Done

- [x] All 5 routes resolve (stub content acceptable).
- [x] TanStack Query provider active; devtools (optional) show query
      cache behavior.
- [x] Generated API client callable with full type safety.
- [x] Shared error/loading components exist and are documented for reuse.
- [x] Vitest smoke test passes; lint/type-check clean.
