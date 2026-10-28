# @boardloom/view-dom

Framework-neutral DOM runtime for the Boardloom viewer shell, design tokens and accessible state surfaces.

Status: T06 implements the browser ESM viewer runtime, mount/update/unmount host contract, view-local mode handling, block registry foundation, locale/timezone forwarding, scoped responsive layout and loading, empty, error, cancelled, stale and partial states. T07 adds the KPI and table renderers on the shared renderer contract, chart renderer composition through `renderers`, accessible chart summaries and data alternatives, and an explicit fallback when no chart renderer is registered. T08 adds the editor-mode binding inspector foundation for chart and metric X, Y, series, group and aggregation selection. T09 adds the filter block controls, scoped filter chips with origin and reset paths, an editor filter manager with explicit dataset mappings and valid typed range defaults, pending-schema states, fixed boolean predicates, and accessible cross-filter selection from chart data rows with stable selection names and disabled targets explained. T10 adds two-query comparison execution, overlay and side-by-side chart and metric presentation, comparison tables with outer-row and unavailable-reason cells, and an editor comparison builder for inputs, mapping, alignment, display mode, delta mode, unit policy display, time windows and block attachment. The inspector uses the shared core binding model and the space's effective validation catalog, disables combinations the core would reject, resolves X/Y/series with the same precedence as chart rendering, renders fixed bindings as configuration locks with a non-security notice, and writes selectable changes to the space-owned draft. The full editor, block library, layout editing and apply/cancel draft workflow belong to T12. Chart blocks use the accessible tabular data alternative plus a renderer-unavailable notice by default; hosts pass `CHART_RENDERERS` from `@boardloom/renderers-echarts` to render charts. No DOM runtime depends on React, Angular, Svelte, a backend or a database, and it does not import ECharts directly.

The package exports browser ESM with TypeScript declarations and `@boardloom/view-dom/styles.css`. npm publication is not authorized; planned scoped names are used for tarball consumers only.

## Host contract

```ts
import { createRuntime } from "@boardloom/core";
import { mountBoardView } from "@boardloom/view-dom";
import { CHART_RENDERERS } from "@boardloom/renderers-echarts";
import "@boardloom/view-dom/styles.css";

const runtime = createRuntime({ datasetProvider });
const created = runtime.createSpace({ document });
if (!created.ok) {
  throw new Error(created.diagnostics[0]?.message);
}

const mounted = mountBoardView(document.querySelector("#board"), {
  space: created.value,
  renderers: CHART_RENDERERS,
  theme: "system",
  locale: "en",
  timezone: "UTC",
  realtime: { status: "historical" },
  provenance: "Synthetic fixture",
});
if (!mounted.ok) {
  throw new Error(mounted.diagnostics[0]?.message);
}

const view = mounted.value;
void view.update({ locale: "ar", timezone: "Asia/Riyadh", theme: "dark" });
const lease = created.value.acquireEditorLease({ sessionId: "host-session" });
if (lease.ok) {
  void view.setMode("editor", { lease: lease.value });
}
view.focus("content");
void view.unmount();
void view.dispose();
```

`mountBoardView(target, options)` requires a DOM element. It accepts either an existing `space` or a `runtime`/`document` pair. Mount-time locale and timezone options are applied to an external space before the first render and are rolled back if the mount fails. When the mount creates a space or runtime, it owns and disposes it. An externally supplied space and an externally supplied view are host-owned: unmount releases only the mounted DOM, listeners, observers and the view-created query slots. A zero-view external space stays alive until the host disposes it.

A live view can be mounted by one viewer handle at a time; a second mount is rejected instead of sharing destructive query ownership. Disposing the exposed core view also tears down the mounted shell and its listeners, while preserving a host-owned space. Public update, refresh, mode and focus operations stop being admitted once unmount begins, including when re-entered from a disposal callback.

`update(options)` forwards locale and timezone changes through `space.setLocale`, preserves the committed document, editor draft, undo history, query generations and view mode, and reconciles the shell in place. A messages-only update rebuilds all framework copy, accessible region names and filter headings without reloading the board or queries. When a combined update also requests a rejected editor mode, the presentation inputs are applied and the localized diagnostic is announced through the new locale and dictionary; the board, queries and view mode stay unchanged. External-view mode requests are applied only after the rest of the mount succeeds. A throw or rejected mode during that deferred step unmounts the fresh shell, releases the mount claim and restores the host-owned view's original mode and session before returning a failure Result. Because that rollback uses the core view session contract, a structurally compatible non-core `BoardView` wrapper supplied together with mount-time mode or lease options is rejected before any mode change with `VIEW_SESSION_RESTORE_FAILED`; set the wrapper's mode before mounting instead. Restoration failure during an actual rollback is reported in the returned diagnostics rather than suppressed. Validated document theme tokens are applied as scoped `--bl-` custom properties on the instance root. Host theme and message overrides are presentation inputs and are not written into the board document. Message overrides apply to the selected locale and use the core English fallback.

