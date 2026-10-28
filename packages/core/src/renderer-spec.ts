import type { AggregationType, ChartType } from "./board-schema.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import {
  classifyField,
  isCategoryOrder,
  isVisualizationKind,
  validateVisualizationMatrix,
  VISUALIZATION_MATRIX,
  type CategoryOrder,
  type MatrixFieldInput,
} from "./field-matrix.js";
import type {
  ChartRendererSpec,
  KpiRendererSpec,
  RendererAxis,
  RendererField,
  RendererValidation,
  TableRendererSpec,
} from "./renderer-contract.js";

export interface ChartSpecInput {
  readonly id: string;
  readonly title?: string | null;
  readonly visualization: ChartType;
  readonly x: RendererField;
  readonly y: RendererField;
  readonly series?: RendererField | null;
  readonly aggregation?: AggregationType | null;
  readonly stacked?: boolean;
  readonly categoryOrder?: CategoryOrder;
  readonly xAxis?: RendererAxis;
  readonly yAxis?: RendererAxis;
  readonly comparison?: boolean;
}

export interface KpiSpecInput {
  readonly id: string;
  readonly title?: string | null;
  readonly y: RendererField;
  readonly aggregation?: AggregationType | null;
  readonly comparison?: boolean;
}

export interface TableSpecInput {
  readonly id: string;
  readonly title?: string | null;
  readonly columns: readonly RendererField[];
  readonly comparison?: boolean;
}

function matrixField(field: RendererField | null | undefined): MatrixFieldInput | null {
  if (!field) {
    return null;
  }
  return Object.freeze({
    type: field.type,
    ...(field.role === undefined ? {} : { role: field.role }),
    ...(field.allowedValues === undefined ? {} : { allowedValues: field.allowedValues }),
    ...(field.ordered === undefined ? {} : { ordered: field.ordered }),
    ...(field.bucket === undefined ? {} : { bucket: field.bucket }),
    ...(field.binned === undefined ? {} : { binned: field.binned }),
  });
}

function specDiagnostic(path: string, message: string): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE, path, { message });
}

function normalizeTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const trimmed = title.trim();
  return trimmed === "" ? null : trimmed;
}

function unitText(field: RendererField): string {
  return field.unit?.label ?? field.unit?.unit ?? "";
}

function validateAxis(axis: RendererAxis, path: string, diagnostics: Diagnostic[]): void {
  if (axis.min !== undefined && !Number.isFinite(axis.min)) {
    diagnostics.push(specDiagnostic(`${path}/min`, "The axis minimum must be finite."));
  }
  if (axis.max !== undefined && !Number.isFinite(axis.max)) {
    diagnostics.push(specDiagnostic(`${path}/max`, "The axis maximum must be finite."));
  }
  if (
    axis.min !== undefined &&
    axis.max !== undefined &&
    Number.isFinite(axis.min) &&
    Number.isFinite(axis.max) &&
    axis.min > axis.max
  ) {
    diagnostics.push(
      specDiagnostic(path, "The axis minimum must not be greater than the maximum."),
    );
  }
}

