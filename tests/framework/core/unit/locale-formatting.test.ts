import { describe, expect, it } from "vitest";
import {
  BoardloomError,
  DEFAULT_LOCALE_CONFIG,
  SUPPORTED_LOCALES,
  createIntlFormatterProvider,
  isBoardloomLocale,
  isValidTimeZone,
  resolveLocaleConfig,
} from "../../../../packages/core/src/index.js";

describe("locale configuration", () => {
  it("declares all eleven built-in locales with Arabic as RTL", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(11);
    expect(SUPPORTED_LOCALES).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(isBoardloomLocale("ar")).toBe(true);
    expect(isBoardloomLocale("sv")).toBe(false);
    expect(DEFAULT_LOCALE_CONFIG).toEqual({ locale: "en", timezone: "UTC" });
  });

  it("validates locales and IANA time zones before accepting a configuration", () => {
    expect(isValidTimeZone("Europe/Moscow")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(resolveLocaleConfig({ locale: "ru", timezone: "Europe/Moscow" }).ok).toBe(true);
    const invalid = resolveLocaleConfig({ locale: "sv", timezone: "Nowhere/Zone" });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) {
      throw new Error("expected an invalid locale configuration");
    }
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_LOCALE",
      "INVALID_TIMEZONE",
    ]);
  });
});

describe("Intl formatter contract", () => {
  const provider = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });

  it("formats numbers, percentages, unit scales and durations deterministically", () => {
    expect(provider.formatNumber(1234.5)).toBe("1,234.5");
    expect(provider.formatNumber(0.25, { style: "percent" })).toBe("25%");
    expect(provider.formatNumber(25, { style: "percent", unitScale: 0.01 })).toBe("25%");
    expect(provider.formatDuration(120_000, { unit: "minute" })).toBe("2");
    expect(provider.selectPlural(1)).toBe("one");
    expect(provider.selectPlural(2)).toBe("other");
  });

  it("uses the configured display timezone independent of the locale", () => {
    const value = "2024-01-01T00:00:00Z";
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    expect(provider.formatDate(value, options)).toBe("01/01/2024");
    expect(provider.formatDate(value, { ...options, timeZone: "America/New_York" })).toBe(
      "12/31/2023",
    );
  });

  it("formats relative time and lists through Intl", () => {
    expect(provider.formatRelativeTime(-1, "day")).toBe("1 day ago");
    expect(provider.formatList(["alpha", "beta", "gamma"])).toBe("alpha, beta, and gamma");
  });

  it("rejects invalid and non-finite values instead of rendering zero", () => {
    expect(() => provider.formatNumber(Number.NaN)).toThrow(BoardloomError);
    expect(() => provider.formatNumber(Number.POSITIVE_INFINITY)).toThrow(BoardloomError);
    expect(() => provider.formatNumber(1, { unitScale: 0 })).toThrow(BoardloomError);
    expect(() => provider.formatDate("not-a-date")).toThrow(BoardloomError);
    expect(() => provider.formatDate("2024-01-01T00:00:00Z", { timeZone: "Not/AZone" })).toThrow(
      BoardloomError,
    );
  });
});
