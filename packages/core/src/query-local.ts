import {
  validateDatasetDescriptor,
  type DataFieldDescriptor,
  type DatasetDescriptor,
  type DatasetProvider,
  type DatasetProviderContext,
  type DatasetQueryResult,
  type QueryAggregation,
  type QueryCounts,
  type QueryFailure,
  type QueryFilter,
  type QueryGrouping,
  type QueryRequest,
  type QueryResultField,
  type QueryResultRow,
  type QuerySuccess,
  type TemporalRepresentation,
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
import { cloneJson, deepFreeze, isPlainObject, validateJsonValue, type JsonValue } from "./json.js";
import {
  isIsoDateString,
  isIsoDateTimeString,
  isRecord,
  nonEmptyString,
  own,
} from "./board-validation-shared.js";
import { buildQueryPlan, type QueryPlan } from "./query-planning.js";
import {
  bucketTemporalValue,
  compareTemporalValues,
  temporalInstant,
  withinTemporalWindow,
} from "./temporal.js";

export interface LocalDatasetSource {
  readonly descriptor: DatasetDescriptor;
  readonly rows: readonly Readonly<Record<string, JsonValue>>[];
}

export interface LocalDatasetProviderOptions {
  readonly providerId?: string;
  readonly datasets: readonly LocalDatasetSource[];
}

interface StoredDataset {
  readonly descriptor: DatasetDescriptor;
  readonly rows: readonly QueryResultRow[];
}

interface QueryGroup {
  readonly values: readonly JsonValue[];
  readonly rows: readonly QueryResultRow[];
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readRowValue(row: QueryResultRow, fieldId: string): JsonValue {
  return Object.hasOwn(row, fieldId) ? (row[fieldId] as JsonValue) : null;
}

function representationOf(
  descriptor: DatasetDescriptor,
  field: DataFieldDescriptor,
): TemporalRepresentation {
  return field.temporalRepresentation ?? descriptor.temporalRepresentation;
}

function valueMatchesField(
  value: JsonValue,
  field: DataFieldDescriptor,
  descriptor: DatasetDescriptor,
): boolean {
  if (value === null) {
    return field.nullable;
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (field.type === "string") {
    return typeof value === "string";
  }
  if (field.type === "boolean") {
    return typeof value === "boolean";
  }
  const representation = representationOf(descriptor, field);
  if (representation !== "iso8601-offset") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (field.type === "date") {
    return (
      typeof value === "string" &&
      isIsoDateString(value) &&
      temporalInstant(value, "date", field.timezone ?? descriptor.timezone, "iso8601-offset") !==
        null
    );
  }
  return typeof value === "string" && isIsoDateTimeString(value);
}

function validateRows(
  descriptor: DatasetDescriptor,
  rows: unknown,
  diagnostics: Diagnostic[],
  path: string,
): readonly QueryResultRow[] | null {
  if (!Array.isArray(rows)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, path));
    return null;
  }
  const json = validateJsonValue(rows);
  if (!json.valid) {
    for (const issue of json.issues) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}${issue.path}`, {
          message: issue.message,
        }),
      );
    }
    return null;
  }
  const fieldsById = new Map(descriptor.fields.map((field) => [field.id, field]));
  const normalized: QueryResultRow[] = [];
  rows.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}/${index}`));
      return;
    }
    for (const key of Object.getOwnPropertyNames(entry)) {
      const field = fieldsById.get(key);
      if (!field) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}/${index}/${key}`, {
            message: `Row field "${key}" is not declared by the dataset.`,
          }),
        );
        continue;
      }
      const value = entry[key] as JsonValue;
      if (!valueMatchesField(value, field, descriptor)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}/${index}/${key}`),
        );
        continue;
      }
      if (field.allowedValues !== undefined && value !== null) {
        if (!field.allowedValues.includes(value as string | number | boolean)) {
          diagnostics.push(
            createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}/${index}/${key}`, {
              message: `Value is not part of the declared allowed values for "${field.id}".`,
            }),
          );
        }
      }
      if (
        field.range !== undefined &&
        typeof value === "number" &&
        ((field.range.min !== undefined && value < field.range.min) ||
          (field.range.max !== undefined && value > field.range.max))
      ) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}/${index}/${key}`),
        );
      }
    }
    for (const field of descriptor.fields) {
      if (!field.nullable && !Object.hasOwn(entry, field.id)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_ROW_INVALID, `${path}/${index}/${field.id}`, {
            message: `A non-nullable field "${field.id}" is missing from this row.`,
          }),
        );
      }
    }
    if (diagnostics.length > 0) {
      return;
    }
    normalized.push(deepFreeze(cloneJson(entry as JsonValue) as QueryResultRow));
  });
  if (diagnostics.length > 0) {
    return null;
  }
  return Object.freeze(normalized);
}

