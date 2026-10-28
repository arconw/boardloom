# Boardloom Task Graph

Status: T00 revised plan after round-1 review feedback, ready for re-review. This file plans work; it does not report completed implementation, passing tests or accepted stages.

Every task is a review gate. After the implementer finishes a task, the OC reviewer/tester and the CDX reviewer work independently on the same snapshot. A stage closes only when all its tasks and the stage integration check have explicit PASS from both reviewers. The protocol is in `WORKFLOW.md`.

## 1. Stage map

| Stage | Theme | Tasks | Exit outcome |
| --- | --- | --- | --- |
| S0 | Baseline and specification | T00 | Approved docs, traceability and baseline map; no runtime change |
| S1 | Foundations and contracts | T01-T04 | Reproducible workspace, headless core, versioned document, data contract |
| S2 | Design and neutral runtime | T05-T06 | Approved design references, framework-neutral viewer shell and lifecycle |
| S3 | Visualization and analysis | T07-T10 | Built-in visualizations, bindings, filters, comparisons |
| S4 | Realtime, editor, extensions | T11-T13 | Real WebSocket path, editor/drafts, public extension points |
| S5 | Framework adapters | T14-T16 | Real React, Angular and Svelte adapters and examples |
| S6 | Localization and RTL | T17 | Complete built-in locales, state-preserving locale switching, Arabic RTL |
| S7 | Quality and packaging | T18-T19 | Accessibility/responsiveness hardening, verified packages |
| S8 | Demo, docs, CI | T20-T22 | Pages demo, documentation, hardened CI/release gates |
| S9 | Release acceptance | T23 | v0.1 acceptance evidence and release decision package |

v0.1 MUST contain every mandatory FR in `SPEC.md`. Later version targets may raise scale ceilings and browser breadth; they may not postpone a mandatory capability. The product version is 0.x. npm publication is withheld until a publisher context and registry namespace are provided; licensing is MIT.

## 2. Standard task fields

Each task below records:

- Dependencies.
- Scope and non-scope.
- Expected outcomes and deliverables.
- Requirements and acceptance criteria covered.
- Checks the reviewer can reproduce.
- Video and local evidence plan.
- Review focus.

Command contract, created or confirmed in T01 and kept stable where possible:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:contract`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:a11y`
- `npm run test:i18n`
- `npm run verify:boundaries`
- `npm run verify:packages`
- `npm run verify:consumers`
- `npm run verify:acceptance-owners`
- `npm run build:docs`
- `npm run build:demo`
- `npm run scan:secrets`

The exact tool behind each script is selected in T01 after checking official primary documentation, then pinned in the repository. The command names use npm because npm is the current baseline; T01 may change the runner only if reproducible install and legacy compatibility are preserved and the change is recorded. A passing command is evidence only when the reviewer reruns it or reviews a recorded run with the same fingerprint.

Temporary files, test databases, raw recordings, logs and build artifacts MUST stay under `<project>/.tmp/`. Final selected videos and screenshots go to `.evidence/videos/<task-id>/` with a manifest. Challenge, review and video evidence is local only and MUST NOT be committed, uploaded to GitHub Releases or CI, or sent to an external service.

## 2.1 Normative acceptance ownership

Every global AC has exactly one final owner. T23 is the release-wide revalidation gate and is not a second feature owner; it finally owns only release-level criteria that no feature task can complete (AC-140, AC-141, AC-146) and revalidates all others. T00 contributes traceability for every ID but accepts planning completeness only, except AC-136 and AC-157 which it owns.

Each task's `Final acceptance` line is authoritative; its `Contributes` line lists evidence supplied to other owners. An early task can PASS its own scope without claiming a future criterion complete. `npm run verify:acceptance-owners` must fail on a missing or duplicate final owner.

| AC | Final owner | Contributors |
| --- | --- | --- |
| AC-001 | T12 | T02, T06 |
| AC-002 | T12 | T02, T03, T06 |
| AC-010 | T11 | T02, T06 |
| AC-011 | T12 | T02 |
| AC-012 | T06 | T02, T11, T12 |
| AC-020 | T03 | None beyond the final owner |
| AC-021 | T03 | T12 |
| AC-022 | T03 | None beyond the final owner |
| AC-030 | T04 | None beyond the final owner |
| AC-031 | T04 | T06 |
| AC-032 | T06 | T04 |
| AC-033 | T19 | T01 |
| AC-040 | T13 | T06, T07, T12 |
| AC-041 | T12 | T06 |
| AC-042 | T12 | T02, T03 |
| AC-050 | T13 | T07, T20 |
| AC-051 | T08 | T07 |
| AC-052 | T07 | T04 |
| AC-053 | T07 | None beyond the final owner |
| AC-060 | T08 | T07, T20 |
| AC-061 | T08 | None beyond the final owner |
| AC-070 | T09 | T20 |
| AC-071 | T09 | None beyond the final owner |
| AC-072 | T09 | T10 |
| AC-073 | T09 | None beyond the final owner |
| AC-080 | T10 | T09, T20 |
| AC-081 | T10 | None beyond the final owner |
| AC-090 | T11 | T04, T20 |
| AC-091 | T11 | T04 |
| AC-092 | T20 | T11 |
| AC-100 | T19 | T01, T06, T14, T15, T16 |
| AC-101 | T19 | T14, T15, T16 |
| AC-102 | T19 | T02, T06, T12, T14, T15, T16 |
| AC-110 | T13 | T20 |
| AC-111 | T13 | T05, T06, T18 |
| AC-120 | T12 | T05, T06, T07, T08, T17, T18 |
| AC-121 | T18 | T05, T07, T09, T10, T12, T14, T15, T16, T17 |
| AC-122 | T05 | None beyond the final owner |
| AC-130 | T21 | None beyond the final owner |
| AC-131 | T20 | None beyond the final owner |
| AC-132 | T19 | T01 |
| AC-133 | T22 | T01 |
| AC-134 | T22 | T19 |
| AC-135 | T21 | None beyond the final owner |
| AC-136 | T00 | T01, T21, T22 |
| AC-140 | T23 | T07, T11, T12, T17 |
| AC-141 | T23 | None beyond the final owner |
| AC-142 | T02 | T11 |
| AC-143 | T17 | T03, T04, T09, T10, T21 |
| AC-144 | T22 | T13, T20, T21 |
| AC-145 | T19 | T01, T22 |
| AC-146 | T23 | T19, T22 |
| AC-147 | T22 | T21 |
| AC-150 | T17 | T02, T05, T06, T19, T20, T21, T22 |
| AC-151 | T17 | T06, T21, T22 |
| AC-152 | T17 | T02, T04, T06, T14, T15, T16, T21, T22 |
| AC-153 | T17 | T06, T18, T20, T21, T22 |
| AC-154 | T17 | T03, T06, T13, T21 |
| AC-155 | T17 | T20, T21, T22 |
| AC-156 | T22 | T19, T21 |
| AC-157 | T00 | T01, T22 |

