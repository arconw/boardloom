import { describe, expect, it } from "vitest";
import {
  createIntlFormatterProvider,
  formatValueParts,
  formatValueText,
  type ValueFieldSpec,
} from "../../../../packages/core/src/index.js";

const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });
const messages = {
  text(key: string): string {
    return key === "common.true" ? "Yes" : key === "common.false" ? "No" : key;
  },
};

function field(overrides: Partial<ValueFieldSpec> = {}): ValueFieldSpec {
  return { type: "number", ...overrides };
}

describe("T07 value formatting", () => {
  it("keeps null, undefined and non-finite values distinct from zero", () => {
    expect(formatValueText(null, field(), formatters)).toBeNull();
    expect(formatValueText(undefined, field(), formatters)).toBeNull();
    expect(formatValueText(Number.POSITIVE_INFINITY, field(), formatters)).toBeNull();
    expect(formatValueText(Number.NaN, field(), formatters)).toBeNull();
    expect(formatValueText(0, field(), formatters)).toBe("0");
  });

  it("honours units, precision and percent scale semantics", () => {
    expect(formatValueText(12, field({ unit: { unit: "points" } }), formatters)).toBe("12 points");
    expect(formatValueText(0.9, field({ unit: { unit: "percent", scale: 100 } }), formatters)).toBe(
      "90%",
    );
    expect(formatValueText(74, field({ unit: { unit: "percent", scale: 1 } }), formatters)).toBe(
      "74%",
    );
    expect(formatValueText(12.345, field({ format: { precision: 1 } }), formatters)).toBe("12.3");
    expect(
      formatValueText(1234, field({ format: { style: "currency", currency: "USD" } }), formatters),
    ).toBe("$1,234.00");
    expect(formatValueText(1234567, field({ format: { style: "compact" } }), formatters)).toMatch(
      /1\.2/,
    );
  });

  it("does not round small non-zero values to zero without disclosure", () => {
    const result = formatValueText(0.00042, field(), formatters);
    expect(result).not.toBe("0");
    expect(result).toContain("0.00042");
  });

  it("formats negative values with their sign", () => {
    expect(formatValueText(-12, field({ unit: { unit: "points" } }), formatters)).toBe(
      "-12 points",
    );
  });

  it("formats temporal values in the declared timezone and representation", () => {
    const date = field({ type: "date", timezone: "UTC" });
    expect(formatValueText("2026-10-01T12:00:00Z", date, formatters)).toContain("2026");
    const epochs = field({
      type: "datetime",
      timezone: "UTC",
      temporalRepresentation: "epoch-seconds",
    });
    expect(formatValueText(1_700_000_000, epochs, formatters)).toContain("2023");
    expect(
      formatValueText(
        1_700_000_000,
        field({
          type: "datetime",
          temporalRepresentation: "iso8601-offset",
          timezone: "UTC",
        }),
        formatters,
      ),
    ).toBeNull();
  });

  it("formats numbers and dates through the selected locale and timezone", () => {
    const german = createIntlFormatterProvider({ locale: "de", timezone: "Europe/Berlin" });
    expect(formatValueText(1234.5, field({ format: { precision: 1 } }), german)).toBe("1.234,5");
    expect(
      formatValueText(
        "2026-10-01T12:00:00Z",
        field({ type: "date", timezone: "Europe/Berlin" }),
        german,
      ),
    ).toContain("2026");
  });

  it("localizes booleans through message keys", () => {
    expect(formatValueText(true, field({ type: "boolean" }), formatters, messages)).toBe("Yes");
    expect(formatValueText(false, field({ type: "boolean" }), formatters, messages)).toBe("No");
    const parts = formatValueParts(0, field({ unit: { unit: "percent", scale: 100 } }), formatters);
    expect(parts.unitText).toBe("percent");
    expect(parts.numeric).toBe(0);
  });
});
