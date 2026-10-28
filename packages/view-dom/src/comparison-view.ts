import {
  DIAGNOSTIC_CODES,
  buildChartRendererSpec,
  createDiagnostic,
  destroyRenderer,
  formatValueParts,
  mountRenderer,
  selectChartBindings,
  updateRenderer,
  type ChartRendererSpec,
  type ComparisonDelta,
  type ComparisonDeltaReason,
  type ComparisonMeasurePlan,
  type ComparisonMeasureRow,
  type ComparisonRow,
  type Diagnostic,
  type RendererData,
  type RendererDefinition,
  type RendererField,
  type RendererHandle,
  type Result,
} from "@boardloom/core";
import type { BlockSurfaceEnvironment } from "./block-registry.js";
import type { ComparisonViewState } from "./comparison-query.js";
import { createElement, setHostText, setKeyedText } from "./dom.js";
import { rendererInputWithData } from "./renderer-adapter.js";
import { filterScopeText } from "./renderer-adapter.js";
import type { ViewMessages } from "./messages.js";
import { ownValue } from "./own-value.js";

const SERIES_FIELD_ID = "__comparison_side";
const KEY_FIELD_PREFIX = "__comparison_key_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDocument(
  environment: BlockSurfaceEnvironment,
): import("@boardloom/core").BoardDocumentV1 {
  return environment.document as unknown as import("@boardloom/core").BoardDocumentV1;
}

function textKey(messages: ViewMessages, key: string): string {
  return messages.has(key) ? messages.text(key) : key;
}

function reasonKey(reason: ComparisonDeltaReason | null): string {
  if (reason === "PRIMARY_ONLY" || reason === "REFERENCE_ONLY") {
    return "chart.delta.reason.missingPair";
  }
  if (reason === "PRIMARY_NULL") {
    return "chart.delta.reason.primaryNull";
  }
  if (reason === "REFERENCE_NULL") {
    return "chart.delta.reason.referenceNull";
  }
  if (reason === "ZERO_REFERENCE") {
    return "chart.delta.reason.referenceZero";
  }
  if (reason === "UNIT_MISMATCH") {
    return "chart.delta.reason.unitMismatch";
  }
  return "chart.delta.reason.nonFinite";
}

function deltaValueText(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  delta: ComparisonDelta,
  percentage: boolean,
): string | null {
  if (!delta.available || delta.value === null) {
    return null;
  }
  const field = percentage
    ? {
        type: "number" as const,
        unit: { unit: "percent", scale: 1 },
      }
    : {
        type: "number" as const,
        ...(measure.primaryUnit === null ? {} : { unit: measure.primaryUnit }),
      };
  return formatValueParts(delta.value, field, environment.formatters, environment.messages).text;
}

function unitDescriptorsEqual(
  left: ComparisonMeasurePlan["primaryUnit"],
  right: ComparisonMeasurePlan["referenceUnit"],
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.unit === right.unit && (left.scale ?? 1) === (right.scale ?? 1);
}

function referenceUnitsDiffer(measure: ComparisonMeasurePlan): boolean {
  return (
    measure.conversion === null && !unitDescriptorsEqual(measure.primaryUnit, measure.referenceUnit)
  );
}

function operandText(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  operand: ComparisonMeasureRow["primary"],
  side: "primary" | "reference",
): string | null {
  const unit =
    side === "reference" && referenceUnitsDiffer(measure)
      ? measure.referenceUnit
      : measure.primaryUnit;
  if (side === "reference" && referenceUnitsDiffer(measure)) {
    if (operand.rawValue === null) {
      return null;
    }
    return formatValueParts(
      operand.rawValue,
      {
        type: "number",
        ...(unit === null ? {} : { unit }),
      },
      environment.formatters,
      environment.messages,
    ).text;
  }
  if (operand.value === null) {
    return null;
  }
  return formatValueParts(
    operand.value,
    {
      type: "number",
      ...(unit === null ? {} : { unit }),
    },
    environment.formatters,
    environment.messages,
  ).text;
}

function showsAbsoluteDelta(mode: ComparisonViewState["plan"]["deltaMode"]): boolean {
  return mode === "absolute" || mode === "both";
}

