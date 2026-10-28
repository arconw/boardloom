import {
  FILTER_OPERATORS,
  type BlockDefinition,
  type BoardDocumentV1,
  type FieldDescriptor,
  type FieldReference,
  type FieldValueType,
  type FilterDefinition,
  type FilterFieldMapping,
  type FilterOperator,
  type FilterTarget,
  type FilterTemporalConfig,
} from "./board-schema.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import { deepFreeze, isJsonValue, isPlainObject, type JsonValue } from "./json.js";
import {
  catalogDatasetEntry,
  catalogFieldEntry,
  isIsoDateString,
  isIsoDateTimeString,
  type BoardValidationCatalog,
} from "./board-validation-shared.js";
import { FILTER_OPERATORS_BY_FIELD_TYPE } from "./board-validation-filter.js";
import { isValidTimeZone } from "./locale.js";
import { temporalInstant } from "./temporal.js";

export const DATA_CONSUMING_BLOCK_TYPES = Object.freeze(["chart", "metric", "table"] as const);
const VALUE_OPERATORS: readonly FilterOperator[] = Object.freeze([
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "in",
  "notIn",
  "contains",
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "isNull",
  "isNotNull",
  "isTrue",
  "isFalse",
]);

export interface FilterActiveValue {
  readonly filterId: string;
  readonly value: JsonValue;
}

export interface CrossFilterSelection {
  readonly id: string;
  readonly sourceBlockId: string;
  readonly field: FieldReference;
  readonly operator: FilterOperator;
  readonly value: JsonValue;
  readonly temporal?: FilterTemporalConfig;
  readonly mappings?: readonly FilterFieldMapping[];
  readonly label?: string;
}

export interface CrossFilterSelectionInput {
  readonly id?: string;
  readonly sourceBlockId: string;
  readonly field: FieldReference;
  readonly operator: FilterOperator;
  readonly value: JsonValue;
  readonly temporal?: FilterTemporalConfig;
  readonly mappings?: readonly FilterFieldMapping[];
  readonly label?: string;
}

export interface FilterRuntimeState {
  readonly activeValues: readonly FilterActiveValue[];
  readonly crossFilters: readonly CrossFilterSelection[];
}

export interface FilterOrigin {
  readonly kind: FilterTarget["kind"];
  readonly groupId?: string;
  readonly blockId?: string;
  readonly sourceBlockId?: string;
  readonly label?: string;
}

export interface EffectiveFilter {
  readonly filterId: string;
  readonly origin: FilterOrigin;
  readonly source: "definition" | "active" | "cross";
  readonly filterField: FieldReference;
  readonly targetField: FieldReference;
  readonly operator: FilterOperator;
  readonly value?: JsonValue;
  readonly temporal?: FilterTemporalConfig;
  readonly mappings?: readonly FilterFieldMapping[];
}

export interface FilterConflict {
  readonly field: FieldReference;
  readonly filterIds: readonly string[];
  readonly diagnostic: Diagnostic;
}

export interface BlockFilterComposition {
  readonly blockId: string;
  readonly filters: readonly EffectiveFilter[];
  readonly diagnostics: readonly Diagnostic[];
  readonly conflicts: readonly FilterConflict[];
}

