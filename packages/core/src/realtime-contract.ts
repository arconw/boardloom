import { FIELD_VALUE_TYPES, type FieldValueType } from "./board-schema.js";
import { isRecord, nonEmptyString, oneOf, own } from "./board-validation-shared.js";
import type { QueryCounts, QueryResultField, QueryResultRow } from "./data-contract.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import {
  canonicalJson,
  cloneJson,
  deepFreeze,
  jsonByteLength,
  validateJsonValue,
  type JsonValue,
} from "./json.js";

export const REALTIME_MESSAGE_KINDS = Object.freeze([
  "snapshot",
  "append",
  "upsert",
  "delete",
  "reset",
  "heartbeat",
  "error",
] as const);

export const REALTIME_STATUSES = Object.freeze([
  "connecting",
  "live",
  "reconnecting",
  "resyncing",
  "paused",
  "degraded",
  "closed",
  "error",
] as const);

export const REALTIME_CONNECTION_STATUSES = Object.freeze([
  "connecting",
  "open",
  "reconnecting",
  "resyncing",
  "closed",
  "degraded",
  "error",
] as const);

export type RealtimeMessageKind = (typeof REALTIME_MESSAGE_KINDS)[number];
export type RealtimeStatus = (typeof REALTIME_STATUSES)[number];
export type RealtimeConnectionStatus = (typeof REALTIME_CONNECTION_STATUSES)[number];

export interface RealtimeLimits {
  readonly maxBufferedMessages: number;
  readonly maxBufferedBytes: number;
  readonly maxBufferAgeMs: number;
}

export const DEFAULT_REALTIME_LIMITS: RealtimeLimits = Object.freeze({
  maxBufferedMessages: 1_000,
  maxBufferedBytes: 5 * 1024 * 1024,
  maxBufferAgeMs: 5_000,
});

export const DEFAULT_REALTIME_RECONNECT = Object.freeze({
  initialDelayMs: 500,
  factor: 2,
  maxDelayMs: 30_000,
  maxAttempts: 10,
  jitter: 0.2,
});

export interface RealtimeEnvelope {
  readonly messageId: string;
  readonly datasetId: string;
  readonly sliceId?: string;
  readonly queryKey: string;
  readonly generation: number;
  readonly epoch: string;
  readonly sequence: number;
  readonly cursor?: string;
  readonly kind: RealtimeMessageKind;
  readonly rowKeys: readonly string[];
  readonly rows?: readonly QueryResultRow[];
  readonly fields?: readonly QueryResultField[];
  readonly counts?: QueryCounts;
  readonly complete?: boolean;
  readonly nextCursor?: string;
  readonly diagnostics?: readonly Diagnostic[];
  readonly timestamp: number;
}

export interface RealtimeSubscriptionRequest {
  readonly subscriptionId: string;
  readonly queryId: string;
  readonly queryKey: string;
  readonly datasetId: string;
  readonly sliceId?: string;
  readonly generation: number;
  readonly cursor?: string;
  readonly keyFields: readonly string[];
  readonly limits: RealtimeLimits;
}

export interface RealtimeTransportStatus {
  readonly status: RealtimeConnectionStatus;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly diagnostic?: Diagnostic;
}

export type RealtimeCommand =
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "resync"; readonly cursor?: string; readonly reason?: string }
  | { readonly type: "cursor"; readonly cursor: string }
  | { readonly type: "close" };

export interface RealtimeTransportListener {
  onEnvelope(value: unknown): void;
  onStatus(status: RealtimeTransportStatus): void;
  onError(diagnostic: Diagnostic): void;
}

export interface RealtimeTransportSubscription {
  send(command: RealtimeCommand): void;
  close(): void;
}

export interface RealtimeTransport {
  readonly transportId: string;
  readonly simulated: boolean;
  subscribe(
    request: RealtimeSubscriptionRequest,
    listener: RealtimeTransportListener,
  ): RealtimeTransportSubscription;
}

export interface RealtimeTransportInfo {
  readonly transportId: string;
  readonly simulated: boolean;
}

export interface RealtimeSubscriptionState {
  readonly queryId: string;
  readonly subscriptionId: string;
  readonly queryKey: string;
  readonly generation: number;
  readonly datasetId: string;
  readonly sliceId?: string;
  readonly keyFields: readonly string[];
  readonly status: RealtimeStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly epoch: string | null;
  readonly sequence: number;
  readonly cursor: string | null;
  readonly bufferedMessages: number;
  readonly bufferedBytes: number;
  readonly droppedMessages: number;
  readonly receivedMessages: number;
  readonly appliedMessages: number;
  readonly duplicateMessages: number;
  readonly staleMessages: number;
  readonly lastUpdate: number | null;
  readonly simulated: boolean;
  readonly baseEstablished: boolean;
  readonly needsResync: boolean;
}

