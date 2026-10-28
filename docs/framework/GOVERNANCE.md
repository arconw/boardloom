# Boardloom governance record

Status: T01 governance record. It separates owner confirmations from architecture decisions and records the licensing, naming, publication and browser boundaries in force.

## Owner confirmations

- Project path: `/home/arcon/dev/export/chartConstructor`.
- Public repository: https://github.com/arconw/boardloom, owner `arconw`, public visibility.
- Product brand: Boardloom. Repository slug: `boardloom`. The titlecase brand and lowercase repository are intentional.
- Architecture: standalone client library with application adapters. There is no Boardloom-owned server, SQL client, ORM or database runtime.
- License: MIT. The repository `LICENSE` is present and uses `Copyright (c) 2026 Boardloom contributors`. The owner may replace the holder string without changing the MIT terms.
- Documentation language: English. User-interface locale dictionaries naturally contain their respective languages.
- GitHub Pages deployment is authorized.
- npm publication is not authorized without a provided publisher context and registry namespace.
- Existing local files, the legacy application, its database and user history are preserved. Real records, credentials and private context are excluded.
- Local review evidence stays under ignored `.evidence/` and is never committed, released, uploaded by CI or sent to an external service.

## Architecture decisions in force

- Runtime foundation: framework-neutral native DOM runtime, headless core and thin React, Angular and Svelte adapters.
- Chart engine: ECharts isolated behind the renderer contract; the exact version is fixed in T07.
- Packaging: browser ESM only for v0.1, with TypeScript declarations and a CSS entry. UMD and CommonJS are not promised.
- Workspace: root npm workspace with `packages/*`, `examples/*` and `apps/demo`; the legacy application is isolated and recoverable from the local `LEGACY` branch.
- Realtime: transport-independent orchestration owned by the core, with a separate WebSocket adapter and mandatory dataset, query-key, generation, epoch and sequence/cursor identity.

Full rationale and the cost of changing each decision are recorded in `docs/framework/decisions/`.

## Planned package names

These scoped names are planned for tarball consumers. They do not assert npm namespace ownership or registry availability.

| Package                        | Role                                                                                            | Publication status              |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| `@boardloom/core`              | Headless runtime, document, contracts, filters, comparisons, realtime orchestration, registries | Private skeleton; not published |
| `@boardloom/view-dom`          | Framework-neutral viewer and editor DOM runtime, design tokens, accessible shell                | Private skeleton; not published |
| `@boardloom/renderers-echarts` | Built-in ECharts renderers                                                                      | Private skeleton; not published |
| `@boardloom/react`             | React host adapter                                                                              | Private skeleton; not published |
| `@boardloom/angular`           | Angular host adapter                                                                            | Private skeleton; not published |
| `@boardloom/svelte`            | Svelte host adapter                                                                             | Private skeleton; not published |

No package claims registry availability, ownership of the `@boardloom` scope or a release. T19 may produce and verify tarballs. Publication requires a separate explicit owner decision and publisher context.

## Licensing and release boundaries

- MIT is the project license. Every package declares `license: MIT` and includes `LICENSE` in its packed files.
- The first accepted release is 0.x. No `1.0.0` is assigned before acceptance.
- No legacy screenshot, logo or asset is presented as Boardloom product evidence.
- No release may contain secrets, real records, local databases, review evidence, videos or private context.

## Browser matrix

Planned support: current stable Chrome, Edge, Firefox and Safari on desktop, plus the previous major version where CI capacity allows. This is a planning default, not a verified compatibility claim. T23 owns final browser E2E evidence and AC-146. Until then, no browser version is described as tested.

## Reproducibility and security

- Node.js `24.21.0` and npm `11.19.0` are pinned for the framework workspace; legacy Node `>=22` history stays in `LEGACY`.
- One root lockfile is used with `npm ci` for clean installs.
- CI uses read-only repository permissions, a concurrency group and full-SHA pinned actions.
- Local evidence, `.env`, `.ctx`, databases and generated output are ignored. Publishable builds are staged under `.tmp/build/packages`, coverage under `.tmp/testing/coverage`, and Vite/Vitest caches under `.tmp/vite`; source-local `dist` is not permitted.
- The public-surface scanner and metadata-reading quality tools classify every path segment and reject protected names, local-only directories, traversal, absolute paths, symlinks and linked ancestors before reading or writing content. Missing permitted manifest parents can be created only under the intended evidence or `.tmp` roots after containment checks. Malformed manifest diagnostics do not echo input. Findings report file paths and rule identifiers only, never matched values.

## Evidence policy

The challenge journal, implementer and reviewer reports, raw recordings and verification media live under local `.evidence/`. Public documentation may refer to the path as plain text but must not link to files intentionally absent from Git. Product screenshots selected for public documentation are separate approved assets.