`unmount(options)` disposes a view created by the mount. A dirty draft still requires an explicit `apply`, `cancel` or `keep` decision. `dispose()` is idempotent and also disposes owned spaces and runtimes.

## Viewer shell

The root carries the `boardloom` class, a `data-boardloom-theme` value of `light`, `dark` or `system`, a scoped `lang` and `dir`, and a `data-boardloom-breakpoint` value. The shell provides:

- A skip link, banner header, mode group, board region, filter region, status live region and diagnostics disclosure.
- Board title, host provenance, update time and explicit display timezone.
- A realtime status placeholder that distinguishes historical, live, connecting, reconnecting, resyncing, paused, degraded, disconnected and error states.
- Active filter chips with scope origin, the effective active or default value, per-filter reset and a board-wide reset for editable filters.
- A filter block that renders accessible controls for its configured filter IDs, including typed values, range apply controls, viewer-editable active values, fixed-default labels and pending-schema states.
- Linked cross-filter selection from the accessible chart data rows. Selected values are shown as ephemeral source-labelled chips with a clear path; incompatible target blocks show a localized not-included reason instead of silently ignoring the selection.
- An editor-mode binding inspector for chart and metric blocks. It offers only field and aggregation options admitted by the shared core binding model, marks unavailable options explicitly, shows fixed bindings as locked, and states that the lock is a configuration constraint rather than a security boundary.
- An editor-mode filter manager for field, operator, default, viewer-editability, scope target and explicit mapping controls. Changes are written to the space-owned draft and rejected atomically by the same core validation used by the API.
- An editor comparison builder for primary and reference inputs, explicit field mapping across different field IDs, alignment keys, display and delta modes, declared time windows and block attachment. Builder edits validate the affected comparison plan before draft acceptance, so a mapped but ungrouped alignment key is rejected with the prior draft preserved. Incompatible units are rejected for overlay with a visible side-by-side/no-delta alternative. Chart renderer failures surface diagnostics, recover on retry without leaving stale alerts, and every converted measure in a table has a visible conversion note.
- Comparison presentation for charts, metrics and tables. Overlay and side-by-side modes render from the renderer-neutral core result; side-by-side can show different units with deltas disabled. Missing pairs, null measures, non-finite operands and zero reference denominators show explicit unavailable reasons rather than zero or Infinity. Chart comparisons also expose the accessible comparison table with deltas and reasons.
- A responsive 12/8/4-column board grid selected from the instance width, with placed row spans, deliberate vertical gaps and instance-scoped narrow stacking even inside a wider host page.
- Block-level loading, empty, error, cancelled, stale and partial states driven by actual query state. No placeholder values or fabricated zero axes are rendered. Chart data disclosures are removed from the accessibility tree and keyboard order in every non-settled state.
- Table and chart data-table regions always have a localized accessible name, using host block titles when present and a stable fallback key otherwise.

Block types are resolved through a per-instance block registry. The built-ins are `text`, `metric`, `table`, `chart` and `filter`. A duplicate type ID is rejected instead of replacing an existing surface. Custom block definitions may be supplied to a mount for host integration experiments; the public extension lifecycle belongs to T13.

## Localization and styling

All framework-owned copy comes from stable message keys published in the core English dictionary. Host board titles, block titles, filter labels, dataset field labels, narrative text and data values are host content. Missing selected-locale keys fall back to English deterministically. The runtime sets Arabic RTL only on the scoped Boardloom root. Numeric values and units are isolated in stable left-to-right runs while their table cells and metric containers keep the surrounding reading direction and alignment.

Styles live in the `boardloom` cascade layer and remain scoped to the Boardloom root. The shell uses the approved `--bl-` tokens, logical properties, visible focus, a 24 px minimum target, reduced-motion handling and no page-level horizontal overflow at 320 px. Multiple instances keep independent themes, locales and directions.

## Scope boundaries

- No full editor, block library, layout editing, draft bar or apply/cancel workflow. T08 provides the binding inspector foundation in editor mode; T12 completes the editor.
- The six built-in chart types are provided by `@boardloom/renderers-echarts` and composed through the `renderers` mount option. Without a registered chart renderer, a chart block shows an explicit renderer-unavailable notice plus its accessible query data table.
- No chart-canvas selection; linked cross-filtering is exposed through the accessible chart data rows and the public cross-filter API. Chart pointer interactions remain renderer-specific.
- No realtime transport. The shell renders host-supplied transport status until T11.
- No locale dictionaries beyond English. Full dictionaries, key parity and RTL acceptance belong to T17.
