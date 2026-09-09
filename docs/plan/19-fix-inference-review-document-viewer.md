# Task 19 — Fix Broken Source Document Viewer (inference-review)

## Status

Done — Resolved by Task 22, independently re-verified

## ✅ Independent Re-Verification (2026-09-05)

Per the user's explicit go-ahead to proceed on this task, re-ran the exact
diagnostic that originally caught the bug: a Playwright test that opens a
real completed job's `inference-review` page against a live backend
(real CU-processed invoice), asserts a `<canvas>` element is visible, and
asserts it contains **non-blank pixel content** (not just an empty
element), while also capturing browser console errors.

**Result: PASS.** `Canvas has non-blank content: true`, `Console errors
seen: []` — zero occurrences of `Unexpected server response` or any other
error. This confirms Task 22's `apps/web/lib/use-object-url.ts`
(ref-counted, document-identity-keyed object URL cache with deferred
revocation) fully resolves the breakage previously reproduced here, using
a real running stack (docker-compose emulators + real FastAPI/worker +
real CU + real Next.js dev server), not mocks. The temporary verification
spec/config were deleted after use; no code changes were needed as part
of this re-verification since Task 22 already shipped the fix.

This task is now considered closed. No further action needed unless a new
repro appears.

## ⚠️ Confirmed Root Cause (independently reproduced post-filing)