export interface ComparisonFilterSides {
  readonly primary: readonly EffectiveFilter[];
  readonly reference: readonly EffectiveFilter[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface CrossFilterTargetStatus {
  readonly blockId: string;
  readonly compatible: boolean;
  readonly reason: string | null;
  readonly field: FieldReference | null;
}

export const EMPTY_FILTER_STATE: FilterRuntimeState = Object.freeze({
  activeValues: Object.freeze([]),
  crossFilters: Object.freeze([]),
});

export function createEmptyFilterRuntimeState(): FilterRuntimeState {
  return EMPTY_FILTER_STATE;
}

export function isDataConsumingBlock(block: BlockDefinition): boolean {
  return (DATA_CONSUMING_BLOCK_TYPES as readonly string[]).includes(String(block.type));
}

export function filterFieldKey(reference: FieldReference): string {
  return `${reference.datasetId}\u0000${reference.fieldId}`;
}

export function fieldReferenceEquals(left: FieldReference, right: FieldReference): boolean {
  return left.datasetId === right.datasetId && left.fieldId === right.fieldId;
}

export function blockDatasetIds(block: BlockDefinition): readonly string[] {
  const ids: string[] = [];
  for (const binding of block.bindings ?? []) {
    const datasetId = binding.field.datasetId;
    if (!ids.includes(datasetId)) {
      ids.push(datasetId);
    }
  }
  return Object.freeze(ids);
}

export function documentField(
  document: BoardDocumentV1,
  reference: FieldReference,
): FieldDescriptor | undefined {
  const dataset = document.datasets.find((entry) => entry.id === reference.datasetId);
  return dataset?.fields?.find((entry) => entry.id === reference.fieldId);
}

function providerFieldOperators(
  catalog: BoardValidationCatalog | undefined,
  reference: FieldReference,
): readonly FilterOperator[] | undefined {
  return catalogFieldEntry(catalogDatasetEntry(catalog, reference.datasetId), reference.fieldId)
    ?.operators;
}

function datasetTimezoneConversion(
  catalog: BoardValidationCatalog | undefined,
  datasetId: string,
): boolean {
  return catalogDatasetEntry(catalog, datasetId)?.capabilities?.timezoneConversion === true;
}

function fieldTimezone(
  document: BoardDocumentV1,
  reference: FieldReference,
  catalog: BoardValidationCatalog | undefined,
): string | undefined {
  return (
    catalogFieldEntry(catalogDatasetEntry(catalog, reference.datasetId), reference.fieldId)
      ?.timezone ?? documentField(document, reference)?.timezone
  );
}

function temporalTimezoneDiagnostic(
  document: BoardDocumentV1,
  reference: FieldReference,
  timezone: string,
  catalog: BoardValidationCatalog | undefined,
  path: string,
): Diagnostic | null {
  const declared = fieldTimezone(document, reference, catalog);
  if (declared === undefined || declared === timezone) {
    return null;
  }
  if (datasetTimezoneConversion(catalog, reference.datasetId)) {
    return null;
  }
  return createDiagnostic(DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE, path, {
    message: `The filter timezone "${timezone}" differs from the field timezone "${declared}" and the dataset does not declare timezone conversion capability.`,
    relatedIds: [reference.datasetId, reference.fieldId],
  });
}

function temporalConversionReason(
  document: BoardDocumentV1,
  reference: FieldReference,
  timezone: string,
  catalog: BoardValidationCatalog | undefined,
): string | null {
  const declared = fieldTimezone(document, reference, catalog);
  if (declared === undefined || declared === timezone) {
    return null;
  }
  return datasetTimezoneConversion(catalog, reference.datasetId) ? null : "timezone-conversion";
}

export function fieldCompatibilityReason(
  source: FieldDescriptor | undefined,
  target: FieldDescriptor | undefined,
): string | null {
  if (source === undefined || target === undefined) {
    return "field-unverified";
  }
  if (source.type !== target.type) {
    return "field-type";
  }
  if ((source.unit ?? "") !== (target.unit ?? "")) {
    return "field-unit";
  }
  if (source.type === "date" || source.type === "datetime") {
    if ((source.timezone ?? "") !== (target.timezone ?? "")) {
      return "field-timezone";
    }
  }
  return null;
}

export function mappingForDataset(
  filter: Pick<FilterDefinition, "field" | "mappings">,
  datasetId: string,
): FilterFieldMapping | null {
  if (filter.field.datasetId === datasetId) {
    return null;
  }
  for (const mapping of filter.mappings ?? []) {
    if (
      fieldReferenceEquals(mapping.source, filter.field) &&
      mapping.target.datasetId === datasetId
    ) {
      return mapping;
    }
  }
  return null;
}

export function filterTargetsBlock(
  target: FilterTarget,
  block: BlockDefinition,
  document: BoardDocumentV1,
): boolean {
  if (target.kind === "board") {
    return true;
  }
  if (target.kind === "group") {
    if (block.groupId === target.groupId) {
      return true;
    }
    const group = document.filterGroups?.find((entry) => entry.id === target.groupId);
    return group?.blockIds?.includes(block.id) ?? false;
  }
  return target.blockId === block.id;
}

export function filtersForBlockScope(
  document: BoardDocumentV1,
  block: BlockDefinition,
): readonly FilterDefinition[] {
  const ordered: FilterDefinition[] = [];
  const board = document.filters.filter((filter) => filter.target.kind === "board");
  ordered.push(...board);
  const groups = document.filterGroups ?? [];
  for (const group of groups) {
    const groupFilters = document.filters.filter(
      (filter) => filter.target.kind === "group" && filter.target.groupId === group.id,
    );
    ordered.push(...groupFilters);
  }
  const blockFilters = document.filters.filter(
    (filter) => filter.target.kind === "block" && filter.target.blockId === block.id,
  );
  ordered.push(...blockFilters);
  return Object.freeze(ordered);
}

function groupFiltersInDocumentOrder(document: BoardDocumentV1): readonly FilterDefinition[] {
  const ordered: FilterDefinition[] = [];
  const groups = document.filterGroups ?? [];
  for (const group of groups) {
    for (const filter of document.filters) {
      if (filter.target.kind === "group" && filter.target.groupId === group.id) {
        ordered.push(filter);
      }
    }
  }
  return ordered;
}

export function filterCompositionOrder(document: BoardDocumentV1): readonly FilterDefinition[] {
  const board = document.filters.filter((filter) => filter.target.kind === "board");
  const groups = groupFiltersInDocumentOrder(document);
  const blocks = document.filters.filter((filter) => filter.target.kind === "block");
  return Object.freeze([...board, ...groups, ...blocks]);
}

export function activeValueFor(state: FilterRuntimeState, filterId: string): JsonValue | undefined {
  const entry = state.activeValues.find((candidate) => candidate.filterId === filterId);
  return entry?.value;
}

export function effectiveFilterValue(
  filter: FilterDefinition,
  state: FilterRuntimeState,
): { readonly value: JsonValue | undefined; readonly source: "definition" | "active" } {
  const active = state.activeValues.find((candidate) => candidate.filterId === filter.id);
  return active === undefined
    ? { value: filter.defaultValue, source: "definition" }
    : { value: active.value, source: "active" };
}

export function cloneFilterState(state: FilterRuntimeState): {
  activeValues: FilterActiveValue[];
  crossFilters: CrossFilterSelection[];
} {
  return {
    activeValues: state.activeValues.map((entry) => ({
      filterId: entry.filterId,
      value: entry.value,
    })),
    crossFilters: state.crossFilters.map((entry) => ({
      ...entry,
      field: { ...entry.field },
      ...(entry.mappings === undefined
        ? {}
        : { mappings: entry.mappings.map((mapping) => ({ ...mapping })) }),
    })),
  };
}

function freezeFilterState(state: FilterRuntimeState): FilterRuntimeState {
  return deepFreeze({
    activeValues: state.activeValues.map((entry) =>
      Object.freeze({ filterId: entry.filterId, value: entry.value }),
    ),
    crossFilters: state.crossFilters.map((entry) =>
      Object.freeze({
        id: entry.id,
        sourceBlockId: entry.sourceBlockId,
        field: Object.freeze({ ...entry.field }),
        operator: entry.operator,
        value: entry.value,
        ...(entry.temporal === undefined ? {} : { temporal: Object.freeze({ ...entry.temporal }) }),
        ...(entry.mappings === undefined
          ? {}
          : {
              mappings: Object.freeze(
                entry.mappings.map((mapping) =>
                  Object.freeze({
                    source: Object.freeze({ ...mapping.source }),
                    target: Object.freeze({ ...mapping.target }),
                  }),
                ),
              ),
            }),
        ...(entry.label === undefined ? {} : { label: entry.label }),
      }),
    ),
  }) as FilterRuntimeState;
}

export function makeFilterState(
  activeValues: readonly FilterActiveValue[],
  crossFilters: readonly CrossFilterSelection[],
): FilterRuntimeState {
  return freezeFilterState({ activeValues, crossFilters });
}

export function crossFilterSelectionEquals(
  left: CrossFilterSelection,
  right: CrossFilterSelection,
): boolean {
  return (
    left.sourceBlockId === right.sourceBlockId &&
    fieldReferenceEquals(left.field, right.field) &&
    left.operator === right.operator &&
    JSON.stringify(left.value) === JSON.stringify(right.value)
  );
}

export function crossFilterKey(selection: CrossFilterSelection): string {
  return `${selection.sourceBlockId}\u0000${filterFieldKey(selection.field)}\u0000${selection.operator}\u0000${JSON.stringify(selection.value)}`;
}

function crossFilterMappingForDataset(
  selection: CrossFilterSelection,
  datasetId: string,
): FilterFieldMapping | null {
  if (selection.field.datasetId === datasetId) {
    return null;
  }
  for (const mapping of selection.mappings ?? []) {
    if (
      fieldReferenceEquals(mapping.source, selection.field) &&
      mapping.target.datasetId === datasetId
    ) {
      return mapping;
    }
  }
  return null;
}

export function crossFilterTargetStatus(
  document: BoardDocumentV1,
  block: BlockDefinition,
  state: FilterRuntimeState,
  catalog?: BoardValidationCatalog,
): CrossFilterTargetStatus {
  const selections = state.crossFilters.filter((selection) => selection.sourceBlockId !== block.id);
  if (selections.length === 0) {
    return Object.freeze({ blockId: block.id, compatible: true, reason: null, field: null });
  }
  if (!isDataConsumingBlock(block)) {
    return Object.freeze({
      blockId: block.id,
      compatible: false,
      reason: "not-data-consuming",
      field: null,
    });
  }
  const datasetIds = blockDatasetIds(block);
  if (datasetIds.length === 0) {
    return Object.freeze({
      blockId: block.id,
      compatible: false,
      reason: "schema-pending",
      field: null,
    });
  }
  for (const selection of selections) {
    const source = documentField(document, selection.field);
    for (const datasetId of datasetIds) {
      const mapping = crossFilterMappingForDataset(selection, datasetId);
      if (selection.field.datasetId !== datasetId && mapping === null) {
        return Object.freeze({
          blockId: block.id,
          compatible: false,
          reason: "unmapped",
          field: null,
        });
      }
      const targetReference = mapping === null ? selection.field : mapping.target;
      const target = documentField(document, targetReference);
      const reason = fieldCompatibilityReason(source, target);
      if (reason !== null) {
        return Object.freeze({
          blockId: block.id,
          compatible: false,
          reason,
          field: target === undefined ? null : Object.freeze({ ...targetReference }),
        });
      }
      const operators = providerFieldOperators(catalog, targetReference);
      if (operators !== undefined && !operators.includes(selection.operator)) {
        return Object.freeze({
          blockId: block.id,
          compatible: false,
          reason: "unsupported-operator",
          field: Object.freeze({ ...targetReference }),
        });
      }
      if (
        selection.temporal !== undefined &&
        temporalConversionReason(
          document,
          targetReference,
          selection.temporal.timezone,
          catalog,
        ) !== null
      ) {
        return Object.freeze({
          blockId: block.id,
          compatible: false,
          reason: "timezone-conversion",
          field: Object.freeze({ ...targetReference }),
        });
      }
    }
  }
  return Object.freeze({ blockId: block.id, compatible: true, reason: null, field: null });
}

export function crossFilterTargetIds(
  document: BoardDocumentV1,
  selection: CrossFilterSelection,
  catalog?: BoardValidationCatalog,
): readonly string[] {
  const ids: string[] = [];
  for (const block of document.blocks) {
    if (block.id === selection.sourceBlockId || !isDataConsumingBlock(block)) {
      continue;
    }
    if (
      crossFilterTargetStatus(document, block, makeFilterState([], [selection]), catalog).compatible
    ) {
      ids.push(block.id);
    }
  }
  return Object.freeze(ids);
}

function originForFilter(document: BoardDocumentV1, filter: FilterDefinition): FilterOrigin {
  const target = filter.target;
  if (target.kind === "board") {
    return Object.freeze({ kind: "board" });
  }
  if (target.kind === "group") {
    return Object.freeze({ kind: "group", groupId: target.groupId });
  }
  const block = document.blocks.find((entry) => entry.id === target.blockId);
  return Object.freeze({
    kind: "block",
    blockId: target.blockId,
    ...(block === undefined ? {} : { label: block.title ?? block.id }),
  });
}

function effectiveFilterFor(
  document: BoardDocumentV1,
  filter: FilterDefinition,
  datasetId: string,
  state: FilterRuntimeState,
  catalog: BoardValidationCatalog | undefined,
): EffectiveFilter | Diagnostic {
  const mapping = mappingForDataset(filter, datasetId);
  if (filter.field.datasetId !== datasetId && mapping === null) {
    return createDiagnostic(
      DIAGNOSTIC_CODES.FILTER_TARGET_UNMAPPED,
      `filters/${filter.id}/mappings`,
      {
        message: `Filter "${filter.id}" targets dataset "${datasetId}" without an explicit field mapping.`,
        relatedIds: [filter.id, datasetId],
      },
    );
  }
  const source = documentField(document, filter.field);
  const targetField = mapping === null ? filter.field : mapping.target;
  const target = documentField(document, targetField);
  if (source !== undefined && target !== undefined) {
    const reason = fieldCompatibilityReason(source, target);
    if (reason !== null) {
      return createDiagnostic(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
        `filters/${filter.id}/mappings`,
        {
          message: `Filter "${filter.id}" cannot map "${filter.field.fieldId}" to "${targetField.fieldId}" (${reason}).`,
          relatedIds: [filter.id, datasetId],
        },
      );
    }
  }
  if (
    filter.temporal !== undefined &&
    temporalConversionReason(document, targetField, filter.temporal.timezone, catalog) !== null
  ) {
    return createDiagnostic(
      DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
      `filters/${filter.id}/mappings`,
      {
        message: `Filter "${filter.id}" requires timezone conversion for target dataset "${targetField.datasetId}".`,
        relatedIds: [filter.id, targetField.datasetId],
      },
    );
  }
  const effective = effectiveFilterValue(filter, state);
  return Object.freeze({
    filterId: filter.id,
    origin: originForFilter(document, filter),
    source: effective.source,
    filterField: Object.freeze({ ...filter.field }),
    targetField: Object.freeze({ ...targetField }),
    operator: filter.operator,
    ...(effective.value === undefined ? {} : { value: effective.value }),
    ...(filter.temporal === undefined ? {} : { temporal: Object.freeze({ ...filter.temporal }) }),
    ...(filter.mappings === undefined
      ? {}
      : { mappings: Object.freeze(filter.mappings.map((entry) => Object.freeze({ ...entry }))) }),
  });
}

function effectiveCrossFilterFor(
  document: BoardDocumentV1,
  block: BlockDefinition,
  selection: CrossFilterSelection,
  datasetId: string,
): EffectiveFilter | Diagnostic {
  const mapping = crossFilterMappingForDataset(selection, datasetId);
  if (selection.field.datasetId !== datasetId && mapping === null) {
    return createDiagnostic(
      DIAGNOSTIC_CODES.CROSS_FILTER_INCOMPATIBLE,
      `crossFilters/${selection.id}/mappings`,
      {
        message: `Selection "${selection.id}" cannot target dataset "${datasetId}" without an explicit field mapping.`,
        relatedIds: [selection.id, datasetId],
      },
    );
  }
  const source = documentField(document, selection.field);
  const targetField = mapping === null ? selection.field : mapping.target;
  const target = documentField(document, targetField);
  if (source !== undefined && target !== undefined) {
    const reason = fieldCompatibilityReason(source, target);
    if (reason !== null) {
      return createDiagnostic(
        DIAGNOSTIC_CODES.CROSS_FILTER_INCOMPATIBLE,
        `crossFilters/${selection.id}/mappings`,
        {
          message: `Selection "${selection.id}" is incompatible with "${targetField.fieldId}" (${reason}).`,
          relatedIds: [selection.id, block.id],
        },
      );
    }
  }
  return Object.freeze({
    filterId: selection.id,
    origin: Object.freeze({ kind: "board", sourceBlockId: selection.sourceBlockId }),
    source: "cross",
    filterField: Object.freeze({ ...selection.field }),
    targetField: Object.freeze({ ...targetField }),
    operator: selection.operator,
    value: selection.value,
    ...(selection.temporal === undefined
      ? {}
      : { temporal: Object.freeze({ ...selection.temporal }) }),
    ...(selection.mappings === undefined
      ? {}
      : {
          mappings: Object.freeze(selection.mappings.map((entry) => Object.freeze({ ...entry }))),
        }),
  });
}

interface RangeBound {
  readonly value: JsonValue;
  readonly inclusive: boolean;
}

interface FieldRestriction {
  readonly field: FieldReference;
  readonly type: FieldValueType | undefined;
  readonly timezone: string | undefined;
  readonly filterIds: string[];
  nullAllowed: boolean;
  nullRequired: boolean;
  allowed: JsonValue[] | null;
  excluded: JsonValue[];
  min: RangeBound | null;
  max: RangeBound | null;
}

function temporalValue(
  value: JsonValue,
  field: FieldDescriptor | undefined,
  timezone: string | undefined,
): number | null {
  if (field?.type !== "date" && field?.type !== "datetime") {
    return null;
  }
  return temporalInstant(value, field.type, timezone ?? field.timezone ?? "UTC", "iso8601-offset");
}

function compareScalar(
  left: JsonValue,
  right: JsonValue,
  field: FieldDescriptor | undefined,
  timezone: string | undefined,
): number | null {
  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const leftInstant = temporalValue(left, field, timezone);
  const rightInstant = temporalValue(right, field, timezone);
  if (leftInstant !== null && rightInstant !== null) {
    return leftInstant < rightInstant ? -1 : leftInstant > rightInstant ? 1 : 0;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return null;
}

function stricterMin(
  current: RangeBound | null,
  candidate: RangeBound,
  field: FieldDescriptor | undefined,
  timezone: string | undefined,
): RangeBound {
  if (current === null) {
    return candidate;
  }
  const comparison = compareScalar(candidate.value, current.value, field, timezone);
  if (comparison === 1) {
    return candidate;
  }
  if (comparison === 0 && !candidate.inclusive && current.inclusive) {
    return candidate;
  }
  return current;
}

function stricterMax(
  current: RangeBound | null,
  candidate: RangeBound,
  field: FieldDescriptor | undefined,
  timezone: string | undefined,
): RangeBound {
  if (current === null) {
    return candidate;
  }
  const comparison = compareScalar(candidate.value, current.value, field, timezone);
  if (comparison === -1) {
    return candidate;
  }
  if (comparison === 0 && !candidate.inclusive && current.inclusive) {
    return candidate;
  }
  return current;
}

function applyRestriction(
  restriction: FieldRestriction,
  filter: EffectiveFilter,
  field: FieldDescriptor | undefined,
): void {
  restriction.filterIds.push(filter.filterId);
  const value = filter.value;
  const timezone = filter.temporal?.timezone;
  if (filter.operator === "isNull") {
    restriction.nullRequired = true;
    return;
  }
  if (filter.operator === "isNotNull") {
    restriction.nullAllowed = false;
    return;
  }
  if (filter.operator === "isTrue" || filter.operator === "isFalse") {
    restriction.nullAllowed = false;
    const expected = filter.operator === "isTrue";
    restriction.allowed =
      restriction.allowed === null
        ? [expected]
        : restriction.allowed.filter((entry) => entry === expected);
    return;
  }
  if (filter.operator === "equals") {
    restriction.nullAllowed = false;
    restriction.allowed =
      restriction.allowed === null
        ? value === undefined
          ? []
          : [value]
        : restriction.allowed.filter(
            (entry) => compareScalar(entry, value ?? null, field, timezone) === 0,
          );
    return;
  }
  if (filter.operator === "notEquals") {
    restriction.nullAllowed = false;
    if (value !== undefined) {
      restriction.excluded.push(value);
    }
    return;
  }
  if (filter.operator === "in" || filter.operator === "notIn") {
    const values = Array.isArray(value) ? value : [];
    if (filter.operator === "in") {
      restriction.nullAllowed = false;
      restriction.allowed =
        restriction.allowed === null
          ? [...values]
          : restriction.allowed.filter((entry) =>
              values.some((candidate) => compareScalar(entry, candidate, field, timezone) === 0),
            );
    } else {
      restriction.nullAllowed = false;
      restriction.excluded.push(...values);
    }
    return;
  }
  if (filter.operator === "between") {
    restriction.nullAllowed = false;
    if (Array.isArray(value) && value.length === 2) {
      const bounds = filter.temporal?.bounds ?? "inclusive";
      const startInclusive = bounds !== "exclusive";
      const endInclusive = bounds === "inclusive";
      const start = value[0];
      const end = value[1];
      if (start !== undefined) {
        restriction.min = stricterMin(
          restriction.min,
          { value: start, inclusive: startInclusive },
          field,
          timezone,
        );
      }
      if (end !== undefined) {
        restriction.max = stricterMax(
          restriction.max,
          { value: end, inclusive: endInclusive },
          field,
          timezone,
        );
      }
    }
    return;
  }
  restriction.nullAllowed = false;
  if (value === undefined) {
    return;
  }
  if (
    filter.operator === "greaterThan" ||
    filter.operator === "greaterThanOrEqual" ||
    filter.operator === "after" ||
    filter.operator === "onOrAfter"
  ) {
    const inclusive = filter.operator === "greaterThanOrEqual" || filter.operator === "onOrAfter";
    restriction.min = stricterMin(restriction.min, { value, inclusive }, field, timezone);
  }
  if (
    filter.operator === "lessThan" ||
    filter.operator === "lessThanOrEqual" ||
    filter.operator === "before" ||
    filter.operator === "onOrBefore"
  ) {
    const inclusive = filter.operator === "lessThanOrEqual" || filter.operator === "onOrBefore";
    restriction.max = stricterMax(restriction.max, { value, inclusive }, field, timezone);
  }
}

function contradictoryRestriction(
  restriction: FieldRestriction,
  document: BoardDocumentV1,
): boolean {
  if (restriction.nullRequired && !restriction.nullAllowed) {
    return true;
  }
  const field = documentField(document, restriction.field);
  if (restriction.allowed !== null) {
    if (restriction.allowed.length === 0) {
      return true;
    }
    const surviving = restriction.allowed.filter((value) => {
      if (
        restriction.excluded.some(
          (entry) => compareScalar(entry, value, field, restriction.timezone) === 0,
        )
      ) {
        return false;
      }
      if (restriction.min !== null) {
        const comparison = compareScalar(value, restriction.min.value, field, restriction.timezone);
        if (
          comparison === null ||
          comparison < 0 ||
          (comparison === 0 && !restriction.min.inclusive)
        ) {
          return false;
        }
      }
      if (restriction.max !== null) {
        const comparison = compareScalar(value, restriction.max.value, field, restriction.timezone);
        if (
          comparison === null ||
          comparison > 0 ||
          (comparison === 0 && !restriction.max.inclusive)
        ) {
          return false;
        }
      }
      return true;
    });
    return surviving.length === 0;
  }
  if (restriction.min !== null && restriction.max !== null) {
    const comparison = compareScalar(
      restriction.min.value,
      restriction.max.value,
      field,
      restriction.timezone,
    );
    if (
      comparison === 1 ||
      (comparison === 0 && (!restriction.min.inclusive || !restriction.max.inclusive))
    ) {
      return true;
    }
  }
  return false;
}

function detectConflicts(
  document: BoardDocumentV1,
  filters: readonly EffectiveFilter[],
): readonly FilterConflict[] {
  const restrictions = new Map<string, FieldRestriction>();
  for (const filter of filters) {
    if (!VALUE_OPERATORS.includes(filter.operator)) {
      continue;
    }
    const key = filterFieldKey(filter.targetField);
    let restriction = restrictions.get(key);
    if (restriction === undefined) {
      const field = documentField(document, filter.targetField);
      restriction = {
        field: filter.targetField,
        type: field?.type,
        timezone: filter.temporal?.timezone,
        filterIds: [],
        nullAllowed: true,
        nullRequired: false,
        allowed: null,
        excluded: [],
        min: null,
        max: null,
      };
      restrictions.set(key, restriction);
    }
    applyRestriction(restriction, filter, documentField(document, filter.targetField));
  }
  const conflicts: FilterConflict[] = [];
  for (const restriction of restrictions.values()) {
    if (restriction.filterIds.length < 2 || !contradictoryRestriction(restriction, document)) {
      continue;
    }
    conflicts.push(
      Object.freeze({
        field: Object.freeze({ ...restriction.field }),
        filterIds: Object.freeze([...restriction.filterIds]),
        diagnostic: createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_CONFLICT,
          `filters/${restriction.filterIds[0] ?? "conflict"}`,
          {
            message: `Filters ${restriction.filterIds.join(", ")} contradict each other on ${restriction.field.fieldId}; the result is empty.`,
            relatedIds: Object.freeze([...restriction.filterIds]),
          },
        ),
      }),
    );
  }
  return Object.freeze(conflicts);
}

function queryFilterFromEffective(filter: EffectiveFilter): {
  filterId: string;
  fieldId: string;
  operator: FilterOperator;
  value?: JsonValue;
  temporal?: FilterTemporalConfig;
} {
  return {
    filterId: filter.filterId,
    fieldId: filter.targetField.fieldId,
    operator: filter.operator,
    ...(filter.value === undefined ? {} : { value: filter.value }),
    ...(filter.temporal === undefined ? {} : { temporal: filter.temporal }),
  };
}

export function composeBlockFilters(
  document: BoardDocumentV1,
  block: BlockDefinition,
  state: FilterRuntimeState,
  options: { readonly catalog?: BoardValidationCatalog } = {},
):
  | { readonly ok: true; readonly value: BlockFilterComposition }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  if (!isDataConsumingBlock(block)) {
    return {
      ok: true,
      value: Object.freeze({
        blockId: block.id,
        filters: Object.freeze([]),
        diagnostics: Object.freeze([]),
        conflicts: Object.freeze([]),
      }),
    };
  }
  const datasetIds = blockDatasetIds(block);
  if (datasetIds.length === 0) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.FILTER_SCHEMA_PENDING, `blocks/${block.id}/bindings`, {
          message: `Block "${block.id}" has no resolvable dataset; its filters are pending.`,
          severity: "warning",
          relatedIds: [block.id],
        }),
      ]),
    };
  }
  const diagnostics: Diagnostic[] = [];
  const filters: EffectiveFilter[] = [];
  for (const filter of filtersForBlockScope(document, block)) {
    if (!filterTargetsBlock(filter.target, block, document)) {
      continue;
    }
    for (const datasetId of datasetIds) {
      const effective = effectiveFilterFor(document, filter, datasetId, state, options.catalog);
      if ("code" in effective) {
        diagnostics.push(effective);
      } else {
        filters.push(effective);
      }
    }
  }
  for (const selection of state.crossFilters) {
    if (selection.sourceBlockId === block.id) {
      continue;
    }
    const targetStatus = crossFilterTargetStatus(
      document,
      block,
      makeFilterState([], [selection]),
      options.catalog,
    );
    if (!targetStatus.compatible) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.CROSS_FILTER_INCOMPATIBLE,
          `crossFilters/${selection.id}`,
          {
            message: `Selection "${selection.id}" is not applied to block "${block.id}" (${targetStatus.reason ?? "incompatible"}).`,
            severity: "warning",
            relatedIds: [selection.id, block.id],
          },
        ),
      );
      continue;
    }
    for (const datasetId of datasetIds) {
      const effective = effectiveCrossFilterFor(document, block, selection, datasetId);
      if ("code" in effective) {
        diagnostics.push(
          createDiagnostic(effective.code, effective.path, {
            message: effective.message,
            severity: "warning",
            relatedIds: effective.relatedIds,
          }),
        );
      } else {
        filters.push(effective);
      }
    }
  }
  const conflicts = detectConflicts(document, filters);
  for (const conflict of conflicts) {
    diagnostics.push(conflict.diagnostic);
  }
  if (
    diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" && diagnostic.code !== DIAGNOSTIC_CODES.FILTER_CONFLICT,
    )
  ) {
    return { ok: false, diagnostics: Object.freeze([...diagnostics]) };
  }
  return {
    ok: true,
    value: Object.freeze({
      blockId: block.id,
      filters: Object.freeze([...filters]),
      diagnostics: Object.freeze([...diagnostics]),
      conflicts,
    }),
  };
}

