# Toolchain evidence for T01

Status: evidence collected on 2026-10-28 before the T01 handoff. Only official primary sources and npm registry metadata are treated as evidence. Secondary summaries are not used to justify unstable behavior.

## Pinned versions

| Package           | Version   | Source of version                                                                         |
| ----------------- | --------- | ----------------------------------------------------------------------------------------- |
| Node.js           | `24.21.0` | Local `node --version`; Node release page confirms the 24 line is LTS.                    |
| npm               | `11.19.0` | Local `npm --version`; npm 11 documentation is the reference for workspaces and `npm ci`. |
| TypeScript        | `5.9.3`   | npm registry metadata; supported by typescript-eslint.                                    |
| ESLint            | `10.13.0` | npm registry metadata; ESLint v10 documentation.                                          |
| typescript-eslint | `8.72.1`  | npm registry metadata; dependency-version page.                                           |
| Prettier          | `3.9.10`  | npm registry metadata; official documentation.                                            |
| Vitest            | `5.0.5`   | npm registry metadata; official guide.                                                    |
| Vite              | `7.3.7`   | npm registry metadata; Vitest requires Vite `>=6.4.0`.                                    |

## Verified behavior and primary sources

| Topic                           | Primary source                                                                                                       | Evidence used                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js release line            | https://nodejs.org/en/about/previous-releases                                                                        | Node 24 is listed as LTS (Krypton). Node 22 is also LTS. Node 24 supports Active LTS use.                                                                                                    |
| npm workspaces                  | https://docs.npmjs.com/cli/v11/using-npm/workspaces                                                                  | Workspaces are defined by the root `workspaces` field, linked during `npm install`, and commands can run with `--workspaces` and `--if-present`.                                             |
| Frozen clean install            | https://docs.npmjs.com/cli/v11/commands/npm-ci                                                                       | `npm ci` requires an existing lockfile, fails when the lockfile and manifests disagree, never writes them, and removes an existing `node_modules` first.                                     |
| Node package entry points       | https://nodejs.org/api/packages.html                                                                                 | `"type": "module"` selects ESM for `.js`; `"exports"` is the recommended modern entry-point field; export targets must be relative and encapsulated; condition order is significant.         |
| ESLint flat config              | https://eslint.org/docs/latest/use/configure/configuration-files                                                     | `eslint.config.js` exports an array of configuration objects; global ignores use a configuration object with only `ignores`; `defineConfig` and `globalIgnores` are supported.               |
| typescript-eslint support range | https://typescript-eslint.io/users/dependency-versions/                                                              | Supported ESLint range includes `^10.0.0`; supported TypeScript range is `>=4.8.4 <6.1.0`. This is why T01 pins TypeScript 5.9.3 and defers TypeScript 7.                                    |
| typescript-eslint setup         | https://typescript-eslint.io/getting-started/                                                                        | Flat-config quickstart uses `@eslint/js`, `typescript-eslint` and `eslint/config`; recommended configs are combined with `defineConfig`.                                                     |
| Vitest runtime support          | https://vitest.dev/guide/                                                                                            | Vitest 5 requires Vite `>=6.4.0` and Node `>=22.12.0`; `vitest run` executes once; configuration can live in `vitest.config.*`.                                                              |
| Vitest coverage output          | https://vitest.dev/config/#coverage-reportsdirectory                                                                 | Coverage supports an explicit `reportsDirectory`; T01 sets it to `.tmp/testing/coverage`.                                                                                                    |
| Vite cache location             | https://vite.dev/config/shared-options#cachedir                                                                      | Vite supports an explicit `cacheDir`; T01 sets it to `.tmp/vite`.                                                                                                                            |
| Prettier behavior               | https://prettier.io/docs/                                                                                            | Prettier is an opinionated formatter with check and write commands, configuration files and ignore files. Formatting is kept separate from ESLint.                                           |
| GitHub Actions hardening        | https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions | Use least-privilege `GITHUB_TOKEN` permissions and pin actions to a full-length commit SHA when a workflow dependency lockfile is not used. Avoid `pull_request_target` with untrusted code. |
| Action pin resolution           | `git ls-remote https://github.com/actions/checkout` and `https://github.com/actions/setup-node`                      | The CI skeleton pins `actions/checkout` v7.0.1 at `3d3c42e5aac5ba805825da76410c181273ba90b1` and `actions/setup-node` v7.1.0 at `949feb2413d6458794dcd2491c4babbbce0c15c1`.                  |

## Registry metadata checks

The exact versions and support ranges above were checked with the npm registry through `npm view`, including `engines`, `peerDependencies` and `peerDependenciesMeta` for the pinned tools. The lockfile is the authoritative resolution for the workspace.

## Limitations

- The `@boardloom` npm namespace ownership and registry availability are not verified and are not claimed. Packages remain private and publication is withheld.
- The browser support matrix is planned, not verified. Final browser E2E evidence belongs to T23 and AC-146.
- The CI workflow was authored as a skeleton and was not executed on GitHub in T01. Local commands and clean-checkout simulation are the T01 evidence.
- TypeScript 7 is not used because typescript-eslint 8.72.1 supports TypeScript below 6.1.0.