function showsPercentageDelta(mode: ComparisonViewState["plan"]["deltaMode"]): boolean {
  return mode === "percentage" || mode === "both";
}

function unitLabel(unit: ComparisonMeasurePlan["primaryUnit"]): string {
  if (unit === null) {
    return "";
  }
  return unit.unit;
}

function deltaElement(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  row: ComparisonMeasureRow,
  kind: "absolute" | "percentage",
): HTMLElement {
  const doc = environment.dom;
  const delta = kind === "absolute" ? row.absolute : row.percentage;
  const element = createElement(doc, "div", "bl-comparison-delta");
  element.setAttribute("data-delta", kind);
  const labelKey = kind === "absolute" ? "chart.delta.absolute" : "chart.delta.percent";
  const label = createElement(doc, "span", "bl-comparison-delta__label");
  setKeyedText(label, labelKey, environment.messages.text(labelKey));
  const value = createElement(doc, "span", "bl-comparison-delta__value");
  const text = deltaValueText(environment, measure, delta, kind === "percentage");
  if (text === null) {
    element.setAttribute("data-delta-status", "unavailable");
    element.setAttribute("data-reason", delta.reason ?? "unavailable");
    setKeyedText(
      value,
      "chart.delta.unavailable",
      environment.messages.text("chart.delta.unavailable"),
    );
    const reason = createElement(doc, "span", "bl-comparison-delta__reason");
    const key = reasonKey(delta.reason);
    setKeyedText(reason, key, environment.messages.text(key));
    element.append(label, value, reason);
    return element;
  }
  element.setAttribute("data-delta-status", "available");
  setHostText(value, text);
  element.append(label, value);
  return element;
}

function operandElement(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  operand: ComparisonMeasureRow["primary"],
  side: "primary" | "reference",
): HTMLElement {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-comparison-operand");
  element.setAttribute("data-comparison-side", side);
  const label = createElement(doc, "span", "bl-comparison-operand__label");
  const labelKey = side === "primary" ? "editor.comparison.primary" : "editor.comparison.reference";
  setKeyedText(label, labelKey, environment.messages.text(labelKey));
  const value = createElement(doc, "span", "bl-comparison-operand__value");
  const text = operandText(environment, measure, operand, side);
  if (text === null) {
    element.setAttribute("data-operand-status", "missing");
    element.setAttribute("data-reason", operand.reason ?? "missing");
    setKeyedText(value, "chart.missing", environment.messages.text("chart.missing"));
  } else {
    element.setAttribute("data-operand-status", "available");
    setHostText(value, text);
  }
  element.append(label, value);
  return element;
}

function comparisonSummary(
  environment: BlockSurfaceEnvironment,
  view: ComparisonViewState,
): HTMLElement {
  const doc = environment.dom;
  const result = view.result;
  const summary = createElement(doc, "p", "bl-comparison-summary");
  summary.setAttribute("role", "status");
  if (result === null) {
    summary.setAttribute("hidden", "");
    return summary;
  }
  setKeyedText(
    summary,
    "chart.comparison.summary",
    environment.messages.text("chart.comparison.summary", {
      matched: result.counts.matchedRowCount,
      primaryOnly: result.counts.primaryOnlyCount,
      referenceOnly: result.counts.referenceOnlyCount,
      excluded: result.counts.excludedNullKeyCount,
    }),
  );
  const nonNull = result.measures.map((measure) => ({
    label: measure.label,
    count: result.counts.matchedNonNullMeasureCount[measure.id] ?? 0,
  }));
  if (nonNull.length > 0) {
    const detail = createElement(doc, "span", "bl-comparison-summary__measure");
    detail.setAttribute("data-measure-counts", "true");
    setHostText(
      detail,
      nonNull
        .map(
          (entry) =>
            `${entry.label}: ${environment.messages.text("chart.comparison.nonNullMeasure", {
              count: entry.count,
            })}`,
        )
        .join(" · "),
    );
    summary.append(detail);
  }
  return summary;
}

function conversionNote(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
): HTMLElement | null {
  if (measure.conversion === null) {
    return null;
  }
  const note = createElement(environment.dom, "p", "bl-comparison-conversion");
  note.setAttribute("data-conversion", "declared");
  setKeyedText(
    note,
    "chart.comparison.converted",
    environment.messages.text("chart.comparison.converted", {
      from: measure.conversion.from,
      to: measure.conversion.to,
      provider: measure.conversion.provider,
    }),
  );
  return note;
}

