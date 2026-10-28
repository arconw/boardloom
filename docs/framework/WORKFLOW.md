# Boardloom Workflow

Status: T00 revised draft after round-1 review feedback, ready for re-review. This protocol governs implementation and review after T00.

This document turns the architect brief into a repeatable operating procedure. It is intentionally stricter than a normal code review because the product must be independently verifiable and must not depend on the architect auditing implementation source.

All project documentation, READMEs, decision logs and prose authored for the repository are English. Owner chat may remain Russian. UI locale dictionaries are product assets and naturally contain their respective languages. Do not rewrite locale data as English project prose.

## 1. Roles and hard boundaries

### Architect/orchestrator

- Owns the task graph, review circulation, feedback reconciliation and repository/Git operations.
- Reads the brief, task reports and review reports, Git metadata and CI metadata.
- Does NOT read implementation source or diffs and does NOT run implementation checks.
- Does NOT replace reviewer judgment with a personal audit.
- Creates commits, branches, tags and GitHub resources only as authorized. Never changes the user's Git identity.
- Records exceptions, unknowns and unresolved decisions honestly.
- Does not require AI mentions in commits and does not add AI co-authors.

### OC implementer

- Uses the selected OpenCode session and exact model assigned to the task.
- Reads the brief, specification, baseline, task and applicable AGENTS rules.
- Implements or fixes the task, runs the agreed checks, and writes the implementer handoff.
- Does not commit, push, create GitHub resources or delete user files.
- Does not read `.ctx`, sensitive files, real database data or credentials.
- Keeps temporary material in `<project>/.tmp/`, never `/tmp`.
- Does not present a requirement as done if it was not verified.

### OC reviewer/tester

- Independent OpenCode session, same selected model family as the task assignment.
- Reads the implementation, runs independent checks and regressions, records UI video when the task has a UI, and reviews relevant code.
- Does not implement the feature or modify source as part of the review.
- Can challenge any claim, require fixes, and force re-review of the same task.
- Appends reproducible issues to `.evidence/challenges/CHALLENGES.md`; does not overwrite history.
- A PASS is impossible while a task requirement or mandatory check remains unhandled.

### CDX reviewer

- Independent Codex session with the assigned model and effort for the task.
- Reviews source and architecture independently. Does not implement.
- Can challenge and require fixes.
- Produces a review report in the same format and with the same PASS/CHANGES_REQUESTED/BLOCKED verdict scale.

### Task sessions

Each task has its own implementer and two reviewer sessions living in that task's context. Reviewers do not replace unfinished reviews with new tasks. There is no unconditional round limit that closes issues automatically.

## 2. Review-unit and stage model

Every task in `TASKS.md` is a review gate. A stage is a dependency grouping; it closes only when all its tasks pass and the stage integration check passes. T00 is the documentation task and is also reviewed twice.

A review round is complete only when both reviewers return verdicts on the identical snapshot. If either reviewer finds a defect, the implementer fixes it in the same task session and both reviewers re-review the new snapshot. A change after one reviewer PASS invalidates that PASS for the final artifact unless the reviewer explicitly re-confirms the same fingerprint.

## 3. Snapshot fingerprint and public stage manifest

The architect must be able to tell whether both reviewers examined the same work without reading source.

### 3.1 General rule for later tasks

For a normal task with a commit base:

- The reviewed public file manifest is an explicit repo-relative list under `.evidence/reviews/<task-id>/stage-paths.json`.
- The manifest includes every newly added public file, package manifest, lockfile and changed public document needed for the task, and excludes local evidence, `.questions/`, `.tmp/`, `.ctx`, secrets, databases, generated output and unreviewed legacy source.
- The snapshot is the Git tree produced by staging exactly that manifest.
- The review fingerprint is SHA-256 over lexically sorted repo-relative path bytes, one NUL byte, complete file bytes and one NUL byte for every path in the manifest.
- The base commit, staged tree ID and fingerprint are recorded in the local handoff and both review reports.
- Root controls the index and stages these files. The implementer does not stage or commit.
- A PASS is invalid after any restaging or content change until both reviewers re-run on the new tree.

### 3.2 T00 pre-first-commit exception

`main` is unborn for T00. This is an explicit exception, not an omitted field.