## 3. Tasks

### T00 - Baseline and documentation package

Dependencies: none.

Scope: read the English architect brief, inspect the existing project safely, produce the full T00 documentation set, apply the owner's binding updates (English documentation, MIT license, confirmed naming, localization requirements), preserve existing files, do not modify application source, configs, README or database.

Outcomes:

- `docs/framework/SPEC.md`
- `docs/framework/TASKS.md`
- `docs/framework/WORKFLOW.md`
- `docs/framework/BASELINE.md`
- `.evidence/README.md`
- `.evidence/challenges/CHALLENGES.md`
- `.evidence/videos/README.md`
- `.evidence/reviews/T00/implementer.md`
- `.evidence/reviews/T00/stage-paths.json`
- English translation of `docs/framework/ARCHITECT_BRIEF.md`
- English decision log in `.questions/README.md` (ignored by Git; not published)
- MIT `LICENSE`

Requirements: all FR, NFR and AC defined in `SPEC.md`, including localization FR-140 to FR-144, NFR-013, NFR-014, AC-156 and AC-157; T00 does not implement the framework. T00 owns AC-136 and AC-157 and contributes traceability to all others; remaining ACs are later gates.

Checks: documentation links resolve and public docs do not link to intentionally absent local evidence; every brief requirement maps to a task and acceptance criterion; every AC has exactly one final owner and the ownership table has no missing or duplicate owner; all project prose is English; owner confirmations and architect decisions are separated; localization FR/AC and the T17 task are present; local evidence policy and LICENSE are in the public review scope; `stage-paths.json` lists exactly the eight public files; the working public fingerprint is recorded locally and the staged tree is recorded separately; no fingerprint is embedded in a public hashed file; no source/config/README/DB change; no claim of implementation or passing tests; baseline contains no secrets or real data.

Video: N/A for UI. A real local documentation walkthrough recording is required under `.evidence/videos/T00/`; the traceability report is under `.evidence/reviews/T00/`. Nothing is committed or uploaded.

Review focus: missing requirements, contradictions with the brief, unverifiable acceptance criteria, unsafe baseline advice, invented claims, MIT/publishing boundaries, LICENSE review scope, English requirement preservation, localization coverage, local evidence policy, no broken links to absent local files, unique acceptance ownership, and the T00 fingerprint/stage-path exception.
Final acceptance: AC-136, AC-157.

Contributes: traceability coverage for all FR, NFR and AC; no implementation acceptance.

### T01 - Repository and quality foundation

Dependencies: T00.

Scope: establish the framework workspace without breaking the preserved legacy application; preserve existing local code; document a reversible migration plan; define package layout, toolchain, linting, typechecking, test tiers, package-boundary checks, ignore rules and architecture decision records. Verify the owner-confirmed MIT license and `LICENSE`, the confirmed `arconw/boardloom` naming, the planned scoped package names for tarball consumers, the npm restriction and the browser matrix. No product feature implementation.

Outcomes:

- Workspace and package skeleton with documented planned scoped names.
- Pinned toolchain and lockfile strategy; official-doc evidence for unstable tool behavior.
- Lint, format, typecheck and test command contract.
- `.gitignore` updates or verification for secrets, `.ctx`, transient files, coverage, build output and local databases; no secret values exposed.
- Ignore-rule verification that `.evidence/`, `.questions/`, `.tmp/`, secrets and local data stay uncommitted while the accepted planning package, LICENSE and safe public docs remain commit-ready.
- Reversible migration plan for preserving the existing local code while adding the framework workspace.
- Architecture decision records: confirm the recorded native-DOM runtime default, ECharts usage, ESM policy, realtime layering, workspace layout and package boundaries, with rationale and cost of change.
- CI skeleton for install, lint, typecheck and unit checks, with least privilege and pinned actions.
- Public stage-path manifest generator, acceptance-owner verifier and staged-tree gate for later tasks.
- Governance record: MIT confirmed and `LICENSE` present; brand Boardloom and repository `boardloom` confirmed; planned scoped names allowed for tarball consumers; npm publication withheld without publisher context; no registry-availability claim.

Requirements: FR-033, FR-100, FR-132, FR-133, FR-136, NFR-004, NFR-005, NFR-010.

Final acceptance: none.

Contributes: AC-033, AC-100, AC-132, AC-133, AC-136, AC-145, AC-157.

Checks: clean checkout install; lint/typecheck/unit commands; boundary check proves no legacy/server imports in framework packages; ignore-rule check does not print `.env` or `.ctx` content and confirms `.evidence/` stays local; stage-path generator and acceptance-owner verifier run; legacy TypeScript/build commands still behave as before or deviations are recorded; reversible migration plan and ADRs reviewed.

Video: N/A for product UI. Record a terminal/repository walkthrough and package-boundary demonstration.

Review focus: accidental rewrite of the legacy app, unpinned tooling claims, hidden secrets, local evidence accidentally committed, public stage scope, license overreach, broken legacy commands, vague workspace decisions.

### T02 - Headless core, spaces and lifecycle

Dependencies: T01.

Scope: implement the headless runtime, space isolation, event bus, state snapshots, view-local modes, editor lease, draft ownership, locale/timezone configuration, formatting/message-provider contracts, disposal, injected clock/ID factory/logger and stress harness. No DOM, no renderers, no built-in locale dictionaries beyond the English foundation.

Outcomes:

- Runtime and space creation/load/dispose API; view-local mode contract.
- Editor lease acquisition/release/conflict and draft revision/undo foundation.
- Locale/timezone configuration and formatter/message-provider contracts with an English foundation.
- Per-space state, event ordering and idempotent disposal.
- Isolation and leak tests, including create/switch/dispose stress.
- Public state snapshot contract with immutable values.

