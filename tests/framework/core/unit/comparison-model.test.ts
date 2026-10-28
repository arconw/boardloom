import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  absoluteDelta,
  alignComparisonResults,
  percentageDelta,
  type ComparisonAlignmentKey,
  type ComparisonMeasurePlan,
  type ComparisonPlan,
  type QueryPlan,
  type QueryResultRow,
} from "../../../../packages/core/src/index.js";

function plan(
  alignment: readonly ComparisonAlignmentKey[],
  measures: readonly ComparisonMeasurePlan[],
  options: {
    readonly scalar?: boolean;
    readonly collation?: string;
    readonly normalization?: string;
  } = {},
): ComparisonPlan {
  return {
    comparisonId: "comparison-test",
    label: "Comparison",
    blockId: "block-test",
    displayMode: "overlay",
    deltaMode: "both",
    scalar: options.scalar ?? false,
    collation: options.collation ?? "unicode",
    normalization: options.normalization ?? "none",
    alignment,
    measures,
    primary: {} as QueryPlan,
    reference: {} as QueryPlan,
  };
}

function measure(
  id: string,
  primaryFieldId = id,
  referenceFieldId = primaryFieldId,
): ComparisonMeasurePlan {
  return {
    id,
    label: id,
    aggregation: "average",
    primaryFieldId,
    referenceFieldId,
    primaryOutputFieldId: id,
    referenceOutputFieldId: id,
    primaryUnit: { unit: "points" },
    referenceUnit: { unit: "points" },
    conversion: null,
  };
}

const subjectKey: ComparisonAlignmentKey = {
  primaryFieldId: "subject",
  referenceFieldId: "subject",
  label: "Subject",
  type: "string",
};

function primaryRow(subject: string, score: number | null): QueryResultRow {
  return { subject, score };
}

function referenceRow(subject: string, score: number | null): QueryResultRow {
  return { subject, score };
}

describe("comparison delta arithmetic", () => {
  it("matches the required section 11.3 fixture values", () => {
    const cases = [
      { p: 5, r: 2, absolute: 3, percentage: 150 },
      { p: 10, r: -5, absolute: 15, percentage: 300 },
      { p: 0, r: 5, absolute: -5, percentage: -100 },
      { p: 10, r: 0, absolute: 10, percentage: null },
      { p: 0, r: 0, absolute: 0, percentage: null },
    ] as const;
    for (const entry of cases) {
      const absolute = absoluteDelta(entry.p, entry.r);
      const percentage = percentageDelta(entry.p, entry.r);
      expect(absolute.available, `${entry.p}/${entry.r}`).toBe(true);
      expect(absolute.value).toBe(entry.absolute);
      if (entry.percentage === null) {
        expect(percentage.available).toBe(false);
        expect(percentage.value).toBeNull();
        expect(percentage.reason).toBe("ZERO_REFERENCE");
      } else {
        expect(percentage.available).toBe(true);
        expect(percentage.value).toBe(entry.percentage);
      }
    }
  });

  it("returns explicit reasons instead of zero, NaN or Infinity", () => {
    const primaryNull = absoluteDelta(null, 5);
    expect(primaryNull).toEqual({
      available: false,
      value: null,
      reason: "PRIMARY_NULL",
    });
    expect(percentageDelta(null, 5).reason).toBe("PRIMARY_NULL");
    expect(absoluteDelta(5, null).reason).toBe("REFERENCE_NULL");
    expect(absoluteDelta(Number.POSITIVE_INFINITY, 5).reason).toBe("PRIMARY_NON_FINITE");
    expect(absoluteDelta(5, Number.NaN).reason).toBe("REFERENCE_NON_FINITE");
    expect(absoluteDelta(null, null, "PRIMARY_ONLY").reason).toBe("PRIMARY_ONLY");
    expect(absoluteDelta(null, null, "REFERENCE_ONLY").reason).toBe("REFERENCE_ONLY");
  });
});