export function queryFiltersForComposition(composition: BlockFilterComposition): readonly {
  readonly id: string;
  readonly fieldId: string;
  readonly operator: FilterOperator;
  readonly value?: JsonValue;
  readonly timezone?: string;
  readonly bounds?: FilterTemporalConfig["bounds"];
}[] {
  return Object.freeze(
    composition.filters.map((filter) => {
      const query = queryFilterFromEffective(filter);
      return Object.freeze({
        id: query.filterId,
        fieldId: query.fieldId,
        operator: query.operator,
        ...(query.value === undefined ? {} : { value: query.value }),
        ...(query.temporal === undefined
          ? {}
          : { timezone: query.temporal.timezone, bounds: query.temporal.bounds }),
      });
    }),
  );
}

function comparisonMappingForField(
  document: BoardDocumentV1,
  block: BlockDefinition,
  field: FieldReference,
  side: "primary" | "reference",
  mappings: readonly FilterFieldMapping[] | undefined,
): FieldReference | null {
  const comparisonId = isPlainObject(block.config)
    ? (block.config as { readonly comparisonId?: unknown }).comparisonId
    : undefined;
  if (typeof comparisonId !== "string") {
    return null;
  }
  const comparison = document.comparisons?.find((entry) => entry.id === comparisonId);
  if (comparison === undefined) {
    return null;
  }
  for (const mapping of comparison.mapping) {
    if (side === "primary" && fieldReferenceEquals(mapping.primary, field)) {
      return mapping.primary;
    }
    if (side === "reference" && fieldReferenceEquals(mapping.reference, field)) {
      return mapping.reference;
    }
    if (side === "primary" && fieldReferenceEquals(mapping.reference, field)) {
      return mapping.primary;
    }
    if (side === "reference" && fieldReferenceEquals(mapping.primary, field)) {
      return mapping.reference;
    }
  }
  const sideDataset =
    side === "primary" ? comparison.base.datasetId : comparison.reference.datasetId;
  if (field.datasetId === sideDataset && documentField(document, field) !== undefined) {
    return field;
  }
  for (const mapping of mappings ?? []) {
    if (fieldReferenceEquals(mapping.source, field) && mapping.target.datasetId === sideDataset) {
      return mapping.target;
    }
  }
  return null;
}

