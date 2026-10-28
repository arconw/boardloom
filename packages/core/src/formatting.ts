import { BoardloomError, DIAGNOSTIC_CODES, createDiagnostic } from "./diagnostics.js";
import { isValidTimeZone, type BoardloomLocale, type LocaleConfig } from "./locale.js";

export interface NumberFormatOptions extends Intl.NumberFormatOptions {
  readonly unitScale?: number;
}

export interface DurationFormatOptions extends NumberFormatOptions {
  readonly unit?: "millisecond" | "second" | "minute" | "hour" | "day";
}

const DURATION_DIVISORS: Readonly<Record<NonNullable<DurationFormatOptions["unit"]>, number>> =
  Object.freeze({
    millisecond: 1,
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
  });

export interface FormatterProvider {
  readonly locale: BoardloomLocale;
  readonly timezone: string;
  formatNumber(value: number, options?: NumberFormatOptions): string;
  formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
  formatDuration(milliseconds: number, options?: DurationFormatOptions): string;
  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string;
  formatList(items: readonly string[], options?: Intl.ListFormatOptions): string;
  selectPlural(count: number, options?: Intl.PluralRulesOptions): Intl.LDMLPluralRule;
}

function formatError(code: string, path: string, message: string): BoardloomError {
  return new BoardloomError(createDiagnostic(code, path, { message }));
}

function assertFinite(value: number, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw formatError(
      DIAGNOSTIC_CODES.FORMAT_NON_FINITE,
      path,
      "Non-finite or non-numeric values are invalid data and cannot be formatted.",
    );
  }
}

function toDate(value: Date | number | string): Date {
  if (value instanceof Date) {
    const clone = new Date(value.getTime());
    if (!Number.isFinite(clone.getTime())) {
      throw formatError(DIAGNOSTIC_CODES.FORMAT_INVALID_DATE, "value", "The date is invalid.");
    }
    return clone;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw formatError(
      DIAGNOSTIC_CODES.FORMAT_INVALID_DATE,
      "value",
      "The value is not a valid date or timestamp.",
    );
  }
  return date;
}

export function createIntlFormatterProvider(config: LocaleConfig): FormatterProvider {
  if (!isValidTimeZone(config.timezone)) {
    throw new BoardloomError(createDiagnostic(DIAGNOSTIC_CODES.INVALID_TIMEZONE, "timezone"));
  }

  const provider: FormatterProvider = {
    locale: config.locale,
    timezone: config.timezone,
    formatNumber(value: number, options: NumberFormatOptions = {}): string {
      assertFinite(value, "value");
      const { unitScale, ...intlOptions } = options;
      const scale = unitScale ?? 1;
      assertFinite(scale, "options/unitScale");
      if (scale === 0) {
        throw formatError(
          DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE,
          "options/unitScale",
          "The unit scale must not be zero.",
        );
      }
      try {
        return new Intl.NumberFormat(config.locale, intlOptions).format(value * scale);
      } catch (error) {
        throw new BoardloomError(
          createDiagnostic(DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE, "options", {
            message: `Number formatting failed: ${(error as Error).message}`,
          }),
        );
      }
    },
    formatDate(value: Date | number | string, options: Intl.DateTimeFormatOptions = {}): string {
      const date = toDate(value);
      const timezone = options.timeZone ?? config.timezone;
      if (!isValidTimeZone(timezone)) {
        throw new BoardloomError(
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_TIMEZONE, "options/timeZone"),
        );
      }
      try {
        return new Intl.DateTimeFormat(config.locale, { ...options, timeZone: timezone }).format(
          date,
        );
      } catch (error) {
        throw new BoardloomError(
          createDiagnostic(DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE, "options", {
            message: `Date formatting failed: ${(error as Error).message}`,
          }),
        );
      }
    },
    formatDuration(milliseconds: number, options: DurationFormatOptions = {}): string {
      assertFinite(milliseconds, "value");
      const { unit: selectedUnit = "second", ...numberOptions } = options;
      const divisor = DURATION_DIVISORS[selectedUnit];
      if (divisor === undefined) {
        throw formatError(
          DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE,
          "options/unit",
          "The duration unit is not supported.",
        );
      }
      return provider.formatNumber(milliseconds / divisor, numberOptions);
    },
    formatRelativeTime(
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options: Intl.RelativeTimeFormatOptions = {},
    ): string {
      assertFinite(value, "value");
      try {
        return new Intl.RelativeTimeFormat(config.locale, options).format(value, unit);
      } catch (error) {
        throw new BoardloomError(
          createDiagnostic(DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE, "options", {
            message: `Relative time formatting failed: ${(error as Error).message}`,
          }),
        );
      }
    },
    formatList(items: readonly string[], options: Intl.ListFormatOptions = {}): string {
      if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
        throw formatError(
          DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE,
          "items",
          "List items must be strings.",
        );
      }
      try {
        return new Intl.ListFormat(config.locale, options).format([...items]);
      } catch (error) {
        throw new BoardloomError(
          createDiagnostic(DIAGNOSTIC_CODES.FORMAT_INVALID_VALUE, "options", {
            message: `List formatting failed: ${(error as Error).message}`,
          }),
        );
      }
    },
    selectPlural(count: number, options: Intl.PluralRulesOptions = {}): Intl.LDMLPluralRule {
      assertFinite(count, "value");
      return new Intl.PluralRules(config.locale, options).select(count);
    },
  };

  return Object.freeze(provider);
}