- Base commit: `UNBORN` (no commit parent).
- Snapshot identity: the staged Git tree ID.
- Exact public scope: `.gitignore`, `LICENSE`, `docs/framework/ARCHITECT_BRIEF.md`, `docs/framework/BASELINE.md`, `docs/framework/SPEC.md`, `docs/framework/STATUS.md`, `docs/framework/TASKS.md` and `docs/framework/WORKFLOW.md` (the six Markdown files under `docs/framework` plus `.gitignore` and `LICENSE`).
- Fingerprint algorithm: sort repo-relative path bytes lexically; for each path, feed the path bytes, one NUL byte, the complete file bytes and one NUL byte into SHA-256.
- Excluded: `.evidence/`, `.questions/`, `.tmp/`, `.ctx`, `.git`, `node_modules`, generated output, the legacy source tree and all secrets or real data.
- The local handoff records the working public fingerprint and the current staged tree. It MUST NOT place the fingerprint inside a public file covered by the hash; that would be self-referential.
- Root restages the public docs before the next review and may append the refreshed staged-tree metadata to the local handoff without changing public source.
- Both reviewers independently report the same final fingerprint and staged Git tree. Any restaging, including `STATUS.md` or `.gitignore`, invalidates the prior review until both reviewers re-confirm.
- The T00 stage manifest is `.evidence/reviews/T00/stage-paths.json` and lists exactly the eight public paths above.
- Git blob object IDs and raw-file SHA-256 values are different hashes. Report the Git object/staged tree identity separately from the document SHA-256 fingerprint; do not describe them as equal.

### 3.3 Status update order

Write the intended pre-commit status in `STATUS.md` before final review. Freeze all public docs through the accepted commit. Any later status change belongs to the next reviewed task and invalidates the previous fingerprint until re-reviewed.

If Git is unavailable or the worktree cannot be represented by the declared manifest, the task is BLOCKED. A prose-only snapshot is not sufficient for acceptance.

## 4. Handoff package

The implementer produces a handoff before review. Required content:

1. Task ID and title.
2. Base commit SHA (or explicit `UNBORN` for T00), staged tree ID and review fingerprint.
3. Public stage manifest path (`.evidence/reviews/<task-id>/stage-paths.json`) with exactly the public files root should stage, separated from local evidence paths.
4. Scope delivered, with explicit non-scope.
5. Changed paths, grouped by public package/documentation area and local evidence area.
6. Requirement and acceptance IDs covered, with final ownership versus contribution.
7. Commands run, exact command text, exit status and concise result. Do not claim a command was run if it was not.
8. Local evidence paths: test artifacts, traces, screenshots, videos and manifests under `.evidence/`; no public links to files intentionally absent from Git.
9. Known deviations, unverified items and assumptions.
10. Open decisions that need architect or owner input.
11. Review focus and suggested challenge areas.
12. Status: READY_FOR_REVIEW or BLOCKED.

The handoff is written to the local review directory, for example `.evidence/reviews/<task-id>/implementer.md`. It contains no secrets and no real data and must not be committed or uploaded.

## 5. Review report

Both reviewers write to the local review directory, for example `.evidence/reviews/<task-id>/oc-reviewer.md` and `cdx-reviewer.md`.

Required fields:

1. Task ID.
2. Reviewed snapshot fingerprint, base commit or `UNBORN`, staged tree ID and public stage manifest path.
3. Session/model identification.
4. Scope reviewed and files or behavior examined, described at a useful level.
5. Commands run, exact command text, environment and results.
6. Findings, ordered by severity: P0 blocker, P1 must fix, P2 should fix, P3 note.
7. For each finding: title, reproduction or condition, observed result, expected result, evidence link, and requirement/AC reference.
8. Challenges appended to `.evidence/challenges/CHALLENGES.md`, with IDs.
9. What was not verified and why.
10. Local artifact paths: video, screenshots, traces, logs, manifest and checksum; CI run links only for ordinary diagnostics.
11. Verdict: PASS, CHANGES_REQUESTED or BLOCKED.

Rules for verdicts:

- PASS requires every assigned requirement and mandatory check to be addressed, no unresolved P0/P1, and the same final fingerprint as the other reviewer.
- CHANGES_REQUESTED requires concrete fixes or evidence.
- BLOCKED is for missing prerequisites, unsafe conditions, unavailable evidence or unresolved architectural contradictions. It cannot be silently downgraded.
- "It looks fine" or a diff-only opinion is not a review.
- A reviewer may increase scope to a requirement missed by the task graph; the architect then records a task-graph correction rather than silently ignoring it.

## 6. Challenge journal

`.evidence/challenges/CHALLENGES.md` is append-only. It is maintained by OC reviewers, with implementer resolution notes and reviewer verification.

