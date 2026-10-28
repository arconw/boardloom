import {
  DATE_STYLES,
  TIME_STYLES,
  type BindingFormat,
  type FieldValueType,
  type FormatStyle,
} from "./board-schema.js";
import type {
  DataFieldFormat,
  DataUnitDescriptor,
  TemporalRepresentation,
} from "./data-contract.js";
import type { FormatterProvider } from "./formatting.js";
import type { JsonValue } from "./json.js";

export interface ValueFieldSpec {
  readonly type: FieldValueType;
  readonly unit?: DataUnitDescriptor;
  readonly format?: BindingFormat | DataFieldFormat;
  readonly timezone?: string;
  readonly temporalRepresentation?: TemporalRepresentation;
}

export interface ValueMessages {
  text(key: string, params?: Readonly<Record<string, string | number | boolean>>): string;
}

export interface FormattedValue {
  readonly text: string | null;
  readonly missing: boolean;
  readonly invalid: boolean;
  readonly numeric: number | null;
  readonly unitText: string;
}

const DEFAULT_PRECISION = 2;
const SMALL_VALUE_THRESHOLD = 0.01;

function formatStyleOf(field: ValueFieldSpec): FormatStyle | undefined {
  if (field.format?.style !== undefined) {
    return field.format.style;
  }
  return field.unit?.unit === "percent" ? "percent" : undefined;
}

function precisionOf(field: ValueFieldSpec): number | undefined {
  return field.format?.precision;
}

function dateStyleOf(field: ValueFieldSpec): (typeof DATE_STYLES)[number] {
  return field.format?.dateStyle ?? "medium";
}

function timeStyleOf(field: ValueFieldSpec): (typeof TIME_STYLES)[number] {
  return field.format?.timeStyle ?? "short";
}

export function unitTextOf(field: ValueFieldSpec): string {
  const unit = field.unit;
  if (!unit) {
    return "";
  }
  return unit.label ?? unit.unit;
}

function missing(): FormattedValue {
  return Object.freeze({
    text: null,
    missing: true,
    invalid: false,
    numeric: null,
    unitText: "",
  });
}

function invalid(): FormattedValue {
  return Object.freeze({
    text: null,
    missing: true,
    invalid: true,
    numeric: null,
    unitText: "",
  });
}

function formatTemporal(
  value: JsonValue,
  field: ValueFieldSpec,
  formatters: FormatterProvider,
): FormattedValue {
  let temporal: string | number;
  if (typeof value === "string") {
    if (
      field.temporalRepresentation === "epoch-seconds" ||
      field.temporalRepresentation === "epoch-milliseconds"
    ) {
      return invalid();
    }
    temporal = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    if (field.temporalRepresentation === "epoch-seconds") {
      temporal = value * 1_000;
    } else if (
      field.temporalRepresentation === "epoch-milliseconds" ||
      field.temporalRepresentation === undefined
    ) {
      temporal = value;
    } else {
      return invalid();
    }
  } else {
    return invalid();
  }
  try {
    const text = formatters.formatDate(temporal, {
      dateStyle: dateStyleOf(field),
      ...(field.type === "datetime" ? { timeStyle: timeStyleOf(field) } : {}),
      ...(field.timezone === undefined ? {} : { timeZone: field.timezone }),
    });
    return Object.freeze({
      text,
      missing: false,
      invalid: false,
      numeric: null,
      unitText: unitTextOf(field),
    });
  } catch {
    return invalid();
  }
}

function percentFraction(value: number, unit: DataUnitDescriptor | undefined): number {
  const scale = unit?.scale ?? 100;
  if (scale === 100) {
    return value;
  }
  if (scale === 1) {
    return value / 100;
  }
  return value / 100;
}

function numberOptions(
  field: ValueFieldSpec,
  value: number,
): { readonly options: Intl.NumberFormatOptions; readonly scaled: number } {
  const style = formatStyleOf(field);
  const precision = precisionOf(field);
  const unit = field.unit;
  const options: Intl.NumberFormatOptions = {};
  let scaled = value;

  if (style === "percent") {
    scaled = percentFraction(value, unit);
    options.style = "percent";
  } else if (style === "currency" && field.format && "currency" in field.format) {
    const currency = field.format.currency;
    if (typeof currency === "string" && currency.trim() !== "") {
      options.style = "currency";
      options.currency = currency;
    }
  } else if (style === "compact") {
    options.notation = "compact";
    options.compactDisplay = "short";
  }

  if (style !== "percent" && unit?.scale !== undefined && unit.scale !== 0) {
    scaled = value * unit.scale;
  }

  if (precision !== undefined) {
    options.maximumFractionDigits = precision;
  } else if (options.style === "currency") {
    options.maximumFractionDigits = DEFAULT_PRECISION;
  } else if (
    options.style !== "percent" &&
    options.notation !== "compact" &&
    Math.abs(scaled) > 0 &&
    Math.abs(scaled) < SMALL_VALUE_THRESHOLD
  ) {
    options.maximumSignificantDigits = 3;
  } else {
    options.maximumFractionDigits = DEFAULT_PRECISION;
  }

  return { options, scaled };
}

function formatNumberValue(
  value: number,
  field: ValueFieldSpec,
  formatters: FormatterProvider,
): FormattedValue {
  if (!Number.isFinite(value)) {
    return invalid();
  }
  const unit = unitTextOf(field);
  const style = formatStyleOf(field);
  try {
    const { options, scaled } = numberOptions(field, value);
    const text = formatters.formatNumber(scaled, options);
    const suffix = style === "percent" || style === "currency" ? "" : unit;
    return Object.freeze({
      text: suffix === "" ? text : `${text} ${suffix}`,
      missing: false,
      invalid: false,
      numeric: value,
      unitText: unit,
    });
  } catch {
    return invalid();
  }
}

export function formatValueParts(
  value: JsonValue | undefined,
  field: ValueFieldSpec,
  formatters: FormatterProvider,
  messages?: ValueMessages,
): FormattedValue {
  if (value === null || value === undefined) {
    return missing();
  }
  if (field.type === "date" || field.type === "datetime") {
    return formatTemporal(value, field, formatters);
  }
  if (typeof value === "number") {
    return formatNumberValue(value, field, formatters);
  }
  if (typeof value === "boolean") {
    const key = value ? "common.true" : "common.false";
    const text = messages ? messages.text(key) : value ? "true" : "false";
    return Object.freeze({
      text,
      missing: false,
      invalid: false,
      numeric: null,
      unitText: unitTextOf(field),
    });
  }
  if (typeof value === "string") {
    return Object.freeze({
      text: value,
      missing: false,
      invalid: false,
      numeric: null,
      unitText: unitTextOf(field),
    });
  }
  return invalid();
}

export function formatValueText(
  value: JsonValue | undefined,
  field: ValueFieldSpec,
  formatters: FormatterProvider,
  messages?: ValueMessages,
): string | null {
  return formatValueParts(value, field, formatters, messages).text;
}
