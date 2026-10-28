# ADR-0007: Quality command contract, stage manifest and staged-tree gate

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: FR-133, NFR-005, NFR-010, AC-133, AC-157 and SPEC section 17.4

## Context

The architect does not read implementation source and does not run implementation checks. Reviews therefore need a machine-verifiable snapshot and a stable command contract. The task graph also requires unique final acceptance ownership and a public/private file boundary that prevents evidence, secrets, local data and unreviewed legacy source from being staged.

## Decision

The root command contract is:

- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:unit`
- `npm run test:contract`, `npm run test:integration`, `npm run test:e2e`, `npm run test:a11y`, `npm run test:i18n`
- `npm run verify:boundaries`, `npm run verify:packages`, `npm run verify:consumers`
- `npm run verify:acceptance-owners`
- `npm run verify:ignore-rules`, `npm run scan:secrets` (the scanner source is `scripts/check-public-surface.mjs`; it classifies every path segment and rejects protected or local directories, traversal, absolute paths, symlinks and linked ancestors before any content read or write, including manifest inputs; permitted missing manifest parents can be created only under the intended evidence or `.tmp` roots)
- `npm run build:docs`, `npm run build:demo`

T01 implements the foundation commands, including `verify:packages` against `.tmp/build/packages`. The remaining tier commands are reserved and exit with a clear non-zero message naming their owning task; they never report a false pass. Later tasks replace the placeholder with real checks without renaming the command. `npm run build` stages complete publishable packages under `.tmp/build/packages`; source manifests keep package-relative targets, and `verify:packages` fails with a build-required message when staging is absent. `verify:packages` runs `npm pack` into `.tmp/build/packs` and validates the resulting file list.

Each task supplies `.evidence/reviews/<task-id>/stage-paths.json` with exact repo-relative public paths. `npm run stage:paths` validates that every path exists, is not ignored and is not a local evidence, secret, database, generated or legacy path. The review fingerprint is SHA-256 over lexically sorted path bytes, one NUL byte, complete file bytes and one NUL byte for each manifest path.

`npm run verify:staged-tree` checks that the staged index contains exactly the manifest changes, rejects staged deletions, compares the working tree with the index and reports the base commit, staged tree ID and review fingerprint. It does not mutate the index. The T00 unborn-base exception remains defined in `WORKFLOW.md`.

`npm run verify:acceptance-owners` parses `SPEC.md` and `TASKS.md`, requires exactly one final owner per acceptance criterion, verifies owner and contributor task IDs and compares the normative ownership table with task declarations bidirectionally. Missing, extra, unknown and duplicate declarations fail.

The PR CI skeleton installs with `npm ci`, runs lint, typecheck, package build, unit tests, boundary checks, staging/pack checks, acceptance-owner checks, ignore-rule checks and the redacted public-surface scan. It uses read-only repository permissions, a concurrency group, full-SHA pinned actions and no evidence or video upload.

## Consequences

- Every task has a reproducible public file list and a comparable fingerprint.
- Reviewers can compare the same staged tree without reading an implementer-provided diff.
- Unimplemented quality tiers fail loudly instead of silently passing.
- Secret findings print only file paths and rule identifiers, never matched values.
- CI remains a skeleton until T22 completes the full browser, package, localization, accessibility and Pages gates.

## Cost of change

Changing the fingerprint algorithm or manifest semantics invalidates prior reviews and requires a new task-level decision. Adding a command tier is cheap; renaming an established command would break the contract and CI. Weakening the staged-tree gate or the secret scan requires an explicit architecture decision and increases the risk of publishing local or sensitive material.

## References

- `docs/framework/WORKFLOW.md` sections 3, 4, 5 and 11
- `docs/framework/TASKS.md` sections 2, 2.1 and 4
- `scripts/stage-paths.mjs`, `scripts/verify-staged-tree.mjs`, `scripts/verify-acceptance-owners.mjs`
