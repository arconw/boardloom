import {
  DIAGNOSTIC_CODES,
  canonicalJson,
  composeBlockFilters,
  createDiagnostic,
  createEmptyFilterRuntimeState,
  fail,
  isPlainObject,
  ok,
  queryFiltersForComposition,
  selectChartBindings,
  type BindingDefinition,
  type BoardDocument,
  type BoardDocumentV1,
  type BoardValidationCatalog,
  type BlockDefinition,
  type Diagnostic,
  type FilterConflict,
  type FilterRuntimeState,
  type QueryAggregation,
  type QueryGrouping,
  type QueryOrder,
  type QuerySpec,
  type Result,
} from "@boardloom/core";
import { ownValue } from "./own-value.js";

export interface DerivedBlockQuery {
  readonly spec: QuerySpec;
  readonly valueBindingId: string | null;
  readonly valueLabel: string | null;
  readonly filterDiagnostics: readonly Diagnostic[];
  readonly filterConflicts: readonly FilterConflict[];
}

export interface DeriveBlockQueryOptions {
  readonly filterState?: FilterRuntimeState;
  readonly catalog?: BoardValidationCatalog;
}

function bindingDiagnostic(
  path: string,
  message: string,
  relatedIds?: readonly string[],
): Result<never> {
  return fail([
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, {
      message,
      ...(relatedIds === undefined ? {} : { relatedIds }),
    }),
  ]);
}

function asDocument(document: BoardDocument): BoardDocumentV1 {
  return document as unknown as BoardDocumentV1;
}

function isDataBinding(binding: BindingDefinition): boolean {
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

function isMeasureBinding(binding: BindingDefinition): boolean {
  return binding.role === "measure" || binding.role === "value" || binding.axis === "y";
}

function isGroupingBinding(binding: BindingDefinition): boolean {
  return !isMeasureBinding(binding);
}

function aggregationFor(binding: BindingDefinition): QueryAggregation | null {
  const aggregation = binding.aggregation;
  if (!aggregation || aggregation.type === "none") {
    return null;
  }
  return Object.freeze({
    output: binding.id,
    type: aggregation.type,
    ...(aggregation.fieldId === undefined
      ? { fieldId: binding.field.fieldId }
      : { fieldId: aggregation.fieldId }),
  });
}

function groupingFor(binding: BindingDefinition): QueryGrouping {
  return Object.freeze({
    fieldId: binding.field.fieldId,
    ...(binding.bucket === undefined
      ? {}
      : {
          bucket: Object.freeze({
            grain: binding.bucket.grain,
            timezone: binding.bucket.timezone,
            ...(binding.bucket.weekStartsOn === undefined
              ? {}
              : { weekStartsOn: binding.bucket.weekStartsOn }),
          }),
        }),
  });
}

function firstDatasetAndSlice(
  bindings: readonly BindingDefinition[],
  block: BlockDefinition,
): Result<{ readonly datasetId: string; readonly sliceId?: string }> {
  let datasetId: string | null = null;
  let sliceId: string | undefined;
  for (const binding of bindings) {
    if (datasetId === null) {
      datasetId = binding.field.datasetId;
    } else if (datasetId !== binding.field.datasetId) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "A block cannot mix fields from different datasets.",
      );
    }
    if (binding.sliceId !== undefined) {
      if (sliceId === undefined) {
        sliceId = binding.sliceId;
      } else if (sliceId !== binding.sliceId) {
        return bindingDiagnostic(
          `blocks/${block.id}/bindings`,
          "A block cannot mix fields from different slices.",
        );
      }
    }
  }
  if (datasetId === null) {
    return bindingDiagnostic(
      `blocks/${block.id}/bindings`,
      "The block does not declare a dataset binding.",
    );
  }
  return ok({ datasetId, ...(sliceId === undefined ? {} : { sliceId }) });
}

function sortKeyFor(sortBindingId: string, bindings: readonly BindingDefinition[]): string | null {
  for (const binding of bindings) {
    if (binding.id !== sortBindingId) {
      continue;
    }
    return aggregationFor(binding) === null ? binding.field.fieldId : binding.id;
  }
  return null;
}

function tableOrder(
  block: BlockDefinition,
  bindings: readonly BindingDefinition[],
): readonly QueryOrder[] {
  const sort = ownValue(block.config, "sort");
  if (!isPlainObject(sort)) {
    return Object.freeze([]);
  }
  const bindingId = ownValue(sort, "bindingId");
  const direction = ownValue(sort, "direction");
  if (typeof bindingId !== "string" || (direction !== "ascending" && direction !== "descending")) {
    return Object.freeze([]);
  }
  const key = sortKeyFor(bindingId, bindings);
  if (key === null) {
    return Object.freeze([]);
  }
  return Object.freeze([Object.freeze({ key, direction })]);
}