function modeAttribute(element: HTMLElement, view: ComparisonViewState): void {
  element.setAttribute("data-comparison-id", view.plan.comparisonId);
  element.setAttribute("data-comparison-mode", view.plan.displayMode);
  element.setAttribute("data-comparison-delta-mode", view.plan.deltaMode);
  element.setAttribute("data-comparison-phase", view.phase);
}

export function renderComparisonMetric(
  environment: BlockSurfaceEnvironment,
  container: HTMLElement,
  view: ComparisonViewState,
): void {
  const doc = environment.dom;
  container.replaceChildren();
  modeAttribute(container, view);
  const result = view.result;
  if (result === null || result.measures.length === 0) {
    const empty = createElement(doc, "p", "bl-comparison-empty");
    setKeyedText(empty, "common.empty", environment.messages.text("common.empty"));
    container.append(empty);
    return;
  }
  const measure = result.measures[0];
  if (measure === undefined) {
    return;
  }
  const row = result.rows[0];
  const measureRow = row?.measures[0] ?? null;
  const wrapper = createElement(doc, "div", "bl-comparison bl-comparison--metric");
  const panes = createElement(doc, "div", "bl-comparison__panes");
  if (measureRow === null) {
    const empty = createElement(doc, "p", "bl-comparison-empty");
    setKeyedText(empty, "common.empty", environment.messages.text("common.empty"));
    panes.append(empty);
  } else {
    panes.append(
      operandElement(environment, measure, measureRow.primary, "primary"),
      operandElement(environment, measure, measureRow.reference, "reference"),
    );
  }
  wrapper.append(panes);
  if (showsAbsoluteDelta(result.deltaMode)) {
    const deltas = createElement(doc, "div", "bl-comparison__deltas");
    if (measureRow !== null) {
      deltas.append(deltaElement(environment, measure, measureRow, "absolute"));
    }
    wrapper.append(deltas);
  }
  if (showsPercentageDelta(result.deltaMode)) {
    const deltas = createElement(doc, "div", "bl-comparison__deltas");
    if (measureRow !== null) {
      deltas.append(deltaElement(environment, measure, measureRow, "percentage"));
    }
    wrapper.append(deltas);
  }
  const note = conversionNote(environment, measure);
  if (note !== null) {
    wrapper.append(note);
  }
  wrapper.append(comparisonSummary(environment, view));
  container.append(wrapper);
}

function keyField(
  environment: BlockSurfaceEnvironment,
  view: ComparisonViewState,
  key: ComparisonViewState["plan"]["alignment"][number],
): { type: "string" | "number" | "boolean" | "date" | "datetime"; timezone?: string } {
  const field = asDocument(environment)
    .datasets.find((entry) => entry.id === view.plan.primary.dataset.id)
    ?.fields?.find((entry) => entry.id === key.primaryFieldId);
  return {
    type: key.type ?? field?.type ?? "string",
    ...(field?.timezone === undefined ? {} : { timezone: field.timezone }),
  };
}

function formatKey(
  environment: BlockSurfaceEnvironment,
  view: ComparisonViewState,
  key: ComparisonViewState["plan"]["alignment"][number],
  value: unknown,
): string {
  if (value === null || value === undefined) {
    return environment.messages.text("chart.missing");
  }
  return (
    formatValueParts(
      value as never,
      keyField(environment, view, key) as never,
      environment.formatters,
      environment.messages,
    ).text ?? environment.messages.text("chart.missing")
  );
}

