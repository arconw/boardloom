import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createAsyncDatasetProvider,
  createDiagnostic,
  createLocalDatasetProvider,
  createRuntime,
  type AsyncDatasetQueryInput,
  type AsyncDatasetQueryOutput,
  type DatasetDescriptor,
  type DatasetProvider,
  type QueryAbortSignal,
  type QueryRequest,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";
import {
  ASSESSMENT_DESCRIPTOR,
  ASSESSMENT_ROWS,
  appliedFilters,
  cloneAssessmentDescriptor,
} from "../fixtures/assessment-fixture.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface PendingRequest {
  readonly input: AsyncDatasetQueryInput;
  readonly signal: QueryAbortSignal;
  readonly resolve: (output: AsyncDatasetQueryOutput) => void;
  readonly reject: (error: unknown) => void;
}

function createDeferredProvider(onQuery?: (input: AsyncDatasetQueryInput) => void): {
  readonly provider: DatasetProvider;
  readonly pending: PendingRequest[];
} {
  const pending: PendingRequest[] = [];
  const provider = unwrap(
    createAsyncDatasetProvider({
      providerId: "assessment-async",
      datasets: [ASSESSMENT_DESCRIPTOR],
      query(input) {
        onQuery?.(input);
        return new Promise<AsyncDatasetQueryOutput>((resolve, reject) => {
          pending.push({ input, signal: input.context.signal, resolve, reject });
        });
      },
    }),
  );
  return { provider, pending };
}

function outputFor(
  request: QueryRequest,
  rows: readonly Readonly<Record<string, number | string | null>>[],
  overrides: Partial<AsyncDatasetQueryOutput> = {},
): AsyncDatasetQueryOutput {
  return {
    rows,
    counts: {
      returnedRows: rows.length,
      totalRows: rows.length,
      filteredRows: rows.length,
      nullCounts: {},
    },
    complete: true,
    applied: {
      filters: appliedFilters(request.filters),
      groupBy: request.groupBy.map((grouping) => grouping.fieldId),
      aggregations: request.aggregations.map((aggregation) => aggregation.output),
      timeWindow: request.timeWindow !== undefined,
      comparisonInput: request.comparisonInput !== undefined,
    },
    ...overrides,
  };
}

function createHarness(provider?: DatasetProvider) {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("query"),
    ...(provider === undefined ? {} : { datasetProvider: provider }),
  });
  const space = unwrap(runtime.createSpace({ id: "query-space", document: makeDocument("Query") }));
  const events: SpaceEvent[] = [];
  space.subscribe((event) => events.push(event));
  return { runtime, space, events, clock };
}

const BASIC_QUERY = {
  datasetId: "assessment-results",
  sliceId: "all-results",
  fields: ["school_id", "score"],
} as const;