function buildSpec(
  document: BoardDocumentV1,
  block: BlockDefinition,
  bindings: readonly BindingDefinition[],
  filterState: FilterRuntimeState,
  catalog: BoardValidationCatalog | undefined,
): Result<DerivedBlockQuery> {
  const identity = firstDatasetAndSlice(bindings, block);
  if (!identity.ok) {
    return identity;
  }
  const composition = composeBlockFilters(
    document,
    block,
    filterState,
    catalog === undefined ? {} : { catalog },
  );
  if (!composition.ok) {
    return fail(composition.diagnostics);
  }
  const filters = queryFiltersForComposition(composition.value);
  const filterDiagnostics = composition.value.diagnostics;
  const filterConflicts = composition.value.conflicts;
  const common = {
    datasetId: identity.value.datasetId,
    ...(identity.value.sliceId === undefined ? {} : { sliceId: identity.value.sliceId }),
    ...(filters.length === 0 ? {} : { filters }),
  };

  if (block.type === "metric") {
    const measure = bindings.find(isMeasureBinding);
    if (!measure) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "A metric block requires a measure binding.",
      );
    }
    const aggregation = aggregationFor(measure);
    if (!aggregation) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "A metric block requires an aggregation.",
      );
    }
    return ok(
      Object.freeze({
        spec: Object.freeze({ ...common, aggregations: Object.freeze([aggregation]) }),
        valueBindingId: measure.id,
        valueLabel: measure.label ?? null,
        filterDiagnostics,
        filterConflicts,
      }),
    );
  }

  if (block.type === "table") {
    const measured = bindings
      .map((binding) => ({ binding, aggregation: aggregationFor(binding) }))
      .filter(
        (entry): entry is { binding: BindingDefinition; aggregation: QueryAggregation } =>
          entry.aggregation !== null && isMeasureBinding(entry.binding),
      );
    const grouped = bindings.filter(isGroupingBinding);
    if (measured.length > 0) {
      const groupBy = grouped.map(groupingFor);
      return ok(
        Object.freeze({
          spec: Object.freeze({
            ...common,
            ...(groupBy.length === 0 ? {} : { groupBy: Object.freeze(groupBy) }),
            aggregations: Object.freeze(measured.map((entry) => entry.aggregation)),
            ...(tableOrder(block, bindings).length === 0
              ? {}
              : { orderBy: tableOrder(block, bindings) }),
          }),
          valueBindingId: measured[0]?.binding.id ?? null,
          valueLabel: measured[0]?.binding.label ?? null,
          filterDiagnostics,
          filterConflicts,
        }),
      );
    }
    const fields = [...new Set(bindings.map((binding) => binding.field.fieldId))];
    if (fields.length === 0) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "A table block requires at least one field binding.",
      );
    }
    return ok(
      Object.freeze({
        spec: Object.freeze({
          ...common,
          fields: Object.freeze(fields),
          ...(tableOrder(block, bindings).length === 0
            ? {}
            : { orderBy: tableOrder(block, bindings) }),
        }),
        valueBindingId: null,
        valueLabel: null,
        filterDiagnostics,
        filterConflicts,
      }),
    );
  }

  if (block.type === "chart") {
    const visualization = ownValue(block.config, "visualization");
    if (visualization === "scatter") {
      const fields = [...new Set(bindings.map((binding) => binding.field.fieldId))];
      if (fields.length < 2) {
        return bindingDiagnostic(
          `blocks/${block.id}/bindings`,
          "A scatter chart requires numeric X and Y fields.",
        );
      }
      const measure = bindings.find(isMeasureBinding);
      return ok(
        Object.freeze({
          spec: Object.freeze({ ...common, fields: Object.freeze(fields) }),
          valueBindingId: measure?.id ?? null,
          valueLabel: measure?.label ?? null,
          filterDiagnostics,
          filterConflicts,
        }),
      );
    }
    const selection = selectChartBindings(bindings, null);
    const measure = selection.y;
    const aggregation = measure === null ? null : aggregationFor(measure);
    if (measure === null || aggregation === null) {
      return bindingDiagnostic(
        `blocks/${block.id}/bindings`,
        "A chart block requires a measure aggregation.",
      );
    }
    const grouped = [selection.x, selection.series].filter(
      (binding): binding is BindingDefinition => binding !== null && !isMeasureBinding(binding),
    );
    const groupBy = grouped.map(groupingFor);
    return ok(
      Object.freeze({
        spec: Object.freeze({
          ...common,
          ...(groupBy.length === 0 ? {} : { groupBy: Object.freeze(groupBy) }),
          aggregations: Object.freeze([aggregation]),
        }),
        valueBindingId: measure.id,
        valueLabel: measure.label ?? null,
        filterDiagnostics,
        filterConflicts,
      }),
    );
  }

  return bindingDiagnostic(
    `blocks/${block.id}/type`,
    "This block type does not consume tabular data.",
    [block.type],
  );
}

export function deriveBlockQuery(
  document: BoardDocument,
  block: BlockDefinition,
  options: DeriveBlockQueryOptions = {},
): Result<DerivedBlockQuery> {
  const bindings = (block.bindings ?? []).filter(isDataBinding);
  if (bindings.length === 0) {
    return bindingDiagnostic(
      `blocks/${block.id}/bindings`,
      "The block does not declare data bindings.",
    );
  }
  return buildSpec(
    asDocument(document),
    block,
    bindings,
    options.filterState ?? createEmptyFilterRuntimeState(),
    options.catalog,
  );
}

export function blockQueryId(viewId: string, blockId: string): string {
  return `view:${viewId}:block:${blockId}`;
}

export function querySpecSignature(spec: QuerySpec): string {
  return canonicalJson(spec as never);
}
