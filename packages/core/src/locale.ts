import { DIAGNOSTIC_CODES, createDiagnostic, fail, ok, type Result } from "./diagnostics.js";

export const SUPPORTED_LOCALES = Object.freeze([
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
] as const);

export type BoardloomLocale = (typeof SUPPORTED_LOCALES)[number];
export type TextDirection = "ltr" | "rtl";

export interface LocaleMetadata {
  readonly code: BoardloomLocale;
  readonly direction: TextDirection;
}

export const LOCALE_METADATA: Readonly<Record<BoardloomLocale, LocaleMetadata>> = Object.freeze({
  en: Object.freeze({ code: "en", direction: "ltr" }),
  ru: Object.freeze({ code: "ru", direction: "ltr" }),
  es: Object.freeze({ code: "es", direction: "ltr" }),
  fr: Object.freeze({ code: "fr", direction: "ltr" }),
  de: Object.freeze({ code: "de", direction: "ltr" }),
  "pt-BR": Object.freeze({ code: "pt-BR", direction: "ltr" }),
  "zh-CN": Object.freeze({ code: "zh-CN", direction: "ltr" }),
  ja: Object.freeze({ code: "ja", direction: "ltr" }),
  ko: Object.freeze({ code: "ko", direction: "ltr" }),
  ar: Object.freeze({ code: "ar", direction: "rtl" }),
  hi: Object.freeze({ code: "hi", direction: "ltr" }),
} as Record<BoardloomLocale, LocaleMetadata>);

export const DEFAULT_LOCALE: BoardloomLocale = "en";
export const DEFAULT_TIMEZONE = "UTC";

export interface LocaleConfig {
  readonly locale: BoardloomLocale;
  readonly timezone: string;
}

export const DEFAULT_LOCALE_CONFIG: LocaleConfig = Object.freeze({
  locale: DEFAULT_LOCALE,
  timezone: DEFAULT_TIMEZONE,
});

export interface LocaleConfigInput {
  readonly locale?: string;
  readonly timezone?: string;
}

export function isBoardloomLocale(value: unknown): value is BoardloomLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function resolveLocaleConfig(
  input: LocaleConfigInput,
  base: LocaleConfig = DEFAULT_LOCALE_CONFIG,
): Result<LocaleConfig> {
  const locale = input.locale ?? base.locale;
  const timezone = input.timezone ?? base.timezone;
  const diagnostics = [
    ...(isBoardloomLocale(locale)
      ? []
      : [createDiagnostic(DIAGNOSTIC_CODES.INVALID_LOCALE, "locale")]),
    ...(isValidTimeZone(timezone)
      ? []
      : [createDiagnostic(DIAGNOSTIC_CODES.INVALID_TIMEZONE, "timezone")]),
  ];
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }

  return ok(Object.freeze({ locale: locale as BoardloomLocale, timezone }));
}
