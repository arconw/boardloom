# Boardloom Baseline

Status: T00 revised map after round-1 review feedback, ready for re-review. This is a semantic baseline, not a source listing. It contains no secrets, real records, database contents or local environment values.

Inspection date: 2026-10-28. Working project: `/home/arcon/dev/export/chartConstructor`.

Sensitive material deliberately not read: `.env`, `.ctx`, `prisma/dev.db`, any credentials, any real data export. The existing README and screenshots were treated as project documentation and visual reference, not as a source of real records.

## 1. Repository snapshot

Observed facts at inspection:

- The repository is initialized on branch `main` with remote `origin` set to `https://github.com/arconw/boardloom.git`.
- `main` had no commits. All project files were untracked at the time of the baseline check.
- A `.gitignore` exists. At inspection it was incomplete; by the final T00 check the root had expanded it to ignore `.env`, `.ctx`, `.tmp/`, `.questions/`, `.evidence/`, the retired `docs/framework/CHALLENGES.md` and `docs/framework/reviews/` paths, the legacy `video-materials/` path, plus common secret, database and build patterns. Local evidence under `.evidence/` is intentionally not committed; public docs, LICENSE and safe planning files remain commit-ready.
- At inspection there was no license file. During T00 the owner confirmed MIT and the repository `LICENSE` was added. The copyright holder string is `Boardloom contributors` and may be replaced by the owner.
- There is no CI configuration, no release workflow and no Pages workflow.
- There is no lint script at the root, in the frontend package or in a workspace configuration.
- The project is not a workspace. The root and frontend each have their own `package.json` and lockfile.
- Build output (`dist/`, `frontend/dist/`) and coverage output exist in the working tree but are untracked and must not be treated as accepted evidence.
- `.evidence/videos/` contains no evidence videos yet. Local evidence is intentionally ignored by Git.
- `.evidence/reviews/T00/` contains the T00 implementer handoff; reviewer reports have not started.

Observed tool versions:

- Node.js v24.21.0 and npm 11.19.0 were available in the inspection environment.
- Root `package.json` declares Node.js `>=22`.
- Root TypeScript is 5.9.3. Frontend TypeScript range is 5.9.x.
- Root Vitest is 3.2.7 with coverage v8 3.2.7. Frontend Vitest and coverage are 4.1.12. This split is a migration risk.
- Root package is private and versioned 1.0.0. Frontend package is private and versioned 1.0.0. Neither is a publishable Boardloom package.

## 2. Existing application map

### Backend

- Fastify 5 TypeScript API, Prisma 6.19.3, SQLite, Zod 3.25.
- Modules: assessments and metrics, with controller, service, repository, mapper and schema layers.
- Endpoints: assessment list/detail/filter-options/submit, metric catalog and health.
- Domain: assessment, school, class, student, metric, metric option and result.
- The data model already expresses several concepts Boardloom generalizes: a dataset (assessment), dimensions (school, class, student, time), measures (numeric metrics), ordered categorical values (text metrics) and a result table.
- Integration tests include large synthetic submissions. Test helpers create temporary SQLite databases through the operating system temp directory. That pattern must not be copied into Boardloom tests because project rules require `.tmp/`.
- The backend is not part of Boardloom runtime or packages. It is a migration source and a source of domain vocabulary only.

### Frontend

- React 19, Vite 7, TanStack Query 5, Zustand 5, ECharts 5 and SCSS.
- Single analysis page for a chosen assessment.
- Controls: chart type (line, bar, scatter), mode (classic, stacked, group by), X/Y metric selection, second Y metric for stacked mode, grouping metric and polynomial trend lines.
- Filter dimensions: school and class, with a select-all control, a minimum-one-series rule and independent selections per dimension.
- Data computation: observation pairing per student, ordered category scales from metric options, school/class series, mean aggregation for numeric measures, mode for text measures, deterministic text and numeric grouping, overflow into "Other", missing-group slice and numeric bins.
- Chart behavior: nice five-tick numeric axes with padding, zero-bound clamping for zero-based data, category axes for ordered text metrics, bar width planning and wheel scrolling, tooltip HTML rendering with escaping, zoom preservation, responsive resize and disposal of ECharts instances.
- UX: loading skeleton, empty index, empty metric catalog, error state with retry, dark visual system, desktop and narrow breakpoints.
- Localization baseline: UI copy is hard-coded English. Number and date formatting are fixed to `en-US` and UTC in the frontend. There is no message catalogue, locale switcher, RTL layout, ARIA localization or host override mechanism. Localization is therefore a new framework capability, not a refactor of an existing layer.
- Tests: frontend unit and component tests for ticks, bar layout, regression, formatting, data model, store, controls, filter panel and page empty state. No browser E2E, no accessibility audit and no package consumer tests were observed.