export function composeComparisonFilterSides(
  document: BoardDocumentV1,
  block: BlockDefinition,
  state: FilterRuntimeState,
  options: { readonly catalog?: BoardValidationCatalog } = {},
): ComparisonFilterSides {
  const diagnostics: Diagnostic[] = [];
  const primary: EffectiveFilter[] = [];
  const reference: EffectiveFilter[] = [];
  const add = (filter: EffectiveFilter, side: "primary" | "reference"): void => {
    const mapped = comparisonMappingForField(
      document,
      block,
      filter.filterField,
      side,
      filter.mappings,
    );
    if (mapped === null) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_TARGET_UNMAPPED,
          `filters/${filter.filterId}/mappings`,
          {
            message: `Filter "${filter.filterId}" has no ${side} mapping for the comparison block "${block.id}".`,
            relatedIds: [filter.filterId, block.id],
          },
        ),
      );
      return;
    }
    const operators = providerFieldOperators(options.catalog, mapped);
    if (operators !== undefined && !operators.includes(filter.operator)) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
          `filters/${filter.filterId}/mappings`,
          {
            message: `The ${side} comparison side does not declare operator "${filter.operator}".`,
            relatedIds: [filter.filterId, block.id],
          },
        ),
      );
      return;
    }
    if (
      filter.temporal !== undefined &&
      temporalConversionReason(document, mapped, filter.temporal.timezone, options.catalog) !== null
    ) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
          `filters/${filter.filterId}/mappings`,
          {
            message: `The ${side} comparison dataset does not declare timezone conversion for this filter window.`,
            relatedIds: [filter.filterId, block.id],
          },
        ),
      );
      return;
    }
    const source = documentField(document, filter.filterField);
    const target = documentField(document, mapped);
    const reason = fieldCompatibilityReason(source, target);
    if (reason !== null) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
          `filters/${filter.filterId}/mappings`,
          {
            message: `Filter "${filter.filterId}" is incompatible with the ${side} comparison side (${reason}).`,
            relatedIds: [filter.filterId, block.id],
          },
        ),
      );
      return;
    }
    const sideFilter = Object.freeze({ ...filter, targetField: Object.freeze({ ...mapped }) });
    if (side === "primary") {
      primary.push(sideFilter);
    } else {
      reference.push(sideFilter);
    }
  };
  for (const filter of filtersForBlockScope(document, block)) {
    if (!filterTargetsBlock(filter.target, block, document)) {
      continue;
    }
    const effective = effectiveFilterFor(
      document,
      filter,
      filter.field.datasetId,
      state,
      options.catalog,
    );
    if ("code" in effective) {
      diagnostics.push(effective);
      continue;
    }
    add(effective, "primary");
    add(effective, "reference");
  }
  for (const selection of state.crossFilters) {
    if (selection.sourceBlockId === block.id) {
      continue;
    }
    const effective = effectiveCrossFilterFor(
      document,
      block,
      selection,
      selection.field.datasetId,
    );
    if ("code" in effective) {
      diagnostics.push(
        createDiagnostic(effective.code, effective.path, {
          message: effective.message,
          severity: "warning",
          relatedIds: effective.relatedIds,
        }),
      );
      continue;
    }
    add(effective, "primary");
    add(effective, "reference");
  }
  return Object.freeze({
    primary: Object.freeze([...primary]),
    reference: Object.freeze([...reference]),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function validateFilterRuntimeState(
  document: BoardDocumentV1,
  state: FilterRuntimeState,
  catalog?: BoardValidationCatalog,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const selection of state.crossFilters) {
    const validated = validateCrossFilterSelection(document, selection, catalog);
    if (!validated.ok) {
      diagnostics.push(...validated.diagnostics);
    }
  }
  for (const entry of state.activeValues) {
    const filter = document.filters.find((candidate) => candidate.id === entry.filterId);
    if (filter === undefined) {
      continue;
    }
    const descriptor = documentField(document, filter.field);
    const operator = filter.operator;
    const expected = descriptor?.type;
    const value = entry.value;
    if (
      operator === "isNull" ||
      operator === "isNotNull" ||
      operator === "isTrue" ||
      operator === "isFalse"
    ) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
          `filterState/activeValues/${filter.id}`,
          {
            message: `Filter "${filter.id}" does not accept an active value.`,
            relatedIds: [filter.id],
          },
        ),
      );
      continue;
    }
    if (!valueShapeMatchesOperator(operator, value)) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
          `filterState/activeValues/${filter.id}`,
          {
            message: `The active value for "${filter.id}" does not match operator "${operator}".`,
            relatedIds: [filter.id],
          },
        ),
      );
      continue;
    }
    if (expected !== undefined && !valueMatchesType(value, expected)) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
          `filterState/activeValues/${filter.id}`,
          {
            message: `The active value for "${filter.id}" does not match field type "${expected}".`,
            relatedIds: [filter.id],
          },
        ),
      );
    }
    if (filter.temporal !== undefined) {
      const temporalDiagnostic = temporalTimezoneDiagnostic(
        document,
        filter.field,
        filter.temporal.timezone,
        catalog,
        `filters/${filter.id}/temporal`,
      );
      if (temporalDiagnostic !== null) {
        diagnostics.push(temporalDiagnostic);
      }
    }
  }
  for (const block of document.blocks) {
    if (!isDataConsumingBlock(block)) {
      continue;
    }
    const composition = composeBlockFilters(
      document,
      block,
      state,
      catalog === undefined ? {} : { catalog },
    );
    if (!composition.ok) {
      for (const diagnostic of composition.diagnostics) {
        if (diagnostic.severity === "warning") {
          continue;
        }
        diagnostics.push(
          createDiagnostic(diagnostic.code, diagnostic.path, {
            message: diagnostic.message,
            relatedIds: diagnostic.relatedIds,
            source: "filter-state",
          }),
        );
      }
    }
    if (block.config !== undefined) {
      const comparisonId = (block.config as { readonly comparisonId?: unknown }).comparisonId;
      if (typeof comparisonId === "string") {
        const comparison = document.comparisons?.find((entry) => entry.id === comparisonId);
        if (comparison !== undefined) {
          const sides = composeComparisonFilterSides(
            document,
            block,
            state,
            catalog === undefined ? {} : { catalog },
          );
          for (const diagnostic of sides.diagnostics) {
            if (diagnostic.severity === "warning") {
              continue;
            }
            diagnostics.push(
              createDiagnostic(diagnostic.code, diagnostic.path, {
                message: diagnostic.message,
                relatedIds: diagnostic.relatedIds,
                source: "filter-state",
              }),
            );
          }
        }
      }
    }
  }
  return Object.freeze(diagnostics);
}

