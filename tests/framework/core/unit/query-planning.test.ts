import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  buildQueryPlan,
  deriveQueryResultFields,
  queryFilterKey,
  type QuerySpec,
} from "../../../../packages/core/src/index.js";
import {
  ASSESSMENT_DESCRIPTOR,
  cloneAssessmentDescriptor,
} from "../fixtures/assessment-fixture.js";

function plan(spec: QuerySpec, descriptor = ASSESSMENT_DESCRIPTOR) {
  return buildQueryPlan(descriptor, spec, { providerId: "assessment-fixture" });
}

function codes(spec: QuerySpec, descriptor = ASSESSMENT_DESCRIPTOR): readonly string[] {
  const result = plan(spec, descriptor);
  return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("canonical query planning", () => {
  it("produces a deterministic canonical key for equivalent specifications", () => {
    const left = plan({
      datasetId: "assessment-results",
      sliceId: "all-results",
      fields: ["school_id", "score"],
      filters: [
        { id: "scores", fieldId: "score", operator: "greaterThan", value: 1 },
        { id: "schools", fieldId: "school_id", operator: "in", value: ["north", "east"] },
      ],
      orderBy: [{ key: "score", direction: "descending" }],
      limit: 20,
    });
    const right = plan({
      datasetId: "assessment-results",
      sliceId: "all-results",
      fields: ["school_id", "score"],
      filters: [
        { id: "schools", fieldId: "school_id", operator: "in", value: ["north", "east"] },
        { id: "scores", fieldId: "score", operator: "greaterThan", value: 1 },
      ],
      orderBy: [{ key: "score", direction: "descending" }],
      limit: 20,
    });
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }
    expect(left.value.key.value).toBe(right.value.key.value);
    expect(left.value.key.value.startsWith("BQK1:")).toBe(true);
    expect(left.value.operations).toEqual(["project", "filter", "order", "limit"]);
  });

  it("changes the key when projection, filter, grouping, aggregation or version changes", () => {
    const base = plan({ datasetId: "assessment-results", fields: ["school_id", "score"] });
    const projection = plan({ datasetId: "assessment-results", fields: ["school_id"] });
    const filter = plan({
      datasetId: "assessment-results",
      fields: ["school_id", "score"],
      filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
    });
    const grouping = plan({
      datasetId: "assessment-results",
      groupBy: [{ fieldId: "school_id" }],
      aggregations: [{ output: "total", type: "sum", fieldId: "score" }],
    });
    const aggregation = plan({
      datasetId: "assessment-results",
      groupBy: [{ fieldId: "school_id" }],
      aggregations: [{ output: "total", type: "average", fieldId: "score" }],
    });
    const version = plan(
      { datasetId: "assessment-results", fields: ["school_id", "score"] },
      cloneAssessmentDescriptor({ version: "2026.2" }),
    );
    expect(base.ok).toBe(true);
    const keys = [base, projection, filter, grouping, aggregation, version].map((result) =>
      result.ok ? result.value.key.value : "",
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives result metadata for projections, buckets and aggregations", () => {
    const result = plan({
      datasetId: "assessment-results",
      fields: ["school_id", "submitted_at"],
      groupBy: [
        { fieldId: "school_id" },
        {
          fieldId: "submitted_at",
          bucket: { grain: "day", timezone: "Asia/Tokyo" },
        },
      ],
      aggregations: [{ output: "attempts", type: "count" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.outputFields.map((field) => field.fieldId)).toEqual([
      "school_id",
      "submitted_at",
      "attempts",
    ]);
    const bucket = result.value.outputFields.find((field) => field.fieldId === "submitted_at");
    expect(bucket?.type).toBe("date");
    expect(bucket?.role).toBe("temporal");
    expect(bucket?.timezone).toBe("Asia/Tokyo");
    expect(result.value.operations).toContain("group");
    expect(result.value.operations).toContain("aggregate");
    const request = result.value.request;
    expect(deriveQueryResultFields(ASSESSMENT_DESCRIPTOR, request)).toEqual(
      result.value.outputFields,
    );
  });

  it("defaults to the selected slice fields when no projection is supplied", () => {
    const result = plan({ datasetId: "assessment-results", sliceId: "summary" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.request.fields).toEqual(
        ASSESSMENT_DESCRIPTOR.slices.find((slice) => slice.id === "summary")?.fieldIds,
      );
    }
  });

  it("keeps count and distinct-count outputs dimensionless", () => {
    const result = plan({
      datasetId: "assessment-results",
      groupBy: [{ fieldId: "school_id" }],
      aggregations: [
        { output: "attempts", type: "count", fieldId: "score" },
        { output: "students", type: "countDistinct", fieldId: "attendance_rate" },
        { output: "score_total", type: "sum", fieldId: "score" },
        { output: "score_average", type: "average", fieldId: "score" },
        { output: "score_median", type: "median", fieldId: "score" },
        { output: "score_min", type: "min", fieldId: "score" },
        { output: "score_max", type: "max", fieldId: "score" },
        { output: "score_mode", type: "mode", fieldId: "score" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byId = new Map(result.value.outputFields.map((field) => [field.fieldId, field]));
    expect(byId.get("attempts")?.unit).toBeUndefined();
    expect(byId.get("students")?.unit).toBeUndefined();
    for (const output of [
      "score_total",
      "score_average",
      "score_median",
      "score_min",
      "score_max",
      "score_mode",
    ]) {
      expect(byId.get(output)?.unit?.unit).toBe("points");
    }
  });

  it("rejects a window whose date-only endpoint does not exist in the declared zone", () => {
    expect(
      codes({
        datasetId: "assessment-results",
        fields: ["school_id"],
        timeWindow: {
          fieldId: "submitted_at",
          start: "2011-12-30",
          end: "2011-12-31",
          timezone: "Pacific/Apia",
          bounds: "half-open",
        },
      }),
    ).toContain(DIAGNOSTIC_CODES.QUERY_INVALID);
  });

  it("defaults to declared fields when no projection is supplied", () => {
    const result = plan({ datasetId: "assessment-results" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.request.fields).toEqual(
      ASSESSMENT_DESCRIPTOR.fields.map((field) => field.id),
    );
    expect(result.value.operations).toEqual(["project"]);
  });

  it("rejects unsupported operations, aggregations and filter operators", () => {
    expect(
      codes(
        {
          datasetId: "assessment-results",
          fields: ["school_id"],
          groupBy: [{ fieldId: "school_id" }],
        },
        cloneAssessmentDescriptor({
          capabilities: {
            ...ASSESSMENT_DESCRIPTOR.capabilities,
            grouping: false,
          },
        }),
      ),
    ).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);

    expect(
      codes(
        {
          datasetId: "assessment-results",
          groupBy: [{ fieldId: "school_id" }],
          aggregations: [{ output: "total", type: "sum", fieldId: "score" }],
        },
        cloneAssessmentDescriptor({
          capabilities: {
            ...ASSESSMENT_DESCRIPTOR.capabilities,
            aggregations: ["count"],
          },
        }),
      ),
    ).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);

    expect(
      codes(
        {
          datasetId: "assessment-results",
          fields: ["score"],
          filters: [{ fieldId: "score", operator: "greaterThan", value: 1 }],
        },
        cloneAssessmentDescriptor({
          capabilities: {
            ...ASSESSMENT_DESCRIPTOR.capabilities,
            filterOperators: ["equals"],
          },
        }),
      ),
    ).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);

    expect(
      codes(
        {
          datasetId: "assessment-results",
          fields: ["school_id"],
          timeWindow: {
            fieldId: "submitted_at",
            start: "2026-09-01",
            end: "2026-10-01",
            timezone: "UTC",
            bounds: "half-open",
          },
        },
        cloneAssessmentDescriptor({
          capabilities: {
            ...ASSESSMENT_DESCRIPTOR.capabilities,
            timeWindow: false,
          },
        }),
      ),
    ).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);
  });

  it("rejects unsupported slice operations and fields outside the slice", () => {
    expect(
      codes({
        datasetId: "assessment-results",
        sliceId: "summary",
        fields: ["school_id"],
        timeWindow: {
          fieldId: "submitted_at",
          start: "2026-09-01",
          end: "2026-10-01",
          timezone: "UTC",
          bounds: "half-open",
        },
      }),
    ).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);

    expect(
      codes({
        datasetId: "assessment-results",
        sliceId: "summary",
        fields: ["attendance_rate"],
      }),
    ).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);
  });

  it("rejects dataset versions, unknown fields, invalid order keys and empty projections", () => {
    expect(
      codes({
        datasetId: "assessment-results",
        datasetVersion: "2025.9",
        fields: ["score"],
      }),
    ).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);

    expect(codes({ datasetId: "another-dataset", fields: ["score"] })).toContain(
      DIAGNOSTIC_CODES.INVALID_REFERENCE,
    );

    expect(codes({ datasetId: "assessment-results", fields: ["missing"] })).toContain(
      DIAGNOSTIC_CODES.INVALID_REFERENCE,
    );

    expect(
      codes({
        datasetId: "assessment-results",
        fields: ["school_id"],
        orderBy: [{ key: "score", direction: "ascending" }],
      }),
    ).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);

    expect(codes({ datasetId: "assessment-results", fields: [] })).toContain(
      DIAGNOSTIC_CODES.QUERY_INVALID,
    );
  });

  it("rejects grouping timezone conversion without declared capability", () => {
    const result = codes(
      {
        datasetId: "assessment-results",
        groupBy: [
          {
            fieldId: "submitted_at",
            bucket: { grain: "day", timezone: "Asia/Tokyo" },
          },
        ],
        aggregations: [{ output: "attempts", type: "count" }],
      },
      cloneAssessmentDescriptor({
        capabilities: {
          ...ASSESSMENT_DESCRIPTOR.capabilities,
          timezoneConversion: false,
        },
      }),
    );
    expect(result).toContain(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH);
  });

  it("resolves prototype-name field and slice identifiers through own maps", () => {
    const descriptor = cloneAssessmentDescriptor({
      fields: [
        {
          id: "__proto__",
          key: "toString",
          type: "string",
          role: "dimension",
          nullable: false,
        },
        {
          id: "constructor",
          key: "__proto__",
          type: "number",
          role: "measure",
          nullable: true,
        },
      ],
      slices: [
        {
          id: "toString",
          datasetId: "assessment-results",
          fieldIds: ["__proto__", "constructor"],
        },
      ],
    });
    const result = plan(
      {
        datasetId: "assessment-results",
        sliceId: "toString",
        fields: ["__proto__", "constructor"],
        orderBy: [{ key: "__proto__", direction: "ascending" }],
      },
      descriptor,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputFields.map((field) => field.fieldId)).toEqual([
        "__proto__",
        "constructor",
      ]);
    }
  });

  it("returns query-spec accessor failures without executing getters", () => {
    let sliceReads = 0;
    const topLevel: Record<string, unknown> = {
      datasetId: "assessment-results",
      fields: ["school_id"],
    };
    Object.defineProperty(topLevel, "sliceId", {
      enumerable: true,
      get() {
        sliceReads += 1;
        throw new Error("slice accessor must not execute");
      },
    });
    const topResult = plan(topLevel as never);
    expect(topResult.ok).toBe(false);
    if (!topResult.ok) {
      expect(topResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.QUERY_INVALID,
      );
    }
    expect(sliceReads).toBe(0);

    let filterReads = 0;
    const filter: Record<string, unknown> = {
      fieldId: "score",
      operator: "greaterThan",
    };
    Object.defineProperty(filter, "value", {
      enumerable: true,
      get() {
        filterReads += 1;
        throw new Error("filter accessor must not execute");
      },
    });
    const filterResult = plan({
      datasetId: "assessment-results",
      fields: ["school_id"],
      filters: [filter as never],
    });
    expect(filterResult.ok).toBe(false);
    if (!filterResult.ok) {
      expect(filterResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.QUERY_INVALID,
      );
    }
    expect(filterReads).toBe(0);
  });

  it("rejects sparse query collections before normalization", () => {
    const sparseFields = new Array(2) as unknown[];
    sparseFields[1] = "school_id";
    const sparseGroups = new Array(2) as unknown[];
    sparseGroups[1] = { fieldId: "school_id" };
    const sparseAggregations = new Array(2) as unknown[];
    sparseAggregations[1] = { output: "attempts", type: "count" };
    const sparseFilters = new Array(2) as unknown[];
    sparseFilters[1] = { fieldId: "school_id", operator: "equals", value: "north" };
    const sparseOrders = new Array(2) as unknown[];
    sparseOrders[1] = { key: "school_id", direction: "ascending" };
    const cases: QuerySpec[] = [
      { datasetId: "assessment-results", fields: sparseFields as never },
      { datasetId: "assessment-results", groupBy: sparseGroups as never },
      { datasetId: "assessment-results", aggregations: sparseAggregations as never },
      {
        datasetId: "assessment-results",
        fields: ["school_id"],
        filters: sparseFilters as never,
      },
      {
        datasetId: "assessment-results",
        fields: ["school_id"],
        orderBy: sparseOrders as never,
      },
    ];
    for (const spec of cases) {
      const result = plan(spec);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          DIAGNOSTIC_CODES.QUERY_INVALID,
        );
        expect(result.diagnostics.some((diagnostic) => diagnostic.path.includes("/0"))).toBe(true);
      }
    }
  });

  it("rejects filter and window timezone conversion without declared capability", () => {
    const noConversion = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        timezoneConversion: false,
      },
    });
    const filterResult = plan(
      {
        datasetId: "assessment-results",
        fields: ["school_id"],
        filters: [
          {
            fieldId: "submitted_at",
            operator: "after",
            value: "2026-10-01T00:00:00Z",
            timezone: "Asia/Tokyo",
          },
        ],
      },
      noConversion,
    );
    expect(filterResult.ok).toBe(false);
    if (!filterResult.ok) {
      expect(filterResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      );
      expect(filterResult.diagnostics.map((diagnostic) => diagnostic.path)).toContain(
        "/filters/0/timezone",
      );
    }

    const windowResult = plan(
      {
        datasetId: "assessment-results",
        fields: ["school_id"],
        timeWindow: {
          fieldId: "submitted_at",
          start: "2026-10-01T00:00:00Z",
          end: "2026-10-02T00:00:00Z",
          timezone: "Asia/Tokyo",
          bounds: "half-open",
        },
      },
      noConversion,
    );
    expect(windowResult.ok).toBe(false);
    if (!windowResult.ok) {
      expect(windowResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      );
      expect(windowResult.diagnostics.map((diagnostic) => diagnostic.path)).toContain(
        "/timeWindow/timezone",
      );
    }
  });

  it("distinguishes skipped start and end dates from ordering errors", () => {
    const startSkipped = plan({
      datasetId: "assessment-results",
      fields: ["school_id"],
      timeWindow: {
        fieldId: "submitted_at",
        start: "2011-12-30",
        end: "2011-12-31",
        timezone: "Pacific/Apia",
        bounds: "half-open",
      },
    });
    expect(startSkipped.ok).toBe(false);
    if (!startSkipped.ok) {
      expect(startSkipped.diagnostics[0]?.path).toBe("/timeWindow/start");
      expect(startSkipped.diagnostics[0]?.message).toContain("start date does not occur");
    }

    const endSkipped = plan({
      datasetId: "assessment-results",
      fields: ["school_id"],
      timeWindow: {
        fieldId: "submitted_at",
        start: "2011-12-29",
        end: "2011-12-30",
        timezone: "Pacific/Apia",
        bounds: "half-open",
      },
    });
    expect(endSkipped.ok).toBe(false);
    if (!endSkipped.ok) {
      expect(endSkipped.diagnostics[0]?.path).toBe("/timeWindow/end");
      expect(endSkipped.diagnostics[0]?.message).toContain("end date does not occur");
    }

    const ordering = plan({
      datasetId: "assessment-results",
      fields: ["school_id"],
      timeWindow: {
        fieldId: "submitted_at",
        start: "2026-10-05T00:00:00Z",
        end: "2026-10-01T00:00:00Z",
        timezone: "UTC",
        bounds: "half-open",
      },
    });
    expect(ordering.ok).toBe(false);
    if (!ordering.ok) {
      expect(ordering.diagnostics[0]?.path).toBe("/timeWindow/start");
      expect(ordering.diagnostics[0]?.message).toContain("must not be after");
    }
  });

  it("normalizes temporal filters and keeps filter keys stable", () => {
    const result = plan({
      datasetId: "assessment-results",
      fields: ["score"],
      filters: [
        {
          fieldId: "submitted_at",
          operator: "between",
          value: ["2026-09-30T00:00:00Z", "2026-10-02T00:00:00Z"],
          bounds: "half-open",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const filter = result.value.request.filters[0];
    expect(filter?.timezone).toBe("UTC");
    expect(filter && queryFilterKey(filter)).toBe(
      filter && queryFilterKey({ ...filter, id: "renamed" }),
    );
  });
});
