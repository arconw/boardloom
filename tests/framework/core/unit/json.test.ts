import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  cloneJson,
  defaultDocumentValidator,
  freezeJson,
  jsonEqual,
  validateJsonValue,
  type JsonObject,
} from "../../../../packages/core/src/index.js";

describe("JSON document primitives", () => {
  it("rejects cyclic, non-finite and unsupported values with paths", () => {
    const cyclic: Record<string, unknown> = { name: "cycle" };
    cyclic.self = cyclic;
    const cyclicResult = validateJsonValue(cyclic);
    expect(cyclicResult.valid).toBe(false);
    expect(cyclicResult.issues[0]?.path).toBe("/self");
    expect(cyclicResult.issues[0]?.message).toContain("Cyclic");

    const nonFinite = validateJsonValue({ value: Number.POSITIVE_INFINITY });
    expect(nonFinite.valid).toBe(false);
    expect(nonFinite.issues[0]?.path).toBe("/value");
    expect(nonFinite.issues[0]?.message).toContain("finite");

    const unsupported = validateJsonValue({ handler: () => undefined });
    expect(unsupported.valid).toBe(false);
    expect(unsupported.issues[0]?.path).toBe("/handler");
    expect(unsupported.issues[0]?.message).toContain("function");
  });

  it("clones and freezes documents without sharing mutable values", () => {
    const original: JsonObject = {
      schemaVersion: 1,
      title: "Board",
      blocks: [{ id: "b1", type: "kpi" }],
    };
    const frozen = freezeJson(cloneJson(original));

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.blocks)).toBe(true);
    expect(() => {
      (frozen as Record<string, unknown>).title = "Changed";
    }).toThrow();
    expect(original.blocks).toEqual([{ id: "b1", type: "kpi" }]);
  });

  it("compares documents canonically regardless of key order", () => {
    const left: JsonObject = { b: 2, a: { d: 4, c: 3 } };
    const right: JsonObject = { a: { c: 3, d: 4 }, b: 2 };
    expect(jsonEqual(left, right)).toBe(true);
    expect(canonicalJson(left)).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(jsonEqual(left, { a: { c: 3, d: 5 }, b: 2 })).toBe(false);
  });

  it("rejects non-plain containers instead of rewriting their contents", () => {
    class Sample {
      readonly value = 1;
    }
    for (const [label, value] of [
      ["Date", new Date("2024-01-01T00:00:00Z")],
      ["Map", new Map([["a", 1]])],
      ["boxed number", new Number(1)],
      ["class instance", new Sample()],
    ] as const) {
      const result = validateJsonValue({ nested: value });
      expect(result.valid, label).toBe(false);
      expect(result.issues[0]?.path).toBe("/nested");
      expect(result.issues[0]?.message).toContain("plain objects");
    }
  });

  it("preserves own __proto__ data without changing the prototype", () => {
    const parsed = JSON.parse(
      '{"schemaVersion":1,"__proto__":{"polluted":true},"title":"Proto"}',
    ) as JsonObject;
    const frozen = freezeJson(cloneJson(parsed));

    expect(Object.hasOwn(frozen, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(frozen)).toBe(Object.prototype);
    expect((frozen as Record<string, unknown>).__proto__).toEqual({ polluted: true });
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.isFrozen((frozen as Record<string, unknown>).__proto__)).toBe(true);
    expect(canonicalJson(frozen)).toContain('"__proto__":{"polluted":true}');
    expect(jsonEqual(parsed, { schemaVersion: 1, title: "Proto" })).toBe(false);
    expect(() => {
      ((frozen as Record<string, unknown>).__proto__ as Record<string, unknown>).polluted = false;
    }).toThrow();
  });

  it("rejects accessor-backed input without invoking getters", () => {
    let reads = 0;
    const objectDocument = {
      schemaVersion: 1,
      get title() {
        reads += 1;
        return "Accessor";
      },
    };
    const objectResult = validateJsonValue(objectDocument);
    expect(objectResult.valid).toBe(false);
    expect(objectResult.issues[0]?.path).toBe("/title");
    expect(objectResult.issues[0]?.message).toContain("Accessor");
    expect(reads).toBe(0);
    expect(() => cloneJson(objectDocument as never)).toThrow(TypeError);
    expect(reads).toBe(0);
    expect(() => canonicalJson(objectDocument as never)).toThrow(TypeError);
    expect(reads).toBe(0);
    expect(() => defaultDocumentValidator(objectDocument)).not.toThrow();

    const array = [1];
    Object.defineProperty(array, "0", {
      get() {
        reads += 1;
        return 1;
      },
      enumerable: true,
      configurable: true,
    });
    const arrayResult = validateJsonValue({ array });
    expect(arrayResult.valid).toBe(false);
    expect(arrayResult.issues[0]?.path).toBe("/array/0");
    expect(arrayResult.issues[0]?.message).toContain("Accessor");
    expect(reads).toBe(0);
    expect(() => cloneJson({ array } as never)).toThrow(TypeError);
    expect(() => canonicalJson({ array } as never)).toThrow(TypeError);
    expect(reads).toBe(0);
  });

  it("rejects non-enumerable and symbol properties instead of dropping them", () => {
    const hidden = { schemaVersion: 1 };
    Object.defineProperty(hidden, "hidden", { value: 2, enumerable: false });
    const hiddenResult = validateJsonValue(hidden);
    expect(hiddenResult.valid).toBe(false);
    expect(hiddenResult.issues[0]?.path).toBe("/hidden");
    expect(hiddenResult.issues[0]?.message).toContain("Non-enumerable");
    expect(() => cloneJson(hidden as never)).toThrow(TypeError);

    const withSymbol = { schemaVersion: 1, [Symbol("hidden")]: 3 };
    const symbolResult = validateJsonValue(withSymbol);
    expect(symbolResult.valid).toBe(false);
    expect(symbolResult.issues[0]?.message).toContain("Symbol");

    const sparse = new Array(2);
    sparse[0] = 1;
    const holeResult = validateJsonValue(sparse);
    expect(holeResult.valid).toBe(false);
    expect(holeResult.issues.some((issue) => issue.message.includes("holes"))).toBe(true);
  });
  it("keeps array order meaningful", () => {
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});