export function renderComparisonTable(
  environment: BlockSurfaceEnvironment,
  container: HTMLElement,
  view: ComparisonViewState,
): void {
  const doc = environment.dom;
  container.replaceChildren();
  modeAttribute(container, view);
  const result = view.result;
  if (result === null) {
    return;
  }
  const region = createElement(doc, "div", "bl-comparison-table-region");
  region.setAttribute("role", "region");
  region.setAttribute("tabindex", "0");
  const table = createElement(doc, "table", "bl-table bl-comparison-table");
  const caption = createElement(doc, "caption", "bl-table__caption");
  const title = typeof environment.block.title === "string" ? environment.block.title : "";
  if (title.trim() === "") {
    setKeyedText(caption, "a11y.tableRegion", environment.messages.text("a11y.tableRegion"));
  } else {
    setHostText(caption, title);
  }
  table.append(caption);
  const head = createElement(doc, "thead");
  const headRow = createElement(doc, "tr");
  for (const key of result.alignment) {
    const cell = createElement(doc, "th");
    cell.setAttribute("scope", "col");
    setHostText(cell, key.label);
    headRow.append(cell);
  }
  for (const measure of result.measures) {
    for (const [key, fallback, side] of [
      ["editor.comparison.primary", "Primary", "primary"],
      ["editor.comparison.reference", "Reference", "reference"],
    ] as const) {
      const cell = createElement(doc, "th");
      cell.setAttribute("scope", "col");
      cell.setAttribute("data-measure", measure.id);
      cell.setAttribute("data-comparison-side", side);
      const label = environment.messages.has(key) ? environment.messages.text(key) : fallback;
      const unit =
        side === "reference" && referenceUnitsDiffer(measure)
          ? unitLabel(measure.referenceUnit)
          : unitLabel(measure.primaryUnit);
      setHostText(cell, unit === "" ? label : `${label} (${unit})`);
      headRow.append(cell);
    }
    if (showsAbsoluteDelta(result.deltaMode)) {
      const cell = createElement(doc, "th");
      cell.setAttribute("scope", "col");
      cell.setAttribute("data-measure", measure.id);
      setHostText(cell, environment.messages.text("chart.delta.absolute"));
      headRow.append(cell);
    }
    if (showsPercentageDelta(result.deltaMode)) {
      const cell = createElement(doc, "th");
      cell.setAttribute("scope", "col");
      cell.setAttribute("data-measure", measure.id);
      setHostText(cell, environment.messages.text("chart.delta.percent"));
      headRow.append(cell);
    }
  }
  head.append(headRow);
  const body = createElement(doc, "tbody");
  for (const row of result.rows) {
    body.append(comparisonTableRow(environment, view, row));
  }
  table.append(head, body);
  region.append(table);
  for (const measure of result.measures) {
    const note = conversionNote(environment, measure);
    if (note !== null) {
      region.append(note);
    }
  }
  region.append(comparisonSummary(environment, view));
  container.append(region);
}

function comparisonTableRow(
  environment: BlockSurfaceEnvironment,
  view: ComparisonViewState,
  row: ComparisonRow,
): HTMLTableRowElement {
  const doc = environment.dom;
  const tr = createElement(doc, "tr");
  tr.setAttribute("data-comparison-status", row.status);
  row.key.forEach((value, index) => {
    const key = view.plan.alignment[index];
    const cell = createElement(doc, index === 0 ? "th" : "td");
    if (index === 0) {
      cell.setAttribute("scope", "row");
    }
    setHostText(cell, key === undefined ? String(value) : formatKey(environment, view, key, value));
    if (index === 0 && row.status !== "matched") {
      const status = createElement(doc, "span", "bl-comparison-row-status");
      const statusKey =
        row.status === "primary-only"
          ? "chart.comparison.primaryOnly"
          : "chart.comparison.referenceOnly";
      setKeyedText(status, statusKey, environment.messages.text(statusKey));
      cell.append(status);
    }
    tr.append(cell);
  });
  for (const [measureIndex, measure] of view.plan.measures.entries()) {
    const measureRow = row.measures[measureIndex];
    if (measureRow === undefined) {
      continue;
    }
    tr.append(
      comparisonValueCell(environment, measure, measureRow.primary, "primary"),
      comparisonValueCell(environment, measure, measureRow.reference, "reference"),
    );
    if (showsAbsoluteDelta(view.plan.deltaMode)) {
      tr.append(comparisonDeltaCell(environment, measure, measureRow, "absolute"));
    }
    if (showsPercentageDelta(view.plan.deltaMode)) {
      tr.append(comparisonDeltaCell(environment, measure, measureRow, "percentage"));
    }
  }
  return tr;
}