const ENVELOPE_KEYS = new Set([
  "messageId",
  "datasetId",
  "sliceId",
  "queryKey",
  "generation",
  "epoch",
  "sequence",
  "cursor",
  "kind",
  "rowKeys",
  "rows",
  "fields",
  "counts",
  "complete",
  "nextCursor",
  "diagnostics",
  "timestamp",
]);

const FIELD_KEYS = new Set([
  "fieldId",
  "sourceFieldId",
  "type",
  "role",
  "unit",
  "timezone",
  "temporalRepresentation",
]);

const UNIT_KEYS = new Set(["unit", "scale", "label"]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function envelopeDiagnostic(path: string, message?: string): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ENVELOPE_INVALID, path, {
    ...(message === undefined ? {} : { message }),
  });
}

function readUnit(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push(envelopeDiagnostic(path));
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!UNIT_KEYS.has(key)) {
      diagnostics.push(envelopeDiagnostic(`${path}/${key}`));
    }
  }
  if (!nonEmptyString(own(value, "unit"))) {
    diagnostics.push(envelopeDiagnostic(`${path}/unit`));
  }
  const scale = own(value, "scale");
  if (scale !== undefined && (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0)) {
    diagnostics.push(envelopeDiagnostic(`${path}/scale`));
  }
  const label = own(value, "label");
  if (label !== undefined && typeof label !== "string") {
    diagnostics.push(envelopeDiagnostic(`${path}/label`));
  }
}

function readFields(value: unknown, diagnostics: Diagnostic[]): readonly QueryResultField[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(envelopeDiagnostic("envelope/fields"));
    return null;
  }
  const fields: QueryResultField[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}`));
      return;
    }
    for (const key of Object.getOwnPropertyNames(entry)) {
      if (!FIELD_KEYS.has(key)) {
        diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}/${key}`));
      }
    }
    const fieldId = own(entry, "fieldId");
    const type = own(entry, "type");
    const role = own(entry, "role");
    if (!nonEmptyString(fieldId)) {
      diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}/fieldId`));
    }
    if (!oneOf(type, FIELD_VALUE_TYPES)) {
      diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}/type`));
      return;
    }
    if (role !== "dimension" && role !== "measure" && role !== "temporal") {
      diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}/role`));
      return;
    }
    const sourceFieldId = own(entry, "sourceFieldId");
    if (sourceFieldId !== undefined && typeof sourceFieldId !== "string") {
      diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}/sourceFieldId`));
    }
    const unit = own(entry, "unit");
    if (unit !== undefined) {
      readUnit(unit, `envelope/fields/${index}/unit`, diagnostics);
    }
    const timezone = own(entry, "timezone");
    if (timezone !== undefined && typeof timezone !== "string") {
      diagnostics.push(envelopeDiagnostic(`envelope/fields/${index}/timezone`));
    }
    fields.push(
      deepFreeze({
        fieldId: fieldId as string,
        ...(typeof sourceFieldId === "string" ? { sourceFieldId } : {}),
        type: type as FieldValueType,
        role,
        ...(unit === undefined
          ? {}
          : { unit: cloneJson(unit as JsonValue) as unknown as QueryResultField["unit"] }),
        ...(typeof timezone === "string" ? { timezone } : {}),
      }) as QueryResultField,
    );
  });
  return Object.freeze(fields);
}

function readCounts(value: unknown, diagnostics: Diagnostic[]): QueryCounts | null {
  if (!isRecord(value)) {
    diagnostics.push(envelopeDiagnostic("envelope/counts"));
    return null;
  }
  const returnedRows = own(value, "returnedRows");
  const totalRows = own(value, "totalRows");
  const filteredRows = own(value, "filteredRows");
  const nullCounts = own(value, "nullCounts");
  if (
    !isNonNegativeInteger(returnedRows) ||
    (totalRows !== null && !isNonNegativeInteger(totalRows)) ||
    !isNonNegativeInteger(filteredRows) ||
    !isRecord(nullCounts)
  ) {
    diagnostics.push(envelopeDiagnostic("envelope/counts"));
    return null;
  }
  const normalizedNulls: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of Object.getOwnPropertyNames(nullCounts)) {
    const count = nullCounts[key];
    if (!isNonNegativeInteger(count)) {
      diagnostics.push(envelopeDiagnostic(`envelope/counts/nullCounts/${key}`));
      return null;
    }
    normalizedNulls[key] = count;
  }
  return Object.freeze({
    returnedRows,
    totalRows,
    filteredRows,
    nullCounts: Object.freeze(normalizedNulls),
  });
}

