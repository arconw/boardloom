import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  alignComparisonResults,
  buildComparisonPlan,
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
  type BoardDocumentV1,
  type ComparisonDefinition,
  type DatasetDescriptor,
  type DatasetQueryResult,
  type QueryResultRow,
} from "../../../../packages/core/src/index.js";

function descriptor(
  id: string,
  options: {
    readonly scoreUnit?: string;
    readonly rows?: boolean;
  } = {},
): DatasetDescriptor {
  return {
    id,
    version: "2026.1",
    timezone: "UTC",
    temporalRepresentation: "iso8601-offset",
    fields: [
      {
        id: "subject",
        key: "subject",
        type: "string",
        role: "dimension",
        nullable: false,
      },
      {
        id: "grade",
        key: "grade",
        type: "string",
        role: "dimension",
        nullable: false,
      },
      {
        id: "score",
        key: "score",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit: options.scoreUnit ?? "points" },
      },
      {
        id: "submittedAt",
        key: "submittedAt",
        type: "datetime",
        role: "temporal",
        nullable: false,
        timezone: "UTC",
        temporalRepresentation: "iso8601-offset",
      },
    ],
    slices: [
      {
        id: "term",
        datasetId: id,
        fieldIds: ["subject", "grade", "score", "submittedAt"],
        supportedOperations: ["filter", "group", "aggregate", "timeWindow"],
      },
    ],
    capabilities: {
      grouping: true,
      aggregations: ["average", "sum", "count"],
      filterOperators: ["equals", "between"],
      timeWindow: true,
      timezoneConversion: true,
      local: true,
      pushdownFilters: true,
      serverPaging: false,
      realtime: false,
      comparison: true,
      maxResultSize: null,
    },
  };
}

function rows(
  values: readonly (readonly [string, string, number | null, string])[],
): readonly QueryResultRow[] {
  return values.map(([subject, grade, score, submittedAt]) => ({
    subject,
    grade,
    score,
    submittedAt,
  }));
}

