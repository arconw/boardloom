# @boardloom/view-dom

Framework-neutral DOM runtime for the Boardloom viewer shell, design tokens and accessible state surfaces.

Status: T06 implements the browser ESM viewer runtime, mount/update/unmount host contract, view-local mode handling, block registry foundation, locale/timezone forwarding, scoped responsive layout and loading, empty, error, cancelled, stale and partial states. T07 adds the KPI and table renderers on the shared renderer contract, chart renderer composition through `renderers`, accessible chart summaries and data alternatives, and an explicit fallback when no chart renderer is registered. T08 adds the editor-mode binding inspector foundation for chart and metric X, Y, series, group and aggregation selection. T09 adds the filter block controls, scoped filter chips with origin and reset paths, an editor filter manager with explicit dataset mappings and valid typed range defaults, pending-schema states, fixed boolean predicates, and accessible cross-filter selection from chart data rows with stable selection names and disabled targets explained. T10 adds two-query comparison execution, overlay and side-by-side chart and metric presentation, comparison tables with outer-row and unavailable-reason cells, and an editor comparison builder for inputs, mapping, alignment, display mode, delta mode, unit policy display, time windows and block attachment. T11 adds live query status integration with pause, resume and resync controls, buffered-update and last-update status, and a clearly labeled simulated-feed badge for in-memory demo data. T13 adds public extension registries for block types, renderers, query and realtime adapters, formatters, message dictionaries and theme packs, with API-version checks, duplicate/override diagnostics, per-space adapter sessions and deterministic disposal. Custom block and renderer styles are rewritten into instance-scoped selectors before they reach the document, so two boards on one page cannot collide and the host page is never restyled. The reference plugin exports a block, an explicit custom renderer, a formatter, English plugin messages and an `ext.` theme pack for the demo. T12 adds the complete editor shell: block library, selected-block inspector, block add/delete/duplicate/reorder/move/resize with visible keyboard alternatives, text-block content and registered-block configuration editing, draft bar with undo/redo/apply/discard/preview, validated theme-token editing with explicit update and removal, JSON export, responsive drawers with modal inspector semantics, and a multi-space workspace that imports a board as a new space while preserving the source space, dirty draft, undo history, filters and queries. The workspace owns the spaces it creates, disposes them only after an explicit draft decision, preserves host-supplied external spaces, and keeps import labels and tab titles in sync. The inspector uses the shared core binding model and the space's effective validation catalog, disables combinations the core would reject, resolves X/Y/series with the same precedence as chart rendering, renders fixed bindings as configuration locks with a non-security notice, and writes selectable changes to the space-owned draft. Chart blocks use the accessible tabular data alternative plus a renderer-unavailable notice by default; hosts pass `CHART_RENDERERS` from `@boardloom/renderers-echarts` to render charts. No DOM runtime depends on React, Angular, Svelte, a backend or a database, and it does not import ECharts directly.

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

For multi-board hosts, `mountBoardWorkspace(target, options)` mounts one view per space, exposes a keyboard-operable tab list and keeps every space alive while another board is active. Import uses `runtime.importDocument` when the active source space belongs to the workspace runtime; for a host-supplied external space it imports independently and preserves that source. A new space is created, marked as imported, activated and focused; its tab title follows committed document changes. The source view is only hidden, never disposed, so its draft, undo history, filters, queries and subscriptions remain intact. An invalid import returns diagnostics and leaves the active board, focus and source state unchanged. `BoardWorkspaceHandle.importDocument`, `activateSpace`, `getEntry`, `exportActiveDocument` and `dispose` expose the same behavior to hosts. Disposal requires an explicit apply or cancel decision for a dirty draft; a clean editor lease is released without a decision. Entries whose external space was already disposed by the host are detached and skipped. Disposal resolves apply and cancel decisions against the actual space lease, including a lease held by a sibling view, and preflights revision, schema and filter-runtime validation before closing any entry. The workspace opens a core event batch on every participant before the lease decisions. Normal space events are suspended while decisions run, so neither workspace host callbacks nor direct space subscribers can mutate another space between decisions. Owned spaces are disposed under the batch, so their queued normal notifications are canceled; terminal `space:disposed` delivery is deferred until every owned space has been disposed, preventing a terminal subscriber from creating work in a later owned space that is about to close. External spaces remain alive: their queued events are flushed in sequence before their views close, and reentrant callbacks cannot reorder newer events ahead of older queued events. After lease decisions the workspace rechecks committed revisions, leases and drafts; a reentrantly created or changed draft requires a new explicit decision and is preserved instead of being disposed. A rejected decision leaves the workspace entries and drafts usable. If an unexpected failure occurs after some spaces were already resolved or closed, the result includes `DISPOSAL_PARTIAL` with the affected space IDs. It disposes only workspace-owned spaces after successful decisions, preserves host-supplied external spaces and keeps externally supplied runtimes alive. An explicit external source-space ID is handled consistently with the default external-source import path. Tab arrow keys, Home and End move and activate between boards, while Enter and Space activate the focused tab.

