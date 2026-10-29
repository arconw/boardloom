import {
  BLOCK_EXTENSION_API_VERSION,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  destroyRenderer,
  mountRenderer,
  updateRenderer,
  type BoardDocumentV1,
  type Diagnostic,
  type FieldDescriptor,
  type FilterDefinition,
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
import { filterDisplayValue, filterSummaryEntry, filterValueText } from "./filter-summary.js";
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
  createComparisonChartView,
  renderComparisonMetric,
  renderComparisonTable,
} from "./comparison-view.js";
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

function fieldDescriptor(
  document: BoardDocumentV1,
  datasetId: string,
  fieldId: string,
): FieldDescriptor | undefined {
  return document.datasets
    .find((entry) => entry.id === datasetId)
    ?.fields?.find((entry) => entry.id === fieldId);
}

function currentFilterValue(
  environment: BlockSurfaceEnvironment,
  filter: FilterDefinition,
): JsonValue | undefined {
  const active = environment.filterState.activeValues.find((entry) => entry.filterId === filter.id);
  return active === undefined ? filter.defaultValue : active.value;
}

function crossSelectionButton(
  doc: Document,
  environment: BlockSurfaceEnvironment,
  fieldId: string,
  value: JsonValue | undefined,
  text: string,
): HTMLElement {
  const button = createElement(doc, "button", "bl-cross-select");
  button.setAttribute("type", "button");
  setHostText(button, text);
  const datasetId = environment.queryPlan?.spec.datasetId ?? "";
  const selected =
    value !== undefined &&
    value !== null &&
    environment.filterState.crossFilters.some(
      (selection) =>
        selection.sourceBlockId === environment.block.id &&
        selection.field.datasetId === datasetId &&
        selection.field.fieldId === fieldId &&
        JSON.stringify(selection.value) === JSON.stringify(value),
    );
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("data-cross-select", "true");
  button.setAttribute("data-cross-block", environment.block.id);
  button.setAttribute("data-cross-dataset", datasetId);
  button.setAttribute("data-cross-field", fieldId);
  button.setAttribute("data-cross-selected", String(selected));
  button.setAttribute("data-message-key", "viewer.filters.crossFilter");
  const messages = environment.messages;
  button.setAttribute("aria-label", `${text}: ${messages.text("chart.selectValue")}`);
  if (value !== undefined && value !== null && datasetId !== "") {
    const click = (): void => {
      environment.toggleCrossFilter({
        sourceBlockId: environment.block.id,
        field: { datasetId, fieldId },
        operator: "equals",
        value,
        label: bindingLabel(environment.block, fieldId),
      });
    };
    button.addEventListener("click", click);
  } else {
    button.setAttribute("disabled", "");
    button.setAttribute("aria-disabled", "true");
  }
  return button;
}

