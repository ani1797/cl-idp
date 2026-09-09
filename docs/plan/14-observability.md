# Task 14 — Observability Threading

## Status

Done

## Objective

Thread the named-span/correlation-ID observability model through the
already-implemented backend pipeline (tasks 03, 05, 06, 08), and confirm
PII-safe logging discipline throughout. This is deliberately a follow-up
task rather than embedded per-task, so instrumentation can be reviewed as
one coherent pass against the finished pipeline rather than half-done in
each earlier task.

## Spec References

- `docs/spec/TECHNOLOGY.md` — Observability section (named spans list,
  correlation ID propagation, Logging and PII subsection).
- `docs/spec/DECISIONS.md` — #28 (named spans + correlation ID), #29
  (never log PII).

## Scope

**In scope:**
- Named spans across the pipeline, matching the spec's list exactly:
  `trigger.request`, `blob.write`, `queue.enqueue`, `worker.dequeue`,
  `cu.analyze.submit`, `cu.analyze.poll`, `job.persist`, `notify.email`,
  `review.save`.
- Correlation ID: generated at `POST .../trigger`, attached as a span
  attribute on every span above, carried on the queue message (already
  done in task 05), stamped onto the job document (already done), and
  included in every log record for that job (structured logging with a
  `correlation_id` field/context var).
- A log-scrubbing check: audit every log statement and span attribute
  added across tasks 03/05/06/08 for field values or document content;
  remove any found. Add a lightweight test or lint rule (e.g. a custom
  pytest fixture that captures log output during a live pipeline run and
  asserts no known sample field value/string appears in it) as a
  regression guard.
- Production exporter note: confirm the OpenTelemetry SDK setup from task
  02 can switch to Azure Monitor via config alone (add the config knob
  even if not exercised against real Azure Monitor in this task).

**Out of scope:** any new functional endpoint behavior; frontend
instrumentation (mentioned as "where practical" in the spec — a stretch
goal, not required for demo completeness; skip unless time allows).

## Dependencies

- Tasks 03, 05, 06, 08 (the endpoints/worker being instrumented must
  already exist).

## Subtasks

1. Add explicit span creation at each of the 9 named points, with
   `correlation_id`, `job_id`, `process_id` as attributes (never field
   values/content).
2. Wire a context var or similar mechanism so `correlation_id` is
   automatically attached to every log record within a job's processing
   scope without manually threading it through every function signature.
3. Audit existing log statements (grep across `apps/api`) for accidental
   PII (field values, extracted content, raw document bytes/text) and fix
   any violations.
4. Write the log-scrubbing regression test: run a real trigger→worker
   pipeline with a known sample document/field value, capture logs, assert
   the known field value string never appears; assert IDs/status/
   confidence/counts do appear (proving logging isn't just silently
   disabled).
5. Add the Azure Monitor exporter config knob (env-var-selected exporter)
   without necessarily testing against real Azure Monitor.

## Acceptance Criteria

- **Given** a full trigger→worker→success run, **when** traces are
  inspected (console exporter locally), **then** all 9 named spans appear,
  each carrying the same `correlation_id` for that job.
- **Given** the same run, **when** logs are inspected, **then** every log
  line related to that job carries the same `correlation_id`.
- **Given** a document containing a known distinctive field value (e.g. a
  test vendor name), **when** the regression test captures full log
  output for that run, **then** the distinctive value string does not
  appear anywhere in the logs, while job/process IDs, field *names*,
  confidence scores, and status transitions do.
- **Given** the exporter config knob, **when** set to an Azure Monitor
  connection string, **then** the SDK selects that exporter instead of
  console (verified by config-driven branching, not necessarily a live
  Azure Monitor account).

## Test Instructions

```bash
cd apps/api
uv run pytest tests/test_observability_pii.py -v -m live   # needs CU creds, runs a real job

# Manual trace inspection
uv run uvicorn app.main:app --reload &
uv run python -m app.worker.main &
curl -s -X POST http://localhost:8000/processes/<id>/trigger -F "file=@samples/invoice.pdf"
# watch console output for span names + correlation_id consistency
```

## Definition of Done

- [x] All 9 named spans present and correctly attributed for a full run.
- [x] Correlation ID verified consistent from trigger request through to
      job persistence in both logs and traces.
- [x] PII regression test passes and would fail if a log statement leaked
      a field value (verify by temporarily reintroducing a violation and
      confirming the test catches it).
- [x] Exporter config knob implemented and documented in `.env.example`.