export function filterOperatorsForField(
  document: BoardDocumentV1,
  reference: FieldReference,
  catalog?: BoardValidationCatalog,
): readonly FilterOperator[] {
  const descriptor = documentField(document, reference);
  if (descriptor === undefined) {
    return Object.freeze([]);
  }
  const supported = FILTER_OPERATORS_BY_FIELD_TYPE[descriptor.type];
  const declared = providerFieldOperators(catalog, reference);
  if (declared === undefined) {
    return supported;
  }
  return Object.freeze(supported.filter((operator) => declared.includes(operator)));
}

export function filterDefinitionOperators(
  document: BoardDocumentV1,
  filter: FilterDefinition,
  catalog?: BoardValidationCatalog,
): readonly FilterOperator[] {
  let available = filterOperatorsForField(document, filter.field, catalog);
  const restrict = (reference: FieldReference): void => {
    const operators = providerFieldOperators(catalog, reference);
    if (operators !== undefined) {
      available = available.filter((operator) => operators.includes(operator));
    }
  };
  for (const block of document.blocks) {
    if (!isDataConsumingBlock(block) || !filterTargetsBlock(filter.target, block, document)) {
      continue;
    }
    const comparisonId = isPlainObject(block.config)
      ? (block.config as { readonly comparisonId?: unknown }).comparisonId
      : undefined;
    if (typeof comparisonId === "string") {
      const primary = comparisonMappingForField(
        document,
        block,
        filter.field,
        "primary",
        filter.mappings,
      );
      const reference = comparisonMappingForField(
        document,
        block,
        filter.field,
        "reference",
        filter.mappings,
      );
      if (primary !== null) {
        restrict(primary);
      }
      if (reference !== null) {
        restrict(reference);
      }
      continue;
    }
    for (const datasetId of blockDatasetIds(block)) {
      if (filter.field.datasetId === datasetId) {
        restrict(filter.field);
      } else {
        const mapping = mappingForDataset(filter, datasetId);
        if (mapping !== null) {
          restrict(mapping.target);
        }
      }
    }
  }
  return Object.freeze([...available]);
}