Requirements: FR-001, FR-002, FR-010, FR-011, FR-012, FR-042 (foundation), NFR-007, NFR-008.

Final acceptance: AC-142.

Contributes: AC-001, AC-002, AC-010, AC-011, AC-012, AC-042, AC-102, AC-150, AC-152.

Checks: `test:unit`, `test:contract`, `test:integration`, stress test with many spaces; listener/subscription/timer leak assertions; no DOM import in core; late callbacks ignored after dispose; viewer-bound command rejection while a sibling editor exists; second editor lease rejected; dirty-draft release requires a decision; locale/timezone contracts and English fallback.

Video: N/A, no UI. Code walkthrough with a trace of space isolation and disposal tests.

Review focus: module-global mutable state, event resurrection after dispose, draft loss on mode switch, hidden framework dependency, lease ambiguity, missing locale foundation.

### T03 - Board document, validation, migrations and import/export

Dependencies: T02.

Scope: implement schema v1, canonical serialization, stable IDs, layout, block/filter/comparison/theme envelopes, validation diagnostics, non-destructive import as a new space, export and migration harness. No full editor UI.

Outcomes:

- Versioned document types and validators.
- Diagnostic taxonomy and recovery paths.
- Migration chain with fixture corpus, including future-version rejection and round-trip determinism.
- Import size limits and safe parsing.
- Atomic import-as-new-space with a fresh runtime space ID, source-space preservation, and `space:imported` / `import:failed` events.
- Invalid import creates no space and changes no state, focus, committed document or draft.
- Document load/apply/export events.

Requirements: FR-002, FR-020, FR-021, FR-022, NFR-007, NFR-008, NFR-011.

Final acceptance: AC-020, AC-021, AC-022.

Contributes: AC-002, AC-042, AC-143, AC-154.

Checks: `test:contract`, `test:unit`; round-trip fixtures; duplicate ID, overlap, unknown property, invalid reference and future version cases; migration report assertions; no runtime handle in exported JSON; valid import creates a new space with a fresh runtime ID and leaves the source space, draft, undo, filters and subscriptions intact; invalid import creates no space and changes no state/focus.

Video: N/A, no UI. Code and fixture walkthrough.

Review focus: lossy serialization, unstable IDs, permissive unknown fields, silent migration, replace-in-place import, source draft loss, unsafe import.

### T04 - Data contract and query adapters

Dependencies: T02, T03.

Scope: implement dataset/field/slice descriptors, capabilities, local and async adapters, canonical query-key and generation foundation, query planning, abort, stale-result protection, loading/empty/partial/error states and timezone/unit descriptors. No chart UI, no realtime transport.

Outcomes:

- Provider contract and capability validation.
- Local fixture provider and async provider wrapper.
- Request token, canonical query key, generation and cancellation behavior.
- Query state machine and diagnostics, with older-generation results rejected.
- Deterministic synthetic fixture set aligned with the school-assessment domain without real records.

Requirements: FR-030, FR-031, FR-032, NFR-007, NFR-008, NFR-011.

Final acceptance: AC-030, AC-031.

Contributes: AC-032, AC-052, AC-090, AC-091, AC-143, AC-152.

Checks: `test:contract`, `test:unit`, `test:integration`; cancellation, query-key and generation tests; older-generation stale result rejection; empty versus zero versus error tests; unsupported capability rejection; timezone fixture tests.

Video: N/A, no UI. Code walkthrough and test trace.

Review focus: hidden backend dependency, silent filter dropping, stale overwrite across generations, fake error handling, real data leakage.

### T05 - Design system, reference mocks and visual acceptance

Dependencies: T01. Can start in parallel with core after T01 but must finish before T06.

Scope: produce the design system and reference mocks required before the large UI stage. No production viewer/editor implementation.

Outcomes:

- Token specification for color, typography, spacing, radii, elevation, motion, chart palette and focus.
- Light, dark and system theme direction.
- Viewer and editor compositions for desktop and narrow, including inspector/drawer behavior.
- State gallery: loading, empty, error, stale, partial, diagnostics, filter origin, comparison, realtime reconnect, plugin error.
- Accessibility annotations and keyboard/focus specification.
- Copy annotated with stable message keys, plus locale and RTL design annotations used from the first UI implementation.
- Visual acceptance checklist and screenshots/mocks in an agreed documentation location.
- Real UI is not claimed; mocks are explicitly labeled references.

Requirements: FR-120 (design basis), FR-121 (design basis), FR-122, FR-111, NFR-002.

Final acceptance: AC-122.

Contributes: AC-111, AC-120, AC-121, AC-150.

Checks: design review against the brief; token completeness; contrast calculations; 320 px and 200 percent zoom plans; reduced-motion plan; keyboard path for every core flow; stable message-key and RTL annotations; mock-to-acceptance checklist traceability.

Video: required design walkthrough covering viewer, editor, states and narrow layouts. Screenshots are supporting evidence, not a substitute for the walkthrough.

Review focus: generic or inconsistent visual direction, inaccessible contrast, color-only encoding, missing narrow/editor states, mock artifacts mistaken for implementation, unspecified visual acceptance.

### T06 - Framework-neutral DOM runtime and viewer shell

Dependencies: T02, T03, T04, T05.

Scope: implement the shared DOM runtime, mount/update/unmount, view-local modes, view/space ownership, locale/timezone provider using the T02 contracts and stable message keys from inception, viewer shell, block registry foundation, responsive layout, loading/empty/error states and basic text/KPI/table container surfaces. No editor and no full chart matrix.

Outcomes:

- Browser ESM view runtime with no UI framework dependency.
- Host contract implementation and cleanup.
- Viewer shell with title/meta, board grid, diagnostics, realtime status placeholder and accessible landmarks.
- View-local mode handling, sibling view independence and external-space ownership.
- Locale/timezone provider, English foundation, stable message keys and state-preserving updates.
- Responsive layout from the approved design tokens.
- Storybook-like internal fixtures only under `.tmp` or test fixtures, not published.

Requirements: FR-001, FR-010, FR-031, FR-032, FR-040 (foundation), FR-041 (layout foundation), FR-100, FR-102, FR-111, FR-120 (shell), NFR-002.

