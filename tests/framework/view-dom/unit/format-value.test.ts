import { describe, expect, it } from "vitest";
import {
  createIntlFormatterProvider,
  type QueryResultField,
} from "../../../../packages/core/src/index.js";
import { formatFieldValue } from "../../../../packages/view-dom/src/format-value.js";

const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });

function field(overrides: Partial<QueryResultField> = {}): QueryResultField {
  return {
    fieldId: "score",
    type: "number",
    role: "measure",
    ...overrides,
  };
}

describe("T06 value formatting", () => {
  it("formats null and non-finite values as unavailable instead of zero", () => {
    expect(formatFieldValue(null, field(), formatters)).toBeNull();
    expect(formatFieldValue(Number.POSITIVE_INFINITY, field(), formatters)).toBeNull();
  });

  it("formats percent scales and units through the display locale", () => {
    expect(
      formatFieldValue(0.9, field({ unit: { unit: "percent", scale: 100 } }), formatters),
    ).toBe("90%");
    expect(formatFieldValue(74, field({ unit: { unit: "percent", scale: 1 } }), formatters)).toBe(
      "74%",
    );
    expect(formatFieldValue(12, field({ unit: { unit: "points" } }), formatters)).toBe("12 points");
  });

  it("formats temporal values in the declared field timezone", () => {
    expect(
      formatFieldValue(
        "2026-10-01T12:00:00Z",
        field({ type: "date", role: "temporal", timezone: "UTC" }),
        formatters,
      ),
    ).toContain("2026");
  });

  it("formats epoch temporal representations instead of grouped numbers", () => {
    const milliseconds = field({
      type: "datetime",
      role: "temporal",
      temporalRepresentation: "epoch-milliseconds",
      timezone: "UTC",
    });
    const seconds = field({
      type: "datetime",
      role: "temporal",
      temporalRepresentation: "epoch-seconds",
      timezone: "UTC",
    });
    const fromMilliseconds = formatFieldValue(1_700_000_000_000, milliseconds, formatters);
    const fromSeconds = formatFieldValue(1_700_000_000, seconds, formatters);
    expect(fromMilliseconds).toContain("2023");
    expect(fromSeconds).toBe(fromMilliseconds);
    expect(
      formatFieldValue(
        1_700_000_000,
        field({
          type: "datetime",
          role: "temporal",
          temporalRepresentation: "iso8601-offset",
          timezone: "UTC",
        }),
        formatters,
      ),
    ).toBeNull();
  });
});
