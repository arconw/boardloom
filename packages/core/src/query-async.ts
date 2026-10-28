import {
  validateDatasetDescriptor,
  type DatasetDescriptor,
  type DatasetProvider,
  type DatasetProviderContext,
  type DatasetQueryResult,
  type QueryCounts,
  type QueryFailure,
  type QueryRequest,
  type QueryResultField,
  type QueryResultRow,
  type QuerySuccess,
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
import { isRecord, nonEmptyString, own } from "./board-validation-shared.js";
import { buildQueryPlan, queryFilterKey, type QueryPlan } from "./query-planning.js";
import { admitProviderResult } from "./query-result.js";
import type { JsonValue } from "./json.js";

export interface AsyncDatasetQueryInput {
  readonly request: QueryRequest;
  readonly descriptor: DatasetDescriptor;
  readonly context: DatasetProviderContext;
}

export interface AsyncDatasetQueryApplied {
  readonly filters?: readonly string[];
  readonly groupBy?: readonly string[];
  readonly aggregations?: readonly string[];
  readonly timeWindow?: boolean;
  readonly comparisonInput?: boolean;
}

export interface AsyncDatasetQueryOutput {
  readonly rows: readonly Readonly<Record<string, JsonValue>>[];
  readonly fields?: readonly QueryResultField[];
  readonly counts?: QueryCounts;
  readonly diagnostics?: readonly Diagnostic[];
  readonly complete?: boolean;
  readonly nextCursor?: string;
  readonly applied?: AsyncDatasetQueryApplied;
}

export interface AsyncDatasetProviderOptions {
  readonly providerId: string;
  readonly datasets: readonly DatasetDescriptor[];
  readonly query: (
    input: AsyncDatasetQueryInput,
  ) => AsyncDatasetQueryOutput | Promise<AsyncDatasetQueryOutput>;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readRowValue(row: Readonly<Record<string, JsonValue>>, fieldId: string): JsonValue {
  return Object.hasOwn(row, fieldId) ? (row[fieldId] as JsonValue) : null;
}

function deriveNullCounts(
  plan: QueryPlan,
  rows: readonly QueryResultRow[],
): Readonly<Record<string, number>> {
  const fieldIds = new Set(
    plan.request.fields.filter(
      (fieldId) => plan.dataset.fields.find((field) => field.id === fieldId)?.role === "measure",
    ),
  );
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

function deriveCounts(plan: QueryPlan, rows: readonly QueryResultRow[]): QueryCounts {
  return Object.freeze({
    returnedRows: rows.length,
    totalRows: null,
    filteredRows: rows.length,
    nullCounts: deriveNullCounts(plan, rows),
  });
}

function failureFrom(
  context: DatasetProviderContext,
  plan: QueryPlan | undefined,
  descriptor: DatasetDescriptor | undefined,
  request: QueryRequest | undefined,
  diagnostics: readonly Diagnostic[],
): QueryFailure {
  return Object.freeze({
    ok: false,
    requestId: context.requestId,
    datasetId: plan?.dataset.id ?? descriptor?.id ?? request?.datasetId ?? "",
    datasetVersion: plan?.dataset.version ?? descriptor?.version ?? request?.datasetVersion ?? "",
    ...(plan?.request.sliceId === undefined
      ? request?.sliceId === undefined
        ? {}
        : { sliceId: request.sliceId }
      : { sliceId: plan.request.sliceId }),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

function appliedValues(value: unknown): readonly string[] | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return null;
  }
  return Object.freeze([...value]);
}

function verifyApplied(plan: QueryPlan, applied: unknown): readonly Diagnostic[] {
  const request = plan.request;
  const filterKeys = request.filters.map(queryFilterKey);
  const aggregationKeys = request.aggregations.map((aggregation) => aggregation.output);
  const groupKeys = request.groupBy.map((grouping) => grouping.fieldId);
  if (
    filterKeys.length === 0 &&
    aggregationKeys.length === 0 &&
    groupKeys.length === 0 &&
    request.timeWindow === undefined &&
    request.comparisonInput === undefined
  ) {
    return Object.freeze([]);
  }
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(applied)) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED, "result/applied", {
        message: "The async provider did not declare which query operations it applied.",
      }),
    );
    return Object.freeze(diagnostics);
  }
  const filters = appliedValues(own(applied, "filters"));
  const groupBy = appliedValues(own(applied, "groupBy"));
  const aggregations = appliedValues(own(applied, "aggregations"));
  filterKeys.forEach((key, index) => {
    if (!filters?.includes(key)) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED,
          `result/applied/filters/${index}`,
          {
            message: "The async provider did not apply a requested filter.",
            relatedIds: [request.filters[index]?.fieldId ?? key],
          },
        ),
      );
    }
  });
  groupKeys.forEach((key, index) => {
    if (!groupBy?.includes(key)) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED,
          `result/applied/groupBy/${index}`,
          { message: "The async provider did not apply a requested grouping.", relatedIds: [key] },
        ),
      );
    }
  });
  aggregationKeys.forEach((key, index) => {
    if (!aggregations?.includes(key)) {
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED,
          `result/applied/aggregations/${index}`,
          {
            message: "The async provider did not apply a requested aggregation.",
            relatedIds: [key],
          },
        ),
      );
    }
  });
  if (request.timeWindow !== undefined && own(applied, "timeWindow") !== true) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED, "result/applied/timeWindow", {
        message: "The async provider did not apply the requested time window.",
        relatedIds: [request.timeWindow.fieldId],
      }),
    );
  }
  if (request.comparisonInput !== undefined && own(applied, "comparisonInput") !== true) {
    diagnostics.push(
      createDiagnostic(
        DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED,
        "result/applied/comparisonInput",
        { message: "The async provider did not apply the requested comparison input." },
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function successFrom(
  plan: QueryPlan,
  context: DatasetProviderContext,
  output: AsyncDatasetQueryOutput,
):
  | { readonly ok: true; readonly value: QuerySuccess }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  if (!Array.isArray(output.rows)) {
    return Object.freeze({
      ok: false as const,
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/rows"),
      ]),
    });
  }
  const rows = output.rows;
  const groupedOrAggregated =
    plan.request.groupBy.length > 0 || plan.request.aggregations.length > 0;
  if (groupedOrAggregated && output.counts === undefined) {
    return Object.freeze({
      ok: false as const,
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/counts", {
          message: "An async grouped or aggregated result must provide counts.",
        }),
      ]),
    });
  }
  const fields = output.fields ?? plan.outputFields;
  const counts = output.counts ?? deriveCounts(plan, rows);
  const nextCursor = output.nextCursor;
  const complete = output.complete ?? nextCursor === undefined;
  const diagnostics = output.diagnostics ?? [];
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      ok: true as const,
      requestId: context.requestId,
      datasetId: plan.dataset.id,
      datasetVersion: plan.dataset.version,
      ...(plan.request.sliceId === undefined ? {} : { sliceId: plan.request.sliceId }),
      fields,
      rows,
      counts,
      complete,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      diagnostics: Object.freeze([...diagnostics]),
    }),
  });
}