`mountBoardView(target, options)` requires a DOM element. It accepts either an existing `space` or a `runtime`/`document` pair. Mount-time locale and timezone options are applied to an external space before the first render and are rolled back if the mount fails. When the mount creates a space or runtime, it owns and disposes it. An externally supplied space and an externally supplied view are host-owned: unmount releases only the mounted DOM, listeners, observers and the view-created query slots. A zero-view external space stays alive until the host disposes it.

A live view can be mounted by one viewer handle at a time; a second mount is rejected instead of sharing destructive query ownership. Disposing the exposed core view also tears down the mounted shell and its listeners, while preserving a host-owned space. Public update, refresh, mode and focus operations stop being admitted once unmount begins, including when re-entered from a disposal callback.

`update(options)` forwards locale and timezone changes through `space.setLocale`, preserves the committed document, editor draft, undo history, query generations and view mode, and reconciles the shell in place. A messages-only update rebuilds all framework copy, accessible region names and filter headings without reloading the board or queries. When a combined update also requests a rejected editor mode, the presentation inputs are applied and the localized diagnostic is announced through the new locale and dictionary; the board, queries and view mode stay unchanged. External-view mode requests are applied only after the rest of the mount succeeds. A throw or rejected mode during that deferred step unmounts the fresh shell, releases the mount claim and restores the host-owned view's original mode and session before returning a failure Result. Because that rollback uses the core view session contract, a structurally compatible non-core `BoardView` wrapper supplied together with mount-time mode or lease options is rejected before any mode change with `VIEW_SESSION_RESTORE_FAILED`; set the wrapper's mode before mounting instead. Restoration failure during an actual rollback is reported in the returned diagnostics rather than suppressed. Validated document theme tokens are applied as scoped `--bl-` custom properties on the instance root. Host theme and message overrides are presentation inputs and are not written into the board document. Message overrides apply to the selected locale and use the core English fallback.

`unmount(options)` disposes a view created by the mount. A dirty draft still requires an explicit `apply`, `cancel` or `keep` decision. `dispose()` is idempotent and also disposes owned spaces and runtimes.

## Viewer shell

The root carries the `boardloom` class, a `data-boardloom-theme` value of `light`, `dark` or `system`, a scoped `lang` and `dir`, and a `data-boardloom-breakpoint` value. The shell provides:

