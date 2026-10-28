# ADR-0003: Browser ESM package surface

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: FR-132 and SPEC section 17.1

## Context

Boardloom runs in browsers and is consumed by plain JavaScript, TypeScript, React, Angular and Svelte hosts. The specification supports browser ESM and requires an explicit statement about UMD and CommonJS. Unverified dual-format packages create resolution hazards and a larger test matrix.

## Decision

Every planned package declares `"type": "module"`, a `"."` export with `types`, `import` and `default` conditions, a JavaScript entry under `dist/`, TypeScript declarations and explicit `files`. The DOM package also exports `./styles.css` and declares CSS side effects. Packages are private at T01 because npm publication is not authorized; tarball consumers may use the planned scoped names without any registry-availability claim.

Browser ESM is the supported runtime for v0.1. UMD and CommonJS are not provided and are not promised. T19 verifies exports, declarations, CSS, tarball installation and clean consumers. If CommonJS is added later, it requires a separate build, documentation and consumer tests.

## Consequences

- The public package surface is statically enumerable and encapsulated by the exports map.
- Declarations and CSS are part of the contract rather than incidental files.
- Consumers that only support `require()` are not supported in v0.1.
- Package boundary and tarball checks can inspect a single runtime format.

## Cost of change

Adding UMD or CommonJS later requires a dual build, additional conditional exports, an expanded consumer matrix and an honest compatibility statement. Changing entry names after publication would be a breaking change. Keeping an unverified CommonJS output now would increase the risk of shipping broken resolution behavior.

## References

- Node.js package entry points: https://nodejs.org/api/packages.html
- `docs/framework/SPEC.md` section 17.1
- `docs/framework/GOVERNANCE.md`
