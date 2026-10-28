import {
  CHART_TYPES,
  type AggregationType,
  type BoardDocumentV1,
  type ComparisonDefinition,
  type ComparisonDeltaMode,
  type ComparisonDisplayMode,
  type ComparisonFieldMapping,
  type ComparisonInput,
  type FieldValueType,
  type TimeWindow,
} from "./board-schema.js";
import type { BoardValidationCatalog } from "./board-validation-shared.js";
import { selectChartBindings } from "./chart-bindings.js";
import {
  type DataFieldDescriptor,
  type DatasetDescriptor,
  type QueryAggregation,
  type QueryFilter,
  type QueryGrouping,
  type QueryResultField,
  type QueryResultRow,
  type QuerySpec,
  type QueryTimeWindow,
} from "./data-contract.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  hasError,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import {
  composeComparisonFilterSides,
  documentField,
  type EffectiveFilter,
  type FilterRuntimeState,
} from "./filter-model.js";
import { canonicalJson, type JsonValue } from "./json.js";
import { buildQueryPlan, type QueryPlan } from "./query-planning.js";

export const COMPARISON_ROW_STATUSES = Object.freeze([
  "matched",
  "primary-only",
  "reference-only",
] as const);
export type ComparisonRowStatus = (typeof COMPARISON_ROW_STATUSES)[number];

export const COMPARISON_DELTA_REASONS = Object.freeze([
  "PRIMARY_ONLY",
  "REFERENCE_ONLY",
  "PRIMARY_NULL",
  "REFERENCE_NULL",
  "PRIMARY_NON_FINITE",
  "REFERENCE_NON_FINITE",
  "ZERO_REFERENCE",
  "RESULT_NON_FINITE",
  "UNIT_MISMATCH",
] as const);
export type ComparisonDeltaReason = (typeof COMPARISON_DELTA_REASONS)[number];

export interface ComparisonAlignmentKey {
  readonly primaryFieldId: string;
  readonly referenceFieldId: string;
  readonly label: string;
  readonly type: FieldValueType | null;
}

export interface ComparisonConversionResolution {
  readonly from: string;
  readonly to: string;
  readonly factor: number;
  readonly offset: number;
  readonly provider: string;
  readonly direction: "primary-to-reference" | "reference-to-primary";
}

export interface ComparisonMeasurePlan {
  readonly id: string;
  readonly label: string;
  readonly aggregation: AggregationType;
  readonly primaryFieldId: string;
  readonly referenceFieldId: string;
  readonly primaryOutputFieldId: string;
  readonly referenceOutputFieldId: string;
  readonly primaryUnit: { readonly unit: string; readonly scale?: number } | null;
  readonly referenceUnit: { readonly unit: string; readonly scale?: number } | null;
  readonly conversion: ComparisonConversionResolution | null;
}

export interface ComparisonPlan {
  readonly comparisonId: string;
  readonly label: string;
  readonly blockId: string;
  readonly displayMode: ComparisonDisplayMode;
  readonly deltaMode: ComparisonDeltaMode;
  readonly scalar: boolean;
  readonly collation: string;
  readonly normalization: string;
  readonly alignment: readonly ComparisonAlignmentKey[];
  readonly measures: readonly ComparisonMeasurePlan[];
  readonly primary: QueryPlan;
  readonly reference: QueryPlan;
}

export interface BuildComparisonPlanOptions {
  readonly descriptors: Readonly<Record<string, DatasetDescriptor>>;
  readonly catalog?: BoardValidationCatalog;
  readonly filterState?: FilterRuntimeState;
  readonly providerIds?: Readonly<Record<string, string>>;
}

export interface ComparisonOperand {
  readonly rawValue: JsonValue | null;
  readonly value: number | null;
  readonly reason: ComparisonDeltaReason | null;
}

export interface ComparisonDelta {
  readonly available: boolean;
  readonly value: number | null;
  readonly reason: ComparisonDeltaReason | null;
}

export interface ComparisonMeasureRow {
  readonly id: string;
  readonly primary: ComparisonOperand;
  readonly reference: ComparisonOperand;
  readonly absolute: ComparisonDelta;
  readonly percentage: ComparisonDelta;
}

export interface ComparisonRow {
  readonly key: readonly JsonValue[];
  readonly keyText: string;
  readonly status: ComparisonRowStatus;
  readonly primaryRow: QueryResultRow | null;
  readonly referenceRow: QueryResultRow | null;
  readonly measures: readonly ComparisonMeasureRow[];
}

export interface ComparisonCounts {
  readonly rowCount: number;
  readonly matchedRowCount: number;
  readonly primaryOnlyCount: number;
  readonly referenceOnlyCount: number;
  readonly excludedNullKeyCount: number;
  readonly primaryExcludedNullKeyCount: number;
  readonly referenceExcludedNullKeyCount: number;
  readonly excludedNullComponents: Readonly<Record<string, number>>;
  readonly matchedNonNullMeasureCount: Readonly<Record<string, number>>;
}