describe("local and async query adapters", () => {
  it("loads local fixture rows and exposes settled state and counts", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space, events } = createHarness(provider);
    const loading = unwrap(
      space.setQuery("schools", {
        ...BASIC_QUERY,
        filters: [
          {
            id: "schools",
            fieldId: "school_id",
            operator: "in",
            value: ["north", "south", "east"],
          },
        ],
      }),
    );
    expect(loading.phase).toBe("loading");
    expect(loading.requestId).not.toBeNull();
    expect(space.getSnapshot().queryCount).toBe(1);
    await flush();
    const state = space.getQueryState("schools");
    expect(state?.phase).toBe("settled");
    expect(state?.rows).toHaveLength(8);
    expect(state?.counts.totalRows).toBe(8);
    expect(state?.counts.filteredRows).toBe(8);
    expect(state?.counts.returnedRows).toBe(8);
    expect(state?.counts.nullCounts.score).toBe(1);
    expect(state?.fields.map((field) => field.fieldId)).toEqual(["school_id", "score"]);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state?.rows)).toBe(true);
    expect(Object.isFrozen(state?.rows[0])).toBe(true);
    expect(events.map((event) => event.type)).toContain("query:started");
    expect(events.map((event) => event.type)).toContain("query:settled");
    const settled = events.find((event) => event.type === "query:settled");
    expect(settled?.type).toBe("query:settled");
    if (settled?.type === "query:settled") {
      expect(settled.phase).toBe("settled");
      expect(settled.rowCount).toBe(8);
      expect(settled.generation).toBe(1);
      expect(settled.nullCount).toBe(2);
    }
  });

  it("preserves null, empty string, false, zero, negative, date-only and offset values", async () => {
    const descriptor: DatasetDescriptor = {
      id: "value-semantics",
      version: "1",
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
      fields: [
        { id: "flag", key: "flag", type: "boolean", role: "dimension", nullable: false },
        { id: "label", key: "label", type: "string", role: "dimension", nullable: true },
        {
          id: "value",
          key: "value",
          type: "number",
          role: "measure",
          nullable: true,
          unit: { unit: "points" },
        },
        {
          id: "day",
          key: "day",
          type: "date",
          role: "temporal",
          nullable: false,
          timezone: "UTC",
          temporalRepresentation: "iso8601-offset",
        },
        {
          id: "stamp",
          key: "stamp",
          type: "datetime",
          role: "temporal",
          nullable: false,
          timezone: "UTC",
          temporalRepresentation: "iso8601-offset",
        },
      ],
      slices: [
        {
          id: "all",
          datasetId: "value-semantics",
          fieldIds: ["flag", "label", "value", "day", "stamp"],
          supportedOperations: ["project", "order"] as const,
        },
      ],
      capabilities: {
        grouping: true,
        aggregations: ["count", "sum"],
        filterOperators: ["equals", "isNull", "isNotNull"],
        timeWindow: true,
        timezoneConversion: true,
        local: true,
        pushdownFilters: true,
        serverPaging: false,
        realtime: false,
        comparison: false,
        maxResultSize: null,
      },
    };
    const rows = [
      {
        flag: false,
        label: "",
        value: 0,
        day: "2026-10-01",
        stamp: "2026-10-01T00:00:00Z",
      },
      {
        flag: true,
        label: null,
        value: -5,
        day: "2026-10-02",
        stamp: "2026-10-02T23:30:00-05:00",
      },
    ];
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "value-semantics",
        datasets: [{ descriptor, rows }],
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("values", {
        datasetId: "value-semantics",
        sliceId: "all",
        fields: ["flag", "label", "value", "day", "stamp"],
        orderBy: [{ key: "value", direction: "ascending" }],
      }),
    );
    await flush();
    expect(space.getQueryState("values")?.rows).toEqual([
      {
        flag: true,
        label: null,
        value: -5,
        day: "2026-10-02",
        stamp: "2026-10-02T23:30:00-05:00",
      },
      {
        flag: false,
        label: "",
        value: 0,
        day: "2026-10-01",
        stamp: "2026-10-01T00:00:00Z",
      },
    ]);
  });

  it("distinguishes empty, real zero and provider error states", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space, events } = createHarness(provider);
    unwrap(
      space.setQuery("empty", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "west" }],
      }),
    );
    await flush();
    expect(space.getQueryState("empty")?.phase).toBe("empty");
    expect(space.getQueryState("empty")?.rows).toEqual([]);

    unwrap(
      space.setQuery("zero", {
        datasetId: "assessment-results",
        sliceId: "all-results",
        filters: [{ fieldId: "student_id", operator: "equals", value: "student-02" }],
        aggregations: [{ output: "score_total", type: "sum", fieldId: "score" }],
      }),
    );
    await flush();
    const zero = space.getQueryState("zero");
    expect(zero?.phase).toBe("settled");
    expect(zero?.rows).toEqual([{ score_total: 0 }]);

    const failing = unwrap(
      createAsyncDatasetProvider({
        providerId: "assessment-async",
        datasets: [ASSESSMENT_DESCRIPTOR],
        async query() {
          throw new Error("synthetic transport detail that must not leak");
        },
      }),
    );
    const failed = createHarness(failing);
    unwrap(failed.space.setQuery("failure", BASIC_QUERY));
    await flush();
    const error = failed.space.getQueryState("failure");
    expect(error?.phase).toBe("error");
    expect(error?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_FAILED);
    expect(error?.diagnostics[0]?.message).not.toContain("synthetic transport detail");
    expect(
      failed.events.some((event) => event.type === "query:failed" && event.queryId === "failure"),
    ).toBe(true);
    expect(events.some((event) => event.type === "query:failed")).toBe(false);
  });

  it("aborts async work on cancellation without surfacing a hard error", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    unwrap(
      space.setQuery("cancel", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    await flush();
    const request = pending[0];
    expect(request).toBeDefined();
    expect(request?.signal.aborted).toBe(false);
    unwrap(space.cancelQuery("cancel", "host"));
    expect(request?.signal.aborted).toBe(true);
    const cancelled = space.getQueryState("cancel");
    expect(cancelled?.phase).toBe("cancelled");
    expect(cancelled?.cancelledReason).toBe("host");
    expect(cancelled?.diagnostics[0]?.severity).toBe("warning");
    expect(events.some((event) => event.type === "query:cancelled")).toBe(true);
    request?.resolve(outputFor(request.input.request, [{ school_id: "north", score: 10 }]));
    await flush();
    expect(space.getQueryState("cancel")?.phase).toBe("cancelled");
    expect(events.some((event) => event.type === "query:settled")).toBe(false);
  });

  it("does not start superseded provider work when a listener reenters a new request", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    let nested = false;
    space.subscribe((event) => {
      if (event.type === "query:started" && event.queryId === "reentrant" && !nested) {
        nested = true;
        unwrap(
          space.setQuery("reentrant", {
            ...BASIC_QUERY,
            filters: [{ fieldId: "school_id", operator: "equals", value: "south" }],
          }),
        );
      }
    });
    const outer = unwrap(
      space.setQuery("reentrant", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    expect(outer.phase).toBe("loading");
    await flush();
    expect(pending).toHaveLength(1);
    const request = pending[0];
    expect(request?.input.request.filters[0]?.value).toBe("south");
    const current = space.getQueryState("reentrant");
    expect(current?.queryKey).not.toBe(outer.queryKey);
    expect(current?.generation).toBe(2);
    request?.resolve(outputFor(request.input.request, [{ school_id: "south", score: 5 }]));
    await flush();
    expect(space.getQueryState("reentrant")?.phase).toBe("settled");
    expect(space.getQueryState("reentrant")?.rows).toEqual([{ school_id: "south", score: 5 }]);
    expect(events.some((event) => event.type === "query:failed")).toBe(false);
  });

  it("does not overwrite a request started by a cancellation observer", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("cancelled-reentry", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    await flush();
    let nested = false;
    space.subscribe((event) => {
      if (
        event.type === "query:cancelled" &&
        event.queryId === "cancelled-reentry" &&
        event.reason === "query-key-changed" &&
        !nested
      ) {
        nested = true;
        unwrap(
          space.setQuery("cancelled-reentry", {
            ...BASIC_QUERY,
            filters: [{ fieldId: "school_id", operator: "equals", value: "east" }],
          }),
        );
      }
    });
    unwrap(
      space.setQuery("cancelled-reentry", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "south" }],
      }),
    );
    await flush();
    expect(nested).toBe(true);
    expect(pending).toHaveLength(2);
    const replacement = pending[1];
    expect(replacement?.input.request.filters[0]?.value).toBe("east");
    const state = space.getQueryState("cancelled-reentry");
    expect(state?.generation).toBe(2);
    replacement?.resolve(outputFor(replacement.input.request, [{ school_id: "east", score: 4 }]));
    await flush();
    expect(space.getQueryState("cancelled-reentry")?.rows).toEqual([
      { school_id: "east", score: 4 },
    ]);
  });

  it("rejects older-generation results after a query key change", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    unwrap(
      space.setQuery("generation", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    await flush();
    unwrap(
      space.setQuery("generation", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "south" }],
      }),
    );
    await flush();
    expect(pending).toHaveLength(2);
    const first = pending[0];
    const second = pending[1];
    expect(second?.input.request.filters[0]?.value).toBe("south");
    const changed = space.getQueryState("generation");
    expect(changed?.generation).toBe(2);
    expect(changed?.phase).toBe("loading");
    const invalidated = events.find((event) => event.type === "query:invalidated");
    expect(invalidated?.type).toBe("query:invalidated");
    if (invalidated?.type === "query:invalidated") {
      expect(invalidated.previousGeneration).toBe(1);
      expect(invalidated.newGeneration).toBe(2);
      expect(invalidated.previousQueryKey).not.toBe(invalidated.newQueryKey);
    }
    first?.resolve(outputFor(first.input.request, [{ school_id: "north", score: 10 }]));
    await flush();
    expect(space.getQueryState("generation")?.phase).toBe("loading");
    expect(space.getQueryState("generation")?.rows).toEqual([]);
    const stale = events.find((event) => event.type === "query:stale");
    expect(stale?.type).toBe("query:stale");
    if (stale?.type === "query:stale") {
      expect(stale.generation).toBe(1);
      expect(stale.reason).toBe("generation");
    }
    second?.resolve(outputFor(second.input.request, [{ school_id: "south", score: 7.5 }]));
    await flush();
    const settled = space.getQueryState("generation");
    expect(settled?.phase).toBe("settled");
    expect(settled?.generation).toBe(2);
    expect(settled?.rows).toEqual([{ school_id: "south", score: 7.5 }]);
  });

  it("rejects a superseded same-key request and keeps the newer result", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    unwrap(space.setQuery("refresh", BASIC_QUERY));
    await flush();
    unwrap(space.refreshQuery("refresh"));
    await flush();
    expect(pending).toHaveLength(2);
    const first = pending[0];
    const second = pending[1];
    first?.resolve(outputFor(first.input.request, [{ school_id: "north", score: 1 }]));
    await flush();
    expect(space.getQueryState("refresh")?.phase).toBe("loading");
    second?.resolve(outputFor(second.input.request, [{ school_id: "east", score: 2 }]));
    await flush();
    const settled = space.getQueryState("refresh");
    expect(settled?.phase).toBe("settled");
    expect(settled?.generation).toBe(1);
    expect(settled?.rows).toEqual([{ school_id: "east", score: 2 }]);
    const stale = events.find((event) => event.type === "query:stale");
    expect(stale?.type).toBe("query:stale");
    if (stale?.type === "query:stale") {
      expect(stale.reason).toBe("superseded");
    }
  });

  it("rejects stale results after explicit invalidation and refresh", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    unwrap(space.setQuery("invalidate", BASIC_QUERY));
    await flush();
    const first = pending[0];
    const invalidated = unwrap(space.invalidateQuery("invalidate", "filters-changed"));
    expect(invalidated.phase).toBe("stale");
    expect(invalidated.generation).toBe(2);
    expect(first?.signal.aborted).toBe(true);
    unwrap(space.refreshQuery("invalidate"));
    await flush();
    const second = pending[1];
    first?.resolve(outputFor(first.input.request, [{ school_id: "north", score: 1 }]));
    await flush();
    expect(space.getQueryState("invalidate")?.phase).toBe("loading");
    const stale = events.find((event) => event.type === "query:stale");
    expect(stale?.type).toBe("query:stale");
    if (stale?.type === "query:stale") {
      expect(stale.reason).toBe("generation");
    }
    second?.resolve(outputFor(second.input.request, [{ school_id: "east", score: 3 }]));
    await flush();
    const state = space.getQueryState("invalidate");
    expect(state?.phase).toBe("settled");
    expect(state?.generation).toBe(2);
    expect(state?.rows).toEqual([{ school_id: "east", score: 3 }]);
  });

  it("rejects unsupported capabilities before starting a request", () => {
    const descriptor = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        grouping: false,
      },
    });
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space, events } = createHarness(provider);
    expectFailure(
      space.setQuery("unsupported", {
        datasetId: "assessment-results",
        groupBy: [{ fieldId: "school_id" }],
        aggregations: [{ output: "attempts", type: "count" }],
      }),
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
    );
    expect(space.getQueryState("unsupported")).toBeUndefined();
    expect(events.some((event) => event.type === "query:started")).toBe(false);
  });

  it("contains synchronous provider throws without leaking the error payload", async () => {
    const provider: DatasetProvider = {
      providerId: "sync-throw",
      listDatasetIds: () => ["assessment-results"],
      getDatasetDescriptor: () => ASSESSMENT_DESCRIPTOR,
      query() {
        throw new Error("synthetic synchronous detail that must not leak");
      },
    };
    const { space } = createHarness(provider);
    unwrap(space.setQuery("sync-throw", BASIC_QUERY));
    await flush();
    const state = space.getQueryState("sync-throw");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_FAILED);
    expect(state?.diagnostics[0]?.message).not.toContain("synthetic synchronous detail");
  });

  it("rejects an async provider that silently drops requested filters", async () => {
    const provider = unwrap(
      createAsyncDatasetProvider({
        providerId: "assessment-async",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query(input) {
          return outputFor(input.request, [{ school_id: "north", score: 10 }], {
            applied: { filters: [] },
          });
        },
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("dropped", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    await flush();
    const state = space.getQueryState("dropped");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED);
  });

  it("rejects an async provider that drops grouping, aggregation or window work", async () => {
    const provider = unwrap(
      createAsyncDatasetProvider({
        providerId: "assessment-async",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query(input) {
          return outputFor(input.request, [{ school_id: "north", attempts: 2 }], {
            applied: { filters: [], groupBy: [], aggregations: [] },
          });
        },
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("dropped-work", {
        datasetId: "assessment-results",
        groupBy: [{ fieldId: "school_id" }],
        aggregations: [{ output: "attempts", type: "count" }],
        timeWindow: {
          fieldId: "submitted_at",
          start: "2026-09-01",
          end: "2026-10-31",
          timezone: "UTC",
          bounds: "half-open",
        },
      }),
    );
    await flush();
    const state = space.getQueryState("dropped-work");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.QUERY_REQUEST_NOT_HONORED,
    );
    expect(state?.diagnostics.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects date-only rows that do not exist in the declared timezone", () => {
    const descriptor = cloneAssessmentDescriptor({
      timezone: "Pacific/Apia",
      fields: [
        {
          id: "day",
          key: "day",
          type: "date",
          role: "temporal",
          nullable: false,
          timezone: "Pacific/Apia",
          temporalRepresentation: "iso8601-offset",
        },
      ],
      slices: [
        {
          id: "all",
          datasetId: "assessment-results",
          fieldIds: ["day"],
        },
      ],
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        aggregations: ["count"],
        filterOperators: ["equals"],
      },
    });
    const result = createLocalDatasetProvider({
      providerId: "skipped-date",
      datasets: [{ descriptor, rows: [{ day: "2011-12-30" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_ROW_INVALID);
    }
  });

  it("rejects invalid provider rows before they can reach a render", async () => {
    const invalidSource = createLocalDatasetProvider({
      providerId: "invalid-local",
      datasets: [
        {
          descriptor: ASSESSMENT_DESCRIPTOR,
          rows: [{ ...ASSESSMENT_ROWS[0], score: Number.NaN } as never],
        },
      ],
    });
    expect(invalidSource.ok).toBe(false);
    if (!invalidSource.ok) {
      expect(invalidSource.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_ROW_INVALID);
    }

    const invalidAsync = unwrap(
      createAsyncDatasetProvider({
        providerId: "assessment-async",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query(input) {
          return outputFor(input.request, [
            { school_id: "north", score: Number.POSITIVE_INFINITY },
          ]);
        },
      }),
    );
    const { space } = createHarness(invalidAsync);
    unwrap(space.setQuery("non-finite", BASIC_QUERY));
    await flush();
    const state = space.getQueryState("non-finite");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);
  });

  it("aggregates grouped measures deterministically", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("aggregates", {
        datasetId: "assessment-results",
        groupBy: [{ fieldId: "school_id" }],
        aggregations: [
          { output: "attempts", type: "count" },
          { output: "students", type: "countDistinct", fieldId: "student_id" },
          { output: "score_total", type: "sum", fieldId: "score" },
          { output: "score_average", type: "average", fieldId: "score" },
          { output: "score_median", type: "median", fieldId: "score" },
          { output: "score_min", type: "min", fieldId: "score" },
          { output: "score_max", type: "max", fieldId: "score" },
          { output: "top_subject", type: "mode", fieldId: "subject" },
        ],
        orderBy: [{ key: "school_id", direction: "ascending" }],
      }),
    );
    await flush();
    const rows = space.getQueryState("aggregates")?.rows;
    expect(rows).toHaveLength(3);
    expect(rows?.[0]).toMatchObject({
      school_id: "east",
      attempts: 3,
      students: 3,
      score_total: 7,
      score_median: 2,
      score_min: 0,
      score_max: 5,
      top_subject: "science",
    });
    expect(Number(rows?.[0]?.score_average)).toBeCloseTo(7 / 3);
    expect(rows?.[1]).toMatchObject({
      school_id: "north",
      attempts: 3,
      students: 3,
      score_total: 18,
      score_average: 6,
      score_median: 8,
      score_min: 0,
      score_max: 10,
      top_subject: "math",
    });
    expect(rows?.[2]).toMatchObject({
      school_id: "south",
      attempts: 2,
      students: 2,
      score_total: 7.5,
      score_average: 7.5,
      score_median: 7.5,
      score_min: 7.5,
      score_max: 7.5,
      top_subject: "reading",
    });
  });

  it("marks provider truncation as partial instead of a complete result", async () => {
    const descriptor = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        maxResultSize: 2,
      },
    });
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space } = createHarness(provider);
    unwrap(space.setQuery("truncated", BASIC_QUERY));
    await flush();
    const state = space.getQueryState("truncated");
    expect(state?.phase).toBe("partial");
    expect(state?.complete).toBe(false);
    expect(state?.rows).toHaveLength(2);
    expect(state?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_TRUNCATED);
  });

  it("buckets temporal rows in the declared timezone", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("tokyo", {
        datasetId: "assessment-results",
        sliceId: "all-results",
        groupBy: [
          {
            fieldId: "submitted_at",
            bucket: { grain: "day", timezone: "Asia/Tokyo" },
          },
        ],
        aggregations: [{ output: "attempts", type: "count" }],
        orderBy: [{ key: "submitted_at", direction: "ascending" }],
      }),
    );
    await flush();
    const tokyo = space.getQueryState("tokyo");
    expect(tokyo?.phase).toBe("settled");
    expect(tokyo?.rows.map((row) => row.submitted_at)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    unwrap(
      space.setQuery("utc", {
        datasetId: "assessment-results",
        sliceId: "all-results",
        groupBy: [
          {
            fieldId: "submitted_at",
            bucket: { grain: "day", timezone: "UTC" },
          },
        ],
        aggregations: [{ output: "attempts", type: "count" }],
        orderBy: [{ key: "submitted_at", direction: "ascending" }],
      }),
    );
    await flush();
    const utc = space.getQueryState("utc");
    expect(utc?.rows[0]?.submitted_at).toBe("2026-09-30");
    expect(tokyo?.rows.map((row) => row.submitted_at)).not.toContain("2026-09-30");
    expect(tokyo?.rows.find((row) => row.submitted_at === "2026-10-04")?.attempts).toBe(2);
    expect(utc?.rows.find((row) => row.submitted_at === "2026-10-04")?.attempts).toBe(1);
  });

  it("exposes unit descriptors on query result metadata", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("units", {
        datasetId: "assessment-results",
        fields: ["attendance_rate"],
      }),
    );
    await flush();
    const field = space.getQueryState("units")?.fields[0];
    expect(field?.unit?.unit).toBe("percent");
    expect(field?.unit?.scale).toBe(100);
  });

  it("does not start provider work when a start observer disposes the space", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    space.subscribe((event) => {
      if (event.type === "query:started" && event.queryId === "dispose-on-start") {
        unwrap(space.dispose());
      }
    });
    unwrap(space.setQuery("dispose-on-start", BASIC_QUERY));
    await flush();
    expect(pending).toHaveLength(0);
    expect(space.disposed).toBe(true);
    expect(space.getQueryState("dispose-on-start")).toBeUndefined();
    expect(events.some((event) => event.type === "query:settled")).toBe(false);
    expect(events.some((event) => event.type === "query:failed")).toBe(false);
    expect(events.at(-1)?.type).toBe("space:disposed");
  });

  it("ignores late results and cancels work when the space is disposed", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    unwrap(space.setQuery("dispose", BASIC_QUERY));
    await flush();
    const request = pending[0];
    unwrap(space.dispose());
    expect(request?.signal.aborted).toBe(true);
    request?.resolve(outputFor(request.input.request, [{ school_id: "north", score: 1 }]));
    await flush();
    expect(space.getQueryState("dispose")).toBeUndefined();
    const afterDispose = events.filter((event) => event.type.startsWith("query:"));
    expect(afterDispose.some((event) => event.type === "query:settled")).toBe(false);
    expect(events.at(-1)?.type).toBe("space:disposed");
  });
  it("snapshots caller-owned filter values before the provider runs", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space } = createHarness(provider);
    const filterValue = ["north"];
    const loading = unwrap(
      space.setQuery("mutable", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "in", value: filterValue }],
      }),
    );
    const loadingKey = loading.queryKey;
    filterValue[0] = "south";
    filterValue.push("east");
    await flush();
    const state = space.getQueryState("mutable");
    expect(state?.queryKey).toBe(loadingKey);
    expect(state?.rows).toHaveLength(3);
    expect(state?.rows.every((row) => row.school_id === "north")).toBe(true);
    expect(state?.counts.filteredRows).toBe(3);
  });

  it("treats provider warnings, error diagnostics and zero-row diagnostics as partial", async () => {
    const cases = [
      {
        rows: [{ school_id: "north", score: 1 }],
        diagnostic: createDiagnostic("TEST_WARNING", "query", {
          severity: "warning",
          message: "Synthetic warning",
        }),
      },
      {
        rows: [{ school_id: "north", score: 1 }],
        diagnostic: createDiagnostic("TEST_ERROR", "query", {
          severity: "error",
          message: "Synthetic diagnostic error",
        }),
      },
      {
        rows: [],
        diagnostic: createDiagnostic("TEST_WARNING_EMPTY", "query", {
          severity: "warning",
          message: "Synthetic zero-row warning",
        }),
      },
    ];
    for (const entry of cases) {
      const provider = unwrap(
        createAsyncDatasetProvider({
          providerId: "assessment-async",
          datasets: [ASSESSMENT_DESCRIPTOR],
          query(input) {
            return outputFor(input.request, entry.rows, {
              diagnostics: [entry.diagnostic],
              complete: true,
            });
          },
        }),
      );
      const { space } = createHarness(provider);
      unwrap(space.setQuery("partial", BASIC_QUERY));
      await flush();
      const state = space.getQueryState("partial");
      expect(state?.phase).toBe("partial");
      expect(state?.complete).toBe(false);
      expect(state?.diagnostics[0]?.code).toBe(entry.diagnostic.code);
    }
  });

  it("preserves a replacement started by an abort listener during cancellation", async () => {
    const triggerRef: { current?: () => void } = {};
    const { provider, pending } = createDeferredProvider((input) => {
      if (input.request.filters[0]?.value === "north") {
        input.context.signal.addEventListener("abort", () => triggerRef.current?.());
      }
    });
    const { space, events } = createHarness(provider);
    const north = unwrap(
      space.setQuery("abort-cancel", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    await flush();
    triggerRef.current = () =>
      unwrap(
        space.setQuery("abort-cancel", {
          ...BASIC_QUERY,
          filters: [{ fieldId: "school_id", operator: "equals", value: "east" }],
        }),
      );
    const afterCancel = unwrap(space.cancelQuery("abort-cancel", "host"));
    await flush();
    expect(pending).toHaveLength(2);
    const current = space.getQueryState("abort-cancel");
    expect(current?.phase).toBe("loading");
    expect(afterCancel.queryKey).toBe(current?.queryKey);
    expect(current?.queryKey).not.toBe(north.queryKey);
    const cancelled = events.find((event) => event.type === "query:cancelled");
    expect(cancelled?.type).toBe("query:cancelled");
    if (cancelled?.type === "query:cancelled") {
      expect(cancelled.queryKey).toBe(north.queryKey);
      expect(cancelled.generation).toBe(north.generation);
      expect(cancelled.requestId).toBe(north.requestId ?? undefined);
      expect(cancelled.requestToken).toBe(north.requestToken);
    }
    const replacement = pending[1];
    expect(replacement?.input.request.filters[0]?.value).toBe("east");
    replacement?.resolve(outputFor(replacement.input.request, [{ school_id: "east", score: 3 }]));
    await flush();
    expect(space.getQueryState("abort-cancel")?.rows).toEqual([{ school_id: "east", score: 3 }]);
  });

  it("does not overwrite a replacement started by an abort listener during key invalidation", async () => {
    const triggerRef: { current?: () => void } = {};
    const { provider, pending } = createDeferredProvider((input) => {
      if (input.request.filters[0]?.value === "north") {
        input.context.signal.addEventListener("abort", () => triggerRef.current?.());
      }
    });
    const { space, events } = createHarness(provider);
    const north = unwrap(
      space.setQuery("abort-reentry", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    await flush();
    triggerRef.current = () =>
      unwrap(
        space.setQuery("abort-reentry", {
          ...BASIC_QUERY,
          filters: [{ fieldId: "school_id", operator: "equals", value: "east" }],
        }),
      );
    const afterSupersede = unwrap(
      space.setQuery("abort-reentry", {
        ...BASIC_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "south" }],
      }),
    );
    await flush();
    expect(pending).toHaveLength(2);
    const current = space.getQueryState("abort-reentry");
    expect(current?.phase).toBe("loading");
    expect(afterSupersede.queryKey).toBe(current?.queryKey);
    const replacement = pending[1];
    expect(replacement?.input.request.filters[0]?.value).toBe("east");
    expect(pending.some((entry) => entry.input.request.filters[0]?.value === "south")).toBe(false);
    const cancelled = events.find((event) => event.type === "query:cancelled");
    expect(cancelled?.type).toBe("query:cancelled");
    if (cancelled?.type === "query:cancelled") {
      expect(cancelled.queryKey).toBe(north.queryKey);
      expect(cancelled.generation).toBe(north.generation);
    }
    replacement?.resolve(outputFor(replacement.input.request, [{ school_id: "east", score: 4 }]));
    await flush();
    expect(space.getQueryState("abort-reentry")?.rows).toEqual([{ school_id: "east", score: 4 }]);
  });

  it("requires explicit counts for async grouped or aggregated results", async () => {
    const provider = unwrap(
      createAsyncDatasetProvider({
        providerId: "assessment-async",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query() {
          return {
            rows: [{ school_id: "north", avg_score: 9 }],
            complete: true,
            applied: {
              groupBy: ["school_id"],
              aggregations: ["avg_score"],
            },
          };
        },
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("aggregate-counts", {
        datasetId: "assessment-results",
        groupBy: [{ fieldId: "school_id" }],
        aggregations: [{ output: "avg_score", type: "average", fieldId: "score" }],
      }),
    );
    await flush();
    const state = space.getQueryState("aggregate-counts");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.QUERY_RESULT_INVALID,
    );
  });

  it("does not derive null counts for measures absent from a raw projection", async () => {
    const provider = unwrap(
      createAsyncDatasetProvider({
        providerId: "assessment-async",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query(input) {
          return {
            rows: [{ school_id: "north" }],
            complete: true,
            applied: {},
            ...(input.request.fields.includes("score")
              ? {
                  counts: {
                    returnedRows: 1,
                    totalRows: 1,
                    filteredRows: 1,
                    nullCounts: {},
                  },
                }
              : {}),
          };
        },
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("raw-counts", {
        datasetId: "assessment-results",
        fields: ["school_id"],
      }),
    );
    await flush();
    const state = space.getQueryState("raw-counts");
    expect(state?.phase).toBe("settled");
    expect(state?.counts.nullCounts).toEqual({});
  });

  it("produces an error diagnostic for warning-only provider failures", async () => {
    const provider: DatasetProvider = {
      providerId: "warning-failure",
      listDatasetIds: () => ["assessment-results"],
      getDatasetDescriptor: () => ASSESSMENT_DESCRIPTOR,
      query(request, context) {
        return {
          ok: false,
          requestId: context.requestId,
          datasetId: request.datasetId,
          datasetVersion: request.datasetVersion,
          ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
          diagnostics: [
            createDiagnostic("TEST_WARNING_ONLY", "query", {
              severity: "warning",
              message: "Synthetic warning-only failure",
            }),
          ],
        };
      },
    };
    const { space, events } = createHarness(provider);
    unwrap(space.setQuery("warning-failure", BASIC_QUERY));
    await flush();
    const state = space.getQueryState("warning-failure");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    const failed = events.find((event) => event.type === "query:failed");
    expect(failed?.type).toBe("query:failed");
    if (failed?.type === "query:failed") {
      expect(failed.diagnostic.severity).toBe("error");
      expect(failed.diagnostic.code).toBe(DIAGNOSTIC_CODES.QUERY_FAILED);
    }
  });

  it("emits stale for a late result after invalidation without a replacement", async () => {
    const { provider, pending } = createDeferredProvider();
    const { space, events } = createHarness(provider);
    unwrap(space.setQuery("stale-only", BASIC_QUERY));
    await flush();
    unwrap(space.invalidateQuery("stale-only", "filters"));
    const request = pending[0];
    request?.resolve(outputFor(request.input.request, [{ school_id: "north", score: 1 }]));
    await flush();
    expect(space.getQueryState("stale-only")?.phase).toBe("stale");
    const stale = events.find((event) => event.type === "query:stale");
    expect(stale?.type).toBe("query:stale");
    if (stale?.type === "query:stale") {
      expect(stale.reason).toBe("generation");
    }
  });

  it("rejects impossible result count invariants", async () => {
    const provider = unwrap(
      createAsyncDatasetProvider({
        providerId: "bad-counts",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query(input) {
          return outputFor(input.request, [{ school_id: "north", score: 1 }], {
            counts: {
              returnedRows: 1,
              totalRows: 1,
              filteredRows: 0,
              nullCounts: {},
            },
          });
        },
      }),
    );
    const { space } = createHarness(provider);
    unwrap(space.setQuery("bad-counts", BASIC_QUERY));
    await flush();
    const state = space.getQueryState("bad-counts");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);
  });

  it("rejects provider fields and counts that do not match the planned result", async () => {
    const provider: DatasetProvider = {
      providerId: "malformed-result",
      listDatasetIds: () => ["assessment-results"],
      getDatasetDescriptor: () => ASSESSMENT_DESCRIPTOR,
      query(request, context) {
        return {
          ok: true,
          requestId: context.requestId,
          datasetId: request.datasetId,
          datasetVersion: request.datasetVersion,
          ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
          fields: [
            {
              fieldId: "school_id",
              type: "string",
              role: "dimension",
            },
          ],
          rows: [{ school_id: "north" }],
          counts: {
            returnedRows: 1,
            totalRows: 1,
            filteredRows: 1,
            nullCounts: {},
          },
          complete: true,
          diagnostics: [],
        };
      },
    };
    const { space } = createHarness(provider);
    unwrap(space.setQuery("malformed-result", BASIC_QUERY));
    await flush();
    const state = space.getQueryState("malformed-result");
    expect(state?.phase).toBe("error");
    expect(state?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);
  });
  it("resolves dataset temporal defaults into epoch result metadata", async () => {
    const submittedAt = ASSESSMENT_DESCRIPTOR.fields.find((field) => field.id === "submitted_at");
    expect(submittedAt).toBeDefined();
    const inheritedTemporalFields = ASSESSMENT_DESCRIPTOR.fields.map((field) =>
      field.id === "submitted_at"
        ? {
            id: field.id,
            key: field.key,
            label: field.label,
            type: "datetime" as const,
            role: "temporal" as const,
            nullable: false,
          }
        : field,
    );
    for (const representation of ["epoch-milliseconds", "epoch-seconds"] as const) {
      const descriptor = cloneAssessmentDescriptor({
        timezone: "Europe/Berlin",
        temporalRepresentation: representation,
        fields: inheritedTemporalFields,
      });
      const rows = ASSESSMENT_ROWS.map((row) => ({
        ...row,
        submitted_at:
          Date.parse(row.submitted_at) / (representation === "epoch-seconds" ? 1_000 : 1),
      }));
      const local = unwrap(
        createLocalDatasetProvider({
          providerId: "epoch-local",
          datasets: [{ descriptor, rows }],
        }),
      );
      const localHarness = createHarness(local);
      unwrap(
        localHarness.space.setQuery("epoch-raw", {
          datasetId: "assessment-results",
          sliceId: "all-results",
          fields: ["school_id", "submitted_at", "score"],
        }),
      );
      await flush();
      const raw = localHarness.space.getQueryState("epoch-raw");
      expect(raw?.phase).toBe("settled");
      const rawField = raw?.fields.find((field) => field.fieldId === "submitted_at");
      expect(rawField?.temporalRepresentation).toBe(representation);
      expect(rawField?.timezone).toBe("Europe/Berlin");
      expect(typeof raw?.rows[0]?.submitted_at).toBe("number");

      unwrap(
        localHarness.space.setQuery("epoch-min", {
          datasetId: "assessment-results",
          sliceId: "all-results",
          groupBy: [{ fieldId: "school_id" }],
          aggregations: [{ output: "first_submission", type: "min", fieldId: "submitted_at" }],
        }),
      );
      await flush();
      const aggregated = localHarness.space.getQueryState("epoch-min");
      expect(aggregated?.phase).toBe("settled");
      const aggregateField = aggregated?.fields.find(
        (field) => field.fieldId === "first_submission",
      );
      expect(aggregateField?.temporalRepresentation).toBe(representation);
      expect(aggregateField?.timezone).toBe("Europe/Berlin");
      expect(typeof aggregated?.rows[0]?.first_submission).toBe("number");

      const asyncProvider = unwrap(
        createAsyncDatasetProvider({
          providerId: "epoch-async",
          datasets: [descriptor],
          query() {
            return {
              rows: rows.map((row) => ({
                school_id: row.school_id,
                submitted_at: row.submitted_at,
                score: row.score,
              })),
              complete: true,
              applied: {},
            };
          },
        }),
      );
      const asyncHarness = createHarness(asyncProvider);
      unwrap(
        asyncHarness.space.setQuery("epoch-async", {
          datasetId: "assessment-results",
          sliceId: "all-results",
          fields: ["school_id", "submitted_at", "score"],
        }),
      );
      await flush();
      const asyncState = asyncHarness.space.getQueryState("epoch-async");
      expect(asyncState?.phase).toBe("settled");
      expect(
        asyncState?.fields.find((field) => field.fieldId === "submitted_at")
          ?.temporalRepresentation,
      ).toBe(representation);
      expect(typeof asyncState?.rows[0]?.submitted_at).toBe("number");
    }
  });

  it("contains accessor-backed provider results through the failure path", async () => {
    const makeProvider = (
      decorate: (result: Record<string, unknown>) => void,
    ): DatasetProvider => ({
      providerId: "accessor-result",
      listDatasetIds: () => ["assessment-results"],
      getDatasetDescriptor: () => ASSESSMENT_DESCRIPTOR,
      query(request, context) {
        const result: Record<string, unknown> = {
          ok: true,
          requestId: context.requestId,
          datasetId: request.datasetId,
          datasetVersion: request.datasetVersion,
          ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
          fields: [
            { fieldId: "school_id", type: "string", role: "dimension" },
            { fieldId: "score", type: "number", role: "measure" },
          ],
          rows: [],
          counts: {
            returnedRows: 0,
            totalRows: 0,
            filteredRows: 0,
            nullCounts: {},
          },
          complete: true,
          diagnostics: [],
        };
        decorate(result);
        return result as never;
      },
    });

    const identityHarness = createHarness(
      makeProvider((result) => {
        Object.defineProperty(result, "requestId", {
          enumerable: true,
          get() {
            throw new Error("identity accessor must not execute");
          },
        });
      }),
    );
    unwrap(identityHarness.space.setQuery("accessor-identity", BASIC_QUERY));
    await flush();
    const identityState = identityHarness.space.getQueryState("accessor-identity");
    expect(identityState?.phase).toBe("error");
    expect(identityState?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);

    const nestedHarness = createHarness(
      makeProvider((result) => {
        const counts = result.counts as Record<string, unknown>;
        Object.defineProperty(counts, "returnedRows", {
          enumerable: true,
          get() {
            throw new Error("nested accessor must not execute");
          },
        });
      }),
    );
    unwrap(nestedHarness.space.setQuery("accessor-nested", BASIC_QUERY));
    await flush();
    const nestedState = nestedHarness.space.getQueryState("accessor-nested");
    expect(nestedState?.phase).toBe("error");
    expect(
      nestedState?.diagnostics.some((diagnostic) =>
        diagnostic.path.includes("/counts/returnedRows"),
      ),
    ).toBe(true);
  });

  it("orders day buckets and aggregation outputs by planned output semantics", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-shuffled",
        datasets: [
          {
            descriptor: ASSESSMENT_DESCRIPTOR,
            rows: [...ASSESSMENT_ROWS].reverse(),
          },
        ],
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("bucket-asc", {
        datasetId: "assessment-results",
        sliceId: "all-results",
        groupBy: [
          {
            fieldId: "submitted_at",
            bucket: { grain: "day", timezone: "UTC" },
          },
        ],
        aggregations: [{ output: "attempts", type: "count" }],
        orderBy: [{ key: "submitted_at", direction: "ascending" }],
      }),
    );
    await flush();
    const ascendingDates = space.getQueryState("bucket-asc")?.rows.map((row) => row.submitted_at);
    expect(ascendingDates).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);

    unwrap(
      space.setQuery("bucket-desc", {
        datasetId: "assessment-results",
        sliceId: "all-results",
        groupBy: [
          {
            fieldId: "submitted_at",
            bucket: { grain: "day", timezone: "UTC" },
          },
        ],
        aggregations: [{ output: "attempts", type: "count" }],
        orderBy: [{ key: "submitted_at", direction: "descending" }],
      }),
    );
    await flush();
    expect(space.getQueryState("bucket-desc")?.rows.map((row) => row.submitted_at)).toEqual([
      "2026-10-05",
      "2026-10-04",
      "2026-10-03",
      "2026-10-02",
      "2026-10-01",
      "2026-09-30",
    ]);

    unwrap(
      space.setQuery("aggregate-asc", {
        datasetId: "assessment-results",
        groupBy: [{ fieldId: "school_id" }],
        aggregations: [{ output: "score_total", type: "sum", fieldId: "score" }],
        orderBy: [{ key: "score_total", direction: "ascending" }],
      }),
    );
    await flush();
    expect(space.getQueryState("aggregate-asc")?.rows.map((row) => row.school_id)).toEqual([
      "east",
      "south",
      "north",
    ]);

    unwrap(
      space.setQuery("aggregate-desc", {
        datasetId: "assessment-results",
        groupBy: [{ fieldId: "school_id" }],
        aggregations: [{ output: "score_total", type: "sum", fieldId: "score" }],
        orderBy: [{ key: "score_total", direction: "descending" }],
      }),
    );
    await flush();
    expect(space.getQueryState("aggregate-desc")?.rows.map((row) => row.school_id)).toEqual([
      "north",
      "south",
      "east",
    ]);
  });

  it("allows an empty-input global aggregate row with zero filtered rows", async () => {
    const provider = unwrap(
      createAsyncDatasetProvider({
        providerId: "global-aggregate",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query() {
          return {
            rows: [{ attempts: 0 }],
            counts: {
              returnedRows: 1,
              totalRows: 0,
              filteredRows: 0,
              nullCounts: {},
            },
            complete: true,
            applied: { aggregations: ["attempts"] },
          };
        },
      }),
    );
    const { space } = createHarness(provider);
    unwrap(
      space.setQuery("global-aggregate", {
        datasetId: "assessment-results",
        aggregations: [{ output: "attempts", type: "count" }],
      }),
    );
    await flush();
    const state = space.getQueryState("global-aggregate");
    expect(state?.phase).toBe("settled");
    expect(state?.rows).toEqual([{ attempts: 0 }]);
    expect(state?.counts.filteredRows).toBe(0);
    expect(state?.counts.returnedRows).toBe(1);
  });
  it("admits async consumer output before reading applied metadata or rows", async () => {
    let appliedReads = 0;
    let rowsReads = 0;
    let nestedReads = 0;

    const topProvider = unwrap(
      createAsyncDatasetProvider({
        providerId: "async-accessor",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query() {
          const output: Record<string, unknown> = {
            rows: [{ school_id: "north", score: 1 }],
            complete: true,
          };
          Object.defineProperty(output, "applied", {
            enumerable: true,
            get() {
              appliedReads += 1;
              throw new Error("applied accessor must not execute");
            },
          });
          return output as never;
        },
      }),
    );
    const topHarness = createHarness(topProvider);
    unwrap(topHarness.space.setQuery("async-accessor-top", BASIC_QUERY));
    await flush();
    const topState = topHarness.space.getQueryState("async-accessor-top");
    expect(topState?.phase).toBe("error");
    expect(topState?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);
    expect(appliedReads).toBe(0);

    const rowsProvider = unwrap(
      createAsyncDatasetProvider({
        providerId: "async-accessor",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query() {
          const output: Record<string, unknown> = {
            complete: true,
            applied: {},
            counts: {
              returnedRows: 0,
              totalRows: 0,
              filteredRows: 0,
              nullCounts: {},
            },
          };
          Object.defineProperty(output, "rows", {
            enumerable: true,
            get() {
              rowsReads += 1;
              return [];
            },
          });
          return output as never;
        },
      }),
    );
    const rowsHarness = createHarness(rowsProvider);
    unwrap(rowsHarness.space.setQuery("async-accessor-rows", BASIC_QUERY));
    await flush();
    const rowsState = rowsHarness.space.getQueryState("async-accessor-rows");
    expect(rowsState?.phase).toBe("error");
    expect(rowsState?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);
    expect(rowsReads).toBe(0);

    const nestedProvider = unwrap(
      createAsyncDatasetProvider({
        providerId: "async-accessor",
        datasets: [ASSESSMENT_DESCRIPTOR],
        query() {
          const row: Record<string, unknown> = { score: 1 };
          Object.defineProperty(row, "school_id", {
            enumerable: true,
            get() {
              nestedReads += 1;
              throw new Error("nested accessor must not execute");
            },
          });
          return {
            rows: [row],
            complete: true,
            applied: {},
          } as never;
        },
      }),
    );
    const nestedHarness = createHarness(nestedProvider);
    unwrap(nestedHarness.space.setQuery("async-accessor-nested", BASIC_QUERY));
    await flush();
    const nestedState = nestedHarness.space.getQueryState("async-accessor-nested");
    expect(nestedState?.phase).toBe("error");
    expect(nestedState?.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID);
    expect(nestedReads).toBe(0);
  });

  it("returns query-spec accessor failures without executing getters", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "assessment-local",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const { space } = createHarness(provider);

    let datasetIdReads = 0;
    const datasetSpec: Record<string, unknown> = { fields: ["school_id"] };
    Object.defineProperty(datasetSpec, "datasetId", {
      enumerable: true,
      get() {
        datasetIdReads += 1;
        throw new Error("datasetId accessor must not execute");
      },
    });
    const datasetResult = space.setQuery("spec-dataset-accessor", datasetSpec as never);
    expect(datasetResult.ok).toBe(false);
    if (!datasetResult.ok) {
      expect(datasetResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.QUERY_INVALID,
      );
    }
    expect(datasetIdReads).toBe(0);

    let sliceIdReads = 0;
    const sliceSpec: Record<string, unknown> = {
      datasetId: "assessment-results",
      fields: ["school_id"],
    };
    Object.defineProperty(sliceSpec, "sliceId", {
      enumerable: true,
      get() {
        sliceIdReads += 1;
        throw new Error("sliceId accessor must not execute");
      },
    });
    const sliceResult = space.setQuery("spec-slice-accessor", sliceSpec as never);
    expect(sliceResult.ok).toBe(false);
    if (!sliceResult.ok) {
      expect(sliceResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.QUERY_INVALID,
      );
    }
    expect(sliceIdReads).toBe(0);

    let filterValueReads = 0;
    const filter: Record<string, unknown> = {
      fieldId: "score",
      operator: "greaterThan",
    };
    Object.defineProperty(filter, "value", {
      enumerable: true,
      get() {
        filterValueReads += 1;
        throw new Error("filter value accessor must not execute");
      },
    });
    const filterSpec = {
      datasetId: "assessment-results",
      fields: ["school_id"],
      filters: [filter],
    };
    const filterResult = space.setQuery("spec-filter-accessor", filterSpec as never);
    expect(filterResult.ok).toBe(false);
    if (!filterResult.ok) {
      expect(filterResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.QUERY_INVALID,
      );
    }
    expect(filterValueReads).toBe(0);
  });
});