Final acceptance: AC-012, AC-032.

Contributes: AC-001, AC-002, AC-010, AC-031, AC-040, AC-041, AC-100, AC-102, AC-111, AC-120, AC-150, AC-151, AC-152, AC-153, AC-154.

Checks: `test:unit`, `test:integration`, `test:e2e` for mount/update/unmount, view-local mode switch and disposal; sibling unmount; viewer rejection with a sibling editor; external-space ownership; locale/timezone forwarding without state loss; stable keys; multiple instances; no style leakage; no DOM import from core; narrow viewport; keyboard landmarks.

Video: required viewer walkthrough in light/dark and narrow, plus mount/dispose lifecycle demonstration.

Review focus: accidental React dependency, global CSS leakage, listener leaks, fake loading states, inaccessible shell, divergence from approved mocks, hard-coded UI copy, view/space ownership ambiguity.

### T07 - Built-in renderers and field compatibility

Dependencies: T06.

Scope: implement line, area, bar, stacked bar, scatter, donut, KPI and table renderers, the renderer contract and the normative field-type compatibility matrix. Include ECharts spike and version decision. Implement null/empty/zero/negative/category order/format/unit semantics and stable message keys for renderer UI. No comparison or advanced filter UI.

Outcomes:

- Renderer registry and lifecycle.
- ECharts-backed chart renderers for the six chart types.
- KPI and table renderers with accessible alternatives.
- Data-shape and capability validation per renderer, enforcing the normative field-type matrix.
- Custom renderer test double and error containment.
- Baseline zero-line, negative-value and empty-data policies.
- Chart accessibility summaries/data alternatives.

Requirements: FR-040, FR-050, FR-051, FR-052, NFR-001, NFR-002, NFR-007, NFR-011.

Final acceptance: AC-052, AC-053.

Contributes: AC-040, AC-050, AC-051, AC-060, AC-120, AC-121, AC-140.

Checks: `test:unit`, `test:contract`, `test:e2e`, `test:a11y` for the renderer gallery; normative field-type matrix fixtures; fixture snapshots for null/zero/negative/empty; invalid combination rejection; custom renderer registration; stable message keys; size measurement; no misleading geometry.

Video: required renderer gallery walkthrough with all built-ins, invalid-combination diagnostics, empty/null/negative cases, keyboard and text alternative.

Review focus: silent fallback, matrix ambiguity, misleading baselines, category reordering, unit/format inconsistencies, ECharts coupling in core, inaccessible charts.

### T08 - Bindings, aggregation and fixed/selectable axes

Dependencies: T07.

Scope: implement X/Y/series/group/aggregation selection, binding validation, fixed/locked bindings and shared UI/API constraints. No full editor draft workflow yet, but configuration controls are available in the viewer/editor foundation as designed.

Outcomes:

- Binding model and validation.
- Aggregation selection with provider capability checks.
- Fixed binding rendering and rejection through API/import.
- Illegal-combination diagnostics with actionable messages.
- Tests proving UI and core agree.

Requirements: FR-051, FR-060, FR-061, NFR-008.

Final acceptance: AC-051, AC-060, AC-061.

Contributes: AC-120.

Checks: `test:contract`, `test:unit`, `test:e2e`; change selectable binding; rejected fixed binding; invalid field/aggregation/chart combination; viewer-bound command rejection while a sibling editor exists; lock is not presented as security.

Video: required axis/binding walkthrough, including fixed lock and diagnostic paths.

Review focus: UI/API divergence, silent substitution, lock described as security, unsupported aggregations.

### T09 - Scoped filters, typed operators and cross-filtering

Dependencies: T07, T08.

Scope: implement board, group and block filters; dataset-qualified field identity; explicit target IDs; typed number/category/date/range operators; default values and viewer-editable active values; deterministic composition; inheritance; origin display; reset; compatible cross-filtering and linked interactions; atomic rejection for unmapped or incompatible targets; comparison-side symmetric mapping. Include filter block UI.

Outcomes:

- Filter model, validation, defaults and serializable runtime state using dataset-qualified field identity.
- Explicit mapping model shared by ordinary filters and cross-filters; no label matching.
- Deterministic composition engine with conflict diagnostics and atomic rejection that retains the prior accepted state.
- Filter origin chips and reset paths.
- Cross-filter runtime state, compatibility checks and loop suppression.
- Filter manager UI and filter block.
- Pending/error state for deferred schema discovery.

Requirements: FR-070, FR-071, FR-072, FR-073, NFR-007, NFR-008, NFR-011.

Final acceptance: AC-070, AC-071, AC-072, AC-073.

Contributes: AC-080, AC-121, AC-143.

Checks: `test:contract`, `test:unit`, `test:e2e`, `test:a11y`; composition order fixtures; timezone boundaries; conflicting filters; unsupported cross-filter target; multi-dataset board with unmapped, mapped and incompatible fields; atomic rejection with prior state retained; comparison-side mapping/rejection; no echo loop; per-space isolation.

Video: required filter walkthrough across all three scopes, origin/reset, incompatible target and cross-filter.

Review focus: hidden global filters, label-based identity, order ambiguity, date boundary bugs, silent target inference, partial board update, asymmetric comparison filtering, persisted cross-filter mutation.

### T10 - Comparisons

Dependencies: T07, T08, T09.

Scope: implement dataset/slice comparison, field mapping, composite alignment after explicit grouping/aggregation, duplicate/null-key handling, independent time windows, unit policy, overlay and side-by-side, absolute and percentage deltas, missing-pair and zero-denominator handling, count semantics and rejection diagnostics. Include the required negative-reference, duplicate-key, null-key, matched-null and zero fixtures.

Outcomes:

- Comparison definition and validation with dataset-qualified mappings.
- One-row-per-composite-key alignment after explicit grouping/aggregation; duplicate output keys rejected.
- Null composite-key exclusion with counted diagnostics; outer alignment for missing pairs.
- Comparison query planning and renderer-neutral result with row/matched/missing/excluded/non-null counts.
- Overlay and side-by-side presentation.
- Absolute and percentage deltas with the specified arithmetic, negative references, zero denominators and matched null/non-finite reasons.
- Comparison builder UI.

