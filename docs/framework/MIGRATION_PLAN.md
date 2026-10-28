# Reversible migration plan for the legacy application

Status: T01 plan. No legacy source, database, environment file or user document is deleted or moved by this task.

## Preserved baseline

The original non-sensitive application source and configuration were preserved before framework work in a local Git branch named `LEGACY`. The branch was not pushed. Its commit, tree and path manifest are recorded in the local `.evidence/legacy-source-snapshot.json`; the boundary decision is recorded in `.questions/legacy-preservation.md`.

The preservation boundary excludes `.env`, `.ctx`, credentials, the actual SQLite database, generated output, dependencies, local evidence, questions and temporary material. Those local files remain in place and are never read, copied or published by the architect.

The current worktree still contains the original `src/`, `frontend/`, `tests/` and `prisma/` directories as local originals. T01 does not delete or relocate them.

## What T01 changes

- The root `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts` and related root configuration now describe the framework workspace.
- The original versions of those files are recoverable from `LEGACY`.
- Legacy directories are ignored by the framework workspace so they cannot be staged accidentally.
- The framework packages live under `packages/` and do not import legacy source, Prisma, a server framework or a database driver.
- Publishable framework builds are staged under `.tmp/build/packages`; source packages keep standard package-relative export metadata and do not own generated `dist` directories.

## Why root commands changed

A clean public clone must install, lint, typecheck and test without the untracked legacy source. Keeping the legacy backend dependencies and build scripts at the root would either make a clean clone fail or place server, SQL and database dependencies in the public workspace install. Both outcomes conflict with FR-033, NFR-004 and the owner's client-only boundary. Therefore root commands now belong to the framework workspace.

This is an explicit, recorded deviation: the legacy commands are no longer the framework-root commands. They remain reproducible from `LEGACY` until the migration guide and cutover are accepted.

## Reversible route

1. Inspect the preserved baseline: `git worktree add <project>/.tmp/legacy LEGACY` and open the worktree. Keep worktrees under `.tmp/`; do not create one inside tracked paths.
2. In the legacy worktree, install from its own lockfile with `npm ci` and run its historical typecheck, build, test and frontend commands. The legacy worktree owns its dependencies; the framework root does not.
3. Compare the preserved tree with the manifest in `.evidence/legacy-source-snapshot.json` without reading excluded sensitive files.
4. To roll back the framework root configuration, restore the preserved files from `LEGACY` with a non-destructive Git restore into a dedicated `.tmp/` worktree or a separate checkout. Do not reset the working tree or delete user files.
5. Preserve local `.env`, `.ctx`, database files, screenshots and `video-materials/` exactly where they are. They are not part of either public state.

## Legacy command reference

The following historical commands belong to the `LEGACY` branch and its own manifest/lockfile. They are not promised at the framework root after T01:

- Backend typecheck, build, start and unit/integration tests from its root `package.json`.
- Prisma generate, migrate, seed and studio commands.
- Frontend install, typecheck, build, preview and test commands.

The T01 verification records whether these commands still behave in a clean `LEGACY` worktree. Any failure is a recorded deviation, not a hidden success claim.

## What does not migrate automatically

- The Fastify, Prisma, SQLite and backend runtime.
- Real records, local databases, environment values, private URLs or credentials.
- Assessment-specific defaults and the single-page application shell.
- Hard-coded English UI, fixed `en-US` and UTC assumptions and the legacy global store.
- Legacy screenshots as Boardloom product evidence.
- The legacy README as the Boardloom README.

T21 documents the product migration. Replacing the legacy application is a separate reviewed decision, not a side effect of T01.

## Rollback and acceptance

The migration is reversible because the original source and configuration exist in a local Git object graph and the public framework files are additive or explicitly reviewed replacements. A rollback never requires touching user data or secrets. If the legacy commands cannot be reproduced from `LEGACY`, the deviation must be recorded and reviewed before any later task claims legacy compatibility.