export interface ComparisonResult {
  readonly comparisonId: string;
  readonly scalar: boolean;
  readonly displayMode: ComparisonDisplayMode;
  readonly deltaMode: ComparisonDeltaMode;
  readonly alignment: readonly ComparisonAlignmentKey[];
  readonly measures: readonly ComparisonMeasurePlan[];
  readonly rows: readonly ComparisonRow[];
  readonly counts: ComparisonCounts;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ComparisonRows {
  readonly fields?: readonly QueryResultField[];
  readonly rows: readonly QueryResultRow[];
}

const NORMALIZATIONS = new Set(["none", "nfc", "nfd", "nfkc", "nfkd", "case-insensitive"]);
const COLLATIONS = new Set(["unicode", "binary", "case-insensitive"]);

function diagnostic(
  code: string,
  path: string,
  message: string,
  relatedIds?: readonly string[],
): Diagnostic {
  return createDiagnostic(code, path, {
    message,
    ...(relatedIds === undefined ? {} : { relatedIds }),
  });
}

function isMeasureBinding(binding: { readonly role?: string; readonly axis?: string }): boolean {
  return binding.role === "measure" || binding.role === "value" || binding.axis === "y";
}

function isDataBinding(binding: { readonly role?: string; readonly axis?: string }): boolean {
  return (
    binding.role === "dimension" ||
    binding.role === "measure" ||
    binding.role === "series" ||
    binding.role === "group" ||
    binding.role === "value" ||
    binding.role === "label" ||
    binding.axis === "x" ||
    binding.axis === "y"
  );
}

function boundMeasureFieldIds(block: BoardDocumentV1["blocks"][number]): ReadonlySet<string> {
  const bindings = (block.bindings ?? []).filter((binding) => isDataBinding(binding));
  if (block.type === "metric") {
    const measure = bindings.find((binding) => isMeasureBinding(binding));
    return new Set(measure === undefined ? [] : [measure.field.fieldId]);
  }
  if (block.type === "chart") {
    const selected = selectChartBindings(bindings, null);
    return new Set(selected.y === null ? [] : [selected.y.field.fieldId]);
  }
  return new Set(
    bindings.filter((binding) => isMeasureBinding(binding)).map((binding) => binding.field.fieldId),
  );
}

function descriptorField(
  descriptor: DatasetDescriptor,
  fieldId: string,
): DataFieldDescriptor | undefined {
  return descriptor.fields.find((field) => field.id === fieldId);
}

function documentFieldFor(
  document: BoardDocumentV1,
  datasetId: string,
  fieldId: string,
): ReturnType<typeof documentField> {
  return documentField(document, { datasetId, fieldId });
}

function unitOf(
  descriptor: DatasetDescriptor | undefined,
  fieldId: string,
): {
  readonly unit: string;
  readonly scale?: number;
} | null {
  const field = descriptor === undefined ? undefined : descriptorField(descriptor, fieldId);
  if (field?.unit === undefined) {
    return null;
  }
  return Object.freeze({
    unit: field.unit.unit,
    ...(field.unit.scale === undefined ? {} : { scale: field.unit.scale }),
  });
}

function ownEntry<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

function unitsEqual(
  left: { readonly unit: string; readonly scale?: number } | null,
  right: { readonly unit: string; readonly scale?: number } | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.unit === right.unit && (left.scale ?? 1) === (right.scale ?? 1);
}

function conversionFor(
  comparison: ComparisonDefinition,
  primaryUnit: { readonly unit: string; readonly scale?: number } | null,
  referenceUnit: { readonly unit: string; readonly scale?: number } | null,
): Result<ComparisonConversionResolution | null> {
  if (unitsEqual(primaryUnit, referenceUnit)) {
    return ok(null);
  }
  const sideBySide = comparison.displayMode === "side-by-side";
  const deltaDisabled = comparison.deltaMode === "none";
  if (sideBySide && deltaDisabled && comparison.unitPolicy?.mode !== "explicit") {
    return ok(null);
  }
  if (
    primaryUnit !== null &&
    referenceUnit !== null &&
    primaryUnit.unit === referenceUnit.unit &&
    !unitsEqual(primaryUnit, referenceUnit)
  ) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
        `comparisons/${comparison.id}/unitPolicy`,
        "The measure units share a name but declare different scales; an explicit conversion must not hide that difference.",
        [comparison.id],
      ),
    ]);
  }
  if (
    comparison.unitPolicy?.mode !== "explicit" ||
    primaryUnit === null ||
    referenceUnit === null
  ) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
        `comparisons/${comparison.id}/unitPolicy`,
        "The measure units differ. Use side-by-side with deltas disabled or declare an explicit unit policy.",
        [comparison.id],
      ),
    ]);
  }
  for (const conversion of comparison.unitPolicy.conversions ?? []) {
    const usable = conversion.lossless === true || (conversion.documentation ?? "").trim() !== "";
    if (!usable) {
      continue;
    }
    if (conversion.from === primaryUnit.unit && conversion.to === referenceUnit.unit) {
      return ok(
        Object.freeze({
          from: conversion.from,
          to: conversion.to,
          factor: conversion.factor,
          offset: conversion.offset ?? 0,
          provider: conversion.provider,
          direction: "primary-to-reference" as const,
        }),
      );
    }
    if (conversion.from === referenceUnit.unit && conversion.to === primaryUnit.unit) {
      return ok(
        Object.freeze({
          from: conversion.from,
          to: conversion.to,
          factor: conversion.factor,
          offset: conversion.offset ?? 0,
          provider: conversion.provider,
          direction: "reference-to-primary" as const,
        }),
      );
    }
  }
  return fail([
    diagnostic(
      DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
      `comparisons/${comparison.id}/unitPolicy/conversions`,
      "No usable conversion connects the primary and reference units.",
      [comparison.id],
    ),
  ]);
}

function mappingFor(
  comparison: ComparisonDefinition,
  fieldId: string,
  role?: "dimension" | "measure",
): ComparisonFieldMapping | undefined {
  return comparison.mapping.find(
    (mapping) =>
      mapping.primary.fieldId === fieldId && (role === undefined || mapping.role === role),
  );
}

function alignmentMapping(
  comparison: ComparisonDefinition,
  fieldId: string,
): Result<ComparisonFieldMapping> {
  const mapping = mappingFor(comparison, fieldId, "dimension");
  if (mapping === undefined) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_MAPPING_INCOMPLETE,
        `comparisons/${comparison.id}/alignment/keys`,
        `The alignment key "${fieldId}" has no explicit dimension mapping.`,
        [fieldId],
      ),
    ]);
  }
  return ok(mapping);
}

function compareFieldTypes(
  document: BoardDocumentV1,
  comparison: ComparisonDefinition,
  mapping: ComparisonFieldMapping,
  path: string,
): Result<void> {
  const primary = documentFieldFor(document, mapping.primary.datasetId, mapping.primary.fieldId);
  const reference = documentFieldFor(
    document,
    mapping.reference.datasetId,
    mapping.reference.fieldId,
  );
  if (primary !== undefined && reference !== undefined && primary.type !== reference.type) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
        path,
        `The mapping "${mapping.primary.fieldId}" has different field types on each side.`,
        [comparison.id],
      ),
    ]);
  }
  return ok(undefined);
}

function filterQuery(effective: EffectiveFilter): QueryFilter {
  return Object.freeze({
    id: effective.filterId,
    fieldId: effective.targetField.fieldId,
    operator: effective.operator,
    ...(effective.value === undefined ? {} : { value: effective.value }),
    ...(effective.temporal === undefined
      ? {}
      : { timezone: effective.temporal.timezone, bounds: effective.temporal.bounds }),
  });
}

function sideSlice(
  bindingSlice: string | undefined,
  input: ComparisonInput,
  path: string,
): Result<string | undefined> {
  if (bindingSlice !== undefined && input.sliceId !== undefined && bindingSlice !== input.sliceId) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_SLICE_MISMATCH,
        path,
        `The binding uses slice "${bindingSlice}" but the comparison uses "${input.sliceId}".`,
        [bindingSlice, input.sliceId],
      ),
    ]);
  }
  return ok(input.sliceId ?? bindingSlice);
}

function temporalFieldForWindow(
  document: BoardDocumentV1,
  comparison: ComparisonDefinition,
  primaryFieldIds: readonly string[],
  referenceFieldIds: readonly string[],
): Result<{ readonly primaryFieldId: string; readonly referenceFieldId: string }> {
  for (const [index, fieldId] of primaryFieldIds.entries()) {
    const primary = documentFieldFor(document, comparison.base.datasetId, fieldId);
    const referenceFieldId = referenceFieldIds[index];
    const reference =
      referenceFieldId === undefined
        ? undefined
        : documentFieldFor(document, comparison.reference.datasetId, referenceFieldId);
    if (
      (primary?.type === "date" || primary?.type === "datetime") &&
      referenceFieldId !== undefined &&
      (reference?.type === "date" || reference?.type === "datetime")
    ) {
      return ok({ primaryFieldId: fieldId, referenceFieldId });
    }
  }
  return fail([
    diagnostic(
      DIAGNOSTIC_CODES.COMPARISON_WINDOW_FIELD_MISSING,
      `comparisons/${comparison.id}/windows`,
      "A comparison time window requires a mapped temporal grouping field.",
      [comparison.id],
    ),
  ]);
}