Requirements: FR-080, FR-081, NFR-007, NFR-011.

Final acceptance: AC-080, AC-081.

Contributes: AC-072, AC-121, AC-143.

Checks: `test:contract`, `test:unit`, `test:e2e`; compatible and incompatible mappings; composite alignment keys; duplicate keys after aggregation; null composite keys; matched null/non-finite measures; negative reference; zero denominators; missing keys; unit mismatch; timezone windows; no fabricated zero; expected values from SPEC section 11.3.

Video: required comparison walkthrough with successful comparison, side-by-side, percentage delta, zero denominator and rejected incompatible slices.

Review focus: fabricated pairs, duplicate-key first-row choice, null-to-null matching, misleading percentages, zero-denominator handling, hidden unit conversion, timezone window errors, diagnostics that do not explain rejection.

### T11 - Realtime contract, WebSocket adapter and buffers

Dependencies: T04, T07.

Scope: implement the canonical query-shaped live contract, mandatory envelope identity, query/generation invalidation, snapshot/update handshake, sequencing, deduplication, gap detection, reconnect/backoff, resync, bounded buffers, pause/resume, backpressure, status, unsubscribe and space switching. Track primary/reference generations separately. Implement the real WebSocket adapter and the separate in-memory simulation transport.

Outcomes:

- Realtime contracts and state machine for query-shaped rows with mandatory dataset/query-key/generation/epoch/sequence/cursor fields.
- Query invalidation and subscription replacement on filter, binding, projection, grouping or comparison-input changes.
- Snapshot/subscribe handshake, cursor replay or authoritative snapshot, pre-snapshot buffering and stale/loading states.
- WebSocket adapter using consumer-provided endpoints and options.
- Bounded-buffer and backpressure instrumentation.
- Local real WebSocket integration test server and suite.
- Simulated transport with an explicit simulation flag.
- Status UI integration.

Requirements: FR-090, FR-091, FR-092, NFR-001, NFR-008.

Final acceptance: AC-010, AC-090, AC-091.

Contributes: AC-012, AC-092, AC-140, AC-142.

Checks: `test:unit`, `test:contract`, `test:integration`, `test:e2e`; real local socket test for snapshot, order, duplicate, out-of-order, reconnect, resync, pause/resume, overflow, unsubscribe; adversarial query-vs-update races, filter/binding changes, old-generation callbacks, reconnect during query replacement, primary/reference generations; space switch isolation; no unbounded memory; no payload/credential logging.

Video: required realtime walkthrough with status changes, reconnect/resync, pause/resume and space switch; the demo simulation label is shown separately.

Review focus: fake transport standing in for the integration test, raw-row patches in aggregated results, older snapshot overwriting newer stream data, missing generation/epoch identity, unbounded buffers, stale updates after resync, silent drops, cross-space delivery, credential leakage.

### T12 - Editor, drafts, layout operations and serialization

Dependencies: T06, T08, T09, T10.

Scope: implement the full editor: block library, add/delete/duplicate/reorder/move/resize with keyboard alternatives, property inspector, draft/apply/cancel, undo/redo, view-local mode switching without loss, editor lease and revision conflict handling, import-as-new-space UI, theme editing and lossless serialization. Integrate filter and comparison builders. No replace-in-place import.

Outcomes:

- Editor shell matching the approved mocks.
- Block operations for every built-in type and registered block.
- Draft revision model, undo/redo, apply validation, atomic commit, revision conflict rejection and explicit dirty-draft lease release.
- Import action creates and activates a new space, labels the operation clearly and preserves the source space, dirty draft, undo, filters and subscriptions.
- Responsive inspector/drawer behavior.
- Theme editor with validated tokens.
- Round-trip save/export.

Requirements: FR-001, FR-002, FR-040, FR-041, FR-042, FR-120, FR-121, NFR-002.

Final acceptance: AC-001, AC-002, AC-011, AC-041, AC-042, AC-120.

Contributes: AC-012, AC-021, AC-040, AC-102, AC-121, AC-140.

Checks: `test:unit`, `test:contract`, `test:e2e`, `test:a11y`; block CRUD on all types; keyboard move/resize; draft persistence across mode switch; cancel restoration; undo/redo bounds; apply validation; revision conflict preserves draft and rejects overwrite; second editor lease rejected; dirty-draft lease release requires a decision; import creates a new space and preserves the source draft; invalid import changes no state or focus; responsive editor.

Video: required full editor walkthrough, including keyboard move/resize, undo/redo, apply/cancel, revision conflict, second lease rejection, mode switch, import-as-new-space and export/viewer.

Internal checkpoints (same task and review sessions, not separate tasks): C1 editor shell, block operations and keyboard layout; C2 draft/lease/revision/import and serialization; C3 responsive/theme integration and final evidence. Reviewers may review each checkpoint but PASS applies to the complete task.

Review focus: destructive draft loss, viewer mutation, editor lease ambiguity, revision overwrite, replace-in-place import, source draft loss, inaccessible drag-only layout, serialization gaps, editor state leaking between spaces.

### T13 - Public extension points and plugin isolation

Dependencies: T07, T11, T12.

Scope: expose block type, renderer, query adapter, realtime adapter, formatter, message-dictionary and theme extension registries; implement compatibility checks, registration errors, per-space instance lifecycle and style scoping. Provide a reference plugin block/renderer for the demo. Provide the locale-override registration hook used by T17.

Outcomes:

- Public extension contracts and version metadata.
- Registry with duplicate/override policy and diagnostics.
- Reference custom block and custom renderer.
- Formatter/theme extension examples.
- Error containment and disposal tests.
- Scoped style strategy verified with two instances.

Requirements: FR-040, FR-050, FR-110, FR-111, FR-141, NFR-008, NFR-003.

Final acceptance: AC-040, AC-050, AC-110, AC-111.

Contributes: AC-144, AC-154.

Checks: `test:contract`, `test:unit`, `test:e2e`; duplicate ID; incompatible API; invalid schema; broken renderer contained; plugin disposal; multiple instances with no CSS collision.

Video: required plugin walkthrough: register, add block, custom renderer, error case, dispose.

Review focus: registries as hidden global mutable state, unsafe eval, uncontained plugin errors, style leakage, version claims without checks.

### T14 - React adapter and runnable example