function comparisonValueCell(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  operand: ComparisonMeasureRow["primary"],
  side: "primary" | "reference",
): HTMLTableCellElement {
  const cell = createElement(environment.dom, "td", "bl-table__cell");
  cell.setAttribute("data-comparison-side", side);
  const text = operandText(environment, measure, operand, side);
  if (text === null) {
    cell.setAttribute("data-value-status", "missing");
    cell.setAttribute("data-reason", operand.reason ?? "missing");
    setKeyedText(cell, "chart.missing", environment.messages.text("chart.missing"));
  } else {
    setHostText(cell, text);
  }
  return cell;
}

function comparisonDeltaCell(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  row: ComparisonMeasureRow,
  kind: "absolute" | "percentage",
): HTMLTableCellElement {
  const delta = kind === "absolute" ? row.absolute : row.percentage;
  const text = deltaValueText(environment, measure, delta, kind === "percentage");
  const cell = createElement(environment.dom, "td", "bl-table__cell");
  cell.setAttribute("data-delta", kind);
  if (text === null) {
    cell.setAttribute("data-delta-status", "unavailable");
    cell.setAttribute("data-reason", delta.reason ?? "unavailable");
    setKeyedText(
      cell,
      "chart.delta.unavailable",
      environment.messages.text("chart.delta.unavailable"),
    );
  } else {
    setHostText(cell, text);
  }
  return cell;
}

interface ComparisonChartDataset {
  readonly spec: ChartRendererSpec;
  readonly data: RendererData;
  readonly side: "primary" | "reference" | "overlay";
}

function fieldFromBinding(
  environment: BlockSurfaceEnvironment,
  binding: NonNullable<BlockSurfaceEnvironment["block"]["bindings"]>[number],
  keyIndex: number,
  alignment: ComparisonViewState["plan"]["alignment"],
): RendererField {
  const key = alignment[keyIndex];
  const field = asDocument(environment)
    .datasets.find((entry) => entry.id === binding.field.datasetId)
    ?.fields?.find((entry) => entry.id === binding.field.fieldId);
  return {
    fieldId: `${KEY_FIELD_PREFIX}${keyIndex}`,
    label: binding.label ?? key?.label ?? binding.field.fieldId,
    type: field?.type ?? key?.type ?? "string",
    role: "dimension",
    ordered:
      binding.bucket !== undefined ||
      field?.type === "date" ||
      field?.type === "datetime" ||
      field?.type === "number",
    ...(field?.allowedValues === undefined ? {} : { allowedValues: field.allowedValues }),
    ...(field?.timezone === undefined ? {} : { timezone: field.timezone }),
    ...(binding.bucket === undefined ? {} : { bucket: { grain: binding.bucket.grain } }),
  };
}

function measureField(
  environment: BlockSurfaceEnvironment,
  measure: ComparisonMeasurePlan,
  unit: ComparisonMeasurePlan["primaryUnit"] = measure.primaryUnit,
): RendererField {
  const binding = (environment.block.bindings ?? []).find((entry) => entry.id === measure.id);
  return {
    fieldId: measure.id,
    label: measure.label,
    type: "number",
    role: "measure",
    ...(unit === null ? {} : { unit }),
    ...(binding?.format === undefined
      ? {}
      : {
          format: {
            ...(binding.format.style === undefined ? {} : { style: binding.format.style }),
            ...(binding.format.precision === undefined
              ? {}
              : { precision: binding.format.precision }),
            ...(binding.format.currency === undefined ? {} : { currency: binding.format.currency }),
          },
        }),
  };
}

function chartOptions(environment: BlockSurfaceEnvironment): {
  readonly categoryOrder: "declared" | "data" | "ascending" | "descending";
  readonly stacked: boolean;
} {
  const options = ownValue(environment.block.config, "options");
  const categoryOrder = isRecord(options) ? ownValue(options, "categoryOrder") : undefined;
  return {
    categoryOrder:
      categoryOrder === "declared" ||
      categoryOrder === "ascending" ||
      categoryOrder === "descending"
        ? categoryOrder
        : "data",
    stacked: isRecord(options) && ownValue(options, "stacked") === true,
  };
}

