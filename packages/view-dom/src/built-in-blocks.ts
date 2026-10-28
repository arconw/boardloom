import type {
  BindingDefinition,
  BoardDocumentV1,
  JsonValue,
  QueryResultField,
} from "@boardloom/core";
import type {
  BlockSurface,
  BlockSurfaceEnvironment,
  BlockTypeDefinition,
} from "./block-registry.js";
import { clearElement, createElement, setHostText, setKeyedText } from "./dom.js";
import { activeFilterSummaries, filterSummaryEntry, filterValueText } from "./filter-summary.js";
import { formatFieldValue } from "./format-value.js";
import { ownValue } from "./own-value.js";
import type { ViewMessages } from "./messages.js";
import { renderDataBanner, renderEmptyState, renderQueryState } from "./states.js";

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

function measureBinding(block: BlockSurfaceEnvironment["block"]): BindingDefinition | null {
  const bindings = block.bindings ?? [];
  return (
    bindings.find(
      (binding) => binding.role === "measure" || binding.role === "value" || binding.axis === "y",
    ) ?? null
  );
}

function filterScopeText(environment: BlockSurfaceEnvironment): string | null {
  const filters = activeFilterSummaries(asDocument(environment.document), environment.messages);
  if (filters.length === 0) {
    return null;
  }
  return filters
    .map((filter) => `${filter.label}: ${filter.value}`)
    .filter((entry) => !entry.endsWith(": "))
    .join("; ");
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

function missingValueText(messages: ViewMessages): string {
  return messages.text("chart.missing");
}

function renderCell(
  doc: Document,
  messages: ViewMessages,
  formatters: BlockSurfaceEnvironment["formatters"],
  field: QueryResultField,
  value: JsonValue | undefined,
): HTMLTableCellElement {
  const cell = createElement(doc, "td", "bl-table__cell");
  const formatted = value === undefined ? null : formatFieldValue(value, field, formatters);
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
    setHostText(header, bindingLabel(environment.block, field.fieldId));
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
        const formatted =
          value === undefined ? null : formatFieldValue(value, field, environment.formatters);
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
          renderCell(doc, environment.messages, environment.formatters, field, value),
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

function createMetricSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-metric-surface");
  const stateContainer = createElement(doc, "div", "bl-surface-state");
  const bannerContainer = createElement(doc, "div", "bl-surface-banner");
  const content = createElement(doc, "div", "bl-metric");
  const label = createElement(doc, "p", "bl-metric__label");
  const value = createElement(doc, "p", "bl-metric__value");
  const numeric = createElement(doc, "bdi", "bl-numeric");
  value.append(numeric);
  content.append(label, value);
  element.append(stateContainer, bannerContainer, content);

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
      if (!showing || next.query === null) {
        clearElement(content);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      const binding = measureBinding(next.block);
      const fieldId = next.queryPlan?.valueBindingId ?? binding?.field.fieldId ?? null;
      const field =
        next.query.fields.find((candidate) => candidate.fieldId === fieldId) ??
        next.query.fields.find((candidate) => candidate.role === "measure") ??
        null;
      const row = next.query.rows[0];
      const raw = field === null || row === undefined ? undefined : ownValue(row, field.fieldId);
      clearElement(content);
      setHostText(
        label,
        next.queryPlan?.valueLabel ?? binding?.label ?? binding?.field.fieldId ?? "",
      );
      if (
        field === null ||
        raw === undefined ||
        formatFieldValue(raw, field, next.formatters) === null
      ) {
        numeric.textContent = missingValueText(next.messages);
        numeric.setAttribute("data-message-key", "chart.missing");
        numeric.setAttribute("aria-label", missingValueText(next.messages));
        numeric.removeAttribute("dir");
      } else {
        numeric.textContent =
          formatFieldValue(raw, field, next.formatters) ?? missingValueText(next.messages);
        numeric.removeAttribute("data-message-key");
        numeric.removeAttribute("aria-label");
        numeric.setAttribute("dir", "ltr");
      }
      content.append(label, value);
      element.setAttribute("data-state", next.query.phase);
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
        clearElement(content);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      renderTable(content, next, typeof next.block.title === "string" ? next.block.title : null);
      element.setAttribute("data-state", next.query?.phase ?? "settled");
    },
  };
}

function createChartSurface(environment: BlockSurfaceEnvironment): BlockSurface {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-chart-surface");
  const stateContainer = createElement(doc, "div", "bl-surface-state");
  const bannerContainer = createElement(doc, "div", "bl-surface-banner");
  const details = createElement(doc, "details", "bl-chart-data");
  details.setAttribute("open", "");
  const summary = createElement(doc, "summary", "bl-chart-data__summary");
  setKeyedText(summary, "chart.viewDataTable", environment.messages.text("chart.viewDataTable"));
  const tableContainer = createElement(doc, "div", "bl-chart-data__table");
  details.append(summary, tableContainer);
  element.append(stateContainer, bannerContainer, details);
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
        details.setAttribute("hidden", "");
        clearElement(tableContainer);
        element.setAttribute("data-state", next.query?.phase ?? "error");
        return;
      }
      details.removeAttribute("hidden");
      renderTable(
        tableContainer,
        next,
        typeof next.block.title === "string" ? next.block.title : null,
      );
      element.setAttribute("data-state", next.query?.phase ?? "settled");
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
