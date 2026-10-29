import {
  DIAGNOSTIC_CODES,
  buildChartRendererSpec,
  buildKpiRendererSpec,
  buildTableRendererSpec,
  createDiagnostic,
  fail,
  formatEnglishMessage,
  ok,
  rendererAxisFromConfig,
  selectChartBindings as selectSharedChartBindings,
  type BindingDefinition,
  type BoardDocumentV1,
  type ChartAxisConfig,
  type DataFieldDescriptor,
  type ChartRendererSpec,
  type ChartType,
  type FieldDescriptor,
  type KpiRendererSpec,
  type QueryResultField,
  type RendererData,
  type RendererField,
  type RendererInput,
  type RendererSpec,
  type Result,
  type TableRendererSpec,
} from "@boardloom/core";
import type { BlockSurfaceEnvironment } from "./block-registry.js";
import { activeFilterSummaries } from "./filter-summary.js";
import { ownValue } from "./own-value.js";

const CHART_TYPES = new Set(["line", "area", "bar", "stacked-bar", "scatter", "donut"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingDiagnostic(
  path: string,
  detailKey: string,
  detailParams?: Readonly<Record<string, string | number>>,
): Result<never> {
  return fail([
    createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, path, {
      message: formatEnglishMessage(detailKey, detailParams),
      detailKey,
      ...(detailParams === undefined ? {} : { detailParams }),
    }),
  ]);
}

function isMeasureBinding(binding: BindingDefinition): boolean {
  return binding.role === "measure" || binding.role === "value" || binding.axis === "y";
}

function effectiveFieldId(binding: BindingDefinition): string {
  const aggregation = binding.aggregation;
  return aggregation && aggregation.type !== "none" ? binding.id : binding.field.fieldId;
}

function datasetField(
  document: BoardDocumentV1,
  binding: BindingDefinition,
): FieldDescriptor | undefined {
  const dataset = document.datasets.find((entry) => entry.id === binding.field.datasetId);
  return dataset?.fields?.find((entry) => entry.id === binding.field.fieldId);
}

function providerField(
  environment: BlockSurfaceEnvironment,
  binding: BindingDefinition,
): DataFieldDescriptor | undefined {
  const descriptor = environment.getDatasetDescriptor(binding.field.datasetId);
  return descriptor?.fields.find((entry) => entry.id === binding.field.fieldId);
}

function queryField(
  fields: readonly QueryResultField[],
  binding: BindingDefinition,
): QueryResultField | undefined {
  const fieldId = effectiveFieldId(binding);
  return fields.find((field) => field.fieldId === fieldId);
}

function baseUnitDescriptor(
  environment: BlockSurfaceEnvironment,
  binding: BindingDefinition,
  fields: readonly QueryResultField[],
): NonNullable<RendererField["unit"]> | undefined {
  const descriptor = datasetField(environment.document as unknown as BoardDocumentV1, binding);
  const source = providerField(environment, binding);
  const resultField = queryField(fields, binding);
  return (
    resultField?.unit ??
    source?.unit ??
    (descriptor?.unit === undefined ? undefined : { unit: descriptor.unit })
  );
}

function unitOverrideDiagnostic(
  environment: BlockSurfaceEnvironment,
  binding: BindingDefinition,
  fields: readonly QueryResultField[],
  overrideUnit: string | undefined = undefined,
  path: string = `blocks/${environment.block.id}/bindings/${binding.id}/format/unit`,
): ReturnType<typeof createDiagnostic> | null {
  const unit = overrideUnit ?? binding.format?.unit;
  if (unit === undefined) {
    return null;
  }
  const baseUnit = baseUnitDescriptor(environment, binding, fields);
  if (baseUnit !== undefined && baseUnit.unit !== unit) {
    return createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, path, {
      message: formatEnglishMessage("diagnostic.detail.unitConflict", {
        unit,
        baseUnit: baseUnit.unit,
      }),
      detailKey: "diagnostic.detail.unitConflict",
      detailParams: { unit, baseUnit: baseUnit.unit },
      relatedIds: [binding.id],
    });
  }
  return null;
}