function filterMatches(
  value: JsonValue,
  filter: QueryFilter,
  field: DataFieldDescriptor,
  descriptor: DatasetDescriptor,
): boolean {
  if (filter.operator === "isNull") {
    return value === null;
  }
  if (filter.operator === "isNotNull") {
    return value !== null;
  }
  if (filter.operator === "isTrue") {
    return value === true;
  }
  if (filter.operator === "isFalse") {
    return value === false;
  }
  if (value === null) {
    return false;
  }
  const representation = representationOf(descriptor, field);
  const timezone = filter.timezone ?? field.timezone ?? descriptor.timezone;
  if (field.type === "date" || field.type === "datetime") {
    if (filter.value === undefined) {
      return false;
    }
    if (filter.operator === "between") {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        return false;
      }
      const start = filter.value[0] as string;
      const end = filter.value[1] as string;
      return withinTemporalWindow(
        value,
        start,
        end,
        field.type,
        timezone,
        representation,
        filter.bounds ?? "inclusive",
      );
    }
    if (filter.operator === "in" || filter.operator === "notIn") {
      if (!Array.isArray(filter.value)) {
        return false;
      }
      const matched = filter.value.some(
        (entry) => compareTemporalValues(value, entry, field.type, timezone, representation) === 0,
      );
      return filter.operator === "in" ? matched : !matched;
    }
    const comparison = compareTemporalValues(
      value,
      filter.value,
      field.type,
      timezone,
      representation,
    );
    if (comparison === null) {
      return false;
    }
    if (filter.operator === "equals") {
      return comparison === 0;
    }
    if (filter.operator === "notEquals") {
      return comparison !== 0;
    }
    if (filter.operator === "before") {
      return comparison < 0;
    }
    if (filter.operator === "after") {
      return comparison > 0;
    }
    if (filter.operator === "onOrBefore") {
      return comparison <= 0;
    }
    if (filter.operator === "onOrAfter") {
      return comparison >= 0;
    }
    return false;
  }
  if (filter.operator === "in" || filter.operator === "notIn") {
    if (!Array.isArray(filter.value)) {
      return false;
    }
    const matched = filter.value.some((entry) => entry === value);
    return filter.operator === "in" ? matched : !matched;
  }
  if (filter.operator === "contains") {
    return typeof value === "string" && value.includes(String(filter.value ?? ""));
  }
  if (filter.operator === "between") {
    if (!Array.isArray(filter.value) || filter.value.length !== 2) {
      return false;
    }
    const start = filter.value[0];
    const end = filter.value[1];
    return (
      typeof value === "number" &&
      typeof start === "number" &&
      typeof end === "number" &&
      value >= start &&
      value <= end
    );
  }
  if (filter.operator === "equals") {
    return value === filter.value;
  }
  if (filter.operator === "notEquals") {
    return value !== filter.value;
  }
  if (typeof value !== "number" || typeof filter.value !== "number") {
    return false;
  }
  if (filter.operator === "greaterThan") {
    return value > filter.value;
  }
  if (filter.operator === "greaterThanOrEqual") {
    return value >= filter.value;
  }
  if (filter.operator === "lessThan") {
    return value < filter.value;
  }
  if (filter.operator === "lessThanOrEqual") {
    return value <= filter.value;
  }
  return false;
}