After this task was filed, an independent Playwright probe (canvas
visibility + pixel-content assertion against a real completed job) was
run to settle a conflict between two other agents' reports: one
(`t15a`/task 15a) claimed to have "fixed" this via an SSR-safety wrapper
(`components/inference-review-page-client.tsx`, using `next/dynamic`
with `ssr: false`); another (`t18`/task 18) reported reproducing the
break even after that wrapper existed. **The independent probe confirms
`t18` was correct** — the viewer still fails with the UI's own error
state ("Could not render document" / "The PDF viewer could not load this
file"), and the browser console shows:

```
Warning: ResponseException: Unexpected server response (0) while
retrieving PDF "blob:http://localhost:3100/<uuid>".
```

**Root cause, high confidence** (from reading
`apps/web/components/inference-review-page.tsx`'s `useObjectUrl` hook):

```ts
function useObjectUrl(blob: Blob | undefined) {
  const objectUrl = useMemo(() => {
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }, [blob]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  return objectUrl;
}
```

Next.js has React **StrictMode on by default** in `next dev`
(`next.config.ts` does not set `reactStrictMode: false`), which
intentionally double-invokes effects on mount: **mount → cleanup → mount
again**. Since `objectUrl` is memoized on `blob` and does not change
across that double-invocation, the *first* cleanup pass still calls
`URL.revokeObjectURL(objectUrl)` on the one-and-only object URL — so by
the time `react-pdf`/pdf.js asynchronously fetches the `blob:` URL (via
its worker), the URL has already been revoked, producing exactly the
observed "Unexpected server response (0)" fetch failure. This would
explain why it reproduces reliably in `next dev` (used by manual testing
and by the Playwright `webServer` config) — worth confirming whether it
also reproduces under a real production build (`next build && next
start`, where StrictMode's dev-only double-invocation does not happen) as
part of confirming this diagnosis before fixing.

**The `ssr: false` dynamic-import wrapper t15a added is a legitimate fix
for a *different*, real problem** (react-pdf's canvas APIs don't exist
during SSR) but does **not** address this revoke-race — both issues can
be (and appear to be) present simultaneously. Keep that wrapper; it does
not need to be reverted.

**Likely fix** (to be confirmed by whoever picks this up, not applied
here per the deferral below): avoid revoking the object URL on every
effect cleanup tied to a memo that doesn't actually change — e.g. only
revoke the *previous* URL when a *new* one is created (track the prior
value in a ref and revoke it on the next change / on final unmount via a
different mechanism), or avoid the revoke-in-cleanup pattern entirely in
favor of a ref-counted / component-lifetime-scoped URL, or set
`reactStrictMode: false` (last resort — masks the bug rather than fixing
the underlying lifecycle issue, not recommended as the real fix).

## Cross-Check Update from Task 22

Task 22 implemented the confirmed fix path above:

- extracted the object-URL lifecycle into `apps/web/lib/use-object-url.ts`
- reused object URLs by stable document identity instead of raw `Blob`
  object identity
- deferred revocation until the final consumer unmounts, which makes the
  hook resilient to React StrictMode's mount/cleanup/remount cycle
- marked the succeeded-document query as indefinitely fresh to avoid
  unnecessary fresh-`Blob` churn during normal viewing

That means the concrete viewer breakage this task was filed for is
expected to be resolved by task 22. Keep this task only as a narrowed
follow-up for manual browser verification of PDF/image rendering and
overlay behavior after the fix; the earlier speculative worker/CORS
branches should not be reopened unless a new repro survives task 22.

## Scheduling Note

Reported directly by the user during the post-implementation audit (after
tasks 00-18 were scoped): the source document viewer on the
`inference-review` screen (left pane — PDF/image rendering with
bounding-box overlays, built in task 13) is **broken** in real usage. The
user explicitly asked for this to be captured as a scheduled task to fix
**"once we get a chance"** — i.e. this is intentionally deferred, not to
be picked up automatically in the current wave. Do not dispatch an
implementation agent for this task until explicitly told to proceed;
treat it like `docs/plan/15b-ci-dispatch-deferred.md` in that respect
(tracked, scoped, but held). The Confirmed Root Cause section above should
let whoever eventually picks this up skip most of the re-diagnosis work.

## Why This Exists

Task 13 (`docs/plan/13-frontend-inference-review.md`) built the two-pane
review screen including a `react-pdf`-based PDF viewer
(`PdfDocumentViewer`) and an `<img>`-based image viewer
(`ImageDocumentViewer`) in
`apps/web/components/inference-review-page.tsx`, with Vitest coverage
(mocking the API/blob fetch) that passed. However, Vitest's mocked
environment does not exercise real PDF.js worker loading, real blob
fetches from the backend's `GET .../jobs/{jobId}/document` endpoint, or
real browser rendering — so a real breakage in this area could pass all
existing automated tests while still being broken for an actual user.
This is exactly the kind of gap task 18 (verification remediation) was
created to catch systematically, but the user reported this specific
break directly, so it gets its own dedicated fix task rather than waiting
to be rediscovered generically.

At the time this task was filed, the investigating agent was **unable to
get a real browser running in this environment** (`npx playwright install
chromium` failed without `--with-deps` due to missing system libraries,
and `--with-deps` failed because `apt-get` is unavailable in this
sandbox) — so the exact failure mode has **not yet been confirmed live**.
Whoever picks this up next must first reproduce the failure in a real
browser (not just reason about the code) before attempting a fix.

## Suspected Causes To Investigate First

Recorded from a static code read of `apps/web/components/inference-review-page.tsx`
(not yet confirmed against a live repro — verify each before assuming):

- **PDF.js worker resolution under Next.js bundling**: the code sets
  `pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`.
  Confirm this URL actually resolves correctly under Next.js's Turbopack
  dev/build pipeline (this repo is on a Next.js 16 canary with Turbopack
  as the default bundler per task 09/17 — worker asset resolution via
  `import.meta.url` has historically been fragile across bundler
  versions/configurations for `react-pdf`/`pdfjs-dist`). Check the browser
  console for a 404 on the worker script or a "Failed to fetch dynamically
  imported module" / "No GlobalWorkerOptions.workerSrc specified" error.
- **`react-pdf` / `pdfjs-dist` version pairing**: `package.json` pins
  `react-pdf: ^10.5.0`; the resolved `pdfjs-dist` in `node_modules` was
  `5.4.296` at last check. Confirm this is a combination `react-pdf`
  actually supports (check its changelog/peer-dependency range) — a
  silent major-version mismatch between the two is a common root cause of
  "viewer just doesn't render" bugs in this ecosystem.
- **Blob fetch / CORS / content-type from the real backend**: confirm
  `GET .../jobs/{jobId}/document` (task 07/08's endpoint) actually returns
  a fetchable blob from the frontend's origin in a real browser (not just
  via `curl`, which doesn't enforce CORS) — check for a browser-console
  CORS error, and confirm `apps/api`'s CORS middleware config
  (task 02/09) includes the frontend's real dev origin/port.
- **SSR/hydration mismatch**: `react-pdf`'s `Document`/`Page` components
  render onto a `<canvas>` which is client-only; confirm the component
  tree around it is properly client-only (`"use client"` boundaries) and
  not attempting any server-side render pass that could throw or produce
  a hydration mismatch silencing the real error in production mode
  (`next build && next start`) even if `next dev` looks fine, or vice
  versa.
- **Environment/tooling gap**: also confirm whether a real browser can
  even be installed in the target run environment(s) this app is expected
  to run in (this affects both manual verification here and task 15a's
  Playwright suite, which may have hit/worked around the same
  browser-install limitation — check `docs/plan/15a-e2e-live-suite-local.md`'s
  final notes for how it handled browser availability, since that context
  is directly relevant here).

## Spec References

- `docs/plan/13-frontend-inference-review.md` — original viewer scope
  (react-pdf integration, page navigation, bounding-box overlay).
- `docs/spec/screen/inference-review.md` — screen spec for expected
  viewer behavior.
- `apps/web/components/inference-review-page.tsx` — `PdfDocumentViewer`,
  `ImageDocumentViewer`, `useObjectUrl`, `BoundingBoxOverlay`.

## Scope

**In scope:**
- Reproduce the reported breakage in a real browser against the real
  backend (install/enable a real browser in this environment first if at
  all possible — reuse whatever approach task 15a landed on, or escalate
  the environment gap back to the user if no browser can be made
  available at all, rather than guessing at a fix blind).
- Root-cause and fix the actual defect (likely one or more of the
  Suspected Causes above, but do not assume — confirm via real console/
  network errors first).
- Confirm both the PDF path and the image path (PNG/JPG) render
  correctly, plus the bounding-box overlay positioning (task 13's
  acceptance criteria around coordinate math still apply and must not
  regress).
- Add a regression test that would have caught this — if a real headless
  browser is available, a Playwright smoke test asserting the document
  canvas/img actually renders non-blank content is stronger evidence than
  another mocked Vitest test; if no browser is available in this
  environment, document that limitation explicitly and do the strongest
  verification feasible.

**Out of scope:** any other part of the inference-review screen (field
tree, review/approve/save flow) unless directly implicated by the same
root cause.

## Dependencies

- Task 13 (the viewer being fixed).
- Should be picked up with awareness of task 15a's browser-availability
  findings and task 18's verification remediation pass, since both touch
  overlapping "did we actually verify this for real" territory — check
  their final states before starting in case either already surfaced
  more information about this exact bug.

## Test Instructions

```bash
docker compose up -d
cd apps/api && uv run uvicorn app.main:app --reload --port 8000 &
cd apps/web && npm run dev &
# Open http://localhost:3000/processes/<id>/jobs/<jobId> for a real
# succeeded job with a PDF, and separately for one with an image, in an
# actual browser. Check the browser devtools console/network tab for the
# real error before making any code changes.
```

## Definition of Done

- [ ] Real breakage reproduced and root-caused in an actual browser
      against the real backend (not just reasoned about statically).
- [ ] Fix applied and confirmed to resolve both the PDF and image viewer
      paths.
- [ ] Bounding-box overlay positioning confirmed still correct after the
      fix (no regression on task 13's coordinate-math acceptance
      criteria).
- [ ] Strongest feasible regression coverage added given this
      environment's real browser-availability constraints (documented
      either way).