function queryWindow(timeWindow: TimeWindow, fieldId: string): QueryTimeWindow {
  return Object.freeze({
    fieldId,
    start: timeWindow.start,
    end: timeWindow.end,
    timezone: timeWindow.timezone,
    bounds: timeWindow.bounds,
  });
}

function aggregationOutput(
  bindingId: string,
  aggregation: { readonly type: string; readonly fieldId?: string },
  fieldId: string,
): QueryAggregation | null {
  if (aggregation.type === "none") {
    return null;
  }
  return Object.freeze({
    output: bindingId,
    type: aggregation.type as QueryAggregation["type"],
    fieldId,
  });
}

function buildScalarSpecs(
  document: BoardDocumentV1,
  comparison: ComparisonDefinition,
  block: BoardDocumentV1["blocks"][number],
  measures: readonly ComparisonMeasurePlan[],
  primaryFilters: readonly QueryFilter[],
  referenceFilters: readonly QueryFilter[],
  windows: {
    readonly primary: TimeWindow | undefined;
    readonly reference: TimeWindow | undefined;
  },
): Result<{
  readonly primary: QuerySpec;
  readonly reference: QuerySpec;
  readonly primaryMeasureOutput: string;
  readonly referenceMeasureOutput: string;
}> {
  const bindings = block.bindings ?? [];
  const measureBinding = bindings.find((binding) => isMeasureBinding(binding));
  const aggregation = measureBinding?.aggregation;
  if (measureBinding === undefined || aggregation === undefined || aggregation.type === "none") {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
        `blocks/${block.id}/bindings`,
        "A metric comparison requires a measure binding with an explicit aggregation.",
        [block.id],
      ),
    ]);
  }
  const measure = measures.find((entry) => entry.primaryFieldId === measureBinding.field.fieldId);
  if (measure === undefined) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_MAPPING_INCOMPLETE,
        `comparisons/${comparison.id}/mapping`,
        `The metric field "${measureBinding.field.fieldId}" has no measure mapping.`,
        [measureBinding.field.fieldId],
      ),
    ]);
  }
  const primarySlice = sideSlice(
    measureBinding.sliceId,
    comparison.base,
    `comparisons/${comparison.id}/base/sliceId`,
  );
  if (!primarySlice.ok) {
    return primarySlice;
  }
  const temporal = temporalFieldForWindow(
    document,
    comparison,
    comparison.mapping.map((mapping) => mapping.primary.fieldId),
    comparison.mapping.map((mapping) => mapping.reference.fieldId),
  );
  if (!temporal.ok && (windows.primary !== undefined || windows.reference !== undefined)) {
    return temporal;
  }
  const primaryAggregation = aggregationOutput(
    measure.id,
    aggregation,
    measureBinding.field.fieldId,
  );
  const referenceAggregation = aggregationOutput(measure.id, aggregation, measure.referenceFieldId);
  if (primaryAggregation === null || referenceAggregation === null) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
        `blocks/${block.id}/bindings`,
        "A metric comparison requires a non-none aggregation.",
        [block.id],
      ),
    ]);
  }
  const primary: QuerySpec = Object.freeze({
    datasetId: comparison.base.datasetId,
    ...(primarySlice.value === undefined ? {} : { sliceId: primarySlice.value }),
    aggregations: Object.freeze([primaryAggregation]),
    ...(primaryFilters.length === 0 ? {} : { filters: Object.freeze([...primaryFilters]) }),
    ...(windows.primary === undefined || !temporal.ok
      ? {}
      : { timeWindow: queryWindow(windows.primary, temporal.value.primaryFieldId) }),
    comparisonInput: Object.freeze({
      comparisonId: comparison.id,
      side: "primary" as const,
      inputId: `${comparison.id}:primary`,
    }),
  });
  const reference: QuerySpec = Object.freeze({
    datasetId: comparison.reference.datasetId,
    ...(comparison.reference.sliceId === undefined
      ? {}
      : { sliceId: comparison.reference.sliceId }),
    aggregations: Object.freeze([referenceAggregation]),
    ...(referenceFilters.length === 0 ? {} : { filters: Object.freeze([...referenceFilters]) }),
    ...(windows.reference === undefined || !temporal.ok
      ? {}
      : { timeWindow: queryWindow(windows.reference, temporal.value.referenceFieldId) }),
    comparisonInput: Object.freeze({
      comparisonId: comparison.id,
      side: "reference" as const,
      inputId: `${comparison.id}:reference`,
    }),
  });
  return ok({
    primary,
    reference,
    primaryMeasureOutput: measure.primaryOutputFieldId,
    referenceMeasureOutput: measure.referenceOutputFieldId,
  });
}

