# @boardloom/renderers-echarts

Built-in ECharts chart renderers for Boardloom behind the public renderer contract.

Status: T07 implements the line, area, bar, stacked bar, scatter and donut renderers on ECharts `5.6.0` (pinned exactly), registered through `@boardloom/core`. The package imports only `echarts/core` plus the used charts, components and canvas renderer. Core and `@boardloom/view-dom` do not import ECharts directly; hosts compose the package by passing `CHART_RENDERERS` to `mountBoardView`.

The renderer-neutral contract, registry, field-type matrix, value formatter and chart model belong to `@boardloom/core`. Chart renderers consume that contract, enforce the matrix and data policies, and provide a localized accessible summary. The viewer supplies the accessible data table, keyboard focus and an explicit fallback when no chart renderer is registered.

Distribution target: browser ESM with TypeScript declarations. npm publication is not authorized; planned scoped names are used for tarball consumers only.

```ts
import { CHART_RENDERERS } from "@boardloom/renderers-echarts";
import { mountBoardView } from "@boardloom/view-dom";

const mounted = mountBoardView(document.querySelector("#board")!, {
  space,
  renderers: CHART_RENDERERS,
});
```

`npm run measure:renderer-size` bundles the entry with the required ECharts modules and enforces the 400 KiB gzip renderer-chunk target. The T07 measurement and the version decision are recorded in `docs/framework/decisions/ADR-0008-echarts-renderer-engine.md`.