### Documentation and assets

- `README.md` documents ClassScope, its data model, metric catalog, API, run commands, chart behavior and structure. It is existing user documentation and must not be overwritten by Boardloom work without an explicit migration task.
- `docs/` contains real UI screenshots from the legacy application. They are historical visual reference for existing chart behavior only. They must not be copied into the Boardloom README or presented as Boardloom product evidence. New public documentation screenshots must come from the real Boardloom demo.
- The existing visual language is a dark analytical workspace with green and teal accents, Space Grotesk and JetBrains Mono, card panels, small uppercase labels, a numbered rail and a right-side filter panel.
- The legacy screenshots are historical reference only. Do not copy them as new product evidence. The owner-provided project is authorized source for this development; preserve any concrete third-party notices and constraints discovered.

## 3. What to reuse

Reuse as concepts and, where licensing is confirmed, as a starting point:

- Domain vocabulary: assessment as dataset slice, school/class/student as dimensions, metric as measure or category, result as row value.
- Chart correctness ideas: nice numeric ticks with padding, ordered category scales, unknown values after declared values, explicit missing-group handling, bar density planning and zoom preservation.
- Data shaping patterns: pairing rows by stable entity IDs, deterministic group ordering and explicit empty states.
- Tooltip and formatting lessons: escaping text, unit-aware formatting, locale-aware numbers, zero versus null, disclosure of aggregation count.
- Testing patterns: focused unit tests for pure chart math, component tests for controls, integration tests with large synthetic fixtures, and deterministic seeds.
- Chart locale-neutrality: raw category values and numeric formatting helpers can inform the Boardloom formatter boundary, but hard-coded English labels and fixed `en-US`/UTC assumptions must not be reused.
- Visual direction: tokenized dark theme, distinctive typography, restrained accent palette and editor/viewer separation. The Boardloom design must be its own system, not a rebranded copy.
- Existing ECharts experience: renderer lifecycle, resize observer, disposal, zoom retention and tooltip customization can inform the ECharts renderer package.

Reuse only after an architecture decision and package-boundary check:

- Polynomial regression and trend-line behavior as an optional chart capability, not as a core requirement.
- Existing chart option construction, refactored behind a renderer-neutral spec.
- Existing SCSS tokens and layout primitives, re-expressed as Boardloom design tokens and scoped styles.

## 4. What to isolate

Do not include in Boardloom core or published packages:

- Fastify, Prisma, SQLite, database drivers, server modules, server-only validation schemas, environment loading, seed code and backend tests.
- The fixed ClassScope assessment API shape as if it were the general data contract.
- The global Zustand singleton, page-level state, assessment-specific defaults (study hours, math, attendance, final grade) and school/class-only filter model.
- ClassScope branding, legacy navigation, "Legacy module" labels and the existing single-page composition.
- Hard-coded English UI strings, fixed `en-US`/UTC formatting and any assumption that the host page direction is left-to-right.
- The existing README as the Boardloom README. Preserve it until a deliberate migration.
- Build outputs, coverage output, stale `.tsbuildinfo` and local caches as source of truth.
- Any real records, database files, environment values, prompts or private context.

Structural isolation:

- New framework packages must import neither legacy application source nor generated directories.
- If the framework lives in the same repository, boundary checks must prove that published artifacts contain no legacy or server files.
- The legacy application may remain runnable during framework development. Replacing it is a later, separately reviewed migration, not a side effect of package work.

## 5. Risks