function buildCompositeSpecs(
  document: BoardDocumentV1,
  comparison: ComparisonDefinition,
  block: BoardDocumentV1["blocks"][number],
  measures: readonly ComparisonMeasurePlan[],
  alignment: readonly ComparisonAlignmentKey[],
  primaryFilters: readonly QueryFilter[],
  referenceFilters: readonly QueryFilter[],
  windows: {
    readonly primary: TimeWindow | undefined;
    readonly reference: TimeWindow | undefined;
  },
): Result<{ readonly primary: QuerySpec; readonly reference: QuerySpec }> {
  const bindings = (block.bindings ?? []).filter((binding) => isDataBinding(binding));
  if (bindings.length === 0) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
        `blocks/${block.id}/bindings`,
        "A comparison requires block bindings that declare grouping and aggregation.",
        [block.id],
      ),
    ]);
  }
  let groupingBindings = bindings.filter((binding) => !isMeasureBinding(binding));
  let measureBindings: typeof bindings = bindings.filter((binding) => isMeasureBinding(binding));
  if (block.type === "chart") {
    const visualization = block.config.visualization;
    if (
      typeof visualization !== "string" ||
      !(CHART_TYPES as readonly string[]).includes(visualization)
    ) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
          `blocks/${block.id}/config/visualization`,
          "A comparison chart requires a declared chart visualization.",
          [block.id],
        ),
      ]);
    }
    if (visualization === "scatter") {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `blocks/${block.id}/config/visualization`,
          "A scatter chart cannot use composite-key comparison without explicit grouping.",
          [block.id],
        ),
      ]);
    }
    const selected = selectChartBindings(bindings, null);
    groupingBindings = [selected.x, selected.series].filter(
      (binding): binding is (typeof bindings)[number] =>
        binding !== null && !isMeasureBinding(binding),
    );
    measureBindings = selected.y === null ? [] : [selected.y];
  }
  if (groupingBindings.length === 0) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
        `blocks/${block.id}/bindings`,
        "A composite comparison requires at least one grouping binding.",
        [block.id],
      ),
    ]);
  }
  const groupingFields = groupingBindings.map((binding) => binding.field);
  for (const key of alignment) {
    if (!groupingFields.some((field) => field.fieldId === key.primaryFieldId)) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.COMPARISON_ALIGNMENT_INVALID,
          `comparisons/${comparison.id}/alignment/keys`,
          `The alignment key "${key.primaryFieldId}" is not part of the block grouping.`,
          [key.primaryFieldId],
        ),
      ]);
    }
  }
  const primaryGrouping: QueryGrouping[] = [];
  const referenceGrouping: QueryGrouping[] = [];
  const bindingSlices: string[] = [];
  for (const binding of groupingBindings) {
    if (binding.field.datasetId !== comparison.base.datasetId) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `blocks/${block.id}/bindings`,
          `The binding dataset "${binding.field.datasetId}" does not match the comparison base.`,
          [binding.field.datasetId, comparison.base.datasetId],
        ),
      ]);
    }
    const mapping = mappingFor(comparison, binding.field.fieldId);
    const referenceFieldId =
      mapping?.reference.fieldId ??
      (binding.field.datasetId === comparison.reference.datasetId
        ? binding.field.fieldId
        : undefined);
    if (referenceFieldId === undefined) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.COMPARISON_MAPPING_INCOMPLETE,
          `comparisons/${comparison.id}/mapping`,
          `The grouping field "${binding.field.fieldId}" has no reference mapping.`,
          [binding.field.fieldId],
        ),
      ]);
    }
    if (mapping !== undefined) {
      const types = compareFieldTypes(
        document,
        comparison,
        mapping,
        `comparisons/${comparison.id}/mapping`,
      );
      if (!types.ok) {
        return types;
      }
    }
    primaryGrouping.push(
      Object.freeze({
        fieldId: binding.field.fieldId,
        ...(binding.bucket === undefined
          ? {}
          : {
              bucket: {
                grain: binding.bucket.grain,
                timezone: binding.bucket.timezone,
                ...(binding.bucket.weekStartsOn === undefined
                  ? {}
                  : { weekStartsOn: binding.bucket.weekStartsOn }),
              },
            }),
      }),
    );
    referenceGrouping.push(
      Object.freeze({
        fieldId: referenceFieldId,
        ...(binding.bucket === undefined
          ? {}
          : {
              bucket: {
                grain: binding.bucket.grain,
                timezone: binding.bucket.timezone,
                ...(binding.bucket.weekStartsOn === undefined
                  ? {}
                  : { weekStartsOn: binding.bucket.weekStartsOn }),
              },
            }),
      }),
    );
    if (binding.sliceId !== undefined) {
      bindingSlices.push(binding.sliceId);
    }
  }
  const primarySlice = sideSlice(
    bindingSlices[0],
    comparison.base,
    `comparisons/${comparison.id}/base/sliceId`,
  );
  if (!primarySlice.ok) {
    return primarySlice;
  }
  const primaryAggregations: QueryAggregation[] = [];
  const referenceAggregations: QueryAggregation[] = [];
  for (const binding of measureBindings) {
    if (binding.field.datasetId !== comparison.base.datasetId) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `blocks/${block.id}/bindings`,
          `The measure binding dataset "${binding.field.datasetId}" does not match the comparison base.`,
          [binding.field.datasetId, comparison.base.datasetId],
        ),
      ]);
    }
    const measure = measures.find((entry) => entry.primaryFieldId === binding.field.fieldId);
    if (measure === undefined) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.COMPARISON_MAPPING_INCOMPLETE,
          `comparisons/${comparison.id}/mapping`,
          `The measure field "${binding.field.fieldId}" has no reference mapping.`,
          [binding.field.fieldId],
        ),
      ]);
    }
    if (binding.aggregation === undefined || binding.aggregation.type === "none") {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
          `blocks/${block.id}/bindings`,
          `The measure binding "${binding.id}" requires an explicit aggregation.`,
          [binding.id],
        ),
      ]);
    }
    const primaryAggregation = aggregationOutput(
      measure.primaryOutputFieldId,
      binding.aggregation,
      binding.field.fieldId,
    );
    const referenceAggregation = aggregationOutput(
      measure.referenceOutputFieldId,
      binding.aggregation,
      measure.referenceFieldId,
    );
    if (primaryAggregation === null || referenceAggregation === null) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
          `blocks/${block.id}/bindings`,
          `The measure binding "${binding.id}" requires a non-none aggregation.`,
          [binding.id],
        ),
      ]);
    }
    primaryAggregations.push(primaryAggregation);
    referenceAggregations.push(referenceAggregation);
  }
  if (primaryAggregations.length === 0) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_AGGREGATION_REQUIRED,
        `blocks/${block.id}/bindings`,
        "A composite comparison requires at least one aggregated measure.",
        [block.id],
      ),
    ]);
  }
  let primaryWindow: QueryTimeWindow | undefined;
  let referenceWindow: QueryTimeWindow | undefined;
  if (windows.primary !== undefined || windows.reference !== undefined) {
    const temporal = temporalFieldForWindow(
      document,
      comparison,
      primaryGrouping.map((grouping) => grouping.fieldId),
      referenceGrouping.map((grouping) => grouping.fieldId),
    );
    if (!temporal.ok) {
      return temporal;
    }
    if (windows.primary !== undefined) {
      primaryWindow = queryWindow(windows.primary, temporal.value.primaryFieldId);
    }
    if (windows.reference !== undefined) {
      referenceWindow = queryWindow(windows.reference, temporal.value.referenceFieldId);
    }
  }
  const primary: QuerySpec = Object.freeze({
    datasetId: comparison.base.datasetId,
    ...(primarySlice.value === undefined ? {} : { sliceId: primarySlice.value }),
    groupBy: Object.freeze(primaryGrouping),
    aggregations: Object.freeze(primaryAggregations),
    ...(primaryFilters.length === 0 ? {} : { filters: Object.freeze([...primaryFilters]) }),
    ...(primaryWindow === undefined ? {} : { timeWindow: primaryWindow }),
    comparisonInput: Object.freeze({
      comparisonId: comparison.id,
      side: "primary" as const,
      inputId: `${comparison.id}:primary`,
    }),
  });
  const reference: QuerySpec = Object.freeze({
    datasetId: comparison.reference.datasetId,
    ...(comparison.reference.sliceId === undefined
      ? {}
      : { sliceId: comparison.reference.sliceId }),
    groupBy: Object.freeze(referenceGrouping),
    aggregations: Object.freeze(referenceAggregations),
    ...(referenceFilters.length === 0 ? {} : { filters: Object.freeze([...referenceFilters]) }),
    ...(referenceWindow === undefined ? {} : { timeWindow: referenceWindow }),
    comparisonInput: Object.freeze({
      comparisonId: comparison.id,
      side: "reference" as const,
      inputId: `${comparison.id}:reference`,
    }),
  });
  return ok({ primary, reference });
}

