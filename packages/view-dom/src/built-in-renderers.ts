import {
  AGGREGATION_TYPES,
  DIAGNOSTIC_CODES,
  RENDERER_API_VERSION,
  buildKpiModel,
  buildTableModel,
  createDiagnostic,
  formatEnglishMessage,
  type KpiModel,
  type KpiRendererSpec,
  type RendererDefinition,
  type RendererHandle,
  type RendererInput,
  type RendererSpec,
  type RendererValidation,
  type TableModel,
  type TableRendererSpec,
} from "@boardloom/core";

let tableSequence = 0;

function failed(
  detailKey: string,
  id: string,
  detailParams?: Readonly<Record<string, string | number>>,
): RendererValidation {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([
      createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE, `renderer/${id}`, {
        message: formatEnglishMessage(detailKey, detailParams),
        detailKey,
        ...(detailParams === undefined ? {} : { detailParams }),
      }),
    ]),
  });
}

function numericText(input: RendererInput<HTMLElement>, text: string): HTMLElement {
  const bdi = input.host.ownerDocument.createElement("bdi");
  bdi.className = "bl-numeric";
  bdi.setAttribute("dir", "ltr");
  bdi.textContent = text;
  return bdi;
}

function renderKpi(
  host: HTMLElement,
  model: KpiModel,
  input: RendererInput<HTMLElement>,
): HTMLElement {
  const doc = host.ownerDocument;
  const wrapper = doc.createElement("div");
  wrapper.className = "bl-metric";
  wrapper.setAttribute("data-renderer-id", "boardloom.kpi");
  const label = doc.createElement("p");
  label.className = "bl-metric__label";
  label.textContent = model.fieldLabel;
  label.setAttribute("data-host-content", "");
  const value = doc.createElement("p");
  value.className = "bl-metric__value";
  if (model.missing) {
    const missing = doc.createElement("span");
    missing.textContent = input.messages.text("chart.missing");
    missing.setAttribute("data-message-key", "chart.missing");
    missing.setAttribute("aria-label", input.messages.text("chart.missing"));
    value.append(missing);
  } else {
    value.append(numericText(input, model.text ?? input.messages.text("chart.missing")));
  }
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute(
    "aria-label",
    model.missing
      ? `${model.fieldLabel}: ${input.messages.text("chart.missing")}`
      : `${model.fieldLabel}: ${model.text ?? ""}`,
  );
  wrapper.setAttribute("data-state", model.missing ? "missing" : "settled");
  wrapper.setAttribute("data-null-count", String(model.nullCount));
  if (model.unitText !== "") {
    wrapper.setAttribute("data-unit", model.unitText);
  }
  wrapper.append(label, value);
  host.append(wrapper);
  return wrapper;
}

function createKpiRenderer(): RendererDefinition<HTMLElement> {
  const id = "boardloom.kpi";
  return Object.freeze({
    id,
    version: "1.0.0",
    apiVersion: RENDERER_API_VERSION,
    kind: "kpi",
    visualizations: Object.freeze([]),
    capabilities: Object.freeze({
      kinds: Object.freeze(["kpi"] as const),
      visualizations: Object.freeze([]),
      aggregation: Object.freeze(AGGREGATION_TYPES.filter((type) => type !== "none")),
      comparison: false,
      series: false,
      stacking: "rejected" as const,
      zeroBaseline: "none" as const,
      negativeValues: "supported" as const,
      accessibility: true,
    }),
    validate(spec: RendererSpec): RendererValidation {
      if (spec.kind !== "kpi") {
        return failed("diagnostic.detail.renderer.kpi.kind", id, { renderer: id });
      }
      if (spec.y.type !== "number") {
        return failed("diagnostic.detail.renderer.kpi.numeric", id);
      }
      if (spec.aggregation === "none") {
        return failed("diagnostic.detail.renderer.kpi.aggregation", id);
      }
      return Object.freeze({ ok: true, diagnostics: Object.freeze([]) });
    },
    mount(input: RendererInput<HTMLElement>): RendererHandle<HTMLElement> {
      let wrapper: HTMLElement | null = null;
      const update = (next: RendererInput<HTMLElement>): void => {
        if (next.spec.kind !== "kpi") {
          throw new Error("The KPI renderer received a non-KPI spec.");
        }
        const model = buildKpiModel(next.spec, next.data, next.formatters, next.messages);
        wrapper?.remove();
        wrapper = renderKpi(next.host, model, next);
      };
      update(input);
      return Object.freeze({
        update,
        destroy(): void {
          wrapper?.remove();
          wrapper = null;
        },
      });
    },
  });
}

