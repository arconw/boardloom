import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DICTIONARIES,
  BoardloomError,
  ENGLISH_MESSAGES,
  createMessageProvider,
  formatEnglishMessage,
  selectMessageText,
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

  it("returns the documented neutral text for keys missing from every provider", () => {
    const provider = createMessageProvider({ locale: "en" });
    const result = provider.format("missing.key");
    expect(result.text).toBe(ENGLISH_MESSAGES["common.unknown"]);
    expect(result.usedFallback).toBe(true);
    expect(result.diagnostics[0]?.code).toBe("MESSAGE_MISSING_KEY");
    const localized = createMessageProvider({ locale: "ru" }).format("missing.key");
    expect(localized.text).toBe(BUILT_IN_DICTIONARIES.ru["common.unknown"]);
  });

  it("formats English developer detail through the shared message interpolation", () => {
    expect(formatEnglishMessage("viewer.filters.origin.group", { name: "Sample" })).toBe(
      "Group: Sample",
    );
    expect(
      formatEnglishMessage("diagnostic.detail.unitConflict", {
        unit: "kg",
        baseUnit: "lb",
      }),
    ).toBe('Unit "kg" conflicts with field unit "lb".');
    expect(formatEnglishMessage("constructor")).toBe("constructor");
  });

  it("treats non-object interpolation parameters deterministically", () => {
    const provider = createMessageProvider({ locale: "en" });
    for (const params of [null, "name", 42, ["name"]]) {
      const result = provider.format(
        "viewer.filters.origin.group",
        params as unknown as MessageParams,
      );
      expect(result.text).toBe("Group: ");
      expect(result.diagnostics[0]?.code).toBe("MESSAGE_INVALID_PARAM");
      expect(result.diagnostics.some((item) => item.code === "MESSAGE_MISSING_PARAM")).toBe(true);
    }
  });

  it("reports unknown host dictionary keys without rejecting custom copy", () => {
    const provider = createMessageProvider({
      locale: "en",
      dictionaries: { en: { "host.custom": "Custom copy" } },
    });
    expect(provider.format("host.custom").text).toBe("Custom copy");
    expect(provider.diagnostics).toHaveLength(1);
    expect(provider.diagnostics[0]?.code).toBe("MESSAGE_UNKNOWN_KEY");
    expect(provider.diagnostics[0]?.path).toContain("host.custom");
  });

  it("selects plural forms with Intl.PluralRules", () => {
    const provider = createMessageProvider({ locale: "en" });
    expect(provider.plural("common.rows", 1).text).toBe("1 row");
    expect(provider.plural("common.rows", 3).text).toBe("3 rows");
    expect(provider.plural("common.selected", 2).text).toBe("2 selected");
  });

  it("uses the complete built-in locale dictionary without English fallback", () => {
    const provider = createMessageProvider({ locale: "ru" });
    const result = provider.format("common.apply");
    expect(result.text).toBe("Применять");
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to English when a selected dictionary lacks a documented key", () => {
    const result = selectMessageText(
      { "common.apply": "Apply" },
      ENGLISH_MESSAGES,
      "common.cancel",
    );
    expect(result).toEqual({ text: "Cancel", usedFallback: true });
    expect(selectMessageText({}, ENGLISH_MESSAGES, "missing.key")).toBeNull();
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