export function buildComparisonPlan(
  document: BoardDocumentV1,
  comparisonId: string,
  blockId: string,
  options: BuildComparisonPlanOptions,
): Result<ComparisonPlan> {
  const comparison = document.comparisons?.find((entry) => entry.id === comparisonId);
  if (comparison === undefined) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        `comparisons/${comparisonId}`,
        "The comparison does not exist in the document.",
        [comparisonId],
      ),
    ]);
  }
  const block = document.blocks.find((entry) => entry.id === blockId);
  if (block === undefined) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        `blocks/${blockId}`,
        "The comparison block does not exist in the document.",
        [blockId],
      ),
    ]);
  }
  const primaryDescriptor = ownEntry(options.descriptors, comparison.base.datasetId);
  const referenceDescriptor = ownEntry(options.descriptors, comparison.reference.datasetId);
  if (primaryDescriptor === undefined || referenceDescriptor === undefined) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.QUERY_PROVIDER_MISSING,
        `comparisons/${comparison.id}`,
        "Both comparison datasets require a provider descriptor.",
        [comparison.base.datasetId, comparison.reference.datasetId],
      ),
    ]);
  }
  const collation = comparison.alignment.collation ?? "unicode";
  const normalization = comparison.alignment.normalization ?? "none";
  if (!COLLATIONS.has(collation)) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_ALIGNMENT_INVALID,
        `comparisons/${comparison.id}/alignment/collation`,
        `The collation "${collation}" is not supported.`,
        [comparison.id],
      ),
    ]);
  }
  if (!NORMALIZATIONS.has(normalization)) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.COMPARISON_ALIGNMENT_INVALID,
        `comparisons/${comparison.id}/alignment/normalization`,
        `The normalization "${normalization}" is not supported.`,
        [comparison.id],
      ),
    ]);
  }
  const alignment: ComparisonAlignmentKey[] = [];
  for (const key of comparison.alignment.keys) {
    const mapping = alignmentMapping(comparison, key);
    if (!mapping.ok) {
      return mapping;
    }
    const primary = documentFieldFor(
      document,
      mapping.value.primary.datasetId,
      mapping.value.primary.fieldId,
    );
    const reference = documentFieldFor(
      document,
      mapping.value.reference.datasetId,
      mapping.value.reference.fieldId,
    );
    if (primary !== undefined && reference !== undefined && primary.type !== reference.type) {
      return fail([
        diagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          `comparisons/${comparison.id}/alignment/keys`,
          `The alignment key "${key}" has different field types on each side.`,
          [key],
        ),
      ]);
    }
    alignment.push(
      Object.freeze({
        primaryFieldId: mapping.value.primary.fieldId,
        referenceFieldId: mapping.value.reference.fieldId,
        label: mapping.value.primary.fieldId,
        type: primary?.type ?? reference?.type ?? null,
      }),
    );
  }
  const boundMeasures = boundMeasureFieldIds(block);
  const measures: ComparisonMeasurePlan[] = [];
  for (const mapping of comparison.mapping.filter(
    (entry) => entry.role === "measure" && boundMeasures.has(entry.primary.fieldId),
  )) {
    const binding = (block.bindings ?? []).find(
      (entry) => isMeasureBinding(entry) && entry.field.fieldId === mapping.primary.fieldId,
    );
    const aggregation = binding?.aggregation?.type ?? "none";
    const countAggregation = aggregation === "count" || aggregation === "countDistinct";
    const primaryUnit = countAggregation
      ? null
      : unitOf(primaryDescriptor, mapping.primary.fieldId);
    const referenceUnit = countAggregation
      ? null
      : unitOf(referenceDescriptor, mapping.reference.fieldId);
    let conversion: ComparisonConversionResolution | null = null;
    if (!countAggregation) {
      const resolved = conversionFor(comparison, primaryUnit, referenceUnit);
      if (!resolved.ok) {
        return resolved;
      }
      conversion = resolved.value;
      if (conversion !== null) {
        if (aggregation === "sum" && conversion.offset !== 0) {
          return fail([
            diagnostic(
              DIAGNOSTIC_CODES.COMPARISON_CONVERSION_UNSUPPORTED,
              `comparisons/${comparison.id}/unitPolicy/conversions`,
              "A conversion with a non-zero offset cannot be applied after a sum aggregation.",
              [comparison.id, mapping.primary.fieldId],
            ),
          ]);
        }
        if ((aggregation === "min" || aggregation === "max") && conversion.factor < 0) {
          return fail([
            diagnostic(
              DIAGNOSTIC_CODES.COMPARISON_CONVERSION_UNSUPPORTED,
              `comparisons/${comparison.id}/unitPolicy/conversions`,
              "A negative conversion factor reverses min or max ordering and is not supported for comparison.",
              [comparison.id, mapping.primary.fieldId],
            ),
          ]);
        }
      }
    }
    const id = binding?.id ?? mapping.primary.fieldId;
    measures.push(
      Object.freeze({
        id,
        label: binding?.label ?? mapping.primary.fieldId,
        aggregation,
        primaryFieldId: mapping.primary.fieldId,
        referenceFieldId: mapping.reference.fieldId,
        primaryOutputFieldId: id,
        referenceOutputFieldId: id,
        primaryUnit,
        referenceUnit,
        conversion,
      }),
    );
  }
  if (measures.length === 0) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
        `comparisons/${comparison.id}/mapping`,
        "A comparison requires at least one mapped measure that the block binds.",
        [comparison.id],
      ),
    ]);
  }
  const filterState = options.filterState ?? Object.freeze({ activeValues: [], crossFilters: [] });
  const sides = composeComparisonFilterSides(
    document,
    block,
    filterState,
    options.catalog === undefined ? {} : { catalog: options.catalog },
  );
  if (hasError(sides.diagnostics)) {
    return fail(sides.diagnostics);
  }
  const primaryFilters = sides.primary.map(filterQuery);
  const referenceFilters = sides.reference.map(filterQuery);
  const scalar = block.type === "metric";
  const windows = {
    primary: comparison.windows?.primary,
    reference: comparison.windows?.reference,
  };
  const specs = scalar
    ? buildScalarSpecs(
        document,
        comparison,
        block,
        measures,
        primaryFilters,
        referenceFilters,
        windows,
      )
    : buildCompositeSpecs(
        document,
        comparison,
        block,
        measures,
        alignment,
        primaryFilters,
        referenceFilters,
        windows,
      );
  if (!specs.ok) {
    return specs;
  }
  const primaryProviderId = ownEntry(options.providerIds, comparison.base.datasetId);
  const referenceProviderId = ownEntry(options.providerIds, comparison.reference.datasetId);
  const primaryPlan = buildQueryPlan(
    primaryDescriptor,
    specs.value.primary,
    primaryProviderId === undefined ? {} : { providerId: primaryProviderId },
  );
  if (!primaryPlan.ok) {
    return primaryPlan;
  }
  const referencePlan = buildQueryPlan(
    referenceDescriptor,
    specs.value.reference,
    referenceProviderId === undefined ? {} : { providerId: referenceProviderId },
  );
  if (!referencePlan.ok) {
    return referencePlan;
  }
  const plannedMeasures = measures.map((measure) => {
    const primaryOutput = primaryPlan.value.outputFields.find(
      (field) => field.fieldId === measure.primaryOutputFieldId,
    );
    const referenceOutput = referencePlan.value.outputFields.find(
      (field) => field.fieldId === measure.referenceOutputFieldId,
    );
    return Object.freeze({
      ...measure,
      primaryUnit: primaryOutput?.unit ?? measure.primaryUnit,
      referenceUnit: referenceOutput?.unit ?? measure.referenceUnit,
    });
  });
  return ok(
    Object.freeze({
      comparisonId: comparison.id,
      label: comparison.label,
      blockId: block.id,
      displayMode: comparison.displayMode,
      deltaMode: comparison.deltaMode,
      scalar,
      collation,
      normalization,
      alignment: Object.freeze([...alignment]),
      measures: Object.freeze(plannedMeasures),
      primary: primaryPlan.value,
      reference: referencePlan.value,
    }),
  );
}

