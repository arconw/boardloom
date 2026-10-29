import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DICTIONARIES,
  ENGLISH_MESSAGES,
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  createMessageProvider,
  selectMessageText,
  type BoardloomLocale,
  type MessageParams,
} from "../../../../packages/core/src/index.js";

const root = process.cwd();
const catalogKeys = (
  JSON.parse(readFileSync(path.join(root, "docs/design/message-keys.json"), "utf8")) as {
    readonly keys: readonly { readonly key: string; readonly english: string }[];
  }
).keys;

const placeholders = (text: string): readonly string[] =>
  [...text.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)].map((match) => match[1] ?? "").sort();

function paramsFor(text: string): MessageParams {
  const params: Record<string, string | number> = {};
  for (const name of placeholders(text)) {
    params[name] = name === "count" ? 3 : "Sample";
  }
  return params;
}

describe("T17 built-in locale dictionaries", () => {
  it("declares exactly the eleven required locales with Arabic as RTL", () => {
    expect([...SUPPORTED_LOCALES]).toEqual([
      "en",
      "ru",
      "es",
      "fr",
      "de",
      "pt-BR",
      "zh-CN",
      "ja",
      "ko",
      "ar",
      "hi",
    ]);
    expect(Object.keys(BUILT_IN_DICTIONARIES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(LOCALE_METADATA.ar.direction).toBe("rtl");
    for (const locale of SUPPORTED_LOCALES.filter((code) => code !== "ar")) {
      expect(LOCALE_METADATA[locale].direction).toBe("ltr");
    }
  });

  it("keeps the English locale asset aligned with the runtime English catalog", () => {
    expect(BUILT_IN_DICTIONARIES.en).toEqual(ENGLISH_MESSAGES);
  });

  it("documents every runtime key in the public catalog", () => {
    const runtimeKeys = Object.keys(ENGLISH_MESSAGES).sort();
    expect(catalogKeys.map((entry) => entry.key).sort()).toEqual(runtimeKeys);
    for (const entry of catalogKeys) {
      expect(ENGLISH_MESSAGES[entry.key], entry.key).toBe(entry.english);
    }
    expect(catalogKeys.some((entry) => entry.key.startsWith("diagnostic."))).toBe(true);
  });

  it("has exact key parity and placeholder parity for every built-in locale", () => {
    const englishKeys = Object.keys(ENGLISH_MESSAGES).sort();
    expect(englishKeys.length).toBeGreaterThan(600);
    for (const locale of SUPPORTED_LOCALES) {
      const dictionary = BUILT_IN_DICTIONARIES[locale];
      expect(Object.keys(dictionary).sort(), locale).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(dictionary[key], `${locale}/${key}`).toBeTypeOf("string");
        expect(dictionary[key]?.trim(), `${locale}/${key}`).not.toBe("");
        expect(placeholders(dictionary[key] ?? ""), `${locale}/${key}`).toEqual(
          placeholders(ENGLISH_MESSAGES[key] ?? ""),
        );
      }
    }
  });

  it("carries real localized text rather than English placeholders", () => {
    const englishKeys = Object.keys(ENGLISH_MESSAGES);
    for (const locale of SUPPORTED_LOCALES.filter((code) => code !== "en")) {
      const dictionary = BUILT_IN_DICTIONARIES[locale];
      const identical = englishKeys.filter((key) => dictionary[key] === ENGLISH_MESSAGES[key]);
      expect(identical.length / englishKeys.length, locale).toBeLessThan(0.1);
    }
    expect(BUILT_IN_DICTIONARIES.ru["mode.viewer"]).not.toBe(ENGLISH_MESSAGES["mode.viewer"]);
    expect(BUILT_IN_DICTIONARIES.ja["mode.viewer"]).not.toBe(ENGLISH_MESSAGES["mode.viewer"]);
    expect(BUILT_IN_DICTIONARIES.ar["mode.viewer"]).not.toBe(ENGLISH_MESSAGES["mode.viewer"]);
    expect(BUILT_IN_DICTIONARIES.hi["mode.viewer"]).not.toBe(ENGLISH_MESSAGES["mode.viewer"]);
  });

  it("formats every key without English fallback in every built-in locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const provider = createMessageProvider({ locale });
      for (const key of Object.keys(ENGLISH_MESSAGES)) {
        const result = provider.format(key, paramsFor(ENGLISH_MESSAGES[key] ?? ""));
        expect(result.diagnostics, `${locale}/${key}`).toEqual([]);
        expect(result.usedFallback, `${locale}/${key}`).toBe(false);
      }
    }
  });

  it("documents all six plural categories for every plural base", () => {
    const keys = Object.keys(ENGLISH_MESSAGES);
    const bases = keys.filter(
      (key) => key.endsWith(".one") && keys.includes(`${key.slice(0, -4)}.other`),
    );
    expect(bases.length).toBeGreaterThanOrEqual(17);
    for (const oneKey of bases) {
      const base = oneKey.slice(0, -4);
      for (const locale of SUPPORTED_LOCALES) {
        for (const category of ["zero", "one", "two", "few", "many", "other"]) {
          expect(
            BUILT_IN_DICTIONARIES[locale][`${base}.${category}`],
            `${locale}/${base}.${category}`,
          ).toBeTypeOf("string");
        }
      }
    }
  });
});

