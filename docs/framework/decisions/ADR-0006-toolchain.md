# ADR-0006: Pinned toolchain and reproducible installs

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: Q017, NFR-005 and SPEC section 21.2

## Context

The legacy repository had two lockfiles, two Vitest majors, no lint contract and no pinned workspace. Reviews must reproduce the same install from a clean checkout. The framework needs a current Node LTS line, browser ESM builds, TypeScript declarations and a test runner that works on Node without a DOM.

## Decision

The framework workspace pins:

| Tool              | Pin       | Reason                                                       |
| ----------------- | --------- | ------------------------------------------------------------ |
| Node.js           | `24.21.0` | Observed local LTS line; recorded in `.nvmrc` and `engines`. |
| npm               | `11.19.0` | Observed npm major with workspace and lockfile support.      |
| TypeScript        | `5.9.3`   | Supported by typescript-eslint 8.x (`<6.1.0`).               |
| ESLint            | `10.13.0` | Flat-config line supported by typescript-eslint 8.x.         |
| typescript-eslint | `8.72.1`  | Supports ESLint 10 and TypeScript 5.9.                       |
| Prettier          | `3.9.10`  | Formatting is separate from lint.                            |
| Vitest            | `5.0.5`   | Node test runner compatible with Node 24.                    |
| Vite              | `7.3.7`   | Required Vitest peer and proven by the legacy frontend.      |

All direct dependencies are exact versions in `package.json`, and one root `package-lock.json` is committed. `.npmrc` enables `engine-strict` and `save-exact`. A clean checkout installs with `npm ci`; development installs use `npm install` only to change the lockfile intentionally. Publishable package builds are staged in `.tmp/build/packages`, coverage is written to `.tmp/testing/coverage`, and Vite/Vitest caches use `.tmp/vite`. Build, test, coverage, cache, probe and temporary output stays under `.tmp/`, never in package-local `dist` or root `coverage` and never `/tmp`. The only retained non-`.tmp` generated artifacts are unrelated legacy outputs that predate T01.

The legacy application keeps its historical Node `>=22` range inside the `LEGACY` branch and is not part of the framework workspace install.

## Consequences

- A clean checkout has one reproducible dependency graph.
- Tool upgrades are deliberate lockfile changes with updated evidence.
- TypeScript 7 is deferred until typescript-eslint supports it; using an unsupported combination would produce warnings and unreliable lint behavior.
- The workspace requires Node 24.21.x for local development and CI.

## Cost of change

Raising a pin requires checking official support ranges, regenerating the lockfile, rerunning the full command contract and recording the change. Moving to another package manager would require a new lockfile, workspace semantics and CI changes. Floating versions are rejected because they make reviews irreproducible.

## References

- `docs/framework/decisions/toolchain-evidence.md`
- `docs/framework/GOVERNANCE.md`
- `package.json`, `.npmrc`, `.nvmrc`, `package-lock.json`