function normalizeString(value: string, normalization: string, collation: string): string {
  let next = value;
  if (normalization === "nfc") {
    next = next.normalize("NFC");
  } else if (normalization === "nfd") {
    next = next.normalize("NFD");
  } else if (normalization === "nfkc") {
    next = next.normalize("NFKC");
  } else if (normalization === "nfkd") {
    next = next.normalize("NFKD");
  }
  if (normalization === "case-insensitive" || collation === "case-insensitive") {
    next = next.toLowerCase();
  }
  return next;
}

function normalizeKeyValue(
  value: JsonValue | undefined,
  type: FieldValueType | null,
  normalization: string,
  collation: string,
): JsonValue | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return normalizeString(value, normalization, collation);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }
  if (type === "boolean" || typeof value === "boolean") {
    return value;
  }
  return value;
}

type KeyExtraction =
  | {
      readonly ok: true;
      readonly key: readonly JsonValue[];
      readonly keyText: string;
      readonly values: readonly JsonValue[];
    }
  | {
      readonly ok: false;
      readonly nullFieldIds: readonly string[];
      readonly values: readonly JsonValue[];
    };

function extractKey(
  row: QueryResultRow,
  alignment: readonly ComparisonAlignmentKey[],
  side: "primary" | "reference",
  collation: string,
  normalization: string,
): KeyExtraction {
  const values: JsonValue[] = [];
  const normalized: JsonValue[] = [];
  const nullFieldIds: string[] = [];
  for (const key of alignment) {
    const fieldId = side === "primary" ? key.primaryFieldId : key.referenceFieldId;
    const raw = Object.hasOwn(row, fieldId) ? (row[fieldId] as JsonValue) : null;
    values.push(raw ?? null);
    const value = normalizeKeyValue(raw, key.type, normalization, collation);
    if (value === null) {
      nullFieldIds.push(fieldId);
    }
    normalized.push(value);
  }
  if (nullFieldIds.length > 0) {
    return { ok: false, nullFieldIds, values };
  }
  return {
    ok: true,
    key: Object.freeze([...normalized]),
    keyText: canonicalJson(normalized as never),
    values: Object.freeze([...values]),
  };
}

export function absoluteDelta(
  primary: JsonValue | null | undefined,
  reference: JsonValue | null | undefined,
  missingReason: "PRIMARY_ONLY" | "REFERENCE_ONLY" | null = null,
): ComparisonDelta {
  if (missingReason === "PRIMARY_ONLY") {
    return Object.freeze({ available: false, value: null, reason: "PRIMARY_ONLY" });
  }
  if (missingReason === "REFERENCE_ONLY") {
    return Object.freeze({ available: false, value: null, reason: "REFERENCE_ONLY" });
  }
  if (primary === null || primary === undefined) {
    return Object.freeze({ available: false, value: null, reason: "PRIMARY_NULL" });
  }
  if (reference === null || reference === undefined) {
    return Object.freeze({ available: false, value: null, reason: "REFERENCE_NULL" });
  }
  if (typeof primary !== "number" || !Number.isFinite(primary)) {
    return Object.freeze({ available: false, value: null, reason: "PRIMARY_NON_FINITE" });
  }
  if (typeof reference !== "number" || !Number.isFinite(reference)) {
    return Object.freeze({ available: false, value: null, reason: "REFERENCE_NON_FINITE" });
  }
  const value = primary - reference;
  if (!Number.isFinite(value)) {
    return Object.freeze({ available: false, value: null, reason: "RESULT_NON_FINITE" });
  }
  return Object.freeze({
    available: true,
    value: Object.is(value, -0) ? 0 : value,
    reason: null,
  });
}

export function percentageDelta(
  primary: JsonValue | null | undefined,
  reference: JsonValue | null | undefined,
  missingReason: "PRIMARY_ONLY" | "REFERENCE_ONLY" | null = null,
): ComparisonDelta {
  const absolute = absoluteDelta(primary, reference, missingReason);
  if (!absolute.available) {
    return absolute;
  }
  if (reference === 0) {
    return Object.freeze({ available: false, value: null, reason: "ZERO_REFERENCE" });
  }
  const value =
    (100 * ((primary as number) - (reference as number))) / Math.abs(reference as number);
  if (!Number.isFinite(value)) {
    return Object.freeze({ available: false, value: null, reason: "RESULT_NON_FINITE" });
  }
  return Object.freeze({
    available: true,
    value: Object.is(value, -0) ? 0 : value,
    reason: null,
  });
}

function convertedReference(
  raw: JsonValue | null | undefined,
  conversion: ComparisonConversionResolution | null,
): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  if (conversion === null) {
    return raw;
  }
  const value =
    conversion.direction === "primary-to-reference"
      ? (raw - conversion.offset) / conversion.factor
      : raw * conversion.factor + conversion.offset;
  return Number.isFinite(value) ? value : null;
}

function operand(
  raw: JsonValue | null | undefined,
  value: number | null,
  missingReason: "PRIMARY_ONLY" | "REFERENCE_ONLY" | null,
  side: "primary" | "reference",
): ComparisonOperand {
  if (missingReason !== null) {
    return Object.freeze({
      rawValue: null,
      value: null,
      reason: missingReason,
    });
  }
  if (raw === null || raw === undefined) {
    return Object.freeze({
      rawValue: null,
      value: null,
      reason: side === "primary" ? "PRIMARY_NULL" : "REFERENCE_NULL",
    });
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return Object.freeze({
      rawValue: raw,
      value: null,
      reason: side === "primary" ? "PRIMARY_NON_FINITE" : "REFERENCE_NON_FINITE",
    });
  }
  if (value === null || !Number.isFinite(value)) {
    return Object.freeze({
      rawValue: raw,
      value: null,
      reason: side === "primary" ? "PRIMARY_NON_FINITE" : "REFERENCE_NON_FINITE",
    });
  }
  return Object.freeze({ rawValue: raw, value, reason: null });
}