- A skip link, banner header, mode group, board region, filter region, status live region and diagnostics disclosure.
- Board title, host provenance, update time and explicit display timezone.
- Realtime status that distinguishes historical, live, connecting, reconnecting, resyncing, paused, degraded, disconnected and error states. When the space owns a realtime transport, the statusbar also exposes localized pause/resume and resync controls, buffered-update and last-update information, and a visible simulated-feed badge when the transport is the in-memory simulation.
- Active filter chips with scope origin, the effective active or default value, per-filter reset and a board-wide reset for editable filters.
- A filter block that renders accessible controls for its configured filter IDs, including typed values, range apply controls, viewer-editable active values, fixed-default labels and pending-schema states.
- Linked cross-filter selection from the accessible chart data rows. Selected values are shown as ephemeral source-labelled chips with a clear path; incompatible target blocks show a localized not-included reason instead of silently ignoring the selection.
- An editor-mode binding inspector for chart and metric blocks. It offers only field and aggregation options admitted by the shared core binding model, marks unavailable options explicitly, shows fixed bindings as locked, and states that the lock is a configuration constraint rather than a security boundary.
- An editor-mode filter manager for field, operator, default, viewer-editability, scope target and explicit mapping controls. Changes are written to the space-owned draft and rejected atomically by the same core validation used by the API.
- An editor comparison builder for primary and reference inputs, explicit field mapping across different field IDs, alignment keys, display and delta modes, declared time windows and block attachment. Builder edits validate the affected comparison plan before draft acceptance, so a mapped but ungrouped alignment key is rejected with the prior draft preserved. Incompatible units are rejected for overlay with a visible side-by-side/no-delta alternative. Chart renderer failures surface diagnostics, recover on retry without leaving stale alerts, and every converted measure in a table has a visible conversion note.
- Comparison presentation for charts, metrics and tables. Overlay and side-by-side modes render from the renderer-neutral core result; side-by-side can show different units with deltas disabled. Missing pairs, null measures, non-finite operands and zero reference denominators show explicit unavailable reasons rather than zero or Infinity. Chart comparisons also expose the accessible comparison table with deltas and reasons.
- A responsive 12/8/4-column board grid selected from the instance width, with placed row spans, deliberate vertical gaps and instance-scoped narrow stacking even inside a wider host page.
- An editor layout with a block library, dominant canvas, selected-block property inspector and persistent draft bar. The library lists every registered block type; selected blocks expose duplicate, delete, move, resize, reorder and reset actions. Keyboard-only selection is available by focusing a block and pressing Enter or Space. Arrow keys move the selected block, Shift+Arrow resizes it, Enter on the selected block applies the draft, Escape deselects or closes a drawer, and Ctrl/Cmd+Z and Ctrl/Cmd+Y undo and redo. Inspector focus and an unsubmitted focused value survive rerenders triggered by layout actions or space updates. All geometry operations keep every breakpoint non-overlapping and materialize the deterministic fallback layout when a breakpoint is absent.
- Draft state with undo/redo limits, apply validation, atomic commit, revision-conflict diagnostics that preserve the draft, explicit dirty-draft discard confirmation and lease release. Switching to viewer preserves committed document, draft and history; the viewer always renders the committed document.
- Validated theme editing that lists every existing token override, lets each value be edited or removed, and accepts an additional framework or `ext.` extension token. Unknown non-namespaced tokens, bare `--` names, dotted extension names and unsafe values are rejected; single-segment `ext.` tokens render under the `--bl-ext-` namespace. A mode-only edit preserves unrelated overrides. Invalid token names or empty values are rejected without changing the draft, and export preserves the accepted token set.
- Import-as-new-board and canonical JSON export controls. Import requires an explicit workspace handler, creates a fresh space and leaves the source board untouched. Export validates the committed document and downloads its canonical representation.
- Narrow editor drawers for the block library and inspector with scrim, focus entry, Escape close and focus return. When the inspector covers the narrow canvas it is a modal dialog: the background is inert, Tab and Shift+Tab wrap only across visible sheet controls with the confirmation both hidden and visible, Apply and Discard are available in the sheet footer, and a draft confirmation also opens inside the sheet. The sticky draft bar remains available when no modal drawer is open.
- Block-level loading, empty, error, cancelled, stale and partial states driven by actual query state. No placeholder values or fabricated zero axes are rendered. Chart data disclosures are removed from the accessibility tree and keyboard order in every non-settled state.
- Table and chart data-table regions always have a localized accessible name, using host block titles when present and a stable fallback key otherwise.