Dependencies: T06, T12, T13.

Scope: implement the React adapter against the shared host contract and a runnable example consuming the built package. Cover props/inputs, events, imperative handle, locale/timezone props, forwarding and state-preserving updates against the T02/T06 foundation, host message overrides, mount/update/unmount cleanup and viewer/editor switching. Full built-in locale and RTL acceptance is owned by T17.

Outcomes:

- `@boardloom/react` package.
- React example with synthetic data.
- Adapter tests, strict-mode behavior and cleanup tests.
- Consumer smoke test from a packed tarball.
- Locale/timezone forwarding and host message override demonstration without claiming full built-in locale acceptance.

Requirements: FR-100, FR-101, FR-102, NFR-002.

Final acceptance: none.

Contributes: AC-100, AC-101, AC-102, AC-121, AC-152.

Checks: `test:unit`, `test:e2e`, `verify:consumers`; React StrictMode mounts/unmounts; no duplicate instances; events; editor/viewer; locale/timezone forwarding and state preservation; host message overrides; cleanup.

Video: required React example walkthrough, including locale/timezone forwarding and host override. Full built-in locale/RTL validation is recorded under T17.

Review focus: React logic duplicated from the DOM runtime, leaked roots, broken StrictMode, example using source alias only.

### T15 - Angular adapter and runnable example

Dependencies: T06, T12, T13.

Scope: implement the Angular standalone-component adapter and example consuming the built package, including inputs, outputs, locale/timezone inputs, forwarding and state-preserving updates against the T02/T06 foundation, host message overrides, lifecycle cleanup, zone considerations and viewer/editor switching. Full built-in locale and RTL acceptance is owned by T17.

Outcomes:

- `@boardloom/angular` package.
- Angular example and tests.
- Packed-tarball consumer test.
- Locale/timezone forwarding and host message override demonstration without claiming full built-in locale acceptance.

Requirements: FR-100, FR-101, FR-102, NFR-002.

Final acceptance: none.

Contributes: AC-100, AC-101, AC-102, AC-121, AC-152.

Checks: `test:unit`, `test:e2e`, `verify:consumers`; change detection integration; destroy cleanup; no duplicate mount; locale/timezone forwarding and state preservation; host message overrides.

Video: required Angular example walkthrough, including locale/timezone forwarding and host override. Full built-in locale/RTL validation is recorded under T17.

Review focus: change-detection conflicts, lifecycle leaks, unsupported Angular version claims, source-alias-only example.

### T16 - Svelte adapter and runnable example

Dependencies: T06, T12, T13.

Scope: implement the Svelte adapter and example consuming the built package, including props, events, locale/timezone props, forwarding and state-preserving updates against the T02/T06 foundation, host message overrides, reactive updates, lifecycle cleanup and viewer/editor switching. Full built-in locale and RTL acceptance is owned by T17.

Outcomes:

- `@boardloom/svelte` package.
- Svelte example and tests.
- Packed-tarball consumer test.
- Locale/timezone forwarding and host message override demonstration without claiming full built-in locale acceptance.

Requirements: FR-100, FR-101, FR-102, NFR-002.

Final acceptance: none.

Contributes: AC-100, AC-101, AC-102, AC-121, AC-152.

Checks: `test:unit`, `test:e2e`, `verify:consumers`; reactive update behavior; destroy cleanup; no duplicate mount; locale/timezone forwarding and state preservation; host message overrides.

Video: required Svelte example walkthrough, including locale/timezone forwarding and host override. Full built-in locale/RTL validation is recorded under T17.

Review focus: reactivity destroying state, lifecycle leaks, unsupported Svelte version claims, source-alias-only example.

### T17 - Localization, locale switching and RTL

Dependencies: T06, T07, T09, T10, T11, T12, T13, T14, T15, T16.

Scope: implement the complete localization layer for built-in locales `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar` and `hi`; stable message keys; host overrides and custom dictionaries; deterministic English fallback; safe interpolation; pluralization; `Intl` number/date/time/duration/unit formatting; explicit timezone independent from UI language; locale switching without state loss; Arabic RTL scoped to the board host; localized ARIA/status/error/diagnostic copy. No accessibility audit or docs/demo acceptance in this task.

Outcomes:

- Locale contract and documented stable message keys, including framework messages for viewer, editor, charts, KPI, table, filters, comparison, realtime status, diagnostics and plugin host errors.
- Complete built-in locale dictionaries with key parity.
- Host override/custom dictionary merge with documented precedence and validation.
- Interpolation and pluralization utilities with deterministic missing-parameter behavior.
- Locale provider with state-preserving switches and explicit timezone.
- RTL layout provider scoped to the Boardloom host.
- Key-parity checker, fallback/interpolation tests and browser locale/RTL flows.
- Localization documentation inputs for T21.
- Full locale/RTL acceptance over the plain JS/TS view and the React, Angular and Svelte adapters.
- Adapter revalidation against the completed locale layer.

Requirements: FR-140, FR-141, FR-142, FR-143, FR-144, NFR-002, NFR-013.

Final acceptance: AC-143, AC-150, AC-151, AC-152, AC-153, AC-154, AC-155.

Contributes: AC-120, AC-121, AC-140.

Checks: `test:i18n`, `test:unit`, `test:contract`, `test:e2e`, `test:a11y` for localized labels; key parity for all built-in locales; missing-key fallback; interpolation injection cases; plural rules; locale switch preserves board, draft, undo, filters, cross-filter, comparison and realtime state; timezone independence; Arabic RTL scoped; host data labels and values unchanged; no locale stored in the persisted document; React, Angular and Svelte adapters revalidated against the completed locale layer.

Video: required language-switching walkthrough in viewer and editor, including charts, filters, comparison, realtime status, English/Russian, a CJK locale and Arabic RTL. Show that state and draft survive switching. Do not claim professional or native-speaker translation quality.

Review focus: hard-coded UI strings, missing ARIA/status/error keys, English fallback leaking into a complete locale, unsafe interpolation, locale switch losing draft or filters, timezone coupled to language, global RTL leakage, silent translation of host data, locale persisted in the document, fake parity using English placeholders, and adapters not revalidated. Non-Latin dictionaries must be real localization assets; if an agent policy prevents authoring a script, an approved localization asset must be used and recorded, not invented.

