# ADR-0008: Pinned ECharts engine and renderer split

- Status: Accepted
- Date: 2026-10-28
- Task: T07
- Supersedes: none
- Refines: FR-050, FR-051, FR-052, NFR-001 and SPEC sections 2, 8 and 15

## Context

The specification proposes ECharts as the chart engine because the baseline application already uses it, but requires T07 to fix the exact version, the tree-shaken bundle and the renderer split. The legacy frontend declares `echarts` `^5.6.0`. The registry latest release at the T07 spike is `6.1.0`, which is a new major line.

The framework must keep core DOM-free and must not couple the viewer shell to a specific chart engine. The measured v0.1 target is an ECharts renderer chunk at or below 400 KB gzip after tree-shaking. The DOM runtime target excludes ECharts.

## Decision

The built-in chart renderers use ECharts `5.6.0` pinned exactly in `@boardloom/renderers-echarts`. The package imports only `echarts/core`, the line, bar, pie and scatter charts, the grid, tooltip, legend, title, dataset and mark-line components, and the canvas renderer. It does not import the all-in-one `echarts` entry point.

The renderer contract, registry, normative field-type matrix, value formatter and renderer-neutral chart/KPI/table models live in `@boardloom/core` with no DOM import. `@boardloom/renderers-echarts` implements the six chart renderers behind that contract. KPI and table renderers live in `@boardloom/view-dom` because they are framework-owned DOM surfaces, not ECharts charts, and are registered in the same renderer registry.

`@boardloom/view-dom` does not import ECharts directly and does not depend on the ECharts package. A host composes chart renderers by passing `renderers: CHART_RENDERERS` to `mountBoardView`. Without a registered chart renderer the viewer shows an explicit renderer-unavailable notice and the accessible data table instead of drawing a misleading chart.

ECharts 5.6.0 is chosen over 6.1.0 because it is the version already exercised by the baseline, keeps the current option and module surface stable, and satisfies the size target with the tree-shaken imports above. Upgrading to a new major requires a new decision, renderer regression evidence and a size measurement.

Measured on 2026-10-28 with the T07 `measure:renderer-size` check: the ECharts renderer entry plus core and required ECharts modules produced 201,403 bytes gzip (196.7 KiB), below the 400 KiB target. The report is written under `.tmp/T07/size/`.

## Consequences

- Chart behavior is isolated to one package with an explicit, pinned engine.
- Core stays DOM-free and has no ECharts dependency; the viewer shell has no direct ECharts import.
- Hosts that want built-in charts must register the renderer package; the fallback is honest and accessible rather than an empty chart frame.
- Canvas charts always ship an accessible summary and data table in the viewer, and animation is disabled so reduced-motion users receive the final state.
- The exact package version is reproducible from the lockfile.

## Cost of change

Replacing ECharts affects only `@boardloom/renderers-echarts`, its option mapper and the renderer gallery checks while the core renderer contract stays stable. Changing the renderer contract or the matrix affects core, the viewer adapter and every renderer, so it needs a new API version and a reviewed migration path.

## References

- `docs/framework/SPEC.md` sections 8, 14.2, 14.3 and 15
- `docs/framework/decisions/ADR-0002-native-dom-runtime.md`
- `docs/framework/decisions/ADR-0005-package-boundaries.md`
- `https://echarts.apache.org/handbook/en/basics/import/`
- `https://www.npmjs.com/package/echarts/v/5.6.0`
- `scripts/measure-renderer-size.mjs`