Required columns:

- Challenge ID.
- Task ID.
- Date.
- Reviewer and severity.
- Challenge statement.
- Reproduction or symptom.
- Root cause.
- Resolution.
- Verification.
- Artifact links.
- Status: open, fixed-pending-verification, verified, rejected-with-reason, deferred-with-owner-approval.

A challenge is not closed by explanation alone. It requires a reproduction or verification result. Rejected challenges record the technical reason and the architect decision. Deferred challenges require explicit owner approval and remain visible in the local release decision; the journal is never uploaded.

Never delete old entries. Never rewrite a previous task's challenge. Corrections are appended as new entries with a reference to the earlier ID.

## 7. Video and evidence protocol

- Tasks with UI changes require video recorded by the reviewer/tester. Screenshots supplement but do not replace video.
- Tasks without UI use N/A honestly and provide an applicable code or documentation walkthrough. T00 uses N/A for UI video.
- Raw recordings, intermediate scripts, logs, traces, build and test artifacts live under `<project>/.tmp/` and are deleted or allowed to expire. Never use `/tmp`.
- Selected final videos and screenshots go to `.evidence/videos/<task-id>/` with a manifest.
- Do not record secrets, local home files, `.env`, `.ctx`, real database content or unapproved data. Do not use Chrome DevTools MCP. Playwright and ffmpeg are permitted.
- Videos and review evidence are never committed, uploaded to GitHub Releases or CI, or sent to an external service. They remain local under `.evidence/`.
- Every manifest records task ID, scenario, timestamps, environment, browser, commit/fingerprint, related challenge IDs, checksum and whether the content is simulated.
- A video must show the actual built artifact, not a mockup, unless explicitly labeled as a design reference.
- Public README/docs screenshots are selected documentation assets, distinct from raw review/test evidence. Raw evidence must not be copied into public docs without architect approval.
- CI may upload ordinary build/test diagnostics such as logs, coverage and traces. CI must never upload the cumulative challenge journal, review reports, selected review/test screenshots or video recordings.
- Localization evidence must show language switching, state preservation, a CJK locale and Arabic RTL in the real viewer/editor flows. Do not claim professional or native-speaker translation quality; record functional coverage and limitations.

See `.evidence/videos/README.md` for the catalog format.

## 8. Version snapshot

Every handoff and review records:

- Base commit SHA and review fingerprint.
- Branch name and repository remote.
- Node and package manager versions.
- Lockfile hash.
- Browser and operating system for UI evidence.
- Package version or provisional version.
- Fixture name and dataset checksum for performance or data-sensitive evidence.
- UI locale or locales and display timezone used for screenshots, video and formatting evidence.

No acceptance claim may rely on a different snapshot than the one recorded. Dependency and tool behavior choices must be grounded in official primary documentation; secondary summaries are not acceptance evidence for unstable or version-sensitive behavior.

## 9. Git gates

- The implementer does not commit or push.
- A stage receives a commit only after both reviewers PASS the same final snapshot.
- Commit messages are substantive and describe the change. No AI mentions and no AI co-author trailers.
- Do not substitute or rewrite the user's Git identity.
- Do not commit secrets, `.env`, `.ctx`, local databases, real data, raw recordings or build artifacts.
- Commits should contain only intended files and preserve unrelated user work.
- `.evidence/`, `.questions/` and `.tmp/` are intentionally ignored and must never be committed. The architect verifies that the public commit contains only accepted planning docs, safe source changes, `LICENSE` and a safe `.gitignore`, with no unreviewed legacy source, secrets or real data.
- The public initial commit contains only the accepted planning package, `LICENSE` and a safe `.gitignore`. T01 preserves existing local code, establishes the framework workspace and documents a reversible migration plan.
- Tags are created only after the release gate. The first release is 0.x.
- Review reports, the challenge journal and videos are local evidence and are never pushed.
- Destructive history operations require explicit owner approval.

Recommended commit shape: one commit per accepted task or coherent stage, with a subject that names the product area and a body that lists requirement IDs and review evidence. The architect decides whether docs and source share a commit for a stage.

## 10. Branch and Pages gates

- `main` contains the framework, documentation and example sources.
- `DEMO` contains the reproducible static demo for GitHub Pages.
- Feature work may use task branches. The architect manages merging and branch protection.
- Pages deployment uses the approved DEMO artifact and the correct repository base path.
- PR workflows never deploy to Pages and never publish packages.
- Release workflows are manual, environment-protected and least-privilege.