export function validateChartRendererSpec(spec: ChartRendererSpec): RendererValidation {
  if (
    !isVisualizationKind(spec.visualization) ||
    !Object.hasOwn(VISUALIZATION_MATRIX, spec.visualization)
  ) {
    return Object.freeze({
      ok: false,
      diagnostics: Object.freeze([
        specDiagnostic(
          `chart/${spec.id}/visualization`,
          `The visualization ${String(spec.visualization)} is not part of the field-type matrix.`,
        ),
      ]),
    });
  }
  const diagnostics: Diagnostic[] = [];
  const matrix = validateVisualizationMatrix({
    visualization: spec.visualization,
    x: matrixField(spec.x),
    y: matrixField(spec.y),
    series: matrixField(spec.series),
    aggregation: spec.aggregation,
    stacked: spec.stacked,
    paths: {
      visualization: `chart/${spec.id}/visualization`,
      x: `chart/${spec.id}/x`,
      y: `chart/${spec.id}/y`,
      series: `chart/${spec.id}/series`,
      aggregation: `chart/${spec.id}/aggregation`,
    },
  });
  diagnostics.push(...matrix.diagnostics);

  if (!isCategoryOrder(spec.categoryOrder)) {
    diagnostics.push(
      specDiagnostic(`chart/${spec.id}/categoryOrder`, "The category order is not supported."),
    );
  }

  validateAxis(spec.xAxis, `chart/${spec.id}/xAxis`, diagnostics);
  validateAxis(spec.yAxis, `chart/${spec.id}/yAxis`, diagnostics);

  if (!Number.isFinite(spec.yAxis.min ?? 0) || !Number.isFinite(spec.yAxis.max ?? 0)) {
    diagnostics.push(specDiagnostic(`chart/${spec.id}/yAxis`, "The Y axis bounds must be finite."));
  }

  const xFieldUnit = unitText(spec.x);
  const yFieldUnit = unitText(spec.y);
  if (spec.xAxis.unit !== undefined && spec.xAxis.unit !== xFieldUnit) {
    diagnostics.push(
      specDiagnostic(
        `chart/${spec.id}/xAxis/unit`,
        "An X axis unit override must match the field unit; implicit unit conversion is not supported.",
      ),
    );
  }
  if (spec.yAxis.unit !== undefined && spec.yAxis.unit !== yFieldUnit) {
    diagnostics.push(
      specDiagnostic(
        `chart/${spec.id}/yAxis/unit`,
        "A Y axis unit override must match the field unit; implicit unit conversion is not supported.",
      ),
    );
  }

  const numericXAxis =
    spec.visualization === "scatter" || (spec.visualization === "line" && spec.x.type === "number");
  if (!numericXAxis && (spec.xAxis.min !== undefined || spec.xAxis.max !== undefined)) {
    diagnostics.push(
      specDiagnostic(
        `chart/${spec.id}/xAxis`,
        "X axis bounds are only supported for numeric axes; categorical bounds are rejected.",
      ),
    );
  }

  const entry = VISUALIZATION_MATRIX[spec.visualization];
  if (entry.zeroBaseline === "required" || entry.zeroBaseline === "visible") {
    if (spec.yAxis.min !== undefined && spec.yAxis.min > 0) {
      diagnostics.push(
        specDiagnostic(
          `chart/${spec.id}/yAxis/min`,
          `${spec.visualization} requires a visible zero baseline; the Y axis minimum must not be above zero.`,
        ),
      );
    }
    if (spec.yAxis.max !== undefined && spec.yAxis.max < 0) {
      diagnostics.push(
        specDiagnostic(
          `chart/${spec.id}/yAxis/max`,
          `${spec.visualization} requires a visible zero baseline; the Y axis maximum must not be below zero.`,
        ),
      );
    }
  }

  if (spec.visualization === "stacked-bar" && spec.stacked && spec.series === null) {
    diagnostics.push(
      specDiagnostic(`chart/${spec.id}/series`, "A stacked bar requires a series field."),
    );
  }

  return Object.freeze({
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function buildChartRendererSpec(input: ChartSpecInput): Result<ChartRendererSpec> {
  if (
    !isVisualizationKind(input.visualization) ||
    !Object.hasOwn(VISUALIZATION_MATRIX, input.visualization)
  ) {
    return fail([
      specDiagnostic(
        `chart/${input.id}/visualization`,
        `The visualization ${String(input.visualization)} is not part of the field-type matrix.`,
      ),
    ]);
  }
  const aggregation = input.aggregation ?? ("none" as const);
  const categoryOrder: CategoryOrder = input.categoryOrder ?? "data";
  const stacked =
    input.stacked === true || (input.visualization === "stacked-bar" && input.stacked !== false);
  const spec: ChartRendererSpec = Object.freeze({
    id: input.id,
    kind: "chart",
    title: normalizeTitle(input.title),
    visualization: input.visualization,
    x: input.x,
    y: input.y,
    series: input.series ?? null,
    aggregation,
    stacked,
    categoryOrder,
    xAxis: input.xAxis ?? Object.freeze({}),
    yAxis: input.yAxis ?? Object.freeze({}),
    comparison: input.comparison === true,
  });
  const validation = validateChartRendererSpec(spec);
  return validation.ok ? ok(spec) : fail(validation.diagnostics);
}

export function buildKpiRendererSpec(input: KpiSpecInput): Result<KpiRendererSpec> {
  const diagnostics: Diagnostic[] = [];
  const matrix = validateVisualizationMatrix({
    visualization: "kpi",
    y: matrixField(input.y),
    aggregation: input.aggregation ?? null,
    paths: {
      visualization: `kpi/${input.id}/visualization`,
      x: `kpi/${input.id}/x`,
      y: `kpi/${input.id}/y`,
      aggregation: `kpi/${input.id}/aggregation`,
    },
  });
  diagnostics.push(...matrix.diagnostics);
  if (classifyField(matrixField(input.y)) !== "numeric") {
    diagnostics.push(specDiagnostic(`kpi/${input.id}/y`, "A KPI requires one numeric measure."));
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return fail(Object.freeze(diagnostics));
  }
  const spec: KpiRendererSpec = Object.freeze({
    id: input.id,
    kind: "kpi",
    title: normalizeTitle(input.title),
    y: input.y,
    aggregation: input.aggregation ?? "average",
    comparison: input.comparison === true,
  });
  return ok(spec);
}

export function buildTableRendererSpec(input: TableSpecInput): Result<TableRendererSpec> {
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    return fail([
      specDiagnostic(`table/${input.id}/columns`, "A table renderer requires at least one column."),
    ]);
  }
  const spec: TableRendererSpec = Object.freeze({
    id: input.id,
    kind: "table",
    title: normalizeTitle(input.title),
    columns: Object.freeze([...input.columns]),
    comparison: input.comparison === true,
  });
  return ok(spec);
}