function projectRow(row: QueryResultRow, fields: readonly string[]): QueryResultRow {
  const projected: Record<string, JsonValue> = {};
  for (const field of fields) {
    Object.defineProperty(projected, field, {
      value: readRowValue(row, field),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(projected);
}

function groupValue(
  row: QueryResultRow,
  grouping: QueryGrouping,
  field: DataFieldDescriptor,
  descriptor: DatasetDescriptor,
): JsonValue {
  const raw = readRowValue(row, grouping.fieldId);
  if (grouping.bucket === undefined || grouping.bucket.grain === "instant" || raw === null) {
    return raw;
  }
  const bucketed = bucketTemporalValue(
    raw,
    field.type,
    grouping.bucket.timezone,
    representationOf(descriptor, field),
    grouping.bucket.grain,
    grouping.bucket.weekStartsOn,
  );
  return bucketed;
}

function compareValues(
  left: JsonValue,
  right: JsonValue,
  field:
    | {
        readonly type: QueryResultField["type"];
        readonly timezone?: string;
        readonly temporalRepresentation?: QueryResultField["temporalRepresentation"];
      }
    | undefined,
  descriptor: DatasetDescriptor,
): number {
  if (field?.type === "date" || field?.type === "datetime") {
    const comparison = compareTemporalValues(
      left,
      right,
      field.type,
      field.timezone ?? descriptor.timezone,
      field.temporalRepresentation ?? descriptor.temporalRepresentation,
    );
    if (comparison !== null) {
      return comparison;
    }
  }
  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1;
  }
  const leftText = typeof left === "string" ? left : JSON.stringify(left);
  const rightText = typeof right === "string" ? right : JSON.stringify(right);
  return lexicalCompare(leftText, rightText);
}

function aggregateValue(
  aggregation: QueryAggregation,
  group: QueryGroup,
  descriptor: DatasetDescriptor,
): JsonValue {
  const field =
    aggregation.fieldId === undefined
      ? undefined
      : descriptor.fields.find((entry) => entry.id === aggregation.fieldId);
  const values =
    aggregation.fieldId === undefined
      ? []
      : group.rows.map((row) => readRowValue(row, aggregation.fieldId as string));
  const nonNull = values.filter((value): value is JsonValue => value !== null);
  if (aggregation.type === "count") {
    return aggregation.fieldId === undefined ? group.rows.length : nonNull.length;
  }
  if (aggregation.type === "countDistinct") {
    return new Set(nonNull.map((value) => JSON.stringify(value))).size;
  }
  if (nonNull.length === 0) {
    return null;
  }
  if (aggregation.type === "mode") {
    const counts = new Map<string, { value: JsonValue; count: number }>();
    for (const value of nonNull) {
      const key = JSON.stringify(value);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { value, count: 1 });
      }
    }
    const ranked = [...counts.values()].sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return lexicalCompare(JSON.stringify(left.value), JSON.stringify(right.value));
    });
    return ranked[0]?.value ?? null;
  }
  if (aggregation.type === "min" || aggregation.type === "max") {
    const sorted = [...nonNull].sort((left, right) =>
      compareValues(left, right, field, descriptor),
    );
    return aggregation.type === "min" ? (sorted[0] ?? null) : (sorted[sorted.length - 1] ?? null);
  }
  const numbers = nonNull.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (numbers.length === 0) {
    return null;
  }
  if (aggregation.type === "sum") {
    return numbers.reduce((total, value) => total + value, 0);
  }
  if (aggregation.type === "average") {
    return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  }
  if (aggregation.type === "median") {
    const sorted = [...numbers].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
      return sorted[middle] ?? null;
    }
    const lower = sorted[middle - 1];
    const upper = sorted[middle];
    return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
  }
  return null;
}