function chartData(
  environment: BlockSurfaceEnvironment,
  view: ComparisonViewState,
  fields: readonly RendererField[],
  rows: readonly Readonly<Record<string, never>>[],
): RendererData {
  return {
    fields: fields.map((field) => ({
      fieldId: field.fieldId,
      type: field.type,
      role:
        field.role === "measure" ? "measure" : field.role === "temporal" ? "temporal" : "dimension",
      ...(field.unit === undefined ? {} : { unit: field.unit }),
      ...(field.timezone === undefined ? {} : { timezone: field.timezone }),
    })),
    rows: rows as never,
    counts: {
      returnedRows: rows.length,
      totalRows: rows.length,
      filteredRows: rows.length,
      nullCounts: {},
    },
    phase: view.phase === "loading" ? "loading" : "settled",
    scopeText: filterScopeText(environment),
    stale: view.phase === "stale",
    partial: view.phase === "partial",
    empty: rows.length === 0,
  };
}

export function buildComparisonChartDatasets(
  environment: BlockSurfaceEnvironment,
  view: ComparisonViewState,
): Result<readonly ComparisonChartDataset[]> {
  const result = view.result;
  if (result === null) {
    return { ok: true, value: Object.freeze([]) };
  }
  const measure = view.plan.measures[0];
  const visualization = environment.block.config.visualization;
  if (measure === undefined || typeof visualization !== "string") {
    return {
      ok: false,
      diagnostics: Object.freeze([
        createDiagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `blocks/${environment.block.id}/config`,
          { message: "A comparison chart requires one measure and a visualization." },
        ),
      ]),
    };
  }
  const selection = selectChartBindings(environment.block.bindings ?? [], null);
  const xBinding = selection.x;
  if (xBinding === null || typeof visualization !== "string") {
    return {
      ok: false,
      diagnostics: Object.freeze([
        createDiagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `blocks/${environment.block.id}/bindings`,
          { message: "A comparison chart requires an X binding." },
        ),
      ]),
    };
  }
  const alignment = view.plan.alignment;
  const xIndex = alignment.findIndex((key) => key.primaryFieldId === xBinding.field.fieldId);
  if (xIndex < 0) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        createDiagnostic(
          DIAGNOSTIC_CODES.COMPARISON_ALIGNMENT_INVALID,
          `comparisons/${view.plan.comparisonId}/alignment`,
          {
            message: "The chart X field must be one of the comparison alignment keys.",
            relatedIds: [xBinding.field.fieldId],
          },
        ),
      ]),
    };
  }
  const seriesBinding = selection.series === null ? null : selection.series;
  const seriesKeyIndex =
    seriesBinding === null
      ? -1
      : alignment.findIndex((key) => key.primaryFieldId === seriesBinding.field.fieldId);
  const xField = fieldFromBinding(environment, xBinding, xIndex, alignment);
  const yField = measureField(environment, measure);
  const seriesField: RendererField | null =
    result.displayMode === "overlay" || seriesKeyIndex >= 0
      ? {
          fieldId: SERIES_FIELD_ID,
          label: environment.messages.text("chart.series"),
          type: "string",
          role: "dimension",
        }
      : null;
  const options = chartOptions(environment);
  const primaryLabel = textKey(environment.messages, "editor.comparison.primary");
  const referenceLabel = textKey(environment.messages, "editor.comparison.reference");
  const datasets: ComparisonChartDataset[] = [];
  const buildSpec = (
    id: string,
    y: RendererField,
    series: RendererField | null,
  ): Result<ChartRendererSpec> =>
    buildChartRendererSpec({
      id,
      title: typeof environment.block.title === "string" ? environment.block.title : null,
      visualization: visualization as ChartRendererSpec["visualization"],
      x: xField,
      y,
      series,
      aggregation: measure.aggregation === "none" ? "sum" : measure.aggregation,
      stacked: options.stacked,
      categoryOrder: options.categoryOrder,
      comparison: true,
    });
  if (result.scalar) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        createDiagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `blocks/${environment.block.id}/config/comparisonId`,
          { message: "A chart comparison requires composite alignment keys." },
        ),
      ]),
    };
  }
  if (view.plan.displayMode === "overlay") {
    const spec = buildSpec(environment.block.id, yField, seriesField);
    if (!spec.ok) {
      return spec;
    }
    const rows: Record<string, never>[] = [];
    for (const row of result.rows) {
      const x = row.key[xIndex];
      if (x === undefined || x === null) {
        continue;
      }
      const baseSeries = seriesKeyIndex >= 0 ? row.key[seriesKeyIndex] : null;
      for (const [side, measureRow] of [
        ["primary", row.measures[0]?.primary],
        ["reference", row.measures[0]?.reference],
      ] as const) {
        if (measureRow === undefined || measureRow.value === null) {
          continue;
        }
        const seriesLabel =
          baseSeries === null || baseSeries === undefined
            ? side === "primary"
              ? primaryLabel
              : referenceLabel
            : `${String(baseSeries)} · ${side === "primary" ? primaryLabel : referenceLabel}`;
        rows.push({
          [xField.fieldId]: x,
          [yField.fieldId]: measureRow.value,
          ...(seriesField === null ? {} : { [seriesField.fieldId]: seriesLabel }),
        } as never);
      }
    }
    datasets.push({
      spec: spec.value,
      data: chartData(
        environment,
        view,
        seriesField === null ? [xField, yField] : [xField, yField, seriesField],
        rows,
      ),
      side: "overlay",
    });
  } else {
    const differingUnits = referenceUnitsDiffer(measure);
    for (const [side, label] of [
      ["primary", primaryLabel],
      ["reference", referenceLabel],
    ] as const) {
      const sideField =
        side === "reference" && differingUnits
          ? measureField(environment, measure, measure.referenceUnit)
          : yField;
      const spec = buildSpec(`${environment.block.id}:${side}`, sideField, seriesField);
      if (!spec.ok) {
        return spec;
      }
      const rows: Record<string, never>[] = [];
      for (const row of result.rows) {
        const x = row.key[xIndex];
        if (x === undefined || x === null) {
          continue;
        }
        const measureRow = row.measures[0];
        if (measureRow === undefined) {
          continue;
        }
        const operand = side === "primary" ? measureRow.primary : measureRow.reference;
        const value = side === "reference" && differingUnits ? operand.rawValue : operand.value;
        if (value === null) {
          continue;
        }
        const baseSeries = seriesKeyIndex >= 0 ? row.key[seriesKeyIndex] : null;
        rows.push({
          [xField.fieldId]: x,
          [sideField.fieldId]: value,
          ...(seriesField === null
            ? {}
            : {
                [seriesField.fieldId]:
                  baseSeries === null || baseSeries === undefined ? label : String(baseSeries),
              }),
        } as never);
      }
      datasets.push({
        spec: spec.value,
        data: chartData(
          environment,
          view,
          seriesField === null ? [xField, sideField] : [xField, sideField, seriesField],
          rows,
        ),
        side,
      });
    }
  }
  return { ok: true, value: Object.freeze(datasets) };
}

