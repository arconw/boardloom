import type { FormatterProvider, JsonValue, QueryResultField } from "@boardloom/core";

function isTemporalField(field: QueryResultField): boolean {
  return field.type === "date" || field.type === "datetime";
}

function unitText(field: QueryResultField): string {
  const unit = field.unit;
  if (!unit) {
    return "";
  }
  return unit.label ?? unit.unit;
}

export function formatFieldValue(
  value: JsonValue,
  field: QueryResultField,
  formatters: FormatterProvider,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isTemporalField(field)) {
    let temporalValue: string | number;
    if (typeof value === "string") {
      temporalValue = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      if (field.temporalRepresentation === "epoch-seconds") {
        temporalValue = value * 1_000;
      } else if (
        field.temporalRepresentation === "epoch-milliseconds" ||
        field.temporalRepresentation === undefined
      ) {
        temporalValue = value;
      } else {
        return null;
      }
    } else {
      return null;
    }
    try {
      return formatters.formatDate(temporalValue, {
        dateStyle: "medium",
        ...(field.type === "datetime" ? { timeStyle: "short" as const } : {}),
        ...(field.timezone === undefined ? {} : { timeZone: field.timezone }),
      });
    } catch {
      return null;
    }
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const precision = 2;
    if (field.unit?.unit === "percent") {
      const scale = field.unit.scale ?? 100;
      if (scale === 100) {
        return formatters.formatNumber(value, {
          style: "percent",
          maximumFractionDigits: precision,
        });
      }
      if (scale === 1) {
        return formatters.formatNumber(value / 100, {
          style: "percent",
          maximumFractionDigits: precision,
        });
      }
    }
    const text = formatters.formatNumber(value, { maximumFractionDigits: precision });
    const suffix = unitText(field);
    return suffix === "" ? text : `${text} ${suffix}`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return typeof value === "string" ? value : null;
}
