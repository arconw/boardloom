import { describe, expect, it } from "vitest";
import { ownValue } from "../../../../packages/view-dom/src/own-value.js";

describe("T06 own-entry-safe record lookup", () => {
  it("does not resolve inherited names for caller-supplied keys", () => {
    const record = JSON.parse(
      '{"toString":"own","__proto__":"own-proto","constructor":"own"}',
    ) as Record<string, string>;
    expect(ownValue(record, "toString")).toBe("own");
    expect(ownValue(record, "__proto__")).toBe("own-proto");
    expect(ownValue(record, "constructor")).toBe("own");
    expect(ownValue(record, "hasOwnProperty")).toBeUndefined();
    expect(ownValue(record, "valueOf")).toBeUndefined();
    expect(ownValue(null, "toString")).toBeUndefined();
  });
});