interface SideRow {
  readonly row: QueryResultRow;
  readonly index: number;
  readonly values: readonly JsonValue[];
}

function collectSideRows(
  rows: readonly QueryResultRow[],
  alignment: readonly ComparisonAlignmentKey[],
  side: "primary" | "reference",
  comparisonId: string,
  collation: string,
  normalization: string,
): Result<{
  readonly byKey: ReadonlyMap<string, SideRow>;
  readonly order: readonly string[];
  readonly excluded: readonly {
    readonly index: number;
    readonly values: readonly JsonValue[];
    readonly nullFieldIds: readonly string[];
  }[];
  readonly excludedByComponent: Readonly<Record<string, number>>;
}> {
  const byKey = new Map<string, SideRow>();
  const order: string[] = [];
  const excluded: {
    index: number;
    values: readonly JsonValue[];
    nullFieldIds: readonly string[];
  }[] = [];
  const excludedByComponent: Record<string, number> = Object.create(null) as Record<string, number>;
  rows.forEach((row, index) => {
    const extracted = extractKey(row, alignment, side, collation, normalization);
    if (!extracted.ok) {
      excluded.push({
        index,
        values: extracted.values,
        nullFieldIds: extracted.nullFieldIds,
      });
      for (const fieldId of extracted.nullFieldIds) {
        excludedByComponent[fieldId] = (excludedByComponent[fieldId] ?? 0) + 1;
      }
      return;
    }
    const existing = byKey.get(extracted.keyText);
    if (existing !== undefined) {
      throw new DuplicateAlignmentKeyError(
        comparisonId,
        side,
        extracted.keyText,
        existing.index,
        index,
      );
    }
    byKey.set(extracted.keyText, { row, index, values: extracted.values });
    order.push(extracted.keyText);
  });
  return ok({
    byKey,
    order: Object.freeze(order),
    excluded: Object.freeze(excluded),
    excludedByComponent: Object.freeze(excludedByComponent),
  });
}

class DuplicateAlignmentKeyError extends Error {
  readonly comparisonId: string;
  readonly side: "primary" | "reference";
  readonly keyText: string;
  readonly firstIndex: number;
  readonly secondIndex: number;

  constructor(
    comparisonId: string,
    side: "primary" | "reference",
    keyText: string,
    firstIndex: number,
    secondIndex: number,
  ) {
    super("Duplicate alignment key");
    this.comparisonId = comparisonId;
    this.side = side;
    this.keyText = keyText;
    this.firstIndex = firstIndex;
    this.secondIndex = secondIndex;
  }
}

function alignScalarResults(
  plan: ComparisonPlan,
  primaryRows: readonly QueryResultRow[],
  referenceRows: readonly QueryResultRow[],
): Result<ComparisonResult> {
  if (primaryRows.length > 1 || referenceRows.length > 1) {
    return fail([
      diagnostic(
        DIAGNOSTIC_CODES.DUPLICATE_ALIGNMENT_KEY,
        `comparisons/${plan.comparisonId}/alignment`,
        "A scalar comparison received more than one aggregate row. A comparison does not choose a first row.",
        [plan.comparisonId],
      ),
    ]);
  }
  const primaryRow = primaryRows[0];
  const referenceRow = referenceRows[0];
  const hasPrimary = primaryRow !== undefined;
  const hasReference = referenceRow !== undefined;
  const measures: ComparisonMeasureRow[] = plan.measures.map((measure) =>
    measureRow(
      measure,
      primaryRow?.[measure.primaryOutputFieldId],
      referenceRow?.[measure.referenceOutputFieldId],
      hasPrimary,
      hasReference,
    ),
  );
  const empty = { excluded: Object.freeze([]), excludedByComponent: Object.freeze({}) };
  const counts = buildCounts(
    hasPrimary || hasReference ? 1 : 0,
    hasPrimary && hasReference ? 1 : 0,
    hasPrimary && !hasReference ? 1 : 0,
    !hasPrimary && hasReference ? 1 : 0,
    empty,
    empty,
    measures,
  );
  return ok(
    Object.freeze({
      comparisonId: plan.comparisonId,
      scalar: true,
      displayMode: plan.displayMode,
      deltaMode: plan.deltaMode,
      alignment: plan.alignment,
      measures: plan.measures,
      rows:
        !hasPrimary && !hasReference
          ? Object.freeze([])
          : Object.freeze([
              Object.freeze({
                key: Object.freeze([]),
                keyText: "[]",
                status:
                  hasPrimary && hasReference
                    ? ("matched" as const)
                    : hasPrimary
                      ? ("primary-only" as const)
                      : ("reference-only" as const),
                primaryRow: primaryRow ?? null,
                referenceRow: referenceRow ?? null,
                measures: Object.freeze(measures),
              }),
            ]),
      counts,
      diagnostics: Object.freeze([]),
    }),
  );
}