function rendererField(
  environment: BlockSurfaceEnvironment,
  binding: BindingDefinition,
  fields: readonly QueryResultField[],
): RendererField {
  const document = environment.document as unknown as BoardDocumentV1;
  const descriptor = datasetField(document, binding);
  const source = providerField(environment, binding);
  const resultField = queryField(fields, binding);
  const baseUnit = baseUnitDescriptor(environment, binding, fields);
  const unit =
    binding.format?.unit === undefined
      ? baseUnit
      : baseUnit?.unit === binding.format.unit
        ? baseUnit
        : { unit: binding.format.unit };
  const providerFormat = source?.format;
  const format = {
    ...(providerFormat?.style === undefined ? {} : { style: providerFormat.style }),
    ...(providerFormat?.precision === undefined ? {} : { precision: providerFormat.precision }),
    ...(providerFormat?.currency === undefined ? {} : { currency: providerFormat.currency }),
    ...(providerFormat?.dateStyle === undefined ? {} : { dateStyle: providerFormat.dateStyle }),
    ...(providerFormat?.timeStyle === undefined ? {} : { timeStyle: providerFormat.timeStyle }),
    ...(binding.format?.style === undefined ? {} : { style: binding.format.style }),
    ...(binding.format?.precision === undefined ? {} : { precision: binding.format.precision }),
    ...(binding.format?.currency === undefined ? {} : { currency: binding.format.currency }),
    ...(binding.format?.dateStyle === undefined ? {} : { dateStyle: binding.format.dateStyle }),
    ...(binding.format?.timeStyle === undefined ? {} : { timeStyle: binding.format.timeStyle }),
  };
  const allowedValues = source?.allowedValues ?? descriptor?.allowedValues;
  return Object.freeze({
    fieldId: effectiveFieldId(binding),
    label: binding.label ?? binding.field.fieldId,
    type: resultField?.type ?? source?.type ?? descriptor?.type ?? "string",
    ...(resultField?.role === undefined &&
    source?.role === undefined &&
    descriptor?.role === undefined
      ? {}
      : { role: resultField?.role ?? source?.role ?? descriptor?.role }),
    ...(unit === undefined ? {} : { unit }),
    ...(Object.keys(format).length === 0 ? {} : { format }),
    ...((binding.format?.timezone ??
      binding.bucket?.timezone ??
      resultField?.timezone ??
      source?.timezone ??
      descriptor?.timezone) === undefined
      ? {}
      : {
          timezone:
            binding.format?.timezone ??
            binding.bucket?.timezone ??
            resultField?.timezone ??
            source?.timezone ??
            descriptor?.timezone,
        }),
    ...(resultField?.temporalRepresentation === undefined &&
    source?.temporalRepresentation === undefined
      ? {}
      : {
          temporalRepresentation:
            resultField?.temporalRepresentation ?? source?.temporalRepresentation,
        }),
    ...(allowedValues === undefined ? {} : { allowedValues, ordered: true }),
    ...(binding.bucket === undefined ? {} : { bucket: { grain: binding.bucket.grain } }),
  });
}

interface FormatOverride {
  readonly format: NonNullable<RendererField["format"]>;
  readonly unit?: string;
  readonly timezone?: string;
}

