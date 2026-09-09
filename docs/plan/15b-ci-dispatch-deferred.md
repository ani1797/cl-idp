# Task 15b — Live GitHub Actions CI Dispatch (Deferred)

## Status

Blocked (deferred by explicit user decision)

## Why This Exists

The original "Task 15 — Live-CU E2E Suite & CI" required proving the live
suite passes via **actual GitHub Actions execution**, not just locally.
When implementation reached this point, the repository had no git history
at all (no `.git`, no remote, nothing pushed to GitHub). Setting that up
requires decisions only the project owner can make: a repo name/location,
visibility (public/private), and — most importantly — how to provision
live Azure Content Understanding credentials as CI secrets (a security-
sensitive decision, since local dev currently uses interactive `az login`
/ `DefaultAzureCredential`, which does not work unattended in CI; CI would
need a service principal or similar non-interactive credential).

The user was asked directly (see session record) and chose **"local
only"**: build and verify everything locally (task 15a), and defer this
step indefinitely rather than have an agent unilaterally initialize a git
repo, push code, or provision credentials as GitHub secrets.

## Objective (when unblocked)

1. `git init` (or connect to an existing intended remote) and push the
   repository to GitHub at a location the user specifies.
2. Provision a non-interactive CU credential (service principal or API
   key) suitable for unattended CI use, and add it as a repository/
   environment secret (`CU_ENDPOINT`, `CU_API_KEY` or equivalent) —
   **never** commit it to source.
3. Confirm the two-workflow split from task 15a (`ci.yml` for PRs, a
   second workflow for `main`/nightly/`workflow_dispatch`) is present and
   correctly configured to consume that secret.
4. Manually dispatch the live workflow (`gh workflow run <name>` /
   `gh run watch`) and confirm it passes end-to-end in real CI, not just
   locally.
5. Confirm a PR-triggered run needs zero secrets (fork-safe).

## Dependencies

- Task 15a (Playwright suite, samples, and CI YAML must exist and pass
  locally first).

## Unblocking This Task

This task stays `Blocked` until the user explicitly asks to proceed with
git/GitHub repo setup and CI secret provisioning. Do not action any part
of this file's Objective without that explicit go-ahead — re-confirm
repo name/visibility and credential approach at that time even if this
file already has notes, since real-world details (e.g. an existing repo
the user wants to reuse) may have changed.

## Definition of Done

- [ ] Repo pushed to GitHub at a user-approved location.
- [ ] Non-interactive CU credential provisioned and stored only as a
      repository/environment secret (never in source).
- [ ] Live workflow dispatched and passed at least once in real GitHub
      Actions execution.
- [ ] PR-triggered workflow confirmed to require zero secrets.