## 11. CI gates

PR checks must be reproducible and run from the committed lockfile:

- Install, lint and typecheck.
- Unit, contract and integration tests.
- Browser E2E for viewer, editor, filters, comparison, realtime and plugins.
- Localization checks: message-key parity for all built-in locales, fallback and interpolation, English/Russian, a CJK locale and Arabic RTL in real flows.
- Accessibility checks plus manual checklist for UI-affecting work.
- Package build, boundary checks, `npm pack` and tarball consumers for JS, TS, React, Angular and Svelte.
- Docs and demo builds.
- Secret scanning with redacted output.
- Ordinary failure diagnostics: Playwright traces, logs and coverage. Never upload selected review/test screenshots, local review evidence or video recordings.

Required workflow properties:

- Minimal permissions, usually `contents: read` for PR checks.
- Actions pinned to immutable SHAs with recorded versions.
- Concurrency groups cancel superseded PR runs.
- Separate PR, Pages and release workflows.
- No secrets required for PR tests from forks.
- No `pull_request_target` execution of untrusted code.
- Artifact retention and access are documented.
- Secret scanning never prints matching values.

Release gates:

- Both reviewers PASS the identical final fingerprint.
- Every mandatory FR/NFR/AC has evidence.
- No open P0/P1 challenge.
- Performance evidence meets the declared v0.1 targets.
- MIT license and `LICENSE` are present; Boardloom brand and `arconw/boardloom` repository naming are confirmed; npm publication is withheld unless a publisher context and registry namespace are provided.
- Localization evidence covers key parity and real browser locale/RTL flows; no native-speaker certification is claimed.
- No secrets or real data in packages, docs, demo or artifacts.
- SemVer 0.x; no 1.0.0 before explicit acceptance.

## 12. T00 specifics

T00 is documentation-only:

- No application source, config, README or database modification.
- The architect brief is translated to English with every substantive requirement preserved. The `.questions` decision log is English and records owner confirmations separately from architect decisions.
- No Git commit by the implementer.
- No runtime, package or test implementation claim.
- T00 handoff, `stage-paths.json` and reviews are local under `.evidence/reviews/T00/`; no challenge, review or video is committed or uploaded. `LICENSE` is part of the public review scope.
- T00 uses the explicit `UNBORN` base and eight-file public fingerprint exception in section 3.2. The local handoff records the working fingerprint and staged tree; the fingerprint is never embedded in a public hashed file.
- T00 owns only AC-136 and AC-157. It contributes traceability to all IDs but makes no implementation acceptance claim.
- UI video is N/A. A real local documentation walkthrough recording is required under `.evidence/videos/T00/`; the traceability report is under `.evidence/reviews/T00/`. A textual walkthrough does not replace the recording.
- Review focus: brief coverage, contradictions, measurable acceptance criteria, baseline safety, MIT `LICENSE` review scope, npm boundaries, local evidence policy and public/CI separation, localization requirements and the new T17 task, unique acceptance ownership, the T00 fingerprint/stage exception, task graph completeness, whether every requirement has a task and acceptance criterion, and whether owner confirmations are distinguished from architect decisions.

T00 PASS still requires both reviewers. A missing requirement or an unverifiable acceptance criterion is CHANGES_REQUESTED, not a note.

## 13. Disagreement and escalation

- The implementer may disagree with a finding but must answer it with evidence, not ignore it.
- If reviewers disagree, the architect records both positions, the requirement text and the options, then requests an owner decision or a narrowly scoped technical spike.
- No automatic timeout or round count closes a disagreement.
- New tasks do not replace an unfinished review. A new task can be created for a newly discovered requirement, but the current task stays open.
- Security or privacy concerns are escalated immediately and block PASS until resolved.

## 14. Documentation and evidence index

The local release evidence index lives under `.evidence/` and lists local paths. Public release notes do not link to files intentionally absent from Git. The index covers:

- Task review reports under `.evidence/reviews/`.
- Challenge journal entries.
- Final videos and manifests under `.evidence/videos/`.
- CI runs and ordinary diagnostics.
- Package tarball checks.
- Performance reports.
- Browser and accessibility reports.
- MIT license evidence and publisher-context authorization status.
- Localization key-parity, locale/RTL browser evidence and the native-speaker review limitation.

Absence of local evidence or an ordinary diagnostic means the corresponding claim is unverified. Public docs must not link to absent local evidence. Local evidence is never committed or uploaded.