export function valueShapeMatchesOperator(
  operator: FilterOperator,
  value: JsonValue | undefined,
): boolean {
  if (
    operator === "isNull" ||
    operator === "isNotNull" ||
    operator === "isTrue" ||
    operator === "isFalse"
  ) {
    return value === undefined;
  }
  if (value === undefined) {
    return false;
  }
  if (operator === "between") {
    return Array.isArray(value) && value.length === 2;
  }
  if (operator === "in" || operator === "notIn") {
    return Array.isArray(value);
  }
  return !Array.isArray(value);
}

export function valueMatchesType(value: JsonValue, type: FieldValueType): boolean {
  const entries = Array.isArray(value) ? value : [value];
  return entries.every((entry) => {
    if (entry === null) {
      return true;
    }
    if (type === "number") {
      return typeof entry === "number" && Number.isFinite(entry);
    }
    if (type === "string") {
      return typeof entry === "string";
    }
    if (type === "boolean") {
      return typeof entry === "boolean";
    }
    if (type === "date") {
      return typeof entry === "string" && isIsoDateString(entry);
    }
    return typeof entry === "string" && isIsoDateTimeString(entry);
  });
}

export function filterStateWithActiveValue(
  state: FilterRuntimeState,
  filterId: string,
  value: JsonValue,
): FilterRuntimeState {
  const activeValues = state.activeValues.filter((entry) => entry.filterId !== filterId);
  activeValues.push({ filterId, value });
  return makeFilterState(activeValues, state.crossFilters);
}