export function createAsyncDatasetProvider(
  options: AsyncDatasetProviderOptions,
): Result<DatasetProvider> {
  if (!isRecord(options)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "options", {
        message: "Async provider options must be an object.",
      }),
    ]);
  }
  const providerId = own(options, "providerId");
  if (!nonEmptyString(providerId)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.MISSING_ID, "providerId")]);
  }
  if (typeof own(options, "query") !== "function") {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "query", {
        message: "An async provider requires a query function.",
      }),
    ]);
  }
  const datasets = own(options, "datasets");
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "datasets", {
        message: "An async provider requires at least one dataset descriptor.",
      }),
    ]);
  }
  const diagnostics: Diagnostic[] = [];
  const descriptors = new Map<string, DatasetDescriptor>();
  datasets.forEach((entry, index) => {
    const validation = validateDatasetDescriptor(entry);
    diagnostics.push(...validation.diagnostics);
    if (!validation.valid || !validation.descriptor) {
      return;
    }
    const descriptor = validation.descriptor;
    if (descriptors.has(descriptor.id)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.DUPLICATE_ID, `datasets/${index}/id`, {
          relatedIds: [descriptor.id],
        }),
      );
      return;
    }
    descriptors.set(descriptor.id, descriptor);
  });
  if (hasError(diagnostics) || diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const queryFunction = own(options, "query") as AsyncDatasetProviderOptions["query"];
  const provider: DatasetProvider = Object.freeze({
    providerId,
    listDatasetIds(): readonly string[] {
      return Object.freeze([...descriptors.keys()].sort(lexicalCompare));
    },
    getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined {
      return descriptors.get(datasetId);
    },
    async query(
      request: QueryRequest,
      context: DatasetProviderContext,
    ): Promise<DatasetQueryResult> {
      if (context.signal.aborted) {
        return failureFrom(context, undefined, undefined, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_CANCELLED, "query", {
            severity: "warning",
            message: "The query was cancelled.",
          }),
        ]);
      }
      const descriptor = descriptors.get(request.datasetId);
      if (!descriptor) {
        return failureFrom(context, undefined, undefined, request, [
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "datasetId", {
            relatedIds: [request.datasetId],
          }),
        ]);
      }
      const planned = buildQueryPlan(descriptor, request, { providerId });
      if (!planned.ok) {
        return failureFrom(context, undefined, descriptor, request, planned.diagnostics);
      }
      const plan = planned.value;
      let output: AsyncDatasetQueryOutput;
      try {
        output = await queryFunction({
          request: plan.request,
          descriptor,
          context,
        });
      } catch {
        if (context.signal.aborted) {
          return failureFrom(context, plan, descriptor, request, [
            createDiagnostic(DIAGNOSTIC_CODES.QUERY_CANCELLED, "query", {
              severity: "warning",
              message: "The query was cancelled.",
            }),
          ]);
        }
        return failureFrom(context, plan, descriptor, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "query", {
            message: "The async query adapter failed to execute the query.",
          }),
        ]);
      }
      if (context.signal.aborted) {
        return failureFrom(context, plan, descriptor, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_CANCELLED, "query", {
            severity: "warning",
            message: "The query was cancelled.",
          }),
        ]);
      }
      if (!isRecord(output)) {
        return failureFrom(context, plan, descriptor, request, [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result"),
        ]);
      }
      const admitted = admitProviderResult(output);
      if (!admitted.ok) {
        return failureFrom(context, plan, descriptor, request, admitted.diagnostics);
      }
      const snapshot = admitted.value as unknown as AsyncDatasetQueryOutput;
      const appliedDiagnostics = verifyApplied(plan, own(admitted.value, "applied"));
      if (appliedDiagnostics.length > 0) {
        return failureFrom(context, plan, descriptor, request, appliedDiagnostics);
      }
      const success = successFrom(plan, context, snapshot);
      if (!success.ok) {
        return failureFrom(context, plan, descriptor, request, success.diagnostics);
      }
      return success.value;
    },
  });
  return ok(provider);
}
