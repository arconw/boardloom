import type { BucketGrain, FieldValueType, WeekStart } from "./board-schema.js";
import type { TemporalRepresentation } from "./data-contract.js";
import { isIsoDateString, isIsoDateTimeString } from "./board-validation-shared.js";
import { isValidTimeZone } from "./locale.js";

interface CivilParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const TEMPORAL_TYPES: readonly FieldValueType[] = Object.freeze(["date", "datetime"]);

function createPartsFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function readPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const entry = parts.find((part) => part.type === type);
  return entry === undefined ? 0 : Number(entry.value);
}

function zonedParts(instant: number, timezone: string): CivilParts {
  const parts = createPartsFormatter(timezone).formatToParts(new Date(instant));
  return Object.freeze({
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
    hour: readPart(parts, "hour"),
    minute: readPart(parts, "minute"),
    second: readPart(parts, "second"),
  });
}

function utcMillis(parts: CivilParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function zonedDateStartInstant(date: string, timezone: string): number | null {
  if (!isIsoDateString(date)) {
    return null;
  }
  if (!isValidTimeZone(timezone)) {
    return null;
  }
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  const target = Date.UTC(year, month - 1, day);
  const span = 26 * 60 * 60 * 1_000;
  const offsets = new Set<number>();
  for (const probe of [
    target - span,
    target - span / 2,
    target,
    target + span / 2,
    target + span,
  ]) {
    const parts = zonedParts(probe, timezone);
    offsets.add(utcMillis(parts) - probe);
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = target - offset;
    const parts = zonedParts(candidate, timezone);
    if (parts.year === year && parts.month === month && parts.day === day) {
      candidates.push(candidate);
    }
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}

export function temporalInstant(
  value: unknown,
  type: FieldValueType,
  timezone: string,
  representation: TemporalRepresentation,
): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || representation === "iso8601-offset") {
      return null;
    }
    return representation === "epoch-seconds" ? value * 1_000 : value;
  }
  if (typeof value !== "string") {
    return null;
  }
  if (type === "date") {
    if (!isIsoDateString(value)) {
      return null;
    }
    return zonedDateStartInstant(value, timezone);
  }
  if (!isIsoDateTimeString(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(year: number, month: number, day: number, offset: number): string {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function weekdayIndex(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function bucketDate(
  parts: CivilParts,
  grain: Exclude<BucketGrain, "instant">,
  weekStartsOn: WeekStart,
): string {
  if (grain === "day") {
    return `${parts.year.toString().padStart(4, "0")}-${parts.month
      .toString()
      .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
  }
  if (grain === "week") {
    const current = weekdayIndex(parts.year, parts.month, parts.day);
    const anchor = weekStartsOn === "monday" ? 1 : 0;
    const offset = (current - anchor + 7) % 7;
    return addDays(parts.year, parts.month, parts.day, -offset);
  }
  if (grain === "month") {
    return `${parts.year.toString().padStart(4, "0")}-${parts.month
      .toString()
      .padStart(2, "0")}-01`;
  }
  if (grain === "quarter") {
    const month = Math.floor((parts.month - 1) / 3) * 3 + 1;
    return `${parts.year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  }
  return `${parts.year.toString().padStart(4, "0")}-01-01`;
}

export function bucketTemporalValue(
  value: unknown,
  type: FieldValueType,
  timezone: string,
  representation: TemporalRepresentation,
  grain: BucketGrain,
  weekStartsOn: WeekStart = "monday",
): string | null {
  if (!TEMPORAL_TYPES.includes(type)) {
    return null;
  }
  if (grain === "instant") {
    return typeof value === "string" ? value : null;
  }
  const instant = temporalInstant(value, type, timezone, representation);
  if (instant === null) {
    return null;
  }
  return bucketDate(zonedParts(instant, timezone), grain, weekStartsOn);
}

export function compareTemporalValues(
  left: unknown,
  right: unknown,
  type: FieldValueType,
  timezone: string,
  representation: TemporalRepresentation,
): number | null {
  const leftInstant = temporalInstant(left, type, timezone, representation);
  const rightInstant = temporalInstant(right, type, timezone, representation);
  if (leftInstant === null || rightInstant === null) {
    return null;
  }
  return leftInstant < rightInstant ? -1 : leftInstant > rightInstant ? 1 : 0;
}

export function withinTemporalWindow(
  value: unknown,
  start: string,
  end: string,
  type: FieldValueType,
  timezone: string,
  representation: TemporalRepresentation,
  bounds: "inclusive" | "exclusive" | "half-open",
): boolean {
  const instant = temporalInstant(value, type, timezone, representation);
  if (instant === null) {
    return false;
  }
  const startInstant = temporalInstant(
    start,
    type === "date" ? "date" : "datetime",
    timezone,
    "iso8601-offset",
  );
  const endInstant = temporalInstant(
    end,
    type === "date" ? "date" : "datetime",
    timezone,
    "iso8601-offset",
  );
  if (startInstant === null || endInstant === null) {
    return false;
  }
  if (bounds === "inclusive") {
    return instant >= startInstant && instant <= endInstant;
  }
  if (bounds === "exclusive") {
    return instant > startInstant && instant < endInstant;
  }
  return instant >= startInstant && instant < endInstant;
}