export function filterStateWithoutActiveValues(
  state: FilterRuntimeState,
  filterIds: ReadonlySet<string>,
): FilterRuntimeState {
  return makeFilterState(
    state.activeValues.filter((entry) => !filterIds.has(entry.filterId)),
    state.crossFilters,
  );
}

export function filterStateWithCrossFilter(
  state: FilterRuntimeState,
  selection: CrossFilterSelection,
): FilterRuntimeState {
  const existing = state.crossFilters.filter(
    (candidate) => crossFilterKey(candidate) !== crossFilterKey(selection),
  );
  existing.push(selection);
  return makeFilterState(state.activeValues, existing);
}

export function filterStateWithoutCrossFilter(
  state: FilterRuntimeState,
  selectionId: string,
): FilterRuntimeState {
  return makeFilterState(
    state.activeValues,
    state.crossFilters.filter((candidate) => candidate.id !== selectionId),
  );
}

export function pruneFilterState(
  document: BoardDocumentV1,
  state: FilterRuntimeState,
): FilterRuntimeState {
  const filterIds = new Set(document.filters.map((filter) => filter.id));
  const blockIds = new Set(document.blocks.map((block) => block.id));
  const noValueFilterIds = new Set(
    document.filters
      .filter(
        (filter) =>
          filter.operator === "isNull" ||
          filter.operator === "isNotNull" ||
          filter.operator === "isTrue" ||
          filter.operator === "isFalse",
      )
      .map((filter) => filter.id),
  );
  return makeFilterState(
    state.activeValues.filter(
      (entry) => filterIds.has(entry.filterId) && !noValueFilterIds.has(entry.filterId),
    ),
    state.crossFilters.filter((entry) => blockIds.has(entry.sourceBlockId)),
  );
}

export function isFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === "string" && (FILTER_OPERATORS as readonly string[]).includes(value);
}

function parseFieldReference(value: unknown): FieldReference | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const datasetId = Object.hasOwn(value, "datasetId") ? value.datasetId : undefined;
  const fieldId = Object.hasOwn(value, "fieldId") ? value.fieldId : undefined;
  if (typeof datasetId !== "string" || datasetId.trim() === "") {
    return null;
  }
  if (typeof fieldId !== "string" || fieldId.trim() === "") {
    return null;
  }
  return Object.freeze({ datasetId, fieldId });
}

function parseTemporal(value: unknown): FilterTemporalConfig | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const timezone = Object.hasOwn(value, "timezone") ? value.timezone : undefined;
  const bounds = Object.hasOwn(value, "bounds") ? value.bounds : undefined;
  if (typeof timezone !== "string" || timezone.trim() === "" || !isValidTimeZone(timezone)) {
    return null;
  }
  if (bounds !== "inclusive" && bounds !== "exclusive" && bounds !== "half-open") {
    return null;
  }
  return Object.freeze({ timezone, bounds });
}

function parseMappings(value: unknown): readonly FilterFieldMapping[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const mappings: FilterFieldMapping[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      return null;
    }
    const source = parseFieldReference(Object.hasOwn(entry, "source") ? entry.source : undefined);
    const target = parseFieldReference(Object.hasOwn(entry, "target") ? entry.target : undefined);
    if (source === null || target === null) {
      return null;
    }
    mappings.push(Object.freeze({ source, target }));
  }
  return Object.freeze(mappings);
}

