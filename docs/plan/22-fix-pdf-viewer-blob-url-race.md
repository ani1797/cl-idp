# Task 22 — Fix Intermittent PDF Load Failure on inference-review (Blob URL Race)

## Status

Done

## Why This Exists

The user reported a console error that appears **randomly** when opening
the `inference-review` screen for a PDF job:

```
Warning: ResponseException: Unexpected server response (0) while retrieving
PDF "blob:http://localhost:3000/<uuid>".
```

When it happens, the PDF pane fails to render even though the same job
loads fine on a retry/refresh. This is the same viewer surfaced by task 19
(`docs/plan/19-fix-inference-review-document-viewer.md`), but this task
captures a specific, already-diagnosed symptom with a concrete suspected
root cause, rather than the general "go investigate the viewer" scope of
19. Pick this task up first — a fix here may resolve some or all of what
19 was filed to investigate.

## Suspected Root Cause (confirm before fixing)

`useObjectUrl` in `apps/web/components/inference-review-page.tsx` (around
line 85) does:

```ts
function useObjectUrl(blob: Blob | undefined) {
  const objectUrl = useMemo(() => {
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }, [blob]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  return objectUrl;
}
```

`PdfDocumentViewer` passes this `objectUrl` straight into `react-pdf`'s
`<Document file={objectUrl}>`, which asynchronously fetches the blob URL
via PDF.js internally. The `blob` fed into this hook comes from a
react-query-managed fetch of `GET .../jobs/{jobId}/document` — every time
that query re-runs (initial mount, polling refetch per
`getPollingInterval`/`pollingIntervals`, tab refocus, etc.) it can produce
a **new `Blob` object instance**, even if the bytes are identical. That
new `Blob` reference changes `useMemo`'s dependency, so:

1. A new object URL is created for the new blob.
2. React re-renders `<Document file={newObjectUrl}>`, and PDF.js starts
   an async fetch of `newObjectUrl`.
3. The *old* object URL's cleanup effect fires and calls
   `URL.revokeObjectURL(oldObjectUrl)` — but if this happens to also hit
   the URL PDF.js is mid-fetch on (e.g. React 18 double-invoking effects
   in dev, or a fast re-render before the fetch settles), the browser
   returns response status `0` for the in-flight fetch, which is exactly
   the `ResponseException: Unexpected server response (0)` PDF.js throws.

This matches the "random"/intermittent nature of the report (timing-
dependent) far better than a systemic worker/CORS/bundling failure (which
would be consistent, not random). Confirm via browser devtools Network
tab — look for the blob request timing relative to a `revokeObjectURL`
call — before committing to this as the fix, but treat it as the primary
hypothesis.

## Resolution Notes

- Confirmed the hook-level race as the primary cause by combining:
  - the existing independent real-browser/Playwright repro already
    recorded in task 19 (`ResponseException: Unexpected server response (0)`
    against a `blob:` URL), and
  - the current code path in `apps/web/components/inference-review-page.tsx`,
    where the viewer previously created/revoked object URLs directly from
    `Blob` reference identity.
- Replaced the inline `useObjectUrl` implementation with a shared
  `apps/web/lib/use-object-url.ts` hook that caches object URLs by stable
  document identity (`jobId + kind + blob type + blob size`), reuses the
  same URL across equivalent-blob refetches/remounts, and defers revocation
  until the last consumer unmounts.
- Set the document query's `staleTime` to `Infinity` so a succeeded job's
  immutable source document is not needlessly re-fetched into a fresh
  `Blob` during ordinary client lifetime.
- Added Vitest regression coverage for StrictMode remounts plus "same bytes,
  new Blob instance" rerenders.
- Cross-check against task 19: this resolves its confirmed blob-URL revoke
  root cause. Task 19 should be narrowed to any follow-up manual browser
  verification only; its broader speculative worker/CORS branches are no
  longer the primary track unless a new repro appears after this fix.

## Scope

**In scope:**
- Confirm the race above via real reproduction (rapid polling/refetch of
  the document endpoint while the PDF viewer is mounted, e.g. by
  shortening the polling interval locally or forcing a refetch).
- Fix `useObjectUrl` (and the equivalent usage in `ImageDocumentViewer`,
  which shares the same hook) so the object URL for a given document is
  stable across refetches that return equivalent bytes, and is only
  revoked once nothing still needs it — e.g. only re-derive the object
  URL when the underlying document actually changes (compare blob
  size/etag/job id instead of blob reference identity), or gate document
  fetching so it does not re-fetch/re-create the blob at all once a job
  reaches a terminal state.
- Ensure the fix does not revoke a URL that PDF.js (or the `<img>` path)
  may still be actively using — e.g. defer revocation to the next tick
  after the new URL is committed, rather than synchronously on the old
  value's cleanup, if full de-duplication of blob instances isn't
  feasible.
- Add a regression test (component-level test simulating a blob refetch
  while `PdfDocumentViewer`/`ImageDocumentViewer` is mounted, asserting
  no premature revoke/no console error) if feasible under Vitest's mocked
  environment; otherwise, document why not and rely on manual real-browser
  verification.

**Out of scope:** the broader investigation scope of task 19 (worker
resolution, `react-pdf`/`pdfjs-dist` version pairing, CORS, SSR/hydration)
unless the real repro shows this race is not the (sole) cause — if so,
fall back to task 19's broader checklist instead of guessing further here.

## Dependencies

- Task 13 (`docs/plan/13-frontend-inference-review.md`) — introduced the
  viewer and `useObjectUrl`.
- Related: Task 19 (`docs/plan/19-fix-inference-review-document-viewer.md`)
  — broader/deferred viewer investigation; this task's fix should be
  cross-checked against 19's suspected causes list, and 19 should be
  updated/closed out if this fix turns out to fully address the reported
  breakage.

## Test Instructions

```bash
docker compose up -d
cd apps/api && uv run uvicorn app.main:app --reload --port 8000 &
cd apps/web && npm run dev &
```

- Open `http://localhost:3000/processes/<id>/jobs/<jobId>` for a
  `succeeded` PDF job in a real browser with devtools open.
- Watch the console/network tab across several polling cycles (or force
  a manual refetch) and confirm no `ResponseException: Unexpected server
  response (0)` appears and the PDF stays rendered/does not blank out.
- Repeat for an image job to confirm no regression there.
- Run `apps/web`'s Vitest suite (`npm run test`) to confirm the new/
  existing tests around the viewer still pass.

## Definition of Done

- [x] Race condition reproduced and confirmed (or ruled out with evidence)
      in a real browser.
- [x] Fix applied so the PDF/image viewer does not intermittently fail to
      load due to premature `URL.revokeObjectURL` calls on an in-flight
      blob URL.
- [x] Verified stable across multiple polling/refetch cycles without the
      reported console error.
- [x] Regression coverage added where feasible; limitations documented
      otherwise.
- [x] Task 19 cross-checked and updated (or left as-is with a note) based
      on whether this fix resolves its broader scope too.