function metricFormatOverride(block: BlockSurfaceEnvironment["block"]): FormatOverride | null {
  const configured = ownValue(block.config, "format");
  if (!isRecord(configured)) {
    return null;
  }
  const format: NonNullable<RendererField["format"]> = {
    ...(typeof ownValue(configured, "style") === "string"
      ? { style: ownValue(configured, "style") as NonNullable<RendererField["format"]>["style"] }
      : {}),
    ...(typeof ownValue(configured, "precision") === "number"
      ? { precision: ownValue(configured, "precision") as number }
      : {}),
    ...(typeof ownValue(configured, "currency") === "string"
      ? { currency: ownValue(configured, "currency") as string }
      : {}),
    ...(typeof ownValue(configured, "dateStyle") === "string"
      ? {
          dateStyle: ownValue(configured, "dateStyle") as NonNullable<
            RendererField["format"]
          >["dateStyle"],
        }
      : {}),
    ...(typeof ownValue(configured, "timeStyle") === "string"
      ? {
          timeStyle: ownValue(configured, "timeStyle") as NonNullable<
            RendererField["format"]
          >["timeStyle"],
        }
      : {}),
  };
  const unit = ownValue(configured, "unit");
  const timezone = ownValue(configured, "timezone");
  if (
    Object.keys(format).length === 0 &&
    typeof unit !== "string" &&
    typeof timezone !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    format: Object.freeze(format),
    ...(typeof unit === "string" && unit.trim() !== "" ? { unit } : {}),
    ...(typeof timezone === "string" && timezone.trim() !== "" ? { timezone } : {}),
  });
}

function applyFormatOverride(field: RendererField, override: FormatOverride | null): RendererField {
  if (override === null) {
    return field;
  }
  const format = Object.freeze({
    ...(field.format ?? {}),
    ...override.format,
  });
  const unit =
    override.unit === undefined
      ? field.unit
      : field.unit?.unit === override.unit
        ? field.unit
        : { unit: override.unit };
  return Object.freeze({
    ...field,
    ...(Object.keys(format).length === 0 ? {} : { format }),
    ...(unit === undefined ? {} : { unit }),
    ...(override.timezone === undefined ? {} : { timezone: override.timezone }),
  });
}

function chartType(block: BlockSurfaceEnvironment["block"]): ChartType | null {
  const configured = ownValue(block.config, "visualization");
  return typeof configured === "string" && CHART_TYPES.has(configured)
    ? (configured as ChartType)
    : null;
}

function chartOptions(block: BlockSurfaceEnvironment["block"]): Record<string, unknown> {
  const options = ownValue(block.config, "options");
  return isRecord(options) ? options : {};
}

function axisConfig(value: unknown): ChartAxisConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const axis: ChartAxisConfig = {
    ...(typeof ownValue(value, "label") === "string"
      ? { label: ownValue(value, "label") as string }
      : {}),
    ...(typeof ownValue(value, "unit") === "string"
      ? { unit: ownValue(value, "unit") as string }
      : {}),
    ...(typeof ownValue(value, "min") === "number"
      ? { min: ownValue(value, "min") as number }
      : {}),
    ...(typeof ownValue(value, "max") === "number"
      ? { max: ownValue(value, "max") as number }
      : {}),
  };
  return axis;
}

function categoryOrder(
  block: BlockSurfaceEnvironment["block"],
): "declared" | "data" | "ascending" | "descending" {
  const value = ownValue(chartOptions(block), "categoryOrder");
  return value === "declared" || value === "ascending" || value === "descending" ? value : "data";
}

function selectChartBindings(
  block: BlockSurfaceEnvironment["block"],
  visualization: ChartType,
): Result<{
  readonly x: BindingDefinition;
  readonly y: BindingDefinition;
  readonly series: BindingDefinition | null;
}> {
  const bindings = block.bindings ?? [];
  const measures = bindings.filter(isMeasureBinding);
  const selection = selectSharedChartBindings(bindings, visualization);
  if (visualization === "scatter") {
    if (measures.length > 2) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "diagnostic.detail.scatter.maxMeasures",
      );
    }
    if (selection.x === null || selection.y === null) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "diagnostic.detail.scatter.requiresMeasures",
      );
    }
    return ok({ x: selection.x, y: selection.y, series: selection.series });
  }
  if (selection.x === null) {
    return bindingDiagnostic(`blocks/${block.id}/bindings`, "diagnostic.detail.chart.requiresX");
  }
  if (measures.length > 1) {
    return bindingDiagnostic(`blocks/${block.id}/bindings`, "diagnostic.detail.chart.oneMeasure");
  }
  if (selection.y === null) {
    return bindingDiagnostic(`blocks/${block.id}/bindings`, "diagnostic.detail.chart.requiresY");
  }
  if (selection.seriesCandidates.length > 1) {
    return bindingDiagnostic(`blocks/${block.id}/bindings`, "diagnostic.detail.chart.oneSeries");
  }
  return ok({ x: selection.x, y: selection.y, series: selection.series });
}