function createTableRenderer(): RendererDefinition<HTMLElement> {
  const id = "boardloom.table";
  return Object.freeze({
    id,
    version: "1.0.0",
    apiVersion: RENDERER_API_VERSION,
    kind: "table",
    visualizations: Object.freeze([]),
    capabilities: Object.freeze({
      kinds: Object.freeze(["table"] as const),
      visualizations: Object.freeze([]),
      aggregation: Object.freeze([]),
      comparison: false,
      series: false,
      stacking: "rejected" as const,
      zeroBaseline: "none" as const,
      negativeValues: "supported" as const,
      accessibility: true,
    }),
    validate(spec: RendererSpec): RendererValidation {
      if (spec.kind !== "table") {
        return failed("diagnostic.detail.renderer.table.kind", id, { renderer: id });
      }
      if (spec.columns.length === 0) {
        return failed("diagnostic.detail.renderer.table.columns", id);
      }
      return Object.freeze({ ok: true, diagnostics: Object.freeze([]) });
    },
    mount(input: RendererInput<HTMLElement>): RendererHandle<HTMLElement> {
      let region: HTMLElement | null = null;
      const update = (next: RendererInput<HTMLElement>): void => {
        if (next.spec.kind !== "table") {
          throw new Error("The table renderer received a non-table spec.");
        }
        const doc = next.host.ownerDocument;
        const model: TableModel = buildTableModel(
          next.spec,
          next.data,
          next.formatters,
          next.messages,
        );
        const captionId = `bl-table-caption-${++tableSequence}`;
        const hadFocus =
          region !== null &&
          typeof region.contains === "function" &&
          doc.activeElement !== null &&
          region.contains(doc.activeElement);
        const nextRegion = doc.createElement("div");
        nextRegion.className = "bl-table-region";
        nextRegion.setAttribute("role", "region");
        nextRegion.setAttribute("tabindex", "0");
        nextRegion.setAttribute("aria-labelledby", captionId);
        const table = doc.createElement("table");
        table.className = "bl-table";
        const caption = doc.createElement("caption");
        caption.className = "bl-table__caption";
        caption.id = captionId;
        const title = next.spec.title;
        if (title !== null && title.trim() !== "") {
          caption.textContent = title;
          caption.setAttribute("data-host-content", "");
        } else {
          caption.textContent = next.messages.text("a11y.tableRegion");
          caption.setAttribute("data-message-key", "a11y.tableRegion");
        }
        table.append(caption);
        const head = doc.createElement("thead");
        const headRow = doc.createElement("tr");
        for (const column of model.columns) {
          const header = doc.createElement("th");
          header.setAttribute("scope", "col");
          header.textContent =
            column.unitText === "" ? column.label : `${column.label} (${column.unitText})`;
          header.setAttribute("data-host-content", "");
          headRow.append(header);
        }
        head.append(headRow);
        const body = doc.createElement("tbody");
        for (const row of model.rows) {
          const rowElement = doc.createElement("tr");
          model.columns.forEach((_column, index) => {
            const cell = doc.createElement(index === 0 ? "th" : "td");
            if (index === 0) {
              cell.setAttribute("scope", "row");
            }
            const cellModel = row.cells[index];
            if (!cellModel || cellModel.missing) {
              cell.textContent = "—";
              cell.setAttribute("data-message-key", "chart.missing");
              cell.setAttribute("aria-label", next.messages.text("chart.missing"));
            } else if (cellModel.numeric !== null) {
              cell.append(numericText(next, cellModel.text ?? ""));
            } else {
              cell.textContent = cellModel.text ?? "";
            }
            rowElement.append(cell);
          });
          body.append(rowElement);
        }
        table.append(head, body);
        nextRegion.append(table);
        if (model.missingCount > 0) {
          const missing = doc.createElement("p");
          missing.id = `${captionId}-missing`;
          missing.className = "bl-table-missing";
          missing.textContent = next.messages.plural("table.missing", model.missingCount);
          missing.setAttribute("data-message-key", "table.missing");
          nextRegion.setAttribute("aria-describedby", missing.id);
          nextRegion.append(missing);
        }
        nextRegion.setAttribute("data-state", "settled");
        nextRegion.setAttribute("data-row-count", String(model.rowCount));
        region?.remove();
        next.host.append(nextRegion);
        region = nextRegion;
        if (hadFocus) {
          nextRegion.focus();
        }
      };
      update(input);
      return Object.freeze({
        update,
        destroy(): void {
          region?.remove();
          region = null;
        },
      });
    },
  });
}

export const BUILT_IN_RENDERERS: readonly RendererDefinition<HTMLElement>[] = Object.freeze([
  createKpiRenderer(),
  createTableRenderer(),
]);

export type { KpiRendererSpec, TableRendererSpec };