describe("T17 message selection, overrides and safety", () => {
  it("keeps deterministic English fallback for incomplete host-selected dictionaries", () => {
    expect(selectMessageText({}, ENGLISH_MESSAGES, "common.apply")).toEqual({
      text: "Apply",
      usedFallback: true,
    });
    expect(
      selectMessageText({ "common.apply": "Commit" }, ENGLISH_MESSAGES, "common.apply"),
    ).toEqual({ text: "Commit", usedFallback: false });
    expect(selectMessageText({}, ENGLISH_MESSAGES, "missing.key")).toBeNull();
  });

  it("merges host dictionaries over the built-in locale and English", () => {
    const provider = createMessageProvider({
      locale: "ru",
      dictionaries: {
        ru: {
          "common.apply": "Host apply",
          "host.custom": "Host custom",
          "diagnostic.SPACE_DISPOSED": "Host closed",
        },
      },
    });
    expect(provider.format("common.apply").text).toBe("Host apply");
    expect(provider.format("host.custom").text).toBe("Host custom");
    expect(provider.format("diagnostic.SPACE_DISPOSED").text).toBe("Host closed");
    expect(provider.format("common.cancel").text).toBe(BUILT_IN_DICTIONARIES.ru["common.cancel"]);
    expect(provider.format("common.cancel").usedFallback).toBe(false);
  });

  it("rejects overrides for unsupported locales and malformed dictionaries", () => {
    expect(() =>
      createMessageProvider({
        locale: "en",
        dictionaries: { sv: { "common.apply": "Apply" } } as never,
      }),
    ).toThrowError(/INVALID_LOCALE|locale/i);
    expect(() =>
      createMessageProvider({ locale: "en", dictionaries: { en: { broken: 1 } as never } }),
    ).toThrow();
  });

  it("interpolates own scalar parameters without evaluating injected text", () => {
    const provider = createMessageProvider({ locale: "en" });
    const braces = provider.format("common.rows.other", { count: "{count}" });
    expect(braces.text).toBe("{count} rows");
    expect(braces.diagnostics).toEqual([]);
    const html = provider.format("viewer.filters.origin.group", { name: "<script>x</script>" });
    expect(html.text).toBe("Group: <script>x</script>");

    const inherited = Object.create({ name: "Inherited" }) as MessageParams;
    const missing = provider.format("viewer.filters.origin.group", inherited);
    expect(missing.text).toBe("Group: ");
    expect(missing.diagnostics.map((item) => item.code)).toContain("MESSAGE_MISSING_PARAM");

    const proto = provider.format("viewer.filters.origin.group", { name: "__proto__" });
    expect(proto.text).toBe("Group: __proto__");
  });

  it("uses own-entry-safe lookups for prototype-name keys and parameters", () => {
    const provider = createMessageProvider({ locale: "en" });
    const prototypeKey = provider.format("toString");
    expect(prototypeKey.text).toBe(ENGLISH_MESSAGES["common.unknown"]);
    expect(prototypeKey.diagnostics[0]?.code).toBe("MESSAGE_MISSING_KEY");

    const dictionary: Record<string, string> = {};
    Object.defineProperty(dictionary, "__proto__", {
      value: "Prototype text",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const custom = createMessageProvider({
      locale: "en",
      dictionaries: { en: { ...dictionary, "host.proto": "Value {__proto__}" } },
    });
    expect(custom.format("__proto__").text).toBe("Prototype text");

    const params = Object.create(null) as Record<string, string>;
    Object.defineProperty(params, "__proto__", {
      value: "Own parameter",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(custom.format("host.proto", params).text).toBe("Value Own parameter");

    const inheritedParams = Object.create({ name: "Inherited" }) as MessageParams;
    expect(provider.format("viewer.filters.origin.group", inheritedParams).text).toBe("Group: ");
  });

  it("selects locale plural categories with Intl.PluralRules", () => {
    const markers: Record<string, string> = {
      "p.items.zero": "ZERO",
      "p.items.one": "ONE",
      "p.items.two": "TWO",
      "p.items.few": "FEW",
      "p.items.many": "MANY",
      "p.items.other": "OTHER",
    };
    const russian = createMessageProvider({ locale: "ru", dictionaries: { ru: markers } });
    expect(russian.plural("p.items", 1).text).toBe("ONE");
    expect(russian.plural("p.items", 2).text).toBe("FEW");
    expect(russian.plural("p.items", 5).text).toBe("MANY");
    expect(russian.plural("p.items", 1.5).text).toBe("OTHER");

    const arabic = createMessageProvider({ locale: "ar", dictionaries: { ar: markers } });
    expect(arabic.plural("p.items", 0).text).toBe("ZERO");
    expect(arabic.plural("p.items", 1).text).toBe("ONE");
    expect(arabic.plural("p.items", 2).text).toBe("TWO");
    expect(arabic.plural("p.items", 3).text).toBe("FEW");
    expect(arabic.plural("p.items", 11).text).toBe("MANY");
    expect(arabic.plural("p.items", 100).text).toBe("OTHER");

    const japanese = createMessageProvider({ locale: "ja", dictionaries: { ja: markers } });
    expect(japanese.plural("p.items", 1).text).toBe("OTHER");
    expect(japanese.plural("p.items", 3).text).toBe("OTHER");
  });

  it("keeps real locale plural forms available without falling back", () => {
    const russian = createMessageProvider({ locale: "ru" });
    const one = russian.plural("common.rows", 1);
    const few = russian.plural("common.rows", 2);
    const many = russian.plural("common.rows", 5);
    expect(one.usedFallback).toBe(false);
    expect(few.usedFallback).toBe(false);
    expect(many.usedFallback).toBe(false);
    expect(one.text).toContain("1");
    expect(new Set([one.text, few.text, many.text]).size).toBe(3);
  });
});

describe("T17 locale metadata", () => {
  it("keeps locale codes and metadata frozen", () => {
    expect(Object.isFrozen(SUPPORTED_LOCALES)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_DICTIONARIES)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_DICTIONARIES["ru" as BoardloomLocale] as object)).toBe(true);
  });
});