export function buildChartSpecForBlock(
  environment: BlockSurfaceEnvironment,
): Result<ChartRendererSpec> {
  const visualization = chartType(environment.block);
  if (visualization === null) {
    return fail([
      createDiagnostic(
        DIAGNOSTIC_CODES.UNKNOWN_RENDERER_TYPE,
        `blocks/${environment.block.id}/config/visualization`,
      ),
    ]);
  }
  const selected = selectChartBindings(environment.block, visualization);
  if (!selected.ok) {
    return selected;
  }
  const fields = environment.query?.fields ?? [];
  const unitConflict = [
    selected.value.x,
    selected.value.y,
    ...(selected.value.series === null ? [] : [selected.value.series]),
  ]
    .map((binding) => unitOverrideDiagnostic(environment, binding, fields))
    .find((diagnostic) => diagnostic !== null);
  if (unitConflict) {
    return fail([unitConflict]);
  }
  const options = chartOptions(environment.block);
  const order = categoryOrder(environment.block);
  const binnedX = ownValue(options, "binnedX") === true;
  const xBase = rendererField(environment, selected.value.x, fields);
  const x: RendererField = Object.freeze({
    ...xBase,
    ...(order === "ascending" ? { ordered: true } : {}),
    ...(binnedX ? { binned: true } : {}),
  });
  const y = rendererField(environment, selected.value.y, fields);
  const series =
    selected.value.series === null
      ? null
      : rendererField(environment, selected.value.series, fields);
  const aggregation = selected.value.y.aggregation?.type ?? "none";
  return buildChartRendererSpec({
    id: environment.block.id,
    title: typeof environment.block.title === "string" ? environment.block.title : null,
    visualization,
    x,
    y,
    series,
    aggregation,
    ...(ownValue(options, "stacked") === undefined
      ? {}
      : { stacked: ownValue(options, "stacked") === true }),
    categoryOrder: order,
    xAxis: rendererAxisFromConfig(axisConfig(ownValue(options, "xAxis"))),
    yAxis: rendererAxisFromConfig(axisConfig(ownValue(options, "yAxis"))),
  });
}

export function buildKpiSpecForBlock(
  environment: BlockSurfaceEnvironment,
): Result<KpiRendererSpec> {
  const measures = (environment.block.bindings ?? []).filter(isMeasureBinding);
  if (measures.length === 0) {
    return bindingDiagnostic(
      `blocks/${environment.block.id}/bindings`,
      "diagnostic.detail.metric.requiresMeasure",
    );
  }
  if (measures.length > 1) {
    return bindingDiagnostic(
      `blocks/${environment.block.id}/bindings`,
      "diagnostic.detail.metric.oneMeasure",
    );
  }
  const binding = measures[0] ?? null;
  if (binding === null) {
    return bindingDiagnostic(
      `blocks/${environment.block.id}/bindings`,
      "diagnostic.detail.metric.requiresMeasure",
    );
  }
  const fields = environment.query?.fields ?? [];
  const formatOverride = metricFormatOverride(environment.block);
  const unitConflict = unitOverrideDiagnostic(environment, binding, fields);
  if (unitConflict) {
    return fail([unitConflict]);
  }
  if (formatOverride?.unit !== undefined) {
    const configConflict = unitOverrideDiagnostic(
      environment,
      binding,
      fields,
      formatOverride.unit,
      `blocks/${environment.block.id}/config/format/unit`,
    );
    if (configConflict) {
      return fail([configConflict]);
    }
  }
  return buildKpiRendererSpec({
    id: environment.block.id,
    title: typeof environment.block.title === "string" ? environment.block.title : null,
    y: applyFormatOverride(rendererField(environment, binding, fields), formatOverride),
    aggregation: binding.aggregation?.type ?? "none",
  });
}

