# ADR-0001: Workspace layout with an isolated legacy application

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: Q016 and SPEC section 2

## Context

Boardloom is a standalone client library with application adapters. The repository also contains a preserved legacy ClassScope application whose local originals must not be overwritten, deleted, published or mixed into framework packages. A clean public clone must install and build without the untracked legacy source. The owner confirmed a root npm workspace layout with `packages/*`, `examples/*` and `apps/demo`.

## Decision

The root of the repository is a private npm workspace. Publishable packages live under `packages/`, runnable consumers under `examples/` and the static Pages application under `apps/demo/`. Planned package directories exist from T01 with private manifests and no product API.

The legacy application remains in its original directories as a local preservation copy. Those directories are ignored by the framework workspace and are recoverable from the local `LEGACY` Git branch, which was not pushed. Root package and TypeScript configuration now belongs to the framework workspace; the original legacy configuration is preserved in `LEGACY`.

One lockfile at the repository root covers the framework workspace. Publishable package builds and packed staging live under `.tmp/build/packages`, not inside source package directories. The legacy application keeps its own historical lockfile inside the `LEGACY` branch.

## Consequences

- A clean clone contains only framework source, documentation and package skeletons.
- Workspace packages are linked by npm without a manual `npm link`.
- The legacy application is not runnable from the new root commands after T01; it is runnable from a `LEGACY` worktree until the migration guide and cutover are accepted.
- Framework packages cannot rely on untracked legacy files or the legacy `node_modules`.

## Cost of change

Changing to a different monorepo tool or a separate repository requires regenerating the workspace, lockfile, CI paths and every package manifest. Retiring the legacy application or promoting it to an example is a separate reviewed migration. Keeping the legacy commands at the framework root would either publish backend dependencies or make a clean clone fail, so that option is rejected.

## References

- `docs/framework/SPEC.md` sections 1 and 2
- `docs/framework/MIGRATION_PLAN.md`
- `docs/framework/GOVERNANCE.md`
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces
