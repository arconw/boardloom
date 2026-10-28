import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  destroyRenderer,
  mountRenderer,
  updateRenderer,
  type BoardDocumentV1,
  type Diagnostic,
  type JsonValue,
  type QueryResultField,
  type RendererDefinition,
  type RendererField,
  type RendererHandle,
  type RendererSpec,
} from "@boardloom/core";
import type {
  BlockSurface,
  BlockSurfaceEnvironment,
  BlockTypeDefinition,
} from "./block-registry.js";
import { clearElement, createElement, setHostText, setKeyedText } from "./dom.js";
import { filterSummaryEntry, filterValueText } from "./filter-summary.js";
import { formatRendererFieldValue } from "./format-value.js";
import { ownValue } from "./own-value.js";
import type { ViewMessages } from "./messages.js";
import {
  buildChartSpecForBlock,
  buildKpiSpecForBlock,
  buildTableSpecForBlock,
  filterScopeText,
  rendererInput,
} from "./renderer-adapter.js";
import {
  renderDataBanner,
  renderEmptyState,
  renderErrorState,
  renderQueryState,
} from "./states.js";

let surfaceSequence = 0;

function asDocument(document: BlockSurfaceEnvironment["document"]): BoardDocumentV1 {
  return document as unknown as BoardDocumentV1;
}

function bindingLabel(block: BlockSurfaceEnvironment["block"], fieldId: string): string {
  const bindings = block.bindings ?? [];
  for (const binding of bindings) {
    if (binding.id === fieldId || binding.field.fieldId === fieldId) {
      return binding.label ?? binding.field.fieldId;
    }
  }
  return fieldId;
}

function numericRun(doc: Document, text: string): HTMLElement {
  const run = createElement(doc, "bdi", "bl-numeric");
  run.setAttribute("dir", "ltr");
  setHostText(run, text);
  return run;
}

function missingValueCell(messages: ViewMessages, cell: HTMLElement): void {
  cell.textContent = "—";
  cell.setAttribute("data-message-key", "chart.missing");
  cell.setAttribute("aria-label", messages.text("chart.missing"));
}

function renderCell(
  doc: Document,
  messages: ViewMessages,
  formatters: BlockSurfaceEnvironment["formatters"],
  field: QueryResultField,
  value: JsonValue | undefined,
  specField?: RendererField,
): HTMLTableCellElement {
  const cell = createElement(doc, "td", "bl-table__cell");
  const formatted =
    value === undefined
      ? null
      : formatRendererFieldValue(value, field, specField, formatters, messages);
  if (formatted === null) {
    missingValueCell(messages, cell);
  } else if (field.type === "number") {
    cell.append(numericRun(doc, formatted));
  } else {
    setHostText(cell, formatted);
  }
  return cell;
}

function renderTable(
  container: HTMLElement,
  environment: BlockSurfaceEnvironment,
  captionHostText: string | null,
  fieldSpecs?: ReadonlyMap<string, RendererField>,
): void {
  clearElement(container);
  const state = environment.query;
  if (state === null || state.rows.length === 0) {
    renderEmptyState(container, environment.messages, null);
    return;
  }
  const fields = state.fields;
  const doc = container.ownerDocument;
  const surfaceId = `bl-table-${++surfaceSequence}`;
  const region = createElement(doc, "div", "bl-table-region");
  region.setAttribute("role", "region");
  region.setAttribute("tabindex", "0");
  region.setAttribute("aria-labelledby", `${surfaceId}-caption`);
  const table = createElement(doc, "table", "bl-table");
  const caption = createElement(doc, "caption", "bl-table__caption");
  caption.id = `${surfaceId}-caption`;
  const hostCaption = captionHostText?.trim() ?? "";
  if (hostCaption === "") {
    setKeyedText(caption, "a11y.tableRegion", environment.messages.text("a11y.tableRegion"));
  } else {
    setHostText(caption, hostCaption);
  }
  table.append(caption);
  const head = createElement(doc, "thead");
  const headRow = createElement(doc, "tr");
  for (const field of fields) {
    const header = createElement(doc, "th");
    header.setAttribute("scope", "col");
    const specField = fieldSpecs?.get(field.fieldId);
    const label = specField?.label ?? bindingLabel(environment.block, field.fieldId);
    const unit =
      specField?.unit === undefined
        ? field.unit === undefined
          ? ""
          : (field.unit.label ?? field.unit.unit)
        : (specField.unit.label ?? specField.unit.unit);
    setHostText(header, unit === "" ? label : `${label} (${unit})`);
    headRow.append(header);
  }
  head.append(headRow);
  const body = createElement(doc, "tbody");
  for (const row of state.rows) {
    const rowElement = createElement(doc, "tr");
    fields.forEach((field, index) => {
      const value = ownValue(row, field.fieldId);
      if (index === 0) {
        const header = createElement(doc, "th");
        header.setAttribute("scope", "row");
        const specField = fieldSpecs?.get(field.fieldId);
        const formatted =
          value === undefined
            ? null
            : formatRendererFieldValue(
                value,
                field,
                specField,
                environment.formatters,
                environment.messages,
              );
        if (formatted === null) {
          missingValueCell(environment.messages, header);
        } else if (field.type === "number") {
          header.append(numericRun(doc, formatted));
        } else {
          setHostText(header, formatted);
        }
        rowElement.append(header);
      } else {
        rowElement.append(
          renderCell(
            doc,
            environment.messages,
            environment.formatters,
            field,
            value,
            fieldSpecs?.get(field.fieldId),
          ),
        );
      }
    });
    body.append(rowElement);
  }
  table.append(head, body);
  region.append(table);
  container.append(region);
}

function createTextSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-text-surface");
  const content = createElement(doc, "p", "bl-text");
  element.append(content);
  return {
    element,
    update(next: BlockSurfaceEnvironment): void {
      setHostText(content, filterValueText(ownValue(next.block.config, "text")));
      element.setAttribute("data-state", "settled");
    },
  };
}

interface ActiveRenderer {
  definition: RendererDefinition<HTMLElement> | null;
  handle: RendererHandle<HTMLElement> | null;
}

function createActiveRenderer(): ActiveRenderer {
  return { definition: null, handle: null };
}

function disposeActiveRenderer(active: ActiveRenderer): void {
  if (active.handle !== null && active.definition !== null) {
    destroyRenderer(active.definition, active.handle);
  }
  active.definition = null;
  active.handle = null;
}

function unsupportedDiagnostic(
  kind: "chart" | "kpi" | "table",
  visualization?: string,
): Diagnostic {
  return createDiagnostic(
    DIAGNOSTIC_CODES.RENDERER_UNSUPPORTED,
    visualization === undefined ? `renderer/${kind}` : `renderer/${kind}/${visualization}`,
    {
      message:
        visualization === undefined
          ? `No ${kind} renderer is registered in this viewer.`
          : `No chart renderer is registered for ${visualization}.`,
      relatedIds: visualization === undefined ? [kind] : [visualization],
    },
  );
}

function renderActiveRenderer(
  host: HTMLElement,
  environment: BlockSurfaceEnvironment,
  definition: RendererDefinition<HTMLElement>,
  spec: RendererSpec,
  active: ActiveRenderer,
): readonly Diagnostic[] {
  if (
    active.handle !== null &&
    active.definition !== null &&
    active.definition.id === definition.id
  ) {
    const diagnostics = updateRenderer(
      definition,
      active.handle,
      rendererInput(environment, host, spec),
    );
    return diagnostics;
  }
  disposeActiveRenderer(active);
  clearElement(host);
  const mounted = mountRenderer(definition, rendererInput(environment, host, spec));
  if (mounted.handle === null) {
    return mounted.diagnostics;
  }
  active.definition = definition;
  active.handle = mounted.handle;
  return Object.freeze([]);
}

function createMetricSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-metric-surface");
  const stateContainer = createElement(doc, "div", "bl-surface-state");
  const bannerContainer = createElement(doc, "div", "bl-surface-banner");
  const content = createElement(doc, "div", "bl-metric-content");
  element.append(stateContainer, bannerContainer, content);
  const active = createActiveRenderer();

  return {
    element,
    update(next: BlockSurfaceEnvironment): void {
      const showing = renderQueryState(
        stateContainer,
        next.messages,
        next.query,
        next.queryError,
        filterScopeText(next),
      );
      renderDataBanner(bannerContainer, next.messages, next.query, next.formatters);
      if (!showing) {
        disposeActiveRenderer(active);
        clearElement(content);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      const spec = buildKpiSpecForBlock(next);
      if (!spec.ok) {
        disposeActiveRenderer(active);
        clearElement(content);
        renderErrorState(content, next.messages, spec.diagnostics);
        element.setAttribute("data-state", "error");
        return;
      }
      const definition = next.renderers.resolve({ kind: "kpi" });
      if (definition === undefined) {
        disposeActiveRenderer(active);
        clearElement(content);
        renderErrorState(content, next.messages, [unsupportedDiagnostic("kpi")]);
        element.setAttribute("data-state", "error");
        return;
      }
      const diagnostics = renderActiveRenderer(content, next, definition, spec.value, active);
      if (diagnostics.length > 0) {
        disposeActiveRenderer(active);
        clearElement(content);
        renderErrorState(content, next.messages, diagnostics);
        element.setAttribute("data-state", "error");
        return;
      }
      element.setAttribute("data-state", next.query?.phase ?? "settled");
    },
    destroy(): void {
      disposeActiveRenderer(active);
    },
  };
}

function createTableSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-table-surface");
  const stateContainer = createElement(doc, "div", "bl-surface-state");
  const bannerContainer = createElement(doc, "div", "bl-surface-banner");
  const content = createElement(doc, "div", "bl-surface-content");
  element.append(stateContainer, bannerContainer, content);
  const active = createActiveRenderer();

  return {
    element,
    update(next: BlockSurfaceEnvironment): void {
      const showing = renderQueryState(
        stateContainer,
        next.messages,
        next.query,
        next.queryError,
        filterScopeText(next),
      );
      renderDataBanner(bannerContainer, next.messages, next.query, next.formatters);
      if (!showing) {
        disposeActiveRenderer(active);
        clearElement(content);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      const spec = buildTableSpecForBlock(next);
      if (!spec.ok) {
        disposeActiveRenderer(active);
        clearElement(content);
        renderErrorState(content, next.messages, spec.diagnostics);
        element.setAttribute("data-state", "error");
        return;
      }
      const definition = next.renderers.resolve({ kind: "table" });
      if (definition === undefined) {
        disposeActiveRenderer(active);
        clearElement(content);
        renderErrorState(content, next.messages, [unsupportedDiagnostic("table")]);
        element.setAttribute("data-state", "error");
        return;
      }
      const diagnostics = renderActiveRenderer(content, next, definition, spec.value, active);
      if (diagnostics.length > 0) {
        disposeActiveRenderer(active);
        clearElement(content);
        renderErrorState(content, next.messages, diagnostics);
        element.setAttribute("data-state", "error");
        return;
      }
      element.setAttribute("data-state", next.query?.phase ?? "settled");
    },
    destroy(): void {
      disposeActiveRenderer(active);
    },
  };
}

function renderRendererUnavailable(container: HTMLElement, messages: ViewMessages): void {
  clearElement(container);
  const doc = container.ownerDocument;
  const note = createElement(doc, "div", "bl-chart-fallback");
  const title = createElement(doc, "p", "bl-chart-fallback__title");
  setKeyedText(
    title,
    "chart.rendererUnavailable.title",
    messages.text("chart.rendererUnavailable.title"),
  );
  const body = createElement(doc, "p", "bl-chart-fallback__body");
  setKeyedText(
    body,
    "chart.rendererUnavailable.body",
    messages.text("chart.rendererUnavailable.body"),
  );
  note.append(title, body);
  container.append(note);
}

function createChartSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-chart-surface");
  const stateContainer = createElement(doc, "div", "bl-surface-state");
  const bannerContainer = createElement(doc, "div", "bl-surface-banner");
  const plotContainer = createElement(doc, "div", "bl-chart-plot-container");
  const details = createElement(doc, "details", "bl-chart-data");
  details.setAttribute("open", "");
  const summary = createElement(doc, "summary", "bl-chart-data__summary");
  setKeyedText(summary, "chart.viewDataTable", environment.messages.text("chart.viewDataTable"));
  const tableContainer = createElement(doc, "div", "bl-chart-data__table");
  details.append(summary, tableContainer);
  element.append(stateContainer, bannerContainer, plotContainer, details);
  const active = createActiveRenderer();

  return {
    element,
    update(next: BlockSurfaceEnvironment): void {
      const showing = renderQueryState(
        stateContainer,
        next.messages,
        next.query,
        next.queryError,
        filterScopeText(next),
      );
      renderDataBanner(bannerContainer, next.messages, next.query, next.formatters);
      setKeyedText(summary, "chart.viewDataTable", next.messages.text("chart.viewDataTable"));
      if (!showing) {
        disposeActiveRenderer(active);
        clearElement(plotContainer);
        details.setAttribute("hidden", "");
        clearElement(tableContainer);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      const spec = buildChartSpecForBlock(next);
      if (!spec.ok) {
        disposeActiveRenderer(active);
        clearElement(plotContainer);
        renderErrorState(plotContainer, next.messages, spec.diagnostics);
        element.setAttribute("data-state", "error");
        renderTable(
          tableContainer,
          next,
          typeof next.block.title === "string" ? next.block.title : null,
        );
        return;
      }
      const definition = next.renderers.resolve({
        kind: "chart",
        visualization: spec.value.visualization,
      });
      if (definition === undefined) {
        disposeActiveRenderer(active);
        renderRendererUnavailable(plotContainer, next.messages);
        element.setAttribute("data-state", "fallback");
      } else {
        const diagnostics = renderActiveRenderer(
          plotContainer,
          next,
          definition,
          spec.value,
          active,
        );
        if (diagnostics.length > 0) {
          disposeActiveRenderer(active);
          clearElement(plotContainer);
          renderErrorState(plotContainer, next.messages, diagnostics);
          element.setAttribute("data-state", "error");
        } else {
          element.setAttribute("data-state", next.query?.phase ?? "settled");
        }
      }
      details.removeAttribute("hidden");
      const fieldSpecs = new Map<string, RendererField>([
        [spec.value.x.fieldId, spec.value.x],
        [spec.value.y.fieldId, spec.value.y],
      ]);
      if (spec.value.series !== null) {
        fieldSpecs.set(spec.value.series.fieldId, spec.value.series);
      }
      renderTable(
        tableContainer,
        next,
        typeof next.block.title === "string" ? next.block.title : null,
        fieldSpecs,
      );
    },
    destroy(): void {
      disposeActiveRenderer(active);
    },
  };
}

function createFilterSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-filter-surface");
  const heading = createElement(doc, "p", "bl-overline");
  setKeyedText(
    heading,
    "viewer.filters.active",
    environment.messages.text("viewer.filters.active"),
  );
  const list = createElement(doc, "ul", "bl-filter-list");
  element.append(heading, list);
  return {
    element,
    update(next: BlockSurfaceEnvironment): void {
      setKeyedText(heading, "viewer.filters.active", next.messages.text("viewer.filters.active"));
      const document = asDocument(next.document);
      const configured = ownValue(next.block.config, "filterIds");
      const ids =
        Array.isArray(configured) && configured.every((value) => typeof value === "string")
          ? new Set(configured)
          : null;
      const filters =
        ids === null ? document.filters : document.filters.filter((filter) => ids.has(filter.id));
      clearElement(list);
      if (filters.length === 0) {
        const none = createElement(doc, "li", "bl-filter-list__none");
        setKeyedText(none, "viewer.filters.none", next.messages.text("viewer.filters.none"));
        list.append(none);
      } else {
        for (const filter of filters) {
          const summary = filterSummaryEntry(document, filter, next.messages);
          const item = createElement(doc, "li", "bl-filter-chip");
          const origin = createElement(doc, "span", "bl-filter-chip__origin");
          setKeyedText(origin, summary.originKey, summary.originText);
          const label = createElement(doc, "span", "bl-filter-chip__label");
          setHostText(label, summary.label);
          const value = createElement(doc, "span", "bl-filter-chip__value");
          setHostText(value, summary.value);
          item.append(origin, label, value);
          list.append(item);
        }
      }
      element.setAttribute("data-state", "settled");
    },
  };
}

export const BUILT_IN_BLOCK_TYPES: readonly BlockTypeDefinition[] = Object.freeze([
  Object.freeze({ type: "text", version: "1.0.0", createSurface: createTextSurface }),
  Object.freeze({ type: "metric", version: "1.0.0", createSurface: createMetricSurface }),
  Object.freeze({ type: "table", version: "1.0.0", createSurface: createTableSurface }),
  Object.freeze({ type: "chart", version: "1.0.0", createSurface: createChartSurface }),
  Object.freeze({ type: "filter", version: "1.0.0", createSurface: createFilterSurface }),
]);