interface ActiveComparisonRenderer {
  readonly wrapper: HTMLElement;
  definition: RendererDefinition<HTMLElement> | null;
  handle: RendererHandle<HTMLElement> | null;
}

export interface ComparisonChartView {
  readonly element: HTMLElement;
  update(environment: BlockSurfaceEnvironment): readonly Diagnostic[];
  destroy(): void;
}

export function createComparisonChartView(
  environment: BlockSurfaceEnvironment,
): ComparisonChartView {
  const doc = environment.dom;
  const element = createElement(doc, "div", "bl-comparison bl-comparison--chart");
  const conversion = createElement(doc, "p", "bl-comparison-conversion");
  conversion.setAttribute("hidden", "");
  element.append(conversion);
  const active = new Map<string, ActiveComparisonRenderer>();
  const clearAll = (): void => {
    for (const entry of active.values()) {
      if (entry.handle !== null && entry.definition !== null) {
        destroyRenderer(entry.definition, entry.handle);
      }
      entry.wrapper.remove();
    }
    active.clear();
  };
  return {
    element,
    update(next: BlockSurfaceEnvironment): readonly Diagnostic[] {
      const view = next.comparison;
      if (view === null || view === undefined || view.result === null) {
        clearAll();
        element.replaceChildren(conversion);
        return Object.freeze([]);
      }
      const activeWrappers = new Set([...active.values()].map((entry) => entry.wrapper));
      for (const child of [...element.children]) {
        if (child !== conversion && !activeWrappers.has(child as HTMLElement)) {
          child.remove();
        }
      }
      if (element.firstChild !== conversion) {
        element.insertBefore(conversion, element.firstChild);
      }
      modeAttribute(element, view);
      const converted = view.plan.measures.find((measure) => measure.conversion !== null);
      if (converted?.conversion === undefined || converted.conversion === null) {
        conversion.setAttribute("hidden", "");
        conversion.textContent = "";
      } else {
        conversion.removeAttribute("hidden");
        setKeyedText(
          conversion,
          "chart.comparison.converted",
          next.messages.text("chart.comparison.converted", {
            from: converted.conversion.from,
            to: converted.conversion.to,
            provider: converted.conversion.provider,
          }),
        );
      }
      const built = buildComparisonChartDatasets(next, view);
      if (!built.ok) {
        clearAll();
        element.replaceChildren(conversion);
        return Object.freeze([...built.diagnostics]);
      }
      const seen = new Set<string>();
      const diagnostics: Diagnostic[] = [];
      for (const dataset of built.value) {
        seen.add(dataset.spec.id);
        const definition = next.renderers.resolve({
          kind: "chart",
          visualization: dataset.spec.kind === "chart" ? dataset.spec.visualization : "bar",
        });
        if (definition === undefined) {
          diagnostics.push(
            createDiagnostic(
              DIAGNOSTIC_CODES.RENDERER_UNSUPPORTED,
              `renderer/chart/${dataset.spec.kind === "chart" ? dataset.spec.visualization : "chart"}`,
              { message: "No chart renderer is registered for this comparison." },
            ),
          );
          break;
        }
        let entry = active.get(dataset.spec.id);
        if (entry === undefined || entry.definition?.id !== definition.id) {
          if (entry !== undefined) {
            if (entry.handle !== null && entry.definition !== null) {
              destroyRenderer(entry.definition, entry.handle);
            }
            entry.wrapper.remove();
            active.delete(dataset.spec.id);
          }
          const wrapper = createElement(doc, "div", "bl-comparison-chart__pane");
          wrapper.setAttribute("data-comparison-side", dataset.side);
          element.append(wrapper);
          const mounted = mountRenderer(
            definition,
            rendererInputWithData(next, wrapper, dataset.spec, dataset.data),
          );
          if (mounted.handle === null) {
            wrapper.remove();
            diagnostics.push(...mounted.diagnostics);
            break;
          }
          entry = { wrapper, definition, handle: mounted.handle };
          active.set(dataset.spec.id, entry);
        } else if (entry.handle !== null && entry.definition !== null) {
          const updated = updateRenderer(
            entry.definition,
            entry.handle,
            rendererInputWithData(next, entry.wrapper, dataset.spec, dataset.data),
          );
          if (updated.length > 0) {
            diagnostics.push(...updated);
            break;
          }
        }
      }
      if (diagnostics.length > 0) {
        clearAll();
        element.replaceChildren(conversion);
        return Object.freeze(diagnostics);
      }
      for (const [id, entry] of [...active]) {
        if (!seen.has(id)) {
          if (entry.handle !== null && entry.definition !== null) {
            destroyRenderer(entry.definition, entry.handle);
          }
          entry.wrapper.remove();
          active.delete(id);
        }
      }
      return Object.freeze([]);
    },
    destroy(): void {
      clearAll();
    },
  };
}

export const COMPARISON_REASON_KEYS: Readonly<Record<string, string>> = Object.freeze({
  PRIMARY_ONLY: "chart.delta.reason.missingPair",
  REFERENCE_ONLY: "chart.delta.reason.missingPair",
  PRIMARY_NULL: "chart.delta.reason.primaryNull",
  REFERENCE_NULL: "chart.delta.reason.referenceNull",
  ZERO_REFERENCE: "chart.delta.reason.referenceZero",
  UNIT_MISMATCH: "chart.delta.reason.unitMismatch",
  RESULT_NON_FINITE: "chart.delta.reason.nonFinite",
  PRIMARY_NON_FINITE: "chart.delta.reason.nonFinite",
  REFERENCE_NON_FINITE: "chart.delta.reason.nonFinite",
});