Internal checkpoints (same task and review sessions, not separate tasks): C1 contracts, English foundation, complete keys and all dictionaries; C2 formatting, timezone, switching and host overrides; C3 Arabic RTL, all flows and full adapter revalidation. Reviewers may review each checkpoint but PASS applies to the complete task.

### T18 - Accessibility and responsive hardening

Dependencies: T06, T07, T09, T10, T12, T14, T15, T16, T17.

Scope: run and fix the full accessibility and responsive audit against WCAG 2.2 AA and the design acceptance criteria. Add keyboard alternatives, focus management, live regions, chart data alternatives, contrast and motion fixes, 320 px and 200 percent zoom behavior. No new feature scope.

Outcomes:

- Accessibility audit report with automated and manual evidence.
- Fixed keyboard/focus/live-region/data-alternative issues.
- Visual regression coverage for light, dark and narrow.
- Updated limitations for any residual non-conformance, with owner approval; otherwise fix.

Requirements: FR-121, FR-120, NFR-002.

Final acceptance: AC-121.

Contributes: AC-111, AC-120, AC-153.

Checks: `test:a11y`, `test:e2e`, manual keyboard checklist, axe zero critical/serious, contrast report, reduced-motion checks, 200 percent zoom, 320 px reflow, screen-reader notes, multiple-instance style isolation.

Video: required keyboard-only walkthrough of viewer and editor plus assistive-technology evidence and narrow layout.

Review focus: automated-only accessibility claims, drag-only operations, focus traps, color-only encoding, missing data alternatives, unapproved residual issues.

### T19 - Package exports and tarball consumers

Dependencies: T14, T15, T16, T17, T18.

Scope: finalize package exports, declarations, CSS entry points, ESM output, side effects, peer dependencies, source maps, package contents, locale-pack packaging, boundary checks and tarball consumer matrix. Record the UMD/CJS decision and versioning policy. Planned scoped names may be used for tarball consumers without a registry-availability claim; npm publication remains withheld.

Outcomes:

- Verified `exports` maps and declarations for each package.
- CSS entry and token import verification.
- `npm pack` contents audit without legacy, server or secret files.
- Clean consumer fixtures for plain JS, TypeScript, React, Angular and Svelte under `.tmp`, including built-in locale imports and locale overrides.
- Explicit ESM-only/CJS status, version policy, MIT `LICENSE` inclusion and locale-pack contents.
- Package-boundary and forbidden-import checks.
- Reviewed public file manifest for packed artifacts and staged-tree gate for subsequent tasks.

Requirements: FR-132, FR-134, FR-033, NFR-004, NFR-005, NFR-006.

Final acceptance: AC-033, AC-100, AC-101, AC-102, AC-132, AC-145.

Contributes: AC-134, AC-146, AC-150, AC-156.

Checks: `verify:boundaries`, `verify:packages`, `verify:consumers`, `verify:acceptance-owners`, build, typecheck; inspect packed contents; browser ESM smoke test; no unverified UMD/CJS claim; semver 0.x; reviewed public file manifest and staged-tree gate.

Video: N/A for product UI, but include a terminal and example walkthrough showing tarball installation and consumer startup.

Review focus: exports that work only from source, missing declarations/CSS, forbidden files, unverified compatibility claims, premature 1.0.0.

### T20 - DEMO branch and GitHub Pages demonstration

Dependencies: T11, T12, T13, T17, T19.

Scope: build the reproducible static demo on the `DEMO` branch using the same package API. Cover editor to save/export to viewer, second board, comparison, all built-ins, all filter scopes, axes fixed/selectable, realtime simulation, plugin block, language switching and Arabic RTL. Configure correct Pages base path. Show synthetic data and transport type.

Outcomes:

- Demo app and static build.
- DEMO branch workflow and Pages deployment configuration.
- E2E coverage of every showcased capability.
- Visible simulation and data provenance labels.
- Language switch across built-in locales and an Arabic RTL mode scoped to the board host.
- Correct base path for `arconw/boardloom`.

Requirements: FR-131, FR-092, FR-050, FR-070, FR-060, FR-080, FR-090, FR-110, FR-140, FR-143, NFR-003, NFR-013.

Final acceptance: AC-092, AC-131.

Contributes: AC-050, AC-060, AC-070, AC-080, AC-090, AC-110, AC-144, AC-150, AC-153, AC-155.

Checks: `build:demo`, `test:e2e` against the built base path, Pages deployment dry run, link and asset checks, no backend/secret/private API, editor/export/viewer flow, plugin and realtime simulation labels.

Video: required complete demo walkthrough including language switching and Arabic RTL. Raw runs stay in `.tmp`; final edited video and manifest go to `.evidence/videos/T20/`.

Review focus: demo using source-only internals, missing required flows, wrong base path, simulation presented as real transport, real data leakage, broken locale switching or RTL leakage.

### T21 - Documentation, API reference and migration guide

Dependencies: T17, T19, T20.

Scope: write the English product README and docs: cover and real UI screenshots, five quickstarts, data contract example, architecture diagram, viewer/editor, filters, comparison, realtime, plugins, localization/RTL, lifecycle, pages link, API docs, recipes, limitations and migration guide from ClassScope.

Outcomes:

- Strong English README.
- Quickstarts verified against packed packages for JS, TS, React, Angular and Svelte.
- API reference and recipes.
- Localization guide with locale list, stable keys, overrides, fallback, interpolation, timezones and RTL.
- Explicit limitation that translations are not professionally or natively certified.
- Limitations and trust model.
- Migration guide mapping the current assessment app to Boardloom without moving backend, database, secrets or real records.
- Selected public screenshots and demo link, distinct from raw local review/test evidence.
- No Markdown links to intentionally absent `.evidence/` files.

Requirements: FR-130, FR-135, FR-136, FR-140, FR-141, FR-142, FR-143, FR-144, NFR-009, NFR-005, NFR-013.

Final acceptance: AC-130, AC-135.

Contributes: AC-136, AC-143, AC-144, AC-147, AC-150, AC-151, AC-152, AC-153, AC-154, AC-155, AC-156.

Checks: `build:docs`, link check including no links to absent `.evidence/` files, quickstart commands rerun, selected public screenshots from the real demo, migration guide review, no claim unsupported by local evidence.

