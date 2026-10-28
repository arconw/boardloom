import { describe, expect, it } from "vitest";
import {
  BoardloomError,
  ENGLISH_MESSAGES,
  createMessageProvider,
  createRuntime,
  type MessageParams,
} from "../../../../packages/core/src/index.js";

describe("message provider contract", () => {
  it("provides an English foundation for diagnostics and common copy", () => {
    const provider = createMessageProvider({ locale: "en" });
    expect(provider.locale).toBe("en");
    expect(provider.has("diagnostic.SPACE_DISPOSED")).toBe(true);
    expect(provider.has("common.apply")).toBe(true);
    expect(provider.format("common.apply").text).toBe("Apply");
    expect(ENGLISH_MESSAGES["diagnostic.REVISION_CONFLICT"]).toContain("draft was preserved");
  });

  it("interpolates typed scalar parameters without evaluating content", () => {
    const provider = createMessageProvider({ locale: "en" });
    const result = provider.format("common.rows.other", { count: "<script>alert(1)</script>" });
    expect(result.text).toBe("<script>alert(1)</script> rows");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports missing and invalid parameters deterministically", () => {
    const provider = createMessageProvider({ locale: "en" });
    const missing = provider.format("common.rows.other");
    expect(missing.text).toBe(" rows");
    expect(missing.diagnostics[0]?.code).toBe("MESSAGE_MISSING_PARAM");

    const invalid = provider.format("common.rows.other", {
      count: { nested: true } as unknown as MessageParams[string],
    });
    expect(invalid.text).toBe(" rows");
    expect(invalid.diagnostics[0]?.code).toBe("MESSAGE_INVALID_PARAM");
  });

  it("reports unknown keys without inventing another message", () => {
    const provider = createMessageProvider({ locale: "en" });
    const result = provider.format("missing.key");
    expect(result.text).toBe("missing.key");
    expect(result.diagnostics[0]?.code).toBe("MESSAGE_MISSING_KEY");
  });

  it("selects plural forms with Intl.PluralRules", () => {
    const provider = createMessageProvider({ locale: "en" });
    expect(provider.plural("common.rows", 1).text).toBe("1 row");
    expect(provider.plural("common.rows", 3).text).toBe("3 rows");
    expect(provider.plural("common.selected", 2).text).toBe("2 selected");
  });

  it("falls back to English for a locale without a built-in dictionary", () => {
    const provider = createMessageProvider({ locale: "ru" });
    const result = provider.format("common.apply");
    expect(result.text).toBe("Apply");
    expect(result.usedFallback).toBe(true);
  });

  it("applies host overrides before the built-in fallback", () => {
    const provider = createMessageProvider({
      locale: "en",
      dictionaries: {
        en: { "common.apply": "Commit", "diagnostic.SPACE_DISPOSED": "Space is closed." },
      },
    });
    expect(provider.format("common.apply").text).toBe("Commit");
    expect(provider.format("diagnostic.SPACE_DISPOSED").text).toBe("Space is closed.");
    expect(provider.format("common.cancel").text).toBe("Cancel");
  });

  it("rejects non-plain and accessor-backed dictionaries without invoking getters", () => {
    class Sample {
      readonly apply = "Apply";
    }
    for (const dictionary of [
      new Date("2024-01-01T00:00:00Z"),
      new Map([["apply", "Apply"]]),
      new Number(1),
      new Sample(),
    ]) {
      expect(() =>
        createMessageProvider({
          locale: "en",
          dictionaries: { en: dictionary as never },
        }),
      ).toThrow(BoardloomError);
    }

    let reads = 0;
    const accessorDictionary = {
      get apply() {
        reads += 1;
        return "Apply";
      },
    };
    expect(() =>
      createMessageProvider({
        locale: "en",
        dictionaries: { en: accessorDictionary as never },
      }),
    ).toThrow(BoardloomError);
    expect(reads).toBe(0);

    const hiddenDictionary = { apply: "Apply" };
    Object.defineProperty(hiddenDictionary, "hidden", { value: "Hidden", enumerable: false });
    expect(() =>
      createMessageProvider({
        locale: "en",
        dictionaries: { en: hiddenDictionary as never },
      }),
    ).toThrow(BoardloomError);

    const symbolDictionary = { apply: "Apply", [Symbol("hidden")]: "Hidden" };
    expect(() =>
      createMessageProvider({
        locale: "en",
        dictionaries: { en: symbolDictionary as never },
      }),
    ).toThrow(BoardloomError);
  });

  it("rejects malformed dictionaries injected into runtime creation", () => {
    expect(() =>
      createRuntime({
        messageDictionaries: { en: new Date("2024-01-01T00:00:00Z") as never },
      }),
    ).toThrow(BoardloomError);

    let reads = 0;
    const accessorDictionary = {
      get apply() {
        reads += 1;
        return "Apply";
      },
    };
    expect(() =>
      createRuntime({
        messageDictionaries: { en: accessorDictionary as never },
      }),
    ).toThrow(BoardloomError);
    expect(reads).toBe(0);
  });
  it("rejects malformed dictionaries and unsupported locale values", () => {
    expect(() =>
      createMessageProvider({ locale: "en", dictionaries: { en: { broken: 1 } as never } }),
    ).toThrow(BoardloomError);
    expect(() => createMessageProvider({ locale: "sv" as never })).toThrow(BoardloomError);
  });
});