1. No committed baseline: `main` has no commits and the working tree was untracked. Reviews cannot rely on Git history until the architect establishes a baseline commit or otherwise confirms the snapshot protocol. The public initial commit should contain only the accepted planning package, `LICENSE` and a safe `.gitignore`; no unreviewed legacy source or real data. T01 must preserve existing local code and document a reversible migration plan.
2. Local evidence policy: the challenge journal, review reports and videos are intentionally excluded from Git under `.evidence/`. They are local deliverables, not public repository content, and must never be uploaded to GitHub Releases, CI or an external service. Public README/docs screenshots are separate approved assets; CI uploads only ordinary build/test diagnostics.
3. License and source authorization: MIT is confirmed for the new Boardloom repository. The owner-provided project is authorized source for this requested development; preserve concrete third-party notices and constraints. Do not copy legacy screenshots as new product evidence. No repeat owner permission is required for hypothetical provenance worries.
4. Package naming and publication: brand Boardloom, repository `boardloom` and owner `arconw` are confirmed. Planned scoped package names may be used for tarball consumers while registry namespace ownership is unverified. No npm registry-availability claim and no publication without a publisher context.
5. Architecture drift: React, Zustand, TanStack Query and ECharts are present in the legacy frontend. The framework must stay framework-neutral in core and provide real adapters. Copying the page into a "library" would fail the brief.
6. Data semantics: the current app is coupled to one dataset shape, one aggregation choice per chart type and school/class filtering. Generalizing without a capability contract risks silent illegal combinations, misleading null/zero behavior and untestable provider assumptions.
7. Localization: the legacy UI is hard-coded English with fixed `en-US`/UTC formatting. The required built-in locales, including CJK and Arabic RTL, need real dictionary assets, key parity, interpolation safety, state-preserving switching and RTL tests. Professional/native-speaker certification is not available and must not be claimed.
8. Testing gap: no E2E, accessibility, package consumer or real WebSocket tests were observed. Coverage directories exist but current pass status was not verified and must not be claimed.
9. Toolchain split: two lockfiles, two Vitest majors and no lint or workspace contract increase reproducibility and upgrade risk.
10. Temporary-file rule violation risk: the existing backend test helper uses the operating system temp directory. New work must use the project `.tmp/` and must not copy that helper unchanged.
11. Evidence gap: no reviewer videos or reports exist yet. The T00 implementer handoff is local under `.evidence/reviews/T00/`; T00 is documentation-only and cannot claim UI evidence.
12. Public screenshot sourcing: the legacy screenshots are historical reference only and must not be copied as new product evidence. Boardloom public screenshots must come from the real Boardloom demo.
13. Package surface: no exports map, declarations, CSS entry, tarball test, browser ESM test or UMD/CJS decision exists. Publishing is therefore not ready even if feature code appears complete.
14. Scale: existing backend tests exercise 20,000 and 60,000 results, while the browser UI receives a whole assessment payload. Boardloom has no measured browser performance baseline yet.
15. Accessibility: the existing UI has semantic labels and some focus styles, but no verified keyboard path, live-region strategy, chart data alternative or WCAG audit.

## 6. Unknowns

- Concrete third-party notices or constraints in the owner-provided source, to be preserved if discovered.
- Publisher context and registry namespace ownership for any future npm release.
- Source and linguistic quality of non-Latin locale dictionaries, and the absence of native-speaker review.
- Exact browser support matrix and final toolchain pins.
- Exact ECharts version and renderer package split after the T07 spike.
- Expected data scale, latency and realtime message rates for real consumers.
- Final realtime sequence ownership and resync transport details within the recorded protocol default.
- Locale asset provenance and any non-Latin dictionary source; English placeholders are not accepted as parity.
- Which date bucket boundaries are required beyond the explicit timezone model.
- Current test pass status; no test command was run during T00.
- Whether any concrete third-party notice in the owner-provided source requires attribution or an additional constraint; hypothetical provenance concerns are not blockers.
- Whether the legacy application will be migrated, kept as an example, or retired after Boardloom acceptance.

## 7. Migration guidance for later documentation

The migration guide in T21 should treat the current project as a source of domain and chart behavior, not as a runtime to embed:

1. Map assessment to a dataset slice, results to rows, school/class/student/time to dimensions, numeric metrics to measures and text metrics to ordered categorical dimensions.
2. Provide a consumer-side `DatasetProvider` example that queries an assessment without putting the backend or SQL into Boardloom.
3. Re-express the current page as a Boardloom board document: chart blocks, filter block, axis bindings, category ordering and a theme.
4. Keep the legacy API and database untouched. The migration is an adapter and a document, not a database rewrite.
5. The owner-provided project is authorized source for this development. Preserve concrete third-party notices and do not move real records, secrets or private context. Do not copy legacy screenshots as new product evidence.
6. Add regression checks for tick behavior, category order, aggregation disclosure, null/zero handling, responsive layout and accessibility.
7. Cut over behind a feature flag or separate example. Preserve a rollback path until acceptance.
8. Replace hard-coded English UI strings and fixed `en-US`/UTC formatting with stable message keys, locale packs and explicit timezone configuration. Do not silently translate host field labels or data values.
9. Document what intentionally does not migrate: global store assumptions, assessment-specific defaults, server-only validation, hard-coded locale assumptions and the legacy visual identity.

## 8. Baseline conclusions

- The existing project has useful domain vocabulary, chart correctness lessons, a coherent visual direction and solid unit-level testing habits.
- Its backend and application shell must be isolated from Boardloom packages.
- The most urgent baseline risks are not feature gaps but safety and reproducibility: no committed baseline, local evidence that must stay out of Git and external uploads, no CI and no package verification. MIT licensing, brand, repository and package naming are confirmed; the owner-provided source is authorized; localization is now a required new capability. Legacy screenshots are historical only and must not be copied as product evidence.
- T00 does not change the application. T01 must establish a reproducible, secret-safe foundation before feature work begins.
