# Delivery status

This file reports orchestration status, not implementation acceptance.

- Repository: https://github.com/arconw/boardloom (public).
- License decision: MIT, confirmed by the owner; `LICENSE` is part of the T00 public document review scope.
- Architecture: client library with application-provided data and persistence adapters.
- Current stage: T00 round-1 independent reviews completed with CHANGES_REQUESTED. Revisions are applied and the package is ready for round-2 re-review on the same final fingerprint and staged tree. No round-2 reviewer session has started.
- Source inspection and implementation checks: performed by task implementer and reviewers only. The architect manages requirements, review handoffs and Git.
- Review gate: an independent OC reviewer/tester and a CDX reviewer must both accept the same task snapshot and staged tree before the architect commits it. T00 uses the UNBORN-base, eight-file public fingerprint exception; the fingerprint is recorded only in local evidence.
- Framework implementation: not started.
- Packages, integration examples, DEMO deployment, CI and release tags: not yet delivered or verified.
- Local evidence policy: challenges, implementer/reviewer reports and UI-testing/code walkthrough videos live only under ignored `.evidence/`. They are never committed, pushed, attached to GitHub Releases, uploaded by CI or sent to an external service. Product screenshots selected for public README/docs are separate approved documentation assets. CI may upload only ordinary build/test diagnostics such as logs, coverage and traces; not selected review/test screenshots, review reports or videos.
- Decision log: local ignored `.questions/`; temporary orchestration files: ignored `.tmp/`.
- Language policy: project documentation is English; framework UI includes built-in localization and host extension support.
- Public initial commit scope: only the accepted planning package, `.gitignore` and `LICENSE`; no unreviewed legacy source or real data. T01 preserves existing local code, establishes the framework workspace and documents a reversible migration plan.
- Status update order: this pre-commit status is written before final review and frozen through the accepted commit. Later status changes belong to the next reviewed task.

Open items at T00 are documented in local task/review reports under `.evidence/reviews/`. No feature is accepted merely because it appears in the specification.