function computeNullCounts(
  descriptor: DatasetDescriptor,
  rows: readonly QueryResultRow[],
  aggregations: readonly QueryAggregation[],
): Readonly<Record<string, number>> {
  const fieldIds = new Set(
    descriptor.fields.filter((field) => field.role === "measure").map((field) => field.id),
  );
  for (const aggregation of aggregations) {
    if (aggregation.fieldId !== undefined) {
      fieldIds.add(aggregation.fieldId);
    }
  }
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const fieldId of [...fieldIds].sort(lexicalCompare)) {
    let count = 0;
    for (const row of rows) {
      if (readRowValue(row, fieldId) === null) {
        count += 1;
      }
    }
    Object.defineProperty(counts, fieldId, {
      value: count,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(counts);
}

function executePlan(
  plan: QueryPlan,
  rows: readonly QueryResultRow[],
  requestId: string,
): QuerySuccess {
  const request = plan.request;
  const descriptor = plan.dataset;
  const fieldsById = new Map(descriptor.fields.map((field) => [field.id, field]));
  const outputFieldsById = new Map(plan.outputFields.map((field) => [field.fieldId, field]));
  let filtered = rows;
  if (request.filters.length > 0) {
    filtered = rows.filter((row) =>
      request.filters.every((filter) => {
        const field = fieldsById.get(filter.fieldId);
        return field
          ? filterMatches(readRowValue(row, filter.fieldId), filter, field, descriptor)
          : false;
      }),
    );
  }
  if (request.timeWindow) {
    const timeWindow = request.timeWindow;
    const field = fieldsById.get(timeWindow.fieldId);
    if (field) {
      filtered = filtered.filter((row) => {
        const value = readRowValue(row, timeWindow.fieldId);
        if (value === null) {
          return false;
        }
        const valueInstant = temporalInstant(
          value,
          field.type,
          timeWindow.timezone,
          representationOf(descriptor, field),
        );
        const startInstant = temporalInstant(
          timeWindow.start,
          timeWindow.start.includes("T") ? "datetime" : "date",
          timeWindow.timezone,
          "iso8601-offset",
        );
        const endInstant = temporalInstant(
          timeWindow.end,
          timeWindow.end.includes("T") ? "datetime" : "date",
          timeWindow.timezone,
          "iso8601-offset",
        );
        if (valueInstant === null || startInstant === null || endInstant === null) {
          return false;
        }
        if (timeWindow.bounds === "inclusive") {
          return valueInstant >= startInstant && valueInstant <= endInstant;
        }
        if (timeWindow.bounds === "exclusive") {
          return valueInstant > startInstant && valueInstant < endInstant;
        }
        return valueInstant >= startInstant && valueInstant < endInstant;
      });
    }
  }
  const filteredRows = filtered.length;
  let output: QueryResultRow[];
  if (request.groupBy.length === 0 && request.aggregations.length === 0) {
    output = filtered.map((row) => projectRow(row, request.fields));
  } else {
    const groups = new Map<string, QueryGroup>();
    for (const row of filtered) {
      const values = request.groupBy.map((grouping) => {
        const field = fieldsById.get(grouping.fieldId);
        return field ? groupValue(row, grouping, field, descriptor) : null;
      });
      const key = JSON.stringify(values);
      const existing = groups.get(key);
      if (existing) {
        (existing.rows as QueryResultRow[]).push(row);
      } else {
        groups.set(key, { values, rows: [row] });
      }
    }
    output = [...groups.values()].map((group) => {
      const record: Record<string, JsonValue> = {};
      request.groupBy.forEach((grouping, index) => {
        Object.defineProperty(record, grouping.fieldId, {
          value: group.values[index] ?? null,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      });
      for (const aggregation of request.aggregations) {
        Object.defineProperty(record, aggregation.output, {
          value: aggregateValue(aggregation, group, descriptor),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return Object.freeze(record);
    });
  }
  if (request.orderBy.length > 0) {
    output = [...output].sort((left, right) => {
      for (const order of request.orderBy) {
        const leftValue = readRowValue(left, order.key);
        const rightValue = readRowValue(right, order.key);
        if (leftValue === null && rightValue === null) {
          continue;
        }
        if (leftValue === null) {
          return 1;
        }
        if (rightValue === null) {
          return -1;
        }
        const field = outputFieldsById.get(order.key);
        const comparison = compareValues(leftValue, rightValue, field, descriptor);
        if (comparison !== 0) {
          return order.direction === "ascending" ? comparison : -comparison;
        }
      }
      return 0;
    });
  }
  let complete = true;
  const diagnostics: Diagnostic[] = [];
  if (request.limit !== undefined) {
    output = output.slice(0, request.limit);
  }
  const maxResultSize = descriptor.capabilities.maxResultSize;
  if (maxResultSize !== null && output.length > maxResultSize) {
    output = output.slice(0, maxResultSize);
    complete = false;
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_TRUNCATED, "result/rows", {
        severity: "warning",
        hint: `The provider returned at most ${maxResultSize} rows.`,
      }),
    );
  }
  const nullCounts = computeNullCounts(descriptor, filtered, request.aggregations);
  const counts: QueryCounts = Object.freeze({
    returnedRows: output.length,
    totalRows: rows.length,
    filteredRows,
    nullCounts,
  });
  return Object.freeze({
    ok: true,
    requestId,
    datasetId: descriptor.id,
    datasetVersion: descriptor.version,
    ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
    fields: plan.outputFields,
    rows: Object.freeze(output.map((row) => deepFreeze(row))),
    counts,
    complete,
    diagnostics: Object.freeze(diagnostics),
  });
}

function failureFrom(
  context: DatasetProviderContext,
  descriptor: DatasetDescriptor | undefined,
  request: QueryRequest | undefined,
  diagnostics: readonly Diagnostic[],
): QueryFailure {
  return Object.freeze({
    ok: false,
    requestId: context.requestId,
    datasetId: descriptor?.id ?? request?.datasetId ?? "",
    datasetVersion: descriptor?.version ?? request?.datasetVersion ?? "",
    ...(request?.sliceId === undefined ? {} : { sliceId: request.sliceId }),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function createLocalDatasetProvider(
  options: LocalDatasetProviderOptions,
): Result<DatasetProvider> {
  if (!isRecord(options)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "options", {
        message: "Local provider options must be an object.",
      }),
    ]);
  }
  const providerId = own(options, "providerId");
  if (providerId !== undefined && !nonEmptyString(providerId)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.MISSING_ID, "providerId")]);
  }
  const datasets = own(options, "datasets");
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "datasets", {
        message: "A local provider requires at least one dataset source.",
      }),
    ]);
  }
  const diagnostics: Diagnostic[] = [];
  const stored = new Map<string, StoredDataset>();
  datasets.forEach((entry, index) => {
    const path = `datasets/${index}`;
    if (!isRecord(entry)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, path));
      return;
    }
    const descriptorValue = own(entry, "descriptor");
    const validation = validateDatasetDescriptor(descriptorValue);
    diagnostics.push(...validation.diagnostics);
    if (!validation.valid || !validation.descriptor) {
      return;
    }
    const descriptor = validation.descriptor;
    if (stored.has(descriptor.id)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.DUPLICATE_ID, `${path}/descriptor/id`, {
          relatedIds: [descriptor.id],
        }),
      );
      return;
    }
    const rows = validateRows(descriptor, own(entry, "rows"), diagnostics, `${path}/rows`);
    if (!rows) {
      return;
    }
    stored.set(descriptor.id, Object.freeze({ descriptor, rows }));
  });
  if (hasError(diagnostics) || diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const datasetsById = new Map(stored);
  const provider: DatasetProvider = Object.freeze({
    providerId: typeof providerId === "string" ? providerId : "local",
    listDatasetIds(): readonly string[] {
      return Object.freeze([...datasetsById.keys()].sort(lexicalCompare));
    },
    getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined {
      return datasetsById.get(datasetId)?.descriptor;
    },
    query(request: QueryRequest, context: DatasetProviderContext): DatasetQueryResult {
      if (context.signal.aborted) {
        return failureFrom(context, undefined, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_CANCELLED, "query", {
            severity: "warning",
            message: "The query was cancelled.",
          }),
        ]);
      }
      const storedDataset = datasetsById.get(request.datasetId);
      if (!storedDataset) {
        return failureFrom(context, undefined, request, [
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "datasetId", {
            relatedIds: [request.datasetId],
          }),
        ]);
      }
      const planned = buildQueryPlan(storedDataset.descriptor, request, {
        providerId: typeof providerId === "string" ? providerId : "local",
      });
      if (!planned.ok) {
        return failureFrom(context, storedDataset.descriptor, request, planned.diagnostics);
      }
      if (planned.value.request.cursor !== undefined) {
        return failureFrom(context, storedDataset.descriptor, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "cursor", {
            message: "The local provider does not implement cursor paging.",
          }),
        ]);
      }
      if (context.signal.aborted) {
        return failureFrom(context, storedDataset.descriptor, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_CANCELLED, "query", {
            severity: "warning",
            message: "The query was cancelled.",
          }),
        ]);
      }
      try {
        return executePlan(planned.value, storedDataset.rows, context.requestId);
      } catch {
        return failureFrom(context, storedDataset.descriptor, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "query", {
            message: "The local provider could not execute the query.",
          }),
        ]);
      }
    },
  });
  return ok(provider);
}
