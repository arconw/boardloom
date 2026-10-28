# Boardloom: Architectural Brief

Status: input architect requirements for T00; implementation has not been performed or accepted. This is the English version of the original Russian brief, translated per the owner's binding update; all substantive requirements are preserved.

## Product and boundaries

Boardloom is an installable client-side framework for building analytical board interfaces and their visual editor. The goal is a flexible standalone product with strong design, not a wrapper around the current application. Develop in stages without artificially complicating the public API.

Confirmed by the owner: public GitHub `arconw/boardloom`; architecture of "client library plus application adapters". Working project: `/home/arcon/dev/export/chartConstructor`. Package names, license and concrete compatibility are fixed in the specification with regard to availability and rights to the source base; do not publish to npm on behalf of a nonexistent organization. The repository and GitHub Pages are authorized; npm publication requires separate approval of the publishing account.

The current backend, Prisma and database are not part of the runtime or published packages. Reproducible synthetic fixtures based on the application domain are allowed; do not transfer real records, dumps, credentials or private URLs. Preserve existing local files. Deletion, reset, overwriting user data or history is forbidden.

## Mandatory capabilities

1. Two independent modes: BoardViewer and BoardEditor. Viewer allows interaction with charts and available filters; only Editor changes structure and settings. Switching modes must not lose state.
2. Multiple isolated spaces. A space has an identifier and manages one board, its configuration, runtime state, subscriptions and lifecycle. Creating a new board creates a new space. Hidden global storage, leaks of filters or data between spaces, and residual subscriptions after dispose are forbidden.
3. A versioned serializable board document: layout, blocks, data slice references, chart specs, filters, comparisons, theme. Separate non-serializable adapters and runtime handles. Import/export, runtime validation, clear errors, and a migration strategy.
4. An explicit DataSource/Dataset/Slice contract: field schema, types, dimensions, measures, units, timezone, stable identifiers, allowed operations, capability discovery. Local data and an async query adapter; cancellation, stale-response protection, loading/empty/error. Do not include a server or SQL client in the packages.
5. Block structure: chart, metric/KPI, table, text and filter; an extensible type registry. Add, delete, duplicate, reorder, resize, responsive layout. Undo/redo, draft/apply/cancel, and lossless serialization.
6. Built-in line, area, bar, stacked bar, scatter, donut, KPI and table, plus custom renderer registration. The specification must include a compatibility matrix with field types. Null, empty, zero, negative values, category order, formatting and units must not create a misleading picture.
7. Selection of X/Y, series, grouping and aggregation; selectable and fixed/locked bindings. Schema constraints apply equally in the UI and API. Do not silently build illegal combinations. Axis locking is a configuration constraint, not a promise of protection against a malicious actor.
8. Filters for the whole board, a selected group of blocks and an individual block; explicit target IDs, inheritance, reset, and display of origin. Typed operations (number, category, date, range); compatible cross-filtering and linked interactions. Fix a deterministic composition order and the behavior of incompatible fields.
9. Comparison with another dataset/slice: explicit mapping of dimensions and measures, alignment keys, time windows and units. Overlay, side-by-side, absolute and percentage delta; missing pairs and division by zero are shown explicitly. Incompatible slices are rejected with clear diagnostics.
10. Realtime through a shared subscribe contract and a WebSocket adapter. Snapshot plus updates, ordering, duplicates, reconnect, resync, bounded buffers/window, pause/resume and backpressure policy. Unsubscribe, errors, connection status and space switching. The static Pages demonstration honestly labels simulation; a separate integration test with a local real WebSocket verifies the transport.
11. Framework-neutral runtime installable in plain JavaScript and TypeScript; real adapters and runnable examples for React, Angular and Svelte. A shared state contract, mount/update/unmount management and cleanup; no dependency of core on a specific UI framework. A text example in the README must not be considered a confirmed integration.
12. Public extension points for block types, chart renderers, query/realtime adapters, formatting and themes. Define plugin compatibility and registration errors. Fix CSS variables/design tokens and style scope.
13. Design: a coherent expressive system with consistent typography, spacing, colors, light and dark themes, careful parameter editor and states. Keyboard accessibility, focus, labels, reduced motion, contrast, text alternatives for data. Desktop and narrow screens. Reference mockups and visual acceptance criteria are mandatory before the large UI stage.
14. Documentation: a strong README with a cover and screenshots of the real UI, working quickstarts for five environments, a data contract example, an architecture diagram, editor/viewer, filters, comparison, realtime, plugins, lifecycle, and a link to Pages. API docs, recipes and limitations, and a migration guide from the current project.

## Demonstration and delivery

The `main` branch contains the framework, documentation and example sources. A separate `DEMO` branch contains a reproducible HTML demonstration on GitHub Pages that uses the same package API. Editor to save/export to viewer, another board, dataset comparison, all built-in visualizations, all filter scopes, fixed/selectable axes, realtime and a plugin block must be available through the interface. Show the synthetic data used and the transport type. No mandatory backend, secrets or external private API. Configure the correct Pages base path.

Packages have a documented exports map, JavaScript runtime, TypeScript declarations, CSS entry, and verifiable installation from a tarball. Browser ESM for plain HTML; the UMD/CJS decision must be explicit, without promising unverified support. Examples consume the built distribution, not only source through workspace aliases. Version number and SemVer tags are assigned after acceptance, without a premature `1.0.0`.