export function buildTableSpecForBlock(
  environment: BlockSurfaceEnvironment,
): Result<TableRendererSpec> {
  const bindings = environment.block.bindings ?? [];
  if (bindings.length === 0) {
    return bindingDiagnostic(
      `blocks/${environment.block.id}/bindings`,
      "diagnostic.detail.table.requiresBinding",
    );
  }
  const configured = ownValue(environment.block.config, "columns");
  let selected: BindingDefinition[] = [...bindings];
  if (configured !== undefined) {
    if (!Array.isArray(configured)) {
      return bindingDiagnostic(
        `blocks/${environment.block.id}/config/columns`,
        "diagnostic.detail.table.columnsArray",
      );
    }
    const byId = new Map(bindings.map((binding) => [binding.id, binding] as const));
    const seen = new Set<string>();
    selected = [];
    for (const [index, column] of configured.entries()) {
      if (typeof column !== "string" || column.trim() === "") {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.MISSING_ID,
            `blocks/${environment.block.id}/config/columns/${index}`,
          ),
        ]);
      }
      if (seen.has(column)) {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.DUPLICATE_ID,
            `blocks/${environment.block.id}/config/columns/${index}`,
            { relatedIds: [column] },
          ),
        ]);
      }
      seen.add(column);
      const binding = byId.get(column);
      if (binding === undefined) {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.INVALID_REFERENCE,
            `blocks/${environment.block.id}/config/columns/${index}`,
            { relatedIds: [column] },
          ),
        ]);
      }
      selected.push(binding);
    }
  }
  const fields = environment.query?.fields ?? [];
  const unitConflict = selected
    .map((binding) => unitOverrideDiagnostic(environment, binding, fields))
    .find((diagnostic) => diagnostic !== null);
  if (unitConflict) {
    return fail([unitConflict]);
  }
  return buildTableRendererSpec({
    id: environment.block.id,
    title: typeof environment.block.title === "string" ? environment.block.title : null,
    columns: selected.map((binding) => rendererField(environment, binding, fields)),
  });
}

export function filterScopeText(environment: BlockSurfaceEnvironment): string | null {
  const document = environment.document as unknown as BoardDocumentV1;
  const filters = activeFilterSummaries(document, environment.messages);
  if (filters.length === 0) {
    return null;
  }
  const entries = filters
    .map((filter) => `${filter.label}: ${filter.value}`)
    .filter((entry) => !entry.endsWith(": "));
  return entries.length === 0 ? null : entries.join("; ");
}

export function rendererData(environment: BlockSurfaceEnvironment): RendererData {
  const query = environment.query;
  return Object.freeze({
    fields: query?.fields ?? Object.freeze([]),
    rows: query?.rows ?? Object.freeze([]),
    counts:
      query?.counts ??
      Object.freeze({
        returnedRows: 0,
        totalRows: null,
        filteredRows: 0,
        nullCounts: Object.freeze({}),
      }),
    phase: query?.phase ?? "empty",
    scopeText: filterScopeText(environment),
    stale: query?.phase === "stale",
    partial: query?.phase === "partial",
    empty: query === null || query.rows.length === 0,
  });
}

export function rendererInput(
  environment: BlockSurfaceEnvironment,
  host: HTMLElement,
  spec: RendererSpec,
): RendererInput<HTMLElement> {
  return rendererInputWithData(environment, host, spec, rendererData(environment));
}

export function rendererInputWithData(
  environment: BlockSurfaceEnvironment,
  host: HTMLElement,
  spec: RendererSpec,
  data: RendererData,
): RendererInput<HTMLElement> {
  return Object.freeze({
    host,
    spec,
    data,
    comparison: environment.comparison?.result ?? null,
    theme: environment.theme,
    locale: environment.locale,
    timezone: environment.timezone,
    direction: environment.messages.direction,
    formatters: environment.formatters,
    messages: environment.messages,
  });
}