Block types are resolved through a per-instance block registry. The built-ins are `text`, `metric`, `table`, `chart` and `filter`. A duplicate type ID is rejected instead of replacing an existing surface. Extension block, renderer, query adapter, realtime adapter, formatter, message-dictionary and theme registrations are created with `createBoardloomExtensions` and passed to `mountBoardView` or `mountBoardWorkspace` as `extensions`. A custom block type is added to the active validation catalog so editor drafts can add it, while custom renderers remain explicit by ID unless they are the only renderer for a visualization. A host-owned registry is preflighted before a mount changes it: conflicting or invalid supplied definitions are rejected without registering any earlier entry from that call. Block definitions that omit `apiVersion` use the single accepted block API version and are documented as API 1; any declared mismatch is rejected.

```ts
import {
  createReferencePlugin,
  createBoardloomExtensions,
  mountBoardView,
} from "@boardloom/view-dom";

const extensions = createBoardloomExtensions(createReferencePlugin());
if (!extensions.ok) throw new Error(extensions.diagnostics[0]?.message);

const mounted = mountBoardView(target, {
  document,
  extensions: extensions.value,
  extensionSelection: {
    formatter: "reference.formatter",
    messageDictionaries: ["reference.messages.en"],
    themes: ["reference.theme"],
  },
});
```

`extensionSelection` is per space. A selected query or realtime adapter is instantiated once for that space and disposed with the space; formatter instances are owned by the same session, and dictionary/theme definitions are merged only when selected. Registration rejects duplicate IDs unless the explicit override option is used, rejects incompatible API versions and malformed definitions, and emits `extension:registered` or `extension:error` on the runtime. Those events are emitted once per registration; selecting an already registered extension for a space does not emit a second registration event. Definition-level `dispose` hooks run when the owning extension facade is disposed; per-space adapter and formatter instances are disposed with their space.

## Localization and styling

All framework-owned copy comes from stable message keys published in the core English dictionary. Host board titles, block titles, filter labels, dataset field labels, narrative text and data values are host content. Missing selected-locale keys fall back to English deterministically. The runtime sets Arabic RTL only on the scoped Boardloom root. Numeric values and units are isolated in stable left-to-right runs while their table cells and metric containers keep the surrounding reading direction and alignment.

Styles live in the `boardloom` cascade layer and remain scoped to the Boardloom root. The shell uses the approved `--bl-` tokens, logical properties, visible focus, a 24 px minimum target, reduced-motion handling and no page-level horizontal overflow at 320 px. Multiple instances keep independent themes, locales and directions. Extension styles are validated at registration and installation: host document selectors, `@import`, external schemes and `url()` targets (including quoted, whitespace-padded and escaped forms), protocol-relative URLs, `@keyframes` and executable fragments are rejected. CSS escapes are not accepted. Accepted rules are prefixed with the instance's `data-boardloom-scope` selector, installed in a removable style element and removed when the view unmounts. Theme packs may override documented tokens or add single-segment `ext.` tokens, and document theme tokens take precedence over extension defaults.

## Scope boundaries

- The editor covers add, delete, duplicate, reorder, move and resize through labeled controls and keyboard commands. Pointer drag-and-drop is not implemented; dragging is optional in the approved design direction.
- The editor shell, theme editor and inspector manager UI remain integrated in the viewer module. Extraction into focused modules is deferred to T18 while the localization contracts are still moving.
- Chart pointer interactions remain renderer-specific; editor layout is grid-based and serialized per breakpoint.
- The six built-in chart types are provided by `@boardloom/renderers-echarts` and composed through the `renderers` mount option. Without a registered chart renderer, a chart block shows an explicit renderer-unavailable notice plus its accessible query data table.
- No chart-canvas selection; linked cross-filtering is exposed through the accessible chart data rows and the public cross-filter API. Chart pointer interactions remain renderer-specific.
- The realtime adapter and state machine live in `@boardloom/core`; this package renders their status and controls. It does not create sockets or endpoints on its own. The demo simulation remains visibly labeled and is not presented as real transport verification.
- No locale dictionaries beyond English. Full dictionaries, key parity and RTL acceptance belong to T17.