CI: reproducible installation with a lockfile, lint, typecheck, meaningful unit/contract tests, integration tests, browser E2E, accessibility, package/tarball consumer checks for all adapters, docs/demo build, published-package boundary checks, and secret scanning without revealing matches. Minimal permissions, pinned actions, concurrency, separation of PR checks / Pages deploy / release, artifacts on failure. The implementer sets concrete environment versions after checking official documentation; versions are fixed in the repository. No secrets for PR tests.

## Execution protocol

For EACH task, three separate sessions living in its context:

- OC implementer: OpenCode, DeepSeek V4.1 Flash 1017, implementation and fixes.
- OC reviewer/tester: a separate session of the same model, reading the implementation, independent checks, regressions, recording UI testing video and reviewing relevant code.
- CDX reviewer: a separate Codex session `gpt-6.1-sol`, effort `low`, independent review of sources and architecture; not implementation.

The OC implementer finishes first, then both reviewers work independently. The architect passes both reviewers' findings to the implementer, reconciles disagreements and returns the changed version for repeat review in the SAME sessions. New tasks do not replace unfinished reviews. There is no unconditional round limit that automatically closes problems.

The architect/orchestrator does NOT read implementation sources or diffs, does NOT run implementation checks, and does NOT replace reviewers with a personal audit. The architect reads the specification, task/review reports and Git/CI metadata, and manages tasks, feedback, the repository, branches, commits and tags. Each stage receives a commit only after explicit PASS from both reviewers for the same final version. Commits have ordinary substantive messages, without AI mentions and without AI co-authors; do not replace the user's Git identity.

Reviewer reports are local evidence under `.evidence/reviews/<task-id>/` and contain the task ID, reviewed snapshot fingerprint, session/model, findings with priority and reproduction conditions, commands run and results, unverified items, local artifact paths, and a PASS/CHANGES_REQUESTED/BLOCKED verdict. PASS is not allowed while any task requirement or mandatory check remains unresolved. Do not require UI video in a documentation task without UI, but honestly record N/A and provide an applicable code/docs walkthrough.

`.evidence/challenges/CHALLENGES.md` is the single append-only journal maintained by OC testers: task ID, date, challenge, reproduction/symptom, cause, resolution, verification, artifact links, status. Preserve history; do not overwrite entries from previous tasks.

`.evidence/videos/<task-id>/` contains selected final videos, screenshots and a manifest with description, time/scenario, relation to challenges and version. Screenshots do not replace video. Do not record secrets, home files or unauthorized data; do not use Chrome DevTools MCP. Playwright/ffmpeg are allowed. Raw runs, intermediate scripts, logs, build/test artifacts and backups stay only inside `<project>/.tmp/`, never `/tmp`; final selected evidence is a deliberate local deliverable under `.evidence/`. Challenges, review reports and videos MUST NOT be committed to Git, uploaded to GitHub Releases, uploaded by CI or sent to an external service. Product screenshots deliberately selected for the public README or documentation are separate public documentation assets; they are not raw review/test evidence. CI may upload ordinary build/test diagnostics such as logs, coverage and traces according to the CI request, but never the cumulative challenge journal, review reports, selected review/test screenshots or video recordings. Public docs may mention local evidence paths as plain paths but must not contain broken Markdown links to files intentionally absent from Git.

All participants follow the user's AGENTS rules: do not read `.ctx`, do not read sensitive files without separate permission, do not reveal secrets, do not create code comments, do not perform destructive operations, do not push or commit on their own. The architect records exceptions and unknowns honestly.

## T00 result

OC studies the sources, structure and safe documentation, then compiles, without quoting code in the report to the architect:

- `docs/framework/SPEC.md`: a verifiable detailed specification with FR/NFR/AC IDs, contracts, events and lifecycle, UX flows, capability matrices and non-goals;
- `docs/framework/TASKS.md`: a sequential task graph T00... with dependencies, scope, outcomes, criteria, checks and a video capture plan; every requirement item has a task;
- `docs/framework/WORKFLOW.md`: a concrete repeatable protocol for the three sessions, handoff/review formats, journal, version snapshot, Git/CI/release gates;
- `docs/framework/BASELINE.md`: a map of the existing project, what to reuse and what to isolate, risks and unknowns; only semantic conclusions, without sources;
- `.evidence/README.md`: the local evidence layout and retention policy;
- `.evidence/challenges/CHALLENGES.md`: the initial journal, which the OC reviewer then maintains;
- `.evidence/videos/README.md`: rules for recording and cataloging, not invented materials;
- `.evidence/reviews/T00/implementer.md`: a short handoff without code, ready for two reviewers;
- `.evidence/reviews/T00/stage-paths.json`: the exact public stage list;
- `LICENSE` (MIT) and licensing statements, included in the public document review scope.

Public docs may mention `.evidence/` paths as plain paths, but must not contain broken Markdown links to files intentionally absent from Git. Challenge journals, review reports and videos are local evidence and are not committed or uploaded.

The project must not be reworked before the baseline is clarified. T00 does not implement the framework and does not change the current runtime. The owner-provided project is authorized source for this requested development; preserve concrete third-party notices and do not copy legacy screenshots as new product evidence. The public initial commit should contain only the accepted planning package, `LICENSE` and a safe `.gitignore`, with no unreviewed legacy source or real data. T01 must preserve existing local code, establish the framework workspace and document a reversible migration plan.