function documentFor(
  comparison: Partial<ComparisonDefinition> = {},
  options: {
    readonly alignmentKeys?: readonly string[];
    readonly bindings?: BoardDocumentV1["blocks"][number]["bindings"];
    readonly omitMapping?: readonly string[];
    readonly referenceUnit?: string;
    readonly unitPolicy?: ComparisonDefinition["unitPolicy"];
  } = {},
): BoardDocumentV1 {
  return {
    schemaVersion: 1,
    id: "comparison-board",
    title: "Comparison board",
    createdAt: 1,
    updatedAt: 1,
    theme: { mode: "light" },
    datasets: [
      {
        id: "current",
        provider: "test",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "grade", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
          { id: "submittedAt", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
      {
        id: "previous",
        provider: "test",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "grade", type: "string", role: "dimension" },
          {
            id: "score",
            type: "number",
            role: "measure",
            unit: options.referenceUnit ?? "points",
          },
          { id: "submittedAt", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
    ],
    slices: [
      {
        id: "term",
        datasetId: "current",
        fieldIds: ["subject", "grade", "score", "submittedAt"],
      },
      {
        id: "term",
        datasetId: "previous",
        fieldIds: ["subject", "grade", "score", "submittedAt"],
      },
    ],
    blocks: [
      {
        id: "chart",
        type: "chart",
        bindings: options.bindings ?? [
          {
            id: "chart-subject",
            role: "dimension",
            axis: "x",
            field: { datasetId: "current", fieldId: "subject" },
            sliceId: "term",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "current", fieldId: "score" },
            sliceId: "term",
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar", comparisonId: "previous-term" },
      },
    ],
    filters: [],
    comparisons: [
      {
        id: "previous-term",
        label: "Previous term",
        displayMode: "overlay",
        deltaMode: "both",
        base: { datasetId: "current", sliceId: "term" },
        reference: { datasetId: "previous", sliceId: "term" },
        mapping: [
          {
            primary: { datasetId: "current", fieldId: "subject" },
            reference: { datasetId: "previous", fieldId: "subject" },
            role: "dimension",
          },
          {
            primary: { datasetId: "current", fieldId: "grade" },
            reference: { datasetId: "previous", fieldId: "grade" },
            role: "dimension",
          },
          {
            primary: { datasetId: "current", fieldId: "submittedAt" },
            reference: { datasetId: "previous", fieldId: "submittedAt" },
            role: "dimension",
          },
          {
            primary: { datasetId: "current", fieldId: "score" },
            reference: { datasetId: "previous", fieldId: "score" },
            role: "measure",
          },
        ],
        alignment: {
          keys: options.alignmentKeys ?? ["subject"],
          collation: "unicode",
          normalization: "none",
        },
        unitPolicy: options.unitPolicy ?? { mode: "identical" },
        ...comparison,
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        placements: [{ blockId: "chart", x: 0, y: 0, width: 12, height: 4 }],
      },
    },
  } as BoardDocumentV1;
}

function omitMappings(document: BoardDocumentV1, fieldIds: readonly string[]): BoardDocumentV1 {
  if (document.comparisons === undefined) {
    return document;
  }
  return {
    ...document,
    comparisons: document.comparisons.map((comparison) => ({
      ...comparison,
      mapping: comparison.mapping.filter((mapping) => !fieldIds.includes(mapping.primary.fieldId)),
    })),
  };
}

const currentRows = rows([
  ["math", "A", 5, "2026-02-01T10:00:00Z"],
  ["reading", "B", 4, "2026-02-02T10:00:00Z"],
  ["science", "A", null, "2026-02-03T10:00:00Z"],
]);

const previousRows = rows([
  ["math", "A", 2, "2025-02-01T10:00:00Z"],
  ["reading", "B", 8, "2025-02-02T10:00:00Z"],
  ["science", "A", 9, "2025-02-03T10:00:00Z"],
  ["history", "B", 6, "2025-02-04T10:00:00Z"],
]);

function descriptors(referenceUnit = "points"): Record<string, DatasetDescriptor> {
  return {
    current: descriptor("current"),
    previous: descriptor("previous", { scoreUnit: referenceUnit }),
  };
}

describe("comparison query planning and execution", () => {
  it("builds two dataset-qualified query plans and aligns their provider results", () => {
    const planResult = buildComparisonPlan(documentFor(), "previous-term", "chart", {
      descriptors: descriptors(),
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) {
      return;
    }
    const plan = planResult.value;
    expect(plan.primary.request.datasetId).toBe("current");
    expect(plan.reference.request.datasetId).toBe("previous");
    expect(plan.primary.request.groupBy).toEqual([{ fieldId: "subject" }]);
    expect(plan.reference.request.groupBy).toEqual([{ fieldId: "subject" }]);
    expect(plan.primary.request.aggregations).toEqual([
      { output: "chart-score", type: "average", fieldId: "score" },
    ]);
    expect(plan.reference.request.aggregations).toEqual([
      { output: "chart-score", type: "average", fieldId: "score" },
    ]);
    expect(plan.primary.request.comparisonInput).toMatchObject({
      comparisonId: "previous-term",
      side: "primary",
    });
    expect(plan.reference.request.comparisonInput).toMatchObject({
      comparisonId: "previous-term",
      side: "reference",
    });

    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const context = (side: string) => ({
      signal: { aborted: false, addEventListener() {}, removeEventListener() {} },
      requestId: side,
      requestToken: 1,
      queryKey: side,
      generation: 1,
    });
    const primary = provider.value.query(
      plan.primary.request,
      context("primary"),
    ) as DatasetQueryResult;
    const reference = provider.value.query(
      plan.reference.request,
      context("reference"),
    ) as DatasetQueryResult;
    expect(primary.ok).toBe(true);
    expect(reference.ok).toBe(true);
    if (!primary.ok || !reference.ok) {
      return;
    }
    const aligned = alignComparisonResults(plan, primary, reference);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) {
      return;
    }
    expect(aligned.value.counts).toMatchObject({
      rowCount: 4,
      matchedRowCount: 3,
      primaryOnlyCount: 0,
      referenceOnlyCount: 1,
      matchedNonNullMeasureCount: { "chart-score": 2 },
      excludedNullKeyCount: 0,
    });
    const math = aligned.value.rows.find((row) => row.key[0] === "math");
    expect(math?.measures[0]?.absolute.value).toBe(3);
    expect(math?.measures[0]?.percentage.value).toBe(150);
    const science = aligned.value.rows.find((row) => row.key[0] === "science");
    expect(science?.measures[0]?.absolute.reason).toBe("PRIMARY_NULL");
    const history = aligned.value.rows.find((row) => row.key[0] === "history");
    expect(history?.measures[0]?.absolute.reason).toBe("REFERENCE_ONLY");
    expect(history?.measures[0]?.absolute.value).toBeNull();
  });

  it("rejects incompatible units and incomplete mappings with diagnostics", () => {
    const units = buildComparisonPlan(documentFor(), "previous-term", "chart", {
      descriptors: descriptors("percent"),
    });
    expect(units.ok).toBe(false);
    if (!units.ok) {
      expect(units.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
      );
    }

    const incomplete = buildComparisonPlan(
      omitMappings(
        documentFor(
          {},
          {
            bindings: [
              {
                id: "chart-grade",
                role: "dimension",
                axis: "x",
                field: { datasetId: "current", fieldId: "grade" },
                sliceId: "term",
              },
              {
                id: "chart-score",
                role: "measure",
                axis: "y",
                field: { datasetId: "current", fieldId: "score" },
                sliceId: "term",
                aggregation: { type: "average" },
              },
            ],
            alignmentKeys: ["grade"],
          },
        ),
        ["grade"],
      ),
      "previous-term",
      "chart",
      { descriptors: descriptors() },
    );
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.COMPARISON_MAPPING_INCOMPLETE,
      );
    }
  });

  it("applies explicit unit conversion to reference values", () => {
    const document = documentFor({
      unitPolicy: {
        mode: "explicit",
        conversions: [
          {
            from: "points",
            to: "percent",
            factor: 2,
            provider: "local.fixture",
            lossless: true,
          },
        ],
      },
    });
    const planResult = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: descriptors("percent"),
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) {
      return;
    }
    const plan = planResult.value;
    expect(plan.measures[0]?.conversion).toMatchObject({
      factor: 2,
      direction: "primary-to-reference",
    });
    const aligned = alignComparisonResults(
      plan,
      { rows: [{ subject: "math", "chart-score": 5 }] },
      { rows: [{ subject: "math", "chart-score": 4 }] },
    );
    expect(aligned.ok).toBe(true);
    if (aligned.ok) {
      expect(aligned.value.rows[0]?.measures[0]?.reference.value).toBe(2);
      expect(aligned.value.rows[0]?.measures[0]?.absolute.value).toBe(3);
    }
  });

  it("rejects duplicate composite keys after aggregation instead of choosing a row", () => {
    const planResult = buildComparisonPlan(
      documentFor(
        {},
        {
          bindings: [
            {
              id: "chart-subject",
              role: "dimension",
              axis: "x",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term",
            },
            {
              id: "chart-grade",
              role: "group",
              field: { datasetId: "current", fieldId: "grade" },
              sliceId: "term",
            },
            {
              id: "chart-score",
              role: "measure",
              axis: "y",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term",
              aggregation: { type: "average" },
            },
          ],
        },
      ),
      "previous-term",
      "chart",
      { descriptors: descriptors() },
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) {
      return;
    }
    const aligned = alignComparisonResults(
      planResult.value,
      {
        rows: [
          { subject: "math", "chart-score": 5 },
          { subject: "math", "chart-score": 7 },
        ],
      },
      { rows: [{ subject: "math", "chart-score": 2 }] },
    );
    expect(aligned.ok).toBe(false);
    if (!aligned.ok) {
      expect(aligned.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.DUPLICATE_ALIGNMENT_KEY,
      );
    }
  });

  it("keeps primary and reference time windows independent", () => {
    const document = documentFor(
      {
        windows: {
          primary: {
            timezone: "America/New_York",
            start: "2026-01-01",
            end: "2026-06-30",
            bounds: "inclusive",
          },
          reference: {
            timezone: "Europe/Paris",
            start: "2025-01-01",
            end: "2025-06-30",
            bounds: "half-open",
          },
        },
      },
      {
        bindings: [
          {
            id: "chart-date",
            role: "dimension",
            axis: "x",
            bucket: { grain: "day", timezone: "UTC" },
            field: { datasetId: "current", fieldId: "submittedAt" },
            sliceId: "term",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "current", fieldId: "score" },
            sliceId: "term",
            aggregation: { type: "average" },
          },
        ],
        alignmentKeys: ["submittedAt"],
      },
    );
    const planResult = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: descriptors(),
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) {
      return;
    }
    expect(planResult.value.primary.request.timeWindow).toEqual({
      fieldId: "submittedAt",
      start: "2026-01-01",
      end: "2026-06-30",
      timezone: "America/New_York",
      bounds: "inclusive",
    });
    expect(planResult.value.reference.request.timeWindow).toEqual({
      fieldId: "submittedAt",
      start: "2025-01-01",
      end: "2025-06-30",
      timezone: "Europe/Paris",
      bounds: "half-open",
    });
  });

  it("rejects a time window when no mapped temporal field exists", () => {
    const document = documentFor({
      windows: {
        primary: {
          timezone: "UTC",
          start: "2026-01-01",
          end: "2026-06-30",
          bounds: "inclusive",
        },
      },
    });
    const planResult = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: descriptors(),
    });
    expect(planResult.ok).toBe(false);
    if (!planResult.ok) {
      expect(planResult.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.COMPARISON_WINDOW_FIELD_MISSING,
      );
    }
  });

  it("ignores mapped measures that the block does not bind", () => {
    const withCount = (id: string): DatasetDescriptor => ({
      ...descriptor(id),
      fields: [
        ...descriptor(id).fields,
        {
          id: "count",
          key: "count",
          type: "number",
          role: "measure",
          nullable: true,
          unit: { unit: "items" },
        },
      ],
    });
    const base = documentFor();
    const comparison = base.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    const document = {
      ...base,
      comparisons: [
        {
          ...comparison,
          mapping: [
            ...comparison.mapping,
            {
              primary: { datasetId: "current", fieldId: "count" },
              reference: { datasetId: "previous", fieldId: "count" },
              role: "measure" as const,
            },
          ],
        },
      ],
    } as BoardDocumentV1;
    const plan = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: { current: withCount("current"), previous: withCount("previous") },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.value.measures.map((measure) => measure.id)).toEqual(["chart-score"]);
    expect(plan.value.primary.request.aggregations).toHaveLength(1);
    expect(plan.value.reference.request.aggregations).toHaveLength(1);
    const aligned = alignComparisonResults(
      plan.value,
      { rows: [{ subject: "math", "chart-score": 5, count: 99 }] },
      { rows: [{ subject: "math", "chart-score": 2, count: 77 }] },
    );
    expect(aligned.ok).toBe(true);
    if (aligned.ok) {
      expect(aligned.value.measures.map((measure) => measure.id)).toEqual(["chart-score"]);
      expect(aligned.value.rows[0]?.measures).toHaveLength(1);
      expect(aligned.value.counts.matchedNonNullMeasureCount).toEqual({ "chart-score": 1 });
    }
  });

  it("selects a grouped mapped temporal field for a time window", () => {
    const document = {
      ...documentFor(
        {
          windows: {
            primary: {
              timezone: "UTC",
              start: "2026-01-01",
              end: "2026-06-30",
              bounds: "inclusive",
            },
            reference: {
              timezone: "UTC",
              start: "2025-01-01",
              end: "2025-06-30",
              bounds: "inclusive",
            },
          },
        },
        {
          alignmentKeys: ["subject"],
          bindings: [
            {
              id: "chart-subject",
              role: "dimension",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term",
            },
            {
              id: "chart-date",
              role: "group",
              field: { datasetId: "current", fieldId: "submittedAt" },
              sliceId: "term",
              bucket: { grain: "month", timezone: "UTC" },
            },
            {
              id: "chart-score",
              role: "measure",
              axis: "y",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term",
              aggregation: { type: "average" as const },
            },
          ],
        },
      ),
      blocks: [
        {
          id: "chart",
          type: "table",
          bindings: [
            {
              id: "chart-subject",
              role: "dimension",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term",
            },
            {
              id: "chart-date",
              role: "group",
              field: { datasetId: "current", fieldId: "submittedAt" },
              sliceId: "term",
              bucket: { grain: "month", timezone: "UTC" },
            },
            {
              id: "chart-score",
              role: "measure",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term",
              aggregation: { type: "average" as const },
            },
          ],
          config: { comparisonId: "previous-term" },
        },
      ],
    } as BoardDocumentV1;
    const plan = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: descriptors(),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.value.primary.request.timeWindow?.fieldId).toBe("submittedAt");
    expect(plan.value.reference.request.timeWindow?.fieldId).toBe("submittedAt");
  });

  it("allows side-by-side without deltas when units differ and rejects overlay", () => {
    const sideBySide = documentFor(
      { displayMode: "side-by-side", deltaMode: "none" },
      { referenceUnit: "percent" },
    );
    const plan = buildComparisonPlan(sideBySide, "previous-term", "chart", {
      descriptors: descriptors("percent"),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.value.measures[0]?.conversion).toBeNull();
    expect(plan.value.measures[0]?.referenceUnit).toEqual({ unit: "percent" });
    const aligned = alignComparisonResults(
      plan.value,
      { rows: [{ subject: "math", "chart-score": 5 }] },
      { rows: [{ subject: "math", "chart-score": 4 }] },
    );
    expect(aligned.ok).toBe(true);
    if (aligned.ok) {
      const measure = aligned.value.rows[0]?.measures[0];
      expect(measure?.reference.rawValue).toBe(4);
      expect(measure?.reference.value).toBe(4);
      expect(measure?.absolute).toEqual({
        available: false,
        value: null,
        reason: "UNIT_MISMATCH",
      });
      expect(measure?.percentage.reason).toBe("UNIT_MISMATCH");
    }

    const overlay = buildComparisonPlan(
      documentFor({}, { referenceUnit: "percent" }),
      "previous-term",
      "chart",
      { descriptors: descriptors("percent") },
    );
    expect(overlay.ok).toBe(false);
    if (!overlay.ok) {
      expect(overlay.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
      );
    }
  });

  it("rejects equal unit names with different scales even when a conversion is declared", () => {
    const primary = descriptor("current");
    const reference = descriptor("previous");
    const scaled = (value: DatasetDescriptor, scale: number): DatasetDescriptor => ({
      ...value,
      fields: value.fields.map((field) =>
        field.id === "score" ? { ...field, unit: { unit: "percent", scale } } : field,
      ),
    });
    const document = documentFor(
      {},
      {
        referenceUnit: "percent",
        unitPolicy: {
          mode: "explicit",
          conversions: [
            {
              from: "percent",
              to: "percent",
              factor: 1,
              provider: "local.fixture",
              lossless: true,
            },
          ],
        },
      },
    );
    const plan = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: { current: scaled(primary, 100), previous: scaled(reference, 1) },
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
      );
    }
  });

  it("does not resolve inherited descriptor or provider identities", () => {
    const base = documentFor();
    const comparison = base.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    const document = {
      ...base,
      comparisons: [
        {
          ...comparison,
          base: { datasetId: "constructor", sliceId: "term" },
          reference: { datasetId: "toString", sliceId: "term" },
        },
      ],
    } as BoardDocumentV1;
    const plan = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: {},
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.QUERY_PROVIDER_MISSING,
      );
    }
  });

  it("does not convert count aggregates as source measures", () => {
    const document = documentFor(
      {},
      {
        referenceUnit: "percent",
        unitPolicy: {
          mode: "explicit",
          conversions: [
            {
              from: "points",
              to: "percent",
              factor: 2,
              provider: "local.fixture",
              lossless: true,
            },
          ],
        },
        bindings: [
          {
            id: "chart-subject",
            role: "dimension",
            axis: "x",
            field: { datasetId: "current", fieldId: "subject" },
            sliceId: "term",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "current", fieldId: "score" },
            sliceId: "term",
            aggregation: { type: "count" },
          },
        ],
      },
    );
    const plan = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: descriptors("percent"),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.value.measures[0]?.primaryUnit).toBeNull();
    expect(plan.value.measures[0]?.referenceUnit).toBeNull();
    expect(plan.value.measures[0]?.conversion).toBeNull();
    const aligned = alignComparisonResults(
      plan.value,
      { rows: [{ subject: "math", "chart-score": 4 }] },
      { rows: [{ subject: "math", "chart-score": 2 }] },
    );
    expect(aligned.ok).toBe(true);
    if (aligned.ok) {
      expect(aligned.value.rows[0]?.measures[0]?.absolute.value).toBe(2);
      expect(aligned.value.rows[0]?.measures[0]?.percentage.value).toBe(100);
    }
  });

  it("rejects conversions that change aggregate semantics", () => {
    const bindingsFor = (aggregation: "sum" | "min" | "max") => [
      {
        id: "chart-subject",
        role: "dimension" as const,
        axis: "x" as const,
        field: { datasetId: "current", fieldId: "subject" },
        sliceId: "term",
      },
      {
        id: "chart-score",
        role: "measure" as const,
        axis: "y" as const,
        field: { datasetId: "current", fieldId: "score" },
        sliceId: "term",
        aggregation: { type: aggregation },
      },
    ];
    const sum = buildComparisonPlan(
      documentFor(
        {},
        {
          referenceUnit: "percent",
          unitPolicy: {
            mode: "explicit",
            conversions: [
              {
                from: "points",
                to: "percent",
                factor: 2,
                offset: 5,
                provider: "local.fixture",
                lossless: true,
              },
            ],
          },
          bindings: bindingsFor("sum"),
        },
      ),
      "previous-term",
      "chart",
      { descriptors: descriptors("percent") },
    );
    expect(sum.ok).toBe(false);
    if (!sum.ok) {
      expect(sum.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.COMPARISON_CONVERSION_UNSUPPORTED,
      );
    }

    const min = buildComparisonPlan(
      documentFor(
        {},
        {
          referenceUnit: "percent",
          unitPolicy: {
            mode: "explicit",
            conversions: [
              {
                from: "points",
                to: "percent",
                factor: -1,
                provider: "local.fixture",
                lossless: true,
              },
            ],
          },
          bindings: bindingsFor("min"),
        },
      ),
      "previous-term",
      "chart",
      { descriptors: descriptors("percent") },
    );
    expect(min.ok).toBe(false);
    if (!min.ok) {
      expect(min.diagnostics.map((entry) => entry.code)).toContain(
        DIAGNOSTIC_CODES.COMPARISON_CONVERSION_UNSUPPORTED,
      );
    }
  });

  it("orders comparison changes before a reentrant draft operation", () => {
    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const runtime = createRuntime({
      datasetProvider: provider.value,
      validationCatalog: createBoardValidationCatalog([
        descriptor("current"),
        descriptor("previous"),
      ]),
    });
    const space = runtime.createSpace({ document: documentFor() });
    if (!space.ok) {
      return;
    }
    const lease = space.value.acquireEditorLease({ sessionId: "comparison-order" });
    if (!lease.ok) {
      return;
    }
    const labels: string[] = [];
    let reentered = false;
    const unsubscribe = space.value.subscribe((event) => {
      if (event.type === "comparison:changed") {
        labels.push(event.label ?? "");
      }
      if (event.type === "draft:changed" && !reentered) {
        reentered = true;
        const current = space.value.getSnapshot().draft?.document as unknown as
          BoardDocumentV1 | undefined;
        const comparison = current?.comparisons?.[0];
        if (current !== undefined && comparison !== undefined) {
          space.value.updateDraft(lease.value, {
            ...current,
            comparisons: [{ ...comparison, label: "Nested" }],
          });
        }
      }
    });
    const base = documentFor();
    const comparison = base.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    const updated = space.value.updateDraft(lease.value, {
      ...base,
      comparisons: [{ ...comparison, label: "Outer" }],
    });
    unsubscribe();
    expect(updated.ok).toBe(true);
    expect(labels).toEqual(["Outer", "Nested"]);
  });

  it("orders comparison changes before diagnostic-triggered re-entry", () => {
    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const runtime = createRuntime({
      datasetProvider: provider.value,
      validationCatalog: createBoardValidationCatalog([
        descriptor("current"),
        descriptor("previous"),
      ]),
    });
    const space = runtime.createSpace({ document: documentFor() });
    if (!space.ok) {
      return;
    }
    const lease = space.value.acquireEditorLease({ sessionId: "comparison-diagnostics" });
    if (!lease.ok) {
      return;
    }
    const invalid = JSON.parse(JSON.stringify(documentFor())) as {
      blocks: Array<{ config: Record<string, unknown> }>;
    };
    const invalidBlock = invalid.blocks[0];
    if (invalidBlock === undefined) {
      return;
    }
    invalidBlock.config.visualization = "invalid";
    expect(space.value.updateDraft(lease.value, invalid).ok).toBe(false);
    expect(space.value.getSnapshot().diagnostics.length).toBeGreaterThan(0);

    const labels: string[] = [];
    let reentered = false;
    const unsubscribe = space.value.subscribe((event) => {
      if (event.type === "comparison:changed") {
        labels.push(event.label ?? "");
      }
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        const current = space.value.getSnapshot().draft?.document as unknown as
          BoardDocumentV1 | undefined;
        const comparison = current?.comparisons?.[0];
        if (current !== undefined && comparison !== undefined) {
          space.value.updateDraft(lease.value, {
            ...current,
            comparisons: [{ ...comparison, label: "Nested" }],
          });
        }
      }
    });
    const base = documentFor();
    const comparison = base.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    expect(
      space.value.updateDraft(lease.value, {
        ...base,
        comparisons: [{ ...comparison, label: "Outer" }],
      }).ok,
    ).toBe(true);
    unsubscribe();
    expect(labels).toEqual(["Outer", "Nested"]);
  });

  it("orders undo comparison changes before diagnostic-triggered re-entry", () => {
    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const runtime = createRuntime({
      datasetProvider: provider.value,
      validationCatalog: createBoardValidationCatalog([
        descriptor("current"),
        descriptor("previous"),
      ]),
    });
    const space = runtime.createSpace({ document: documentFor() });
    if (!space.ok) {
      return;
    }
    const lease = space.value.acquireEditorLease({ sessionId: "comparison-undo-diagnostics" });
    if (!lease.ok) {
      return;
    }
    const base = documentFor();
    const comparison = base.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    expect(
      space.value.updateDraft(lease.value, {
        ...base,
        comparisons: [{ ...comparison, label: "Changed" }],
      }).ok,
    ).toBe(true);
    const invalid = JSON.parse(JSON.stringify(documentFor())) as {
      blocks: Array<{ config: Record<string, unknown> }>;
    };
    const invalidBlock = invalid.blocks[0];
    if (invalidBlock === undefined) {
      return;
    }
    invalidBlock.config.visualization = "invalid";
    expect(space.value.updateDraft(lease.value, invalid).ok).toBe(false);
    expect(space.value.getSnapshot().diagnostics.length).toBeGreaterThan(0);

    const labels: string[] = [];
    let reentered = false;
    const unsubscribe = space.value.subscribe((event) => {
      if (event.type === "comparison:changed") {
        labels.push(event.label ?? "");
      }
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        const current = space.value.getSnapshot().draft?.document as unknown as
          BoardDocumentV1 | undefined;
        const currentComparison = current?.comparisons?.[0];
        if (current !== undefined && currentComparison !== undefined) {
          space.value.updateDraft(lease.value, {
            ...current,
            comparisons: [{ ...currentComparison, label: "Nested" }],
          });
        }
      }
    });
    expect(space.value.undoDraft(lease.value).ok).toBe(true);
    unsubscribe();
    expect(labels).toEqual(["Previous term", "Nested"]);
  });

  it("orders document-load comparison changes before diagnostic-triggered re-entry", () => {
    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const runtime = createRuntime({
      datasetProvider: provider.value,
      validationCatalog: createBoardValidationCatalog([
        descriptor("current"),
        descriptor("previous"),
      ]),
    });
    const space = runtime.createSpace({ document: documentFor() });
    if (!space.ok) {
      return;
    }
    expect(space.value.loadDocument({ schemaVersion: 1, title: "Broken" }).ok).toBe(false);
    expect(space.value.getSnapshot().diagnostics.length).toBeGreaterThan(0);
    const outerDocument = documentFor();
    const outerComparison = outerDocument.comparisons?.[0];
    const nestedDocument = documentFor();
    const nestedComparison = nestedDocument.comparisons?.[0];
    if (outerComparison === undefined || nestedComparison === undefined) {
      return;
    }
    const labels: string[] = [];
    const titles: string[] = [];
    let reentered = false;
    const unsubscribe = space.value.subscribe((event) => {
      if (event.type === "comparison:changed") {
        labels.push(event.label ?? "");
      }
      if (event.type === "document:changed") {
        titles.push(String(event.document.title ?? ""));
      }
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        space.value.loadDocument({
          ...nestedDocument,
          title: "Nested",
          comparisons: [{ ...nestedComparison, label: "Nested" }],
        });
      }
    });
    expect(
      space.value.loadDocument({
        ...outerDocument,
        title: "Outer",
        comparisons: [{ ...outerComparison, label: "Outer" }],
      }).ok,
    ).toBe(true);
    unsubscribe();
    expect(labels).toEqual(["Outer", "Nested"]);
    expect(titles).toEqual(["Outer", "Nested"]);
  });

  it("emits comparison changes for undo and redo", () => {
    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const runtime = createRuntime({
      datasetProvider: provider.value,
      validationCatalog: createBoardValidationCatalog([
        descriptor("current"),
        descriptor("previous"),
      ]),
    });
    const space = runtime.createSpace({ document: documentFor() });
    if (!space.ok) {
      return;
    }
    const lease = space.value.acquireEditorLease({ sessionId: "comparison-undo" });
    if (!lease.ok) {
      return;
    }
    const base = documentFor();
    const comparison = base.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    expect(
      space.value.updateDraft(lease.value, {
        ...base,
        comparisons: [{ ...comparison, label: "Changed" }],
      }).ok,
    ).toBe(true);
    let comparisonEvents = 0;
    const unsubscribe = space.value.subscribe((event) => {
      if (event.type === "comparison:changed") {
        comparisonEvents += 1;
      }
    });
    expect(space.value.undoDraft(lease.value).ok).toBe(true);
    const afterUndo = comparisonEvents;
    expect(space.value.redoDraft(lease.value).ok).toBe(true);
    unsubscribe();
    expect(afterUndo).toBeGreaterThanOrEqual(1);
    expect(comparisonEvents).toBeGreaterThan(afterUndo);
  });

  it("emits comparison:changed with the comparison identity on draft changes", () => {
    const provider = createLocalDatasetProvider({
      providerId: "test",
      datasets: [
        { descriptor: descriptor("current"), rows: currentRows },
        { descriptor: descriptor("previous"), rows: previousRows },
      ],
    });
    if (!provider.ok) {
      return;
    }
    const runtime = createRuntime({
      datasetProvider: provider.value,
      validationCatalog: createBoardValidationCatalog([
        descriptor("current"),
        descriptor("previous"),
      ]),
    });
    const space = runtime.createSpace({ document: documentFor() });
    if (!space.ok) {
      return;
    }
    const events: {
      readonly type: string;
      readonly comparisonId?: string;
      readonly active?: boolean;
    }[] = [];
    const unsubscribe = space.value.subscribe((event) => {
      if (event.type === "comparison:changed") {
        events.push(event);
      }
    });
    const lease = space.value.acquireEditorLease({ sessionId: "comparison-event" });
    if (!lease.ok) {
      return;
    }
    const document = documentFor();
    const comparison = document.comparisons?.[0];
    if (comparison === undefined) {
      return;
    }
    const changed = {
      ...document,
      comparisons: [{ ...comparison, displayMode: "side-by-side" as const }],
    };
    const updated = space.value.updateDraft(lease.value, changed);
    unsubscribe();
    expect(updated.ok).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "comparison:changed",
        comparisonId: "previous-term",
        active: true,
      }),
    );
  });

  it("keeps comparison filters symmetric across both query sides", () => {
    const document = {
      ...documentFor(),
      filters: [
        {
          id: "filter-subject",
          field: { datasetId: "current", fieldId: "subject" },
          operator: "equals",
          defaultValue: "math",
          target: { kind: "board" },
        },
      ],
    } as BoardDocumentV1;
    const planResult = buildComparisonPlan(document, "previous-term", "chart", {
      descriptors: descriptors(),
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) {
      return;
    }
    expect(planResult.value.primary.request.filters).toHaveLength(1);
    expect(planResult.value.reference.request.filters).toHaveLength(1);
    expect(planResult.value.primary.request.filters[0]?.fieldId).toBe("subject");
    expect(planResult.value.reference.request.filters[0]?.fieldId).toBe("subject");
  });
});
