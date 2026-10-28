# ADR-0002: Native-DOM runtime, ECharts renderers and thin adapters

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: Q015, Q024 and SPEC section 2

## Context

Boardloom must serve plain JavaScript and TypeScript consumers without requiring React, Angular or Svelte. The legacy project proves an ECharts-based chart engine but couples it to React, Zustand and a page-level application shell. Core behavior must remain headless so document validation, spaces, filters, comparisons and realtime orchestration are testable without a browser.

## Decision

The headless core uses native TypeScript with no DOM and no UI framework. The viewer and editor shell is a framework-neutral DOM runtime. Thin React, Angular and Svelte adapters wrap the shared DOM runtime and a common mount/update/unmount host contract. They must not duplicate core UI logic.

ECharts is the chart engine for built-in chart renderers and is isolated in `@boardloom/renderers-echarts` behind the public renderer contract. Core and the DOM shell do not import ECharts directly. The exact ECharts version, tree-shaken bundle and renderer split are fixed in T07 with official-document evidence.

## Consequences

- Plain JavaScript and TypeScript consumers can use the DOM runtime directly.
- The renderer boundary allows later chart engines without changing document or query contracts.
- The DOM runtime must own lifecycle, accessibility, localization and style scoping without framework help.
- Adapters stay small and testable against the same host contract.

## Cost of change

Replacing the native-DOM foundation would require a new rendering shell, accessibility and localization work, and changes to every adapter. Replacing ECharts affects only the renderer package and its consumer tests if the renderer contract stays stable. Adding a UI framework to core is rejected because it would break the framework-neutral guarantee.

## References

- `docs/framework/SPEC.md` sections 2, 5 and 6
- `docs/framework/decisions/ADR-0003-esm-packaging.md`
- `docs/framework/decisions/ADR-0005-package-boundaries.md`