describe("comparison alignment", () => {
  it("aligns one row per composite key and keeps outer rows visible", () => {
    const result = alignComparisonResults(
      plan([subjectKey], [measure("score")]),
      {
        rows: [primaryRow("math", 5), primaryRow("reading", 4), primaryRow("science", null)],
      },
      {
        rows: [
          referenceRow("math", 2),
          referenceRow("reading", 8),
          referenceRow("science", 9),
          referenceRow("history", 6),
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows.map((row) => [row.key[0], row.status])).toEqual([
      ["math", "matched"],
      ["reading", "matched"],
      ["science", "matched"],
      ["history", "reference-only"],
    ]);
    const math = result.value.rows[0];
    expect(math?.measures[0]?.absolute).toEqual({
      available: true,
      value: 3,
      reason: null,
    });
    expect(math?.measures[0]?.percentage.value).toBe(150);
    const reading = result.value.rows[1];
    expect(reading?.measures[0]?.percentage.value).toBe(-50);
    const science = result.value.rows[2];
    expect(science?.measures[0]?.primary.reason).toBe("PRIMARY_NULL");
    expect(science?.measures[0]?.absolute).toEqual({
      available: false,
      value: null,
      reason: "PRIMARY_NULL",
    });
    const history = result.value.rows[3];
    expect(history?.status).toBe("reference-only");
    expect(history?.measures[0]?.primary.reason).toBe("REFERENCE_ONLY");
    expect(history?.measures[0]?.absolute.reason).toBe("REFERENCE_ONLY");
    expect(result.value.counts).toMatchObject({
      rowCount: 4,
      matchedRowCount: 3,
      primaryOnlyCount: 0,
      referenceOnlyCount: 1,
      matchedNonNullMeasureCount: { score: 2 },
    });
  });

  it("handles negative references, zero reference and both zero without invented values", () => {
    const result = alignComparisonResults(
      plan([subjectKey], [measure("score")]),
      {
        rows: [
          primaryRow("negative", 10),
          primaryRow("zero-ref", 10),
          primaryRow("both-zero", 0),
          primaryRow("zero-primary", 0),
        ],
      },
      {
        rows: [
          referenceRow("negative", -5),
          referenceRow("zero-ref", 0),
          referenceRow("both-zero", 0),
          referenceRow("zero-primary", 5),
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byKey = new Map(
      result.value.rows.map((row) => [String(row.key[0]), row.measures[0]] as const),
    );
    expect(byKey.get("negative")?.absolute.value).toBe(15);
    expect(byKey.get("negative")?.percentage.value).toBe(300);
    expect(byKey.get("zero-ref")?.absolute.value).toBe(10);
    expect(byKey.get("zero-ref")?.percentage).toEqual({
      available: false,
      value: null,
      reason: "ZERO_REFERENCE",
    });
    expect(byKey.get("both-zero")?.absolute.value).toBe(0);
    expect(byKey.get("both-zero")?.percentage.reason).toBe("ZERO_REFERENCE");
    expect(byKey.get("zero-primary")?.percentage.value).toBe(-100);
    expect(
      result.value.rows.every(
        (row) =>
          row.measures[0]?.percentage.value === null ||
          Number.isFinite(row.measures[0]?.percentage.value),
      ),
    ).toBe(true);
  });

  it("rejects duplicate alignment keys after aggregation without choosing the first row", () => {
    const result = alignComparisonResults(
      plan([subjectKey], [measure("score")]),
      {
        rows: [primaryRow("math", 5), primaryRow("math", 7)],
      },
      { rows: [referenceRow("math", 2)] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      DIAGNOSTIC_CODES.DUPLICATE_ALIGNMENT_KEY,
    );
    expect(result.diagnostics[0]?.message).toContain("does not choose a first row");
  });

  it("keeps non-finite and matched-null reasons explicit in aligned rows", () => {
    const result = alignComparisonResults(
      plan([subjectKey], [measure("score")]),
      { rows: [primaryRow("non-finite", Number.POSITIVE_INFINITY), primaryRow("ref-null", 5)] },
      { rows: [referenceRow("non-finite", 2), referenceRow("ref-null", null)] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byKey = new Map(
      result.value.rows.map((row) => [String(row.key[0]), row.measures[0]] as const),
    );
    expect(byKey.get("non-finite")?.absolute).toEqual({
      available: false,
      value: null,
      reason: "PRIMARY_NON_FINITE",
    });
    expect(byKey.get("non-finite")?.percentage.reason).toBe("PRIMARY_NON_FINITE");
    expect(byKey.get("ref-null")?.absolute.reason).toBe("REFERENCE_NULL");
    expect(byKey.get("ref-null")?.percentage.reason).toBe("REFERENCE_NULL");
  });

  it("excludes null composite keys with counted diagnostics and never matches null to null", () => {
    const result = alignComparisonResults(
      plan([subjectKey], [measure("score")]),
      { rows: [primaryRow("math", 4), { subject: null, score: 9 }] },
      { rows: [referenceRow("math", 2), { subject: null, score: 9 }] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.counts).toMatchObject({
      rowCount: 1,
      matchedRowCount: 1,
      primaryOnlyCount: 0,
      referenceOnlyCount: 0,
      excludedNullKeyCount: 2,
      primaryExcludedNullKeyCount: 1,
      referenceExcludedNullKeyCount: 1,
      excludedNullComponents: { subject: 2 },
    });
    const nullDiagnostics = result.value.diagnostics.filter(
      (entry) => entry.code === DIAGNOSTIC_CODES.NULL_ALIGNMENT_KEY,
    );
    expect(nullDiagnostics).toHaveLength(2);
    expect(nullDiagnostics[0]?.severity).toBe("warning");
    expect(nullDiagnostics[0]?.message).toContain("subject");
  });

  it("supports composite keys and declared normalization", () => {
    const alignment: ComparisonAlignmentKey[] = [
      subjectKey,
      {
        primaryFieldId: "grade",
        referenceFieldId: "grade",
        label: "Grade",
        type: "string",
      },
    ];
    const result = alignComparisonResults(
      plan(alignment, [measure("score")], { normalization: "nfc" }),
      {
        rows: [
          { subject: "E\u0301cole", grade: "A", score: 4 },
          { subject: "Math", grade: "B", score: 2 },
        ],
      },
      {
        rows: [
          { subject: "\u00c9cole", grade: "A", score: 2 },
          { subject: "Math", grade: "B", score: 2 },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.counts.rowCount).toBe(2);
    expect(result.value.counts.matchedRowCount).toBe(2);
    expect(result.value.rows[0]?.measures[0]?.percentage.value).toBe(100);
  });

  it("aligns scalar comparisons without inventing a zero row", () => {
    const scalar = plan([], [measure("score")], { scalar: true });
    const both = alignComparisonResults(scalar, { rows: [{ score: 5 }] }, { rows: [{ score: 2 }] });
    expect(both.ok).toBe(true);
    if (both.ok) {
      expect(both.value.rows).toHaveLength(1);
      expect(both.value.rows[0]?.measures[0]?.absolute.value).toBe(3);
      expect(both.value.counts.rowCount).toBe(1);
    }
    const missing = alignComparisonResults(scalar, { rows: [] }, { rows: [{ score: 2 }] });
    expect(missing.ok).toBe(true);
    if (!missing.ok) {
      return;
    }
    expect(missing.value.rows).toHaveLength(1);
    expect(missing.value.rows[0]?.status).toBe("reference-only");
    expect(missing.value.rows[0]?.measures[0]?.absolute.reason).toBe("REFERENCE_ONLY");
    expect(missing.value.rows[0]?.measures[0]?.absolute.value).toBeNull();
    const none = alignComparisonResults(scalar, { rows: [] }, { rows: [] });
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.value.rows).toEqual([]);
      expect(none.value.counts.rowCount).toBe(0);
    }
  });

  it("applies a declared unit conversion to the reference operand", () => {
    const converted: ComparisonMeasurePlan = {
      ...measure("score"),
      primaryUnit: { unit: "points" },
      referenceUnit: { unit: "percent" },
      conversion: {
        from: "points",
        to: "percent",
        factor: 2,
        offset: 0,
        provider: "local.fixture",
        direction: "primary-to-reference",
      },
    };
    const result = alignComparisonResults(
      plan([subjectKey], [converted]),
      { rows: [primaryRow("math", 5)] },
      { rows: [referenceRow("math", 4)] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows[0]?.measures[0]?.reference.value).toBe(2);
    expect(result.value.rows[0]?.measures[0]?.absolute.value).toBe(3);
  });
});