export function validateCrossFilterSelection(
  document: BoardDocumentV1,
  input: CrossFilterSelectionInput,
  catalog?: BoardValidationCatalog,
): Result<CrossFilterSelection> {
  const path = "filterState/crossFilters";
  const diagnostics: Diagnostic[] = [];
  if (input === null || typeof input !== "object") {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, path));
    return fail(diagnostics);
  }
  if (typeof input.sourceBlockId !== "string" || input.sourceBlockId.trim() === "") {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/sourceBlockId`),
    );
  }
  const block = document.blocks.find((entry) => entry.id === input.sourceBlockId);
  if (block === undefined) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/sourceBlockId`, {
        relatedIds: [input.sourceBlockId],
      }),
    );
  }
  if (!isFilterOperator(input.operator)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/operator`));
  }
  const field = parseFieldReference(input.field);
  if (field === null) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/field`));
  }
  const temporal = input.temporal === undefined ? undefined : parseTemporal(input.temporal);
  if (input.temporal !== undefined && temporal === null) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/temporal`));
  }
  const mappings = parseMappings(input.mappings);
  if (mappings === null) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/mappings`));
  }
  if (field !== null) {
    const descriptor = documentField(document, field);
    if (descriptor === undefined) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/field`, {
          relatedIds: [field.datasetId, field.fieldId],
        }),
      );
    } else {
      if (!FILTER_OPERATORS_BY_FIELD_TYPE[descriptor.type].includes(input.operator)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/operator`, {
            message: `Operator "${input.operator}" is not compatible with field type "${descriptor.type}".`,
          }),
        );
      }
      if (!isJsonValue(input.value)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/value`, {
            message: "The selection value must be a plain JSON value.",
          }),
        );
      }
      if (!valueMatchesType(input.value, descriptor.type)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/value`, {
            message: `The selection value does not match field type "${descriptor.type}".`,
          }),
        );
      }
      if (
        input.operator === "isNull" ||
        input.operator === "isNotNull" ||
        input.operator === "isTrue" ||
        input.operator === "isFalse"
      ) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/operator`, {
            message: "A cross-filter selection requires an operator with a value.",
          }),
        );
      } else if (!valueShapeMatchesOperator(input.operator, input.value)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/value`, {
            message: `The selection value does not match operator "${input.operator}".`,
          }),
        );
      }
      const temporalOperator =
        input.operator === "before" ||
        input.operator === "after" ||
        input.operator === "onOrBefore" ||
        input.operator === "onOrAfter" ||
        input.operator === "between";
      const temporalField = descriptor.type === "date" || descriptor.type === "datetime";
      if (temporalField && temporalOperator && (temporal === undefined || temporal === null)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/temporal`, {
            message: "A temporal selection must declare its timezone and boundary rule.",
          }),
        );
      }
      if (!temporalField && temporal !== undefined && temporal !== null) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/temporal`, {
            message: "A temporal selection window is only valid for date or datetime fields.",
          }),
        );
      }
      if (temporal !== undefined && temporal !== null) {
        const temporalDiagnostic = temporalTimezoneDiagnostic(
          document,
          field,
          temporal.timezone,
          catalog,
          `${path}/temporal`,
        );
        if (temporalDiagnostic !== null) {
          diagnostics.push(temporalDiagnostic);
        }
      }
    }
  }
  if (mappings !== undefined && mappings !== null && field !== null) {
    for (const mapping of mappings) {
      if (!fieldReferenceEquals(mapping.source, field)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE, `${path}/mappings`, {
            message: "A cross-filter mapping source must be the selection field.",
          }),
        );
        continue;
      }
      const source = documentField(document, field);
      const target = documentField(document, mapping.target);
      const reason = fieldCompatibilityReason(source, target);
      if (reason !== null) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE, `${path}/mappings`, {
            message: `The cross-filter mapping is incompatible (${reason}).`,
            relatedIds: [mapping.target.datasetId, mapping.target.fieldId],
          }),
        );
      }
    }
  }
  if (diagnostics.length > 0 || field === null || temporal === null || mappings === null) {
    return fail(diagnostics);
  }
  const id =
    typeof input.id === "string" && input.id.trim() !== ""
      ? input.id
      : `cross:${input.sourceBlockId}:${field.datasetId}:${field.fieldId}:${JSON.stringify(input.value)}`;
  return ok(
    Object.freeze({
      id,
      sourceBlockId: input.sourceBlockId,
      field,
      operator: input.operator,
      value: input.value,
      ...(temporal === undefined ? {} : { temporal }),
      ...(mappings === undefined ? {} : { mappings }),
      ...(input.label === undefined ? {} : { label: input.label }),
    }),
  );
}

export function parseFilterRuntimeState(value: unknown): Result<FilterRuntimeState> {
  const path = "filterState";
  if (!isPlainObject(value)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, path)]);
  }
  const activeValuesValue = Object.hasOwn(value, "activeValues") ? value.activeValues : [];
  const crossFiltersValue = Object.hasOwn(value, "crossFilters") ? value.crossFilters : [];
  if (!Array.isArray(activeValuesValue)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/activeValues`)]);
  }
  if (!Array.isArray(crossFiltersValue)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/crossFilters`)]);
  }
  const activeValues: FilterActiveValue[] = [];
  for (let index = 0; index < activeValuesValue.length; index += 1) {
    const entry = activeValuesValue[index];
    if (!isPlainObject(entry)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/activeValues/${index}`),
      ]);
    }
    const filterId = Object.hasOwn(entry, "filterId") ? entry.filterId : undefined;
    if (typeof filterId !== "string" || filterId.trim() === "") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/activeValues/${index}`),
      ]);
    }
    const value = Object.hasOwn(entry, "value") ? entry.value : null;
    if (!isJsonValue(value)) {
      return fail([
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
          `${path}/activeValues/${index}/value`,
        ),
      ]);
    }
    activeValues.push(Object.freeze({ filterId, value }));
  }
  const crossFilters: CrossFilterSelection[] = [];
  for (let index = 0; index < crossFiltersValue.length; index += 1) {
    const entry = crossFiltersValue[index];
    if (!isPlainObject(entry)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/crossFilters/${index}`),
      ]);
    }
    const sourceBlockId = Object.hasOwn(entry, "sourceBlockId") ? entry.sourceBlockId : undefined;
    const field = parseFieldReference(Object.hasOwn(entry, "field") ? entry.field : undefined);
    const operator = Object.hasOwn(entry, "operator") ? entry.operator : undefined;
    const temporal = entry.temporal === undefined ? undefined : parseTemporal(entry.temporal);
    const mappings = parseMappings(entry.mappings);
    const id = Object.hasOwn(entry, "id") ? entry.id : undefined;
    if (
      typeof sourceBlockId !== "string" ||
      field === null ||
      !isFilterOperator(operator) ||
      temporal === null ||
      mappings === null
    ) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.FILTER_STATE_INVALID, `${path}/crossFilters/${index}`),
      ]);
    }
    const value = Object.hasOwn(entry, "value") ? entry.value : null;
    if (!isJsonValue(value)) {
      return fail([
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
          `${path}/crossFilters/${index}/value`,
        ),
      ]);
    }
    crossFilters.push(
      Object.freeze({
        id:
          typeof id === "string" && id.trim() !== ""
            ? id
            : `cross:${sourceBlockId}:${field.datasetId}:${field.fieldId}`,
        sourceBlockId,
        field,
        operator,
        value,
        ...(temporal === undefined ? {} : { temporal }),
        ...(mappings === undefined ? {} : { mappings }),
        ...(typeof entry.label === "string" ? { label: entry.label } : {}),
      }),
    );
  }
  return ok(makeFilterState(activeValues, crossFilters));
}