function renderFilterDiagnostics(
  container: HTMLElement,
  environment: BlockSurfaceEnvironment,
): void {
  clearElement(container);
  const conflicts = environment.queryPlan?.filterConflicts ?? [];
  if (conflicts.length === 0) {
    container.setAttribute("hidden", "");
    return;
  }
  container.removeAttribute("hidden");
  const note = createElement(container.ownerDocument, "p", "bl-filter-diagnostic");
  note.setAttribute("role", "status");
  note.setAttribute("data-diagnostic-code", conflicts[0]?.diagnostic.code ?? "FILTER_CONFLICT");
  setKeyedText(
    note,
    "viewer.filters.conflict",
    environment.messages.text("viewer.filters.conflict"),
  );
  container.append(note);
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
        } else {
          header.append(crossSelectionButton(doc, environment, field.fieldId, value, formatted));
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
  const filterContainer = createElement(doc, "div", "bl-surface-filter-diagnostics");
  const content = createElement(doc, "div", "bl-metric-content");
  element.append(stateContainer, bannerContainer, filterContainer, content);
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
      renderFilterDiagnostics(filterContainer, next);
      if (next.comparison !== null && next.comparison !== undefined) {
        if (next.comparison.phase === "error") {
          disposeActiveRenderer(active);
          clearElement(content);
          renderErrorState(content, next.messages, next.comparison.diagnostics);
          element.setAttribute("data-state", "error");
          return;
        }
        if (next.comparison.result === null) {
          disposeActiveRenderer(active);
          clearElement(content);
          element.setAttribute("data-state", next.comparison.phase);
          return;
        }
        disposeActiveRenderer(active);
        renderComparisonMetric(next, content, next.comparison);
        element.setAttribute("data-state", next.comparison.phase);
        return;
      }
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
  const filterContainer = createElement(doc, "div", "bl-surface-filter-diagnostics");
  const content = createElement(doc, "div", "bl-surface-content");
  element.append(stateContainer, bannerContainer, filterContainer, content);
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
      renderFilterDiagnostics(filterContainer, next);
      if (next.comparison !== null && next.comparison !== undefined) {
        if (next.comparison.phase === "error") {
          disposeActiveRenderer(active);
          clearElement(content);
          renderErrorState(content, next.messages, next.comparison.diagnostics);
          element.setAttribute("data-state", "error");
          return;
        }
        if (next.comparison.result === null) {
          disposeActiveRenderer(active);
          clearElement(content);
          element.setAttribute("data-state", next.comparison.phase);
          return;
        }
        disposeActiveRenderer(active);
        renderComparisonTable(next, content, next.comparison);
        element.setAttribute("data-state", next.comparison.phase);
        return;
      }
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
  const filterContainer = createElement(doc, "div", "bl-surface-filter-diagnostics");
  const plotContainer = createElement(doc, "div", "bl-chart-plot-container");
  const chartHost = createElement(doc, "div", "bl-chart-host");
  const comparisonHost = createElement(doc, "div", "bl-comparison-chart-host");
  comparisonHost.setAttribute("hidden", "");
  plotContainer.append(chartHost, comparisonHost);
  const comparisonChart = createComparisonChartView(environment);
  comparisonHost.append(comparisonChart.element);
  const details = createElement(doc, "details", "bl-chart-data");
  details.setAttribute("open", "");
  const summary = createElement(doc, "summary", "bl-chart-data__summary");
  setKeyedText(summary, "chart.viewDataTable", environment.messages.text("chart.viewDataTable"));
  const tableContainer = createElement(doc, "div", "bl-chart-data__table");
  details.append(summary, tableContainer);
  element.append(stateContainer, bannerContainer, filterContainer, plotContainer, details);
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
      renderFilterDiagnostics(filterContainer, next);
      setKeyedText(summary, "chart.viewDataTable", next.messages.text("chart.viewDataTable"));
      const comparison = next.comparison;
      if (comparison !== null && comparison !== undefined) {
        disposeActiveRenderer(active);
        clearElement(chartHost);
        chartHost.setAttribute("hidden", "");
        comparisonHost.removeAttribute("hidden");
        if (comparison.phase === "error") {
          comparisonChart.destroy();
          clearElement(comparisonChart.element);
          renderErrorState(comparisonChart.element, next.messages, comparison.diagnostics);
          details.setAttribute("hidden", "");
          clearElement(tableContainer);
          element.setAttribute("data-state", "error");
          return;
        }
        if (comparison.result === null) {
          comparisonChart.destroy();
          clearElement(comparisonChart.element);
          details.setAttribute("hidden", "");
          clearElement(tableContainer);
          element.setAttribute("data-state", comparison.phase);
          return;
        }
        const diagnostics = comparisonChart.update(next);
        if (diagnostics.length > 0) {
          clearElement(comparisonChart.element);
          renderErrorState(comparisonChart.element, next.messages, diagnostics);
          details.setAttribute("hidden", "");
          clearElement(tableContainer);
          element.setAttribute("data-state", "error");
          return;
        }
        details.removeAttribute("hidden");
        renderComparisonTable(next, tableContainer, comparison);
        element.setAttribute("data-state", comparison.phase);
        return;
      }
      if (!comparisonHost.hasAttribute("hidden")) {
        comparisonChart.destroy();
        clearElement(comparisonChart.element);
        comparisonHost.setAttribute("hidden", "");
        chartHost.removeAttribute("hidden");
      }
      if (!showing) {
        disposeActiveRenderer(active);
        clearElement(chartHost);
        details.setAttribute("hidden", "");
        clearElement(tableContainer);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      const spec = buildChartSpecForBlock(next);
      if (!spec.ok) {
        disposeActiveRenderer(active);
        clearElement(chartHost);
        renderErrorState(chartHost, next.messages, spec.diagnostics);
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
        renderRendererUnavailable(chartHost, next.messages);
        element.setAttribute("data-state", "fallback");
      } else {
        const diagnostics = renderActiveRenderer(chartHost, next, definition, spec.value, active);
        if (diagnostics.length > 0) {
          disposeActiveRenderer(active);
          clearElement(chartHost);
          renderErrorState(chartHost, next.messages, diagnostics);
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
      comparisonChart.destroy();
    },
  };
}

function filterOriginText(environment: BlockSurfaceEnvironment, filter: FilterDefinition): string {
  return filterSummaryEntry(
    asDocument(environment.document),
    filter,
    environment.messages,
    environment.filterState,
  ).originText;
}

function applyScalar(
  environment: BlockSurfaceEnvironment,
  filter: FilterDefinition,
  value: string,
  type: FieldDescriptor["type"] | undefined,
): void {
  const scalar: JsonValue =
    type === "number" ? Number(value) : type === "boolean" ? value === "true" : value;
  const parsed: JsonValue =
    filter.operator === "in" || filter.operator === "notIn" ? [scalar] : scalar;
  environment.applyFilterValue(filter.id, parsed);
}

function createFilterControl(
  doc: Document,
  environment: BlockSurfaceEnvironment,
  filter: FilterDefinition,
  field: FieldDescriptor,
): HTMLElement {
  const control = createElement(doc, "div", "bl-filter-control");
  control.setAttribute("data-filter-id", filter.id);
  control.setAttribute("data-filter-operator", filter.operator);
  control.setAttribute(
    "aria-label",
    environment.messages.text("a11y.filterControls", {
      name: filter.label ?? filter.field.fieldId,
    }),
  );
  const value = currentFilterValue(environment, filter);
  const textValue = filterValueText(value);
  if (filter.operator === "isNull" || filter.operator === "isNotNull") {
    const note = createElement(doc, "span", "bl-filter-control__fixed");
    setKeyedText(
      note,
      "viewer.filters.readOnly",
      environment.messages.text("viewer.filters.readOnly"),
    );
    control.append(note);
    return control;
  }
  if (filter.operator === "isTrue" || filter.operator === "isFalse") {
    const note = createElement(doc, "span", "bl-filter-control__fixed");
    const key = filter.operator === "isTrue" ? "filter.operator.isTrue" : "filter.operator.isFalse";
    setKeyedText(note, key, environment.messages.text(key));
    control.append(note);
    return control;
  }
  if (filter.operator === "between") {
    const range = Array.isArray(value) ? value : [];
    const values: string[] = [];
    for (const [index, labelKey] of [
      [0, "viewer.filters.mapping"],
      [1, "viewer.filters.value"],
    ] as const) {
      const input = createElement(
        doc,
        field.type === "number" ? "input" : "input",
        "bl-filter-input",
      );
      input.setAttribute("data-filter-control", "range");
      input.setAttribute("data-filter-index", String(index));
      input.setAttribute("type", field.type === "number" ? "number" : "text");
      input.setAttribute("aria-label", environment.messages.text(labelKey));
      input.value = range[index] === undefined ? "" : filterValueText(range[index]);
      values[index] = input.value;
      input.addEventListener("input", () => {
        values[index] = input.value;
      });
      control.append(input);
    }
    const apply = createElement(doc, "button", "bl-filter-apply");
    apply.setAttribute("type", "button");
    apply.setAttribute("data-filter-action", "apply-range");
    setKeyedText(apply, "common.apply", environment.messages.text("common.apply"));
    apply.addEventListener("click", () => {
      const parsed = values.map((entry) => (field.type === "number" ? Number(entry) : entry));
      environment.applyFilterValue(filter.id, parsed);
    });
    control.append(apply);
    return control;
  }
  if (field.allowedValues !== undefined && field.allowedValues.length > 0) {
    const select = createElement(doc, "select", "bl-filter-input");
    select.setAttribute("data-filter-control", "value");
    select.setAttribute(
      "aria-label",
      environment.messages.text("a11y.filterControls", {
        name: filter.label ?? filter.field.fieldId,
      }),
    );
    for (const allowed of field.allowedValues) {
      const option = createElement(doc, "option");
      option.value = String(allowed);
      option.textContent = String(allowed);
      select.append(option);
    }
    const first = Array.isArray(value) ? value[0] : value;
    select.value = first === undefined || first === null ? "" : String(first);
    select.addEventListener("change", () => {
      applyScalar(environment, filter, select.value, field.type);
    });
    control.append(select);
  } else {
    const input = createElement(doc, "input", "bl-filter-input");
    input.setAttribute("data-filter-control", "value");
    input.setAttribute("type", field.type === "number" ? "number" : "text");
    input.setAttribute(
      "aria-label",
      environment.messages.text("a11y.filterControls", {
        name: filter.label ?? filter.field.fieldId,
      }),
    );
    input.value = textValue;
    input.addEventListener("change", () => {
      applyScalar(environment, filter, input.value, field.type);
    });
    control.append(input);
  }
  return control;
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
  const list = createElement(doc, "div", "bl-filter-list");
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
        const none = createElement(doc, "p", "bl-filter-list__none");
        setKeyedText(none, "viewer.filters.none", next.messages.text("viewer.filters.none"));
        list.append(none);
        return;
      }
      for (const filter of filters) {
        const item = createElement(doc, "div", "bl-filter-item");
        item.setAttribute("data-filter-id", filter.id);
        const origin = createElement(doc, "span", "bl-filter-chip__origin");
        setHostText(origin, filterOriginText(next, filter));
        const label = createElement(doc, "span", "bl-filter-chip__label");
        setHostText(label, filter.label ?? filter.field.fieldId);
        const value = createElement(doc, "span", "bl-filter-chip__value");
        setHostText(value, filterDisplayValue(filter, next.filterState, next.messages));
        const headingRow = createElement(doc, "div", "bl-filter-item__head");
        headingRow.append(origin, label, value);
        item.append(headingRow);
        const field = fieldDescriptor(document, filter.field.datasetId, filter.field.fieldId);
        if (field === undefined) {
          const pending = createElement(doc, "p", "bl-filter-pending");
          pending.setAttribute("role", "status");
          setKeyedText(
            pending,
            "viewer.filters.pending",
            next.messages.text("viewer.filters.pending"),
          );
          item.append(pending);
        } else if (filter.viewerEditable === true) {
          item.append(createFilterControl(doc, next, filter, field));
          const reset = createElement(doc, "button", "bl-filter-reset");
          reset.setAttribute("type", "button");
          reset.setAttribute("data-filter-reset", filter.id);
          setKeyedText(
            reset,
            "viewer.filters.reset",
            next.messages.text("viewer.filters.resetNamed", {
              name: filter.label ?? filter.field.fieldId,
            }),
          );
          reset.addEventListener("click", () => {
            next.resetFilterValue(filter.id);
          });
          item.append(reset);
        } else {
          const fixed = createElement(doc, "span", "bl-filter-control__fixed");
          setKeyedText(
            fixed,
            "viewer.filters.readOnly",
            next.messages.text("viewer.filters.readOnly"),
          );
          item.append(fixed);
        }
        list.append(item);
      }
    },
  };
}

export const BUILT_IN_BLOCK_TYPES: readonly BlockTypeDefinition[] = Object.freeze([
  Object.freeze({
    type: "text",
    version: "1.0.0",
    apiVersion: BLOCK_EXTENSION_API_VERSION,
    createSurface: createTextSurface,
  }),
  Object.freeze({
    type: "metric",
    version: "1.0.0",
    apiVersion: BLOCK_EXTENSION_API_VERSION,
    createSurface: createMetricSurface,
  }),
  Object.freeze({
    type: "table",
    version: "1.0.0",
    apiVersion: BLOCK_EXTENSION_API_VERSION,
    createSurface: createTableSurface,
  }),
  Object.freeze({
    type: "chart",
    version: "1.0.0",
    apiVersion: BLOCK_EXTENSION_API_VERSION,
    createSurface: createChartSurface,
  }),
  Object.freeze({
    type: "filter",
    version: "1.0.0",
    apiVersion: BLOCK_EXTENSION_API_VERSION,
    createSurface: createFilterSurface,
  }),
]);