Video: required documentation walkthrough and quickstart demonstration; screenshots supplement but do not replace it.

Review focus: README snippets that do not work, mock screenshots, broken links to absent local evidence, missing Pages link, migration guide that implies moving private data, unverified feature claims, or non-English project documentation.

### T22 - CI, Pages deployment and release gates

Dependencies: T17, T19, T20, T21.

Scope: harden and finalize PR checks, Pages deployment, release workflow, security scanning, package consumer matrix, localization checks, ordinary CI diagnostics, concurrency, permissions and pinning. Keep npm publication disabled until a publisher context is provided. Separate PR, Pages and release workflows. CI must never upload challenges, review reports or videos.

Outcomes:

- PR workflow with install, lint, typecheck, unit/contract/integration/E2E/a11y/i18n, docs/demo build, boundaries, package/tarball consumers and redacted secret scan.
- Pages workflow restricted to approved DEMO artifact.
- Manual gated release workflow with dry-run while publication is unauthorized.
- Ordinary build/test diagnostics (logs, coverage, traces) and retention policy; no selected review/test screenshots, local review evidence or video upload.
- Documented environment versions, action pins and lockfile policy.
- Locale key-parity, fallback/interpolation and browser locale/RTL checks.
- No secrets required for PR tests.

Requirements: FR-133, FR-134, FR-136, FR-140, FR-141, FR-142, FR-143, NFR-003, NFR-004, NFR-005, NFR-006, NFR-013, NFR-014.

Final acceptance: AC-133, AC-134, AC-144, AC-147, AC-156.

Contributes: AC-136, AC-145, AC-146, AC-150, AC-151, AC-152, AC-153, AC-155, AC-157.

Checks: workflow lint or dry run, permissions review, pinned SHA review, concurrency review, fork-PR safety, ordinary failure-diagnostics capture (logs, coverage, traces), no `.evidence` upload, Pages base-path deployment check, secret-scan redaction, release dry run, npm publish absent.

Video: N/A for product UI. Provide a CI run walkthrough and permission/pinning evidence.

Review focus: over-broad permissions, unpinned actions, PR workflows with secrets, accidental npm publish, local evidence or video upload, missing localization or accessibility checks, diagnostics containing secrets or real data.

### T23 - v0.1 acceptance and release decision

Dependencies: T00-T22.

Scope: integrate all evidence, run the full acceptance suite on the release candidate, measure performance and browser support, audit localization coverage and traceability, verify no unresolved P0/P1 challenge, and prepare a release decision package. No new feature scope.

Outcomes:

- Acceptance report mapped to every FR/NFR/AC with local evidence paths under `.evidence/`; public docs do not link to absent local files.
- Unique acceptance-owner audit: every AC has one final owner; T23 revalidates all and owns only AC-140, AC-141 and AC-146.
- T00 unborn-base fingerprint and stage-path manifest evidence, plus later reviewed public file manifests and staged-tree gates.
- Performance report on the declared fixture and environment.
- Browser matrix E2E results.
- Localization evidence: key parity for all built-in locales and real browser coverage for English, Russian, a CJK locale and Arabic RTL; stored locally.
- Security/privacy audit and package boundary report.
- Both reviewer verdicts on the identical final fingerprint, stored locally under `.evidence/reviews/T23/`.
- Release notes draft, version recommendation (0.x), known limitations.
- MIT license and `LICENSE` presence, confirmed brand/repository naming, planned package names, and explicit withholding of npm publication without publisher context.

Requirements: all FR/NFR/AC; NFR-001, NFR-005, NFR-006, NFR-009, NFR-010, NFR-012, NFR-013, NFR-014.

Final acceptance: AC-140, AC-141, AC-146.

Contributes: All other AC revalidated by this release gate; not repeated as contributor.

Checks: full CI on the release candidate; `test:unit`, `test:contract`, `test:integration`, `test:e2e`, `test:a11y`, `test:i18n`, `verify:boundaries`, `verify:packages`, `verify:consumers`, `verify:acceptance-owners`, `build:docs`, `build:demo`; T00 fingerprint and stage-path manifest plus the current staged tree; performance measurement; localization coverage audit; traceability and unique-owner audit; challenge audit.

Video: required final regression walkthrough of viewer, editor, filters, comparison, realtime, plugins, adapters, locale switching, RTL and demo. The local release manifest records final video paths and checksums under `.evidence/videos/T23/`; nothing is uploaded.

Review focus: any unverified requirement, stale evidence, mismatched fingerprint, unresolved challenge, hidden deferral, premature release claim, or unverified localization coverage.

## 4. Requirement coverage summary

Every brief requirement is covered:

- Viewer/editor, state preservation, spaces, isolation and lifecycle: T02, T06, T12, T23.
- Versioned document, import/export, validation and migration: T03, T12, T21.
- DataSource/Dataset/Slice and adapters: T04, T06.
- Blocks, layout, undo/redo, draft/apply/cancel: T06, T12.
- Built-in charts, custom renderer, field matrix, data semantics: T07.
- X/Y/series/group/aggregation and fixed axes: T08.
- Filter scopes, typed operations, composition, origin and cross-filter: T09.
- Comparison mapping, windows, units and deltas: T10.
- Realtime contract, WebSocket, buffers and honest demo: T11, T20.
- Framework-neutral runtime and React/Angular/Svelte adapters: T02, T06, T14-T16, T19.
- Extension points, tokens and scoped styles: T05, T13, T18.
- Design, accessibility, responsive and reference mocks: T05, T17, T18.
- Localization, built-in locales, overrides, fallback, interpolation, timezone formatting and Arabic RTL: T17, T20, T21, T22, T23.
- Documentation, README, quickstarts, API docs, recipes, migration: T21.
- Demo branch and Pages: T20.
- Packaging, exports, consumers and ESM decision: T19.
- CI, Pages, release, permissions, pinning, secret scanning: T01, T22.
- MIT license and confirmed naming: T00, T01, T19, T23. npm publication withheld without publisher context; planned scoped names may be used for tarball consumers.
- Review protocol, local challenges and video evidence: T00, all review gates, `WORKFLOW.md`, `.evidence/README.md`.
- Local evidence publication policy: NFR-014, AC-156, all review gates, T22, T23.