export function alignComparisonResults(
  plan: ComparisonPlan,
  primary: ComparisonRows,
  reference: ComparisonRows,
): Result<ComparisonResult> {
  const collect = (rows: readonly QueryResultRow[], side: "primary" | "reference") => {
    try {
      return collectSideRows(
        rows,
        plan.alignment,
        side,
        plan.comparisonId,
        plan.collation,
        plan.normalization,
      );
    } catch (error) {
      if (error instanceof DuplicateAlignmentKeyError) {
        return fail([
          diagnostic(
            DIAGNOSTIC_CODES.DUPLICATE_ALIGNMENT_KEY,
            `comparisons/${plan.comparisonId}/${error.side}/alignment`,
            `Rows ${error.firstIndex} and ${error.secondIndex} share the composite key ${error.keyText}. A comparison does not choose a first row.`,
            plan.alignment.map((key) => key.primaryFieldId),
          ),
        ]);
      }
      throw error;
    }
  };
  if (plan.scalar) {
    return alignScalarResults(plan, primary.rows, reference.rows);
  }
  const primaryResult = collect(primary.rows, "primary");
  if (!primaryResult.ok) {
    return primaryResult;
  }
  const referenceResult = collect(reference.rows, "reference");
  if (!referenceResult.ok) {
    return referenceResult;
  }
  const keys: string[] = [...primaryResult.value.order];
  for (const key of referenceResult.value.order) {
    if (!primaryResult.value.byKey.has(key)) {
      keys.push(key);
    }
  }
  const rows: ComparisonRow[] = [];
  const matchedNonNullMeasureCount: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const measure of plan.measures) {
    matchedNonNullMeasureCount[measure.id] = 0;
  }
  let primaryOnlyCount = 0;
  let referenceOnlyCount = 0;
  for (const keyText of keys) {
    const primarySide = primaryResult.value.byKey.get(keyText);
    const referenceSide = referenceResult.value.byKey.get(keyText);
    const status: ComparisonRowStatus =
      primarySide !== undefined && referenceSide !== undefined
        ? "matched"
        : primarySide !== undefined
          ? "primary-only"
          : "reference-only";
    if (status === "primary-only") {
      primaryOnlyCount += 1;
    } else if (status === "reference-only") {
      referenceOnlyCount += 1;
    }
    const measures: ComparisonMeasureRow[] = [];
    for (const measure of plan.measures) {
      const pValue = primarySide?.row[measure.primaryOutputFieldId];
      const rValue = referenceSide?.row[measure.referenceOutputFieldId];
      const row = measureRow(
        measure,
        pValue,
        rValue,
        primarySide !== undefined,
        referenceSide !== undefined,
      );
      measures.push(row);
      if (row.primary.value !== null && row.reference.value !== null) {
        matchedNonNullMeasureCount[measure.id] = (matchedNonNullMeasureCount[measure.id] ?? 0) + 1;
      }
    }
    const keyValues = primarySide?.values ?? referenceSide?.values ?? Object.freeze([]);
    rows.push(
      Object.freeze({
        key: Object.freeze([...keyValues]),
        keyText,
        status,
        primaryRow: primarySide?.row ?? null,
        referenceRow: referenceSide?.row ?? null,
        measures: Object.freeze(measures),
      }),
    );
  }
  const matchedRows = rows.filter((row) => row.status === "matched").length;
  const counts: ComparisonCounts = Object.freeze({
    rowCount: rows.length,
    matchedRowCount: matchedRows,
    primaryOnlyCount,
    referenceOnlyCount,
    excludedNullKeyCount:
      primaryResult.value.excluded.length + referenceResult.value.excluded.length,
    primaryExcludedNullKeyCount: primaryResult.value.excluded.length,
    referenceExcludedNullKeyCount: referenceResult.value.excluded.length,
    excludedNullComponents: mergeComponentCounts(
      primaryResult.value.excludedByComponent,
      referenceResult.value.excludedByComponent,
    ),
    matchedNonNullMeasureCount: Object.freeze(matchedNonNullMeasureCount),
  });
  return ok(
    Object.freeze({
      comparisonId: plan.comparisonId,
      scalar: false,
      displayMode: plan.displayMode,
      deltaMode: plan.deltaMode,
      alignment: plan.alignment,
      measures: plan.measures,
      rows: Object.freeze(rows),
      counts,
      diagnostics: nullKeyDiagnostics(plan, primaryResult.value, referenceResult.value),
    }),
  );
}

function measureRow(
  measure: ComparisonMeasurePlan,
  pValue: JsonValue | undefined,
  rValue: JsonValue | undefined,
  hasPrimary: boolean,
  hasReference: boolean,
): ComparisonMeasureRow {
  const primaryMissing = hasPrimary ? null : ("REFERENCE_ONLY" as const);
  const referenceMissing = hasReference ? null : ("PRIMARY_ONLY" as const);
  const primaryValue =
    hasPrimary && typeof pValue === "number" && Number.isFinite(pValue) ? pValue : null;
  const converted = hasReference ? convertedReference(rValue, measure.conversion) : null;
  const primaryOperand = operand(pValue, primaryValue, primaryMissing, "primary");
  const referenceOperand = operand(rValue, converted, referenceMissing, "reference");
  const missingReason = primaryMissing ?? referenceMissing;
  const unavailable = (reason: ComparisonDeltaReason): ComparisonDelta =>
    Object.freeze({ available: false, value: null, reason });
  const unitsDiffer =
    measure.conversion === null && !unitsEqual(measure.primaryUnit, measure.referenceUnit);
  const delta = (kind: "absolute" | "percentage"): ComparisonDelta => {
    if (missingReason !== null) {
      return unavailable(missingReason);
    }
    if (unitsDiffer) {
      return unavailable("UNIT_MISMATCH");
    }
    if (primaryOperand.value === null) {
      return unavailable(primaryOperand.reason ?? "PRIMARY_NON_FINITE");
    }
    if (referenceOperand.value === null) {
      return unavailable(referenceOperand.reason ?? "REFERENCE_NON_FINITE");
    }
    return kind === "absolute"
      ? absoluteDelta(primaryOperand.value, referenceOperand.value)
      : percentageDelta(primaryOperand.value, referenceOperand.value);
  };
  const absolute = delta("absolute");
  const percentage = delta("percentage");
  return Object.freeze({
    id: measure.id,
    primary: primaryOperand,
    reference: referenceOperand,
    absolute,
    percentage,
  });
}

function mergeComponentCounts(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const merged: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const source of [left, right]) {
    for (const [key, value] of Object.entries(source)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return Object.freeze(merged);
}

function buildCounts(
  rowCount: number,
  matchedRowCount: number,
  primaryOnlyCount: number,
  referenceOnlyCount: number,
  primary: {
    readonly excluded: readonly unknown[];
    readonly excludedByComponent: Readonly<Record<string, number>>;
  },
  reference: {
    readonly excluded: readonly unknown[];
    readonly excludedByComponent: Readonly<Record<string, number>>;
  },
  measures: readonly ComparisonMeasureRow[],
): ComparisonCounts {
  const matchedNonNullMeasureCount: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const measure of measures) {
    matchedNonNullMeasureCount[measure.id] =
      measure.primary.value !== null && measure.reference.value !== null ? 1 : 0;
  }
  return Object.freeze({
    rowCount,
    matchedRowCount,
    primaryOnlyCount,
    referenceOnlyCount,
    excludedNullKeyCount: primary.excluded.length + reference.excluded.length,
    primaryExcludedNullKeyCount: primary.excluded.length,
    referenceExcludedNullKeyCount: reference.excluded.length,
    excludedNullComponents: mergeComponentCounts(
      primary.excludedByComponent,
      reference.excludedByComponent,
    ),
    matchedNonNullMeasureCount: Object.freeze(matchedNonNullMeasureCount),
  });
}

function nullKeyDiagnostics(
  plan: ComparisonPlan,
  primary: {
    readonly excluded: readonly {
      readonly index: number;
      readonly nullFieldIds: readonly string[];
    }[];
  },
  reference: {
    readonly excluded: readonly {
      readonly index: number;
      readonly nullFieldIds: readonly string[];
    }[];
  },
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [side, rows] of [
    ["primary", primary.excluded],
    ["reference", reference.excluded],
  ] as const) {
    for (const row of rows) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.NULL_ALIGNMENT_KEY,
          `comparisons/${plan.comparisonId}/${side}/rows/${row.index}`,
          {
            severity: "warning",
            message: `Composite key excluded because ${row.nullFieldIds.join(", ")} ${
              row.nullFieldIds.length === 1 ? "is" : "are"
            } null.`,
            relatedIds: row.nullFieldIds,
          },
        ),
      );
    }
  }
  return Object.freeze(diagnostics);
}

export function comparisonRowMeasure(
  row: ComparisonRow,
  measureId: string,
): ComparisonMeasureRow | null {
  return row.measures.find((measure) => measure.id === measureId) ?? null;
}

export function comparisonDeltaIsAvailable(delta: ComparisonDelta): boolean {
  return delta.available && delta.value !== null;
}