function readRows(value: unknown, diagnostics: Diagnostic[]): readonly QueryResultRow[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(envelopeDiagnostic("envelope/rows"));
    return null;
  }
  const rows: QueryResultRow[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, String(index))) {
      diagnostics.push(envelopeDiagnostic(`envelope/rows/${index}`));
      return null;
    }
    const entry = value[index];
    if (!isRecord(entry)) {
      diagnostics.push(envelopeDiagnostic(`envelope/rows/${index}`));
      return null;
    }
    const validation = validateJsonValue(entry);
    if (!validation.valid) {
      diagnostics.push(envelopeDiagnostic(`envelope/rows/${index}`));
      return null;
    }
    rows.push(deepFreeze(cloneJson(entry as JsonValue) as QueryResultRow));
  }
  return Object.freeze(rows);
}

export function validateRealtimeEnvelope(value: unknown): Result<RealtimeEnvelope> {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return fail([envelopeDiagnostic("envelope", "A realtime envelope must be a plain object.")]);
  }
  const jsonValidation = validateJsonValue(value);
  if (!jsonValidation.valid) {
    return fail(
      jsonValidation.issues.map((issue) =>
        envelopeDiagnostic(`envelope${issue.path}`, issue.message),
      ),
    );
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!ENVELOPE_KEYS.has(key)) {
      diagnostics.push(envelopeDiagnostic(`envelope/${key}`));
    }
  }
  const messageId = own(value, "messageId");
  const datasetId = own(value, "datasetId");
  const sliceId = own(value, "sliceId");
  const queryKey = own(value, "queryKey");
  const generation = own(value, "generation");
  const epoch = own(value, "epoch");
  const sequence = own(value, "sequence");
  const cursor = own(value, "cursor");
  const kind = own(value, "kind");
  const rowKeys = own(value, "rowKeys");
  const timestamp = own(value, "timestamp");
  if (!nonEmptyString(messageId)) {
    diagnostics.push(envelopeDiagnostic("envelope/messageId"));
  }
  if (!nonEmptyString(datasetId)) {
    diagnostics.push(envelopeDiagnostic("envelope/datasetId"));
  }
  if (sliceId !== undefined && !nonEmptyString(sliceId)) {
    diagnostics.push(envelopeDiagnostic("envelope/sliceId"));
  }
  if (!nonEmptyString(queryKey) || !queryKey.startsWith("BQK1:")) {
    diagnostics.push(envelopeDiagnostic("envelope/queryKey"));
  }
  if (!isPositiveInteger(generation)) {
    diagnostics.push(envelopeDiagnostic("envelope/generation"));
  }
  if (!nonEmptyString(epoch)) {
    diagnostics.push(envelopeDiagnostic("envelope/epoch"));
  }
  if (!isNonNegativeInteger(sequence)) {
    diagnostics.push(envelopeDiagnostic("envelope/sequence"));
  }
  if (cursor !== undefined && !nonEmptyString(cursor)) {
    diagnostics.push(envelopeDiagnostic("envelope/cursor"));
  }
  if (!oneOf(kind, REALTIME_MESSAGE_KINDS)) {
    diagnostics.push(envelopeDiagnostic("envelope/kind"));
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    diagnostics.push(envelopeDiagnostic("envelope/timestamp"));
  }
  const keys: string[] = [];
  if (!Array.isArray(rowKeys)) {
    diagnostics.push(envelopeDiagnostic("envelope/rowKeys"));
  } else {
    const seen = new Set<string>();
    rowKeys.forEach((entry, index) => {
      if (!nonEmptyString(entry)) {
        diagnostics.push(envelopeDiagnostic(`envelope/rowKeys/${index}`));
        return;
      }
      if (seen.has(entry)) {
        diagnostics.push(
          envelopeDiagnostic(`envelope/rowKeys/${index}`, "Duplicate row keys are not allowed."),
        );
        return;
      }
      seen.add(entry);
      keys.push(entry);
    });
  }
  const rowsValue = own(value, "rows");
  const rows = rowsValue === undefined ? undefined : readRows(rowsValue, diagnostics);
  const fieldsValue = own(value, "fields");
  const fields = fieldsValue === undefined ? undefined : readFields(fieldsValue, diagnostics);
  const countsValue = own(value, "counts");
  const counts = countsValue === undefined ? undefined : readCounts(countsValue, diagnostics);
  const complete = own(value, "complete");
  if (complete !== undefined && typeof complete !== "boolean") {
    diagnostics.push(envelopeDiagnostic("envelope/complete"));
  }
  const nextCursor = own(value, "nextCursor");
  if (nextCursor !== undefined && !nonEmptyString(nextCursor)) {
    diagnostics.push(envelopeDiagnostic("envelope/nextCursor"));
  }
  const diagnosticsValue = own(value, "diagnostics");
  let envelopeDiagnostics: readonly Diagnostic[] | undefined;
  if (diagnosticsValue !== undefined) {
    if (!Array.isArray(diagnosticsValue)) {
      diagnostics.push(envelopeDiagnostic("envelope/diagnostics"));
    } else {
      const normalized: Diagnostic[] = [];
      diagnosticsValue.forEach((entry, index) => {
        if (!isRecord(entry)) {
          diagnostics.push(envelopeDiagnostic(`envelope/diagnostics/${index}`));
          return;
        }
        const code = own(entry, "code");
        const path = own(entry, "path");
        const message = own(entry, "message");
        const severity = own(entry, "severity");
        if (
          !nonEmptyString(code) ||
          typeof path !== "string" ||
          typeof message !== "string" ||
          (severity !== "error" && severity !== "warning")
        ) {
          diagnostics.push(envelopeDiagnostic(`envelope/diagnostics/${index}`));
          return;
        }
        normalized.push(
          deepFreeze({
            code,
            path,
            message,
            severity,
            ...(typeof own(entry, "hint") === "string"
              ? { hint: own(entry, "hint") as string }
              : {}),
            ...(typeof own(entry, "source") === "string"
              ? { source: own(entry, "source") as string }
              : {}),
          }),
        );
      });
      envelopeDiagnostics = Object.freeze(normalized);
    }
  }
  if (kind === "snapshot" || kind === "reset" || kind === "append" || kind === "upsert") {
    if (rows === undefined || rows === null) {
      diagnostics.push(envelopeDiagnostic("envelope/rows", "This message kind requires rows."));
    } else if (keys.length !== rows.length) {
      diagnostics.push(
        envelopeDiagnostic("envelope/rowKeys", "Row keys must match the number of rows."),
      );
    }
  }
  if ((kind === "delete" || kind === "heartbeat" || kind === "error") && rows !== undefined) {
    diagnostics.push(
      envelopeDiagnostic("envelope/rows", "This message kind does not accept rows."),
    );
  }
  if (diagnostics.length > 0) {
    return fail(Object.freeze(diagnostics));
  }
  const envelope = deepFreeze({
    messageId: messageId as string,
    datasetId: datasetId as string,
    ...(typeof sliceId === "string" ? { sliceId } : {}),
    queryKey: queryKey as string,
    generation: generation as number,
    epoch: epoch as string,
    sequence: sequence as number,
    ...(typeof cursor === "string" ? { cursor } : {}),
    kind: kind as RealtimeMessageKind,
    rowKeys: Object.freeze(keys),
    ...(rows === undefined ? {} : { rows }),
    ...(fields === undefined ? {} : { fields }),
    ...(counts === undefined ? {} : { counts }),
    ...(complete === undefined ? {} : { complete }),
    ...(typeof nextCursor === "string" ? { nextCursor } : {}),
    ...(envelopeDiagnostics === undefined ? {} : { diagnostics: envelopeDiagnostics }),
    timestamp: timestamp as number,
  }) as RealtimeEnvelope;
  return ok(envelope);
}

export function realtimeRowKey(row: QueryResultRow, keyFields: readonly string[]): string {
  if (keyFields.length === 0) {
    return canonicalJson([] as never);
  }
  return canonicalJson(
    keyFields.map((field) => (Object.hasOwn(row, field) ? row[field] : null)) as never,
  );
}

export function realtimeEnvelopeBytes(envelope: RealtimeEnvelope): number {
  return jsonByteLength(envelope as unknown as JsonValue);
}

export function normalizeRealtimeLimits(
  limits?: Partial<RealtimeLimits> | undefined,
): RealtimeLimits {
  const pick = (value: unknown, fallback: number, minimum: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= minimum
      ? Math.floor(value)
      : fallback;
  return Object.freeze({
    maxBufferedMessages: pick(
      limits?.maxBufferedMessages,
      DEFAULT_REALTIME_LIMITS.maxBufferedMessages,
      1,
    ),
    maxBufferedBytes: pick(limits?.maxBufferedBytes, DEFAULT_REALTIME_LIMITS.maxBufferedBytes, 1),
    maxBufferAgeMs: pick(limits?.maxBufferAgeMs, DEFAULT_REALTIME_LIMITS.maxBufferAgeMs, 0),
  });
}
