# ADR-0005: Package boundaries and supply-chain enforcement

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: FR-033, FR-100, NFR-004 and SPEC sections 1 and 17.1

## Context

The legacy application uses Fastify, Prisma and SQLite. Those runtime dependencies must never enter framework packages or packed artifacts. A public repository could also accidentally publish local source, secrets, generated output, undeclared internal dependencies or source-only export targets. Source review alone is not a repeatable boundary check.

## Decision

The framework package graph is explicit and enforced in manifests and source:

| Package                        | Allowed internal packages | Allowed external packages |
| ------------------------------ | ------------------------- | ------------------------- |
| `@boardloom/core`              | none                      | none                      |
| `@boardloom/view-dom`          | core                      | none                      |
| `@boardloom/renderers-echarts` | core                      | `echarts`                 |
| `@boardloom/react`             | core, view-dom            | `react`, `react-dom`      |
| `@boardloom/angular`           | core, view-dom            | `@angular/core`           |
| `@boardloom/svelte`            | core, view-dom            | `svelte`                  |

`npm run verify:boundaries` inspects `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, `bundledDependencies` and `bundleDependencies`. It parses static imports, re-exports, dynamic imports, `require`, TypeScript import-equals and type-import forms. It rejects Node built-ins, server packages, SQL clients, ORMs, database drivers, legacy paths, absolute or escaping imports, `eval` and dynamic `Function` construction. A source import must be declared in runtime dependencies or be the package itself.

The checker also validates `main`, `module`, `types`, `style`, `browser`, `exports` and `files` metadata. Export targets must be package-relative, must stay inside the package and may only expose `dist`, `styles.css` or `package.json`. Source exposure, tests, local directories and outside-package targets fail. Source metadata may point to `dist` before it exists; the checker reports a build-required state instead of pretending the target exists.

Publishable builds are staged under `.tmp/build/packages/<package>`, each with its own manifest, `dist`, declarations, source maps, LICENSE, README and required styles. `npm run verify:packages` requires that staging, checks every declared target exists and runs `npm pack` against the staging directory and inspects the tarball file list under `.tmp/build/packs`. Source package manifests keep standard package-relative exports. They never point outside the package or into project `.tmp`.

The package manifests are private at T01. Tarball consumer installation and final packed-artifact acceptance remain T19 work and are rechecked in T22. Root development dependencies are locked and never become runtime package dependencies.

## Consequences

- Boundary violations fail locally and in the PR CI skeleton.
- Core remains browser-safe, dependency-free and framework-neutral.
- Renderer and adapter exceptions are explicit rather than a general external-package allowance.
- Source metadata and built staging are checked separately, so a missing build is actionable.
- Packed file lists are checked before T19 finalizes the consumer matrix.

## Cost of change

Adding a permitted internal edge or external dependency requires updating the policy table and the ADR; an unreviewed edge fails the check. Adding a new publishable file requires updating the source `files` allowlist and the staging verifier. Relaxing the checks would increase the risk of publishing backend, legacy or source-only material.

## References

- `docs/framework/SPEC.md` sections 1 and 17.1
- `docs/framework/decisions/ADR-0002-native-dom-runtime.md`
- `scripts/verify-boundaries.mjs`, `scripts/verify-packages.mjs`, `scripts/build-package.mjs`
