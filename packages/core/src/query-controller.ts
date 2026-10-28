import {
  emptyQueryCounts,
  validateDatasetDescriptor,
  validateDatasetProviderContract,
  type DatasetProvider,
  type DatasetProviderContext,
  type DatasetQueryResult,
  type QueryAbortSignal,
  type QuerySpec,
  type QueryState,
} from "./data-contract.js";
import type { Clock } from "./clock.js";
import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import type { QueryEventInput, RealtimeEventInput } from "./events.js";
import type { IdFactory } from "./ids.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { own } from "./board-validation-shared.js";
import { createQueryAbortHandle } from "./query-abort.js";
import { admitQuerySpec, buildQueryPlan, type QueryPlan } from "./query-planning.js";
import { admitProviderResult, normalizeDiagnostics, normalizeSuccess } from "./query-result.js";
import {
  realtimeRowKey,
  type RealtimeLimits,
  type RealtimeSubscriptionState,
  type RealtimeTransport,
  type RealtimeTransportInfo,
} from "./realtime-contract.js";
import {
  RealtimeSession,
  type RealtimeSessionHost,
  type RealtimeSnapshotInput,
  type RealtimeUpdateInput,
} from "./realtime-session.js";

export interface QuerySetOptions {
  readonly live?: boolean;
  readonly keyFields?: readonly string[];
  readonly cursor?: string;
  readonly limits?: Partial<RealtimeLimits>;
}

export interface QueryControllerOptions {
  readonly provider?: DatasetProvider;
  readonly realtime?: RealtimeTransport;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly emit: (event: QueryEventInput) => void;
  readonly emitRealtime?: (event: RealtimeEventInput) => void;
  readonly isActive?: () => boolean;
}

export interface QueryController {
  readonly pendingCount: number;
  setQuery(queryId: string, spec: QuerySpec, options?: QuerySetOptions): Result<QueryState>;
  refreshQuery(queryId: string): Result<QueryState>;
  invalidateQuery(queryId: string, reason?: string): Result<QueryState>;
  cancelQuery(queryId: string, reason?: string): Result<QueryState>;
  removeQuery(queryId: string): Result<void>;
  getQueryState(queryId: string): QueryState | undefined;
  listQueryStates(): readonly QueryState[];
  getRealtimeInfo(): RealtimeTransportInfo | null;
  getRealtimeState(queryId: string): RealtimeSubscriptionState | undefined;
  listRealtimeStates(): readonly RealtimeSubscriptionState[];
  pauseRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]>;
  resumeRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]>;
  resyncRealtime(queryId?: string, reason?: string): Result<readonly RealtimeSubscriptionState[]>;
  closeRealtime(queryId?: string, reason?: string): Result<readonly RealtimeSubscriptionState[]>;
  dispose(): void;
}

interface QuerySlot {
  readonly queryId: string;
  plan: QueryPlan;
  generation: number;
  revision: number;
  state: QueryState;
  currentToken: number;
  controller: { readonly signal: QueryAbortSignal; abort(reason?: unknown): void } | null;
  live: boolean;
  liveKeyFields: readonly string[];
  liveLimits?: Partial<RealtimeLimits>;
  liveCursor?: string;
  realtime: RealtimeSession | null;
  realtimeToken: number;
  realtimeSubscriptionId: string | null;
  realtimeDiagnostics: readonly Diagnostic[];
}

interface CapturedRequest {
  readonly slot: QuerySlot;
  readonly plan: QueryPlan;
  readonly requestId: string;
  readonly requestToken: number;
  readonly queryKey: string;
  readonly generation: number;
  readonly datasetId: string;
  readonly sliceId?: string;
  readonly startedAt: number;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function defaultRealtimeKeyFields(plan: QueryPlan): readonly string[] {
  if (plan.request.groupBy.length > 0) {
    return Object.freeze(plan.request.groupBy.map((grouping) => grouping.fieldId));
  }
  if (plan.request.aggregations.length > 0) {
    return Object.freeze([]);
  }
  return Object.freeze([...plan.request.fields]);
}

function capDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.message}\u0000${diagnostic.severity}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(diagnostic);
    if (unique.length >= 100) {
      break;
    }
  }
  return Object.freeze(unique);
}

function sameLiveOptions(
  slot: QuerySlot,
  keyFields: readonly string[],
  options: QuerySetOptions,
): boolean {
  return (
    canonicalJson(slot.liveKeyFields as never) === canonicalJson(keyFields as never) &&
    canonicalJson((slot.liveLimits ?? null) as never) ===
      canonicalJson((options.limits ?? null) as never) &&
    slot.liveCursor === options.cursor
  );
}

class QueryControllerImpl implements QueryController {
  private readonly provider?: DatasetProvider;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly emitEvent: (event: QueryEventInput) => void;
  private readonly emitRealtimeEvent: (event: RealtimeEventInput) => void;
  private readonly realtimeTransport?: RealtimeTransport;
  private readonly isActive: () => boolean;
  private readonly slots = new Map<string, QuerySlot>();
  private requestSequence = 0;
  private disposed = false;

  constructor(options: QueryControllerOptions) {
    if (options.provider) {
      const contract = validateDatasetProviderContract(options.provider);
      if (!contract.valid) {
        const first = contract.diagnostics[0];
        throw new BoardloomError(
          first ?? createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "provider"),
        );
      }
    }
    this.provider = options.provider;
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.emitEvent = options.emit;
    this.emitRealtimeEvent = options.emitRealtime ?? (() => undefined);
    this.realtimeTransport = options.realtime;
    this.isActive = options.isActive ?? (() => true);
  }

  get pendingCount(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.currentToken !== 0) {
        count += 1;
      }
    }
    return count;
  }

  setQuery(queryId: string, spec: QuerySpec, options: QuerySetOptions = {}): Result<QueryState> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "query")]);
    }
    if (typeof queryId !== "string" || queryId.trim() === "") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "queryId", {
          message: "A query ID must be a non-empty string.",
        }),
      ]);
    }
    if (!this.provider) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_MISSING, "provider")]);
    }
    const live = options.live === true;
    if (live && this.realtimeTransport === undefined) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.REALTIME_NOT_CONFIGURED, "realtime")]);
    }
    const admittedSpec = admitQuerySpec(spec);
    if (!admittedSpec.ok) {
      return admittedSpec;
    }
    const specInput = admittedSpec.value;
    const requestedDatasetId = specInput.datasetId;
    if (typeof requestedDatasetId !== "string" || requestedDatasetId.trim() === "") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MISSING_ID, "datasetId", {
          message: "A query requires a dataset identifier.",
        }),
      ]);
    }
    let descriptor;
    try {
      descriptor = this.provider.getDatasetDescriptor(requestedDatasetId);
    } catch {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "provider", {
          message: "The dataset provider failed to resolve a dataset descriptor.",
        }),
      ]);
    }
    if (!descriptor) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "datasetId", {
          relatedIds: [requestedDatasetId],
        }),
      ]);
    }
    const descriptorValidation = validateDatasetDescriptor(descriptor);
    if (!descriptorValidation.valid || !descriptorValidation.descriptor) {
      return fail(descriptorValidation.diagnostics);
    }
    const descriptorValue = descriptorValidation.descriptor;
    if (live && descriptorValue.capabilities.realtime !== true) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.REALTIME_PROVIDER_UNSUPPORTED, "datasetId", {
          relatedIds: [descriptorValue.id],
        }),
      ]);
    }
    let planned;
    try {
      planned = buildQueryPlan(descriptorValue, specInput, {
        providerId: this.provider.providerId,
      });
    } catch {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_INVALID, "", {
          message: "The query specification could not be normalized.",
        }),
      ]);
    }
    if (!planned.ok) {
      return fail(planned.diagnostics);
    }
    const plan = planned.value;
    const key = plan.key.value;
    const keyFields = options.keyFields ?? defaultRealtimeKeyFields(plan);
    const existing = this.slots.get(queryId);
    if (
      existing !== undefined &&
      live &&
      existing.live &&
      existing.plan.key.value === key &&
      sameLiveOptions(existing, keyFields, options)
    ) {
      return ok(existing.state);
    }
    let generation = 1;
    let invalidated = false;
    if (existing) {
      generation = existing.plan.key.value === key ? existing.generation : existing.generation + 1;
      invalidated = existing.plan.key.value !== key;
      const slotKeyBefore = existing.plan.key.value;
      const slotGenerationBefore = existing.generation;
      const wasInFlight = existing.currentToken !== 0;
      if (existing.realtime !== null) {
        const previousSession = existing.realtime;
        const replacementToken = existing.realtimeToken + 1;
        existing.realtimeToken = replacementToken;
        existing.realtime = null;
        existing.realtimeSubscriptionId = null;
        previousSession.close("subscription-replaced");
        if (this.slots.get(queryId) !== existing || existing.realtimeToken !== replacementToken) {
          return this.resolveSuperseded(queryId, existing);
        }
      }
      if (
        wasInFlight &&
        !this.cancelInFlight(existing, invalidated ? "query-key-changed" : "superseded")
      ) {
        return this.resolveSuperseded(queryId, existing);
      }
      if (
        this.slots.get(queryId) !== existing ||
        existing.currentToken !== 0 ||
        existing.plan.key.value !== slotKeyBefore ||
        existing.generation !== slotGenerationBefore
      ) {
        return this.resolveSuperseded(queryId, existing);
      }
    }
    const now = this.clock.now();
    const slot: QuerySlot = existing ?? {
      queryId,
      plan,
      generation,
      revision: 0,
      state: this.createLoadingState(queryId, plan, generation, null, 0, now),
      currentToken: 0,
      controller: null,
      live: false,
      liveKeyFields: Object.freeze([]),
      realtime: null,
      realtimeToken: 0,
      realtimeSubscriptionId: null,
      realtimeDiagnostics: Object.freeze([]),
    };
    if (existing) {
      if (invalidated) {
        const previousKey = existing.plan.key.value;
        const previousGeneration = existing.generation;
        existing.plan = plan;
        existing.generation = generation;
        const revisionBeforeInvalidation = existing.revision;
        this.emit({
          type: "query:invalidated",
          queryId,
          previousQueryKey: previousKey,
          newQueryKey: key,
          previousGeneration,
          newGeneration: generation,
          reason: "query-key-changed",
        });
        if (existing.revision !== revisionBeforeInvalidation) {
          return this.resolveSuperseded(queryId, existing);
        }
        if (this.slots.get(queryId) !== existing) {
          return this.resolveSuperseded(queryId, existing);
        }
      } else {
        existing.plan = plan;
      }
    } else {
      this.slots.set(queryId, slot);
    }
    slot.live = live;
    slot.liveKeyFields = Object.freeze([...keyFields]);
    slot.liveLimits = options.limits;
    slot.liveCursor = options.cursor;
    if (live) {
      return ok(this.startRealtime(slot, options, invalidated || !existing));
    }
    return ok(this.startRequest(slot));
  }

  private startRealtime(
    slot: QuerySlot,
    options: QuerySetOptions,
    resetState: boolean,
  ): QueryState {
    const transport = this.realtimeTransport;
    if (transport === undefined) {
      return slot.state;
    }
    if (slot.realtime !== null) {
      const previous = slot.realtime;
      const replacementToken = slot.realtimeToken + 1;
      slot.realtimeToken = replacementToken;
      slot.realtime = null;
      previous.close("subscription-replaced");
      if (this.slots.get(slot.queryId) !== slot || slot.realtimeToken !== replacementToken) {
        return slot.state;
      }
    }
    slot.realtimeToken += 1;
    const sessionToken = slot.realtimeToken;
    const subscriptionId = this.idFactory.createId("realtime-subscription");
    slot.realtimeSubscriptionId = subscriptionId;
    slot.currentToken = 0;
    slot.controller = null;
    const now = this.clock.now();
    const key = slot.plan.key.value;
    const generation = slot.generation;
    const keyFields = slot.liveKeyFields;
    const cursor = options.cursor ?? slot.liveCursor;
    const limits = options.limits ?? slot.liveLimits;
    const baseState = resetState
      ? Object.freeze({
          ...this.createLoadingState(slot.queryId, slot.plan, generation, null, 0, now),
          source: "realtime" as const,
        })
      : Object.freeze({
          ...slot.state,
          generation,
          phase: "stale" as const,
          staleReason: "realtime-resync",
          updatedAt: now,
          source: "realtime" as const,
        });
    slot.state = baseState;
    slot.revision += 1;
    slot.realtimeDiagnostics = Object.freeze([]);
    const isCurrent = (): boolean => {
      return (
        this.isActive() &&
        !this.disposed &&
        this.slots.get(slot.queryId) === slot &&
        slot.realtimeToken === sessionToken &&
        slot.generation === generation &&
        slot.plan.key.value === key
      );
    };
    const host: RealtimeSessionHost = {
      isCurrent,
      applySnapshot: (input: RealtimeSnapshotInput): void => {
        if (!isCurrent()) {
          return;
        }
        slot.realtimeDiagnostics = capDiagnostics(input.diagnostics);
        slot.state = this.realtimeStateFromSnapshot(slot, input);
        slot.revision += 1;
      },
      applyUpdate: (input: RealtimeUpdateInput): void => {
        if (!isCurrent()) {
          return;
        }
        slot.state = this.realtimeStateFromUpdate(slot, input);
        slot.revision += 1;
      },
      markStale: (reason: string): void => {
        if (!isCurrent()) {
          return;
        }
        const previous = slot.state;
        slot.state = deepFreeze({
          ...previous,
          phase: "stale" as const,
          staleReason: reason,
          updatedAt: this.clock.now(),
          source: "realtime" as const,
        });
        slot.revision += 1;
      },
      emit: (event: RealtimeEventInput): void => {
        if (this.isActive() && !this.disposed) {
          this.emitRealtimeEvent(event);
        }
      },
    };
    const session = new RealtimeSession({
      transport,
      queryId: slot.queryId,
      subscriptionId,
      queryKey: key,
      datasetId: slot.plan.request.datasetId,
      ...(slot.plan.request.sliceId === undefined ? {} : { sliceId: slot.plan.request.sliceId }),
      generation,
      keyFields,
      expectedFields: slot.plan.outputFields,
      allowGlobalAggregateRow:
        slot.plan.request.groupBy.length === 0 && slot.plan.request.aggregations.length > 0,
      ...(cursor === undefined ? {} : { cursor }),
      ...(limits === undefined ? {} : { limits }),
      now: () => this.clock.now(),
      host,
    });
    slot.realtime = session;
    session.start();
    return slot.state;
  }

  private realtimeStateFromSnapshot(slot: QuerySlot, input: RealtimeSnapshotInput): QueryState {
    const now = this.clock.now();
    const diagnostics = capDiagnostics([...slot.realtimeDiagnostics, ...input.diagnostics]);
    const phase: QueryState["phase"] = diagnostics.some((entry) => entry.severity === "error")
      ? "error"
      : !input.complete || diagnostics.length > 0
        ? "partial"
        : input.rows.length === 0
          ? "empty"
          : "settled";
    return deepFreeze({
      queryId: slot.queryId,
      datasetId: slot.plan.request.datasetId,
      datasetVersion: slot.plan.request.datasetVersion,
      ...(slot.plan.request.sliceId === undefined ? {} : { sliceId: slot.plan.request.sliceId }),
      queryKey: slot.plan.key.value,
      generation: slot.generation,
      phase,
      requestId: null,
      requestToken: 0,
      fields: input.fields,
      rows: input.rows,
      counts: input.counts,
      diagnostics,
      complete: input.complete && diagnostics.every((entry) => entry.severity !== "error"),
      ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
      startedAt: slot.state.startedAt ?? now,
      settledAt: now,
      updatedAt: now,
      source: "realtime" as const,
      countsStale: false,
    });
  }

  private realtimeStateFromUpdate(slot: QuerySlot, input: RealtimeUpdateInput): QueryState {
    const previous = slot.state;
    const keyFields = slot.liveKeyFields;
    const diagnostics: Diagnostic[] = [...input.diagnostics];
    let rows: QueryState["rows"] = previous.rows;
    if (input.deletes.length > 0) {
      const deleteSet = new Set(input.deletes);
      const missing: string[] = [];
      for (const key of deleteSet) {
        if (!rows.some((row) => realtimeRowKey(row, keyFields) === key)) {
          missing.push(key);
        }
      }
      rows = Object.freeze(rows.filter((row) => !deleteSet.has(realtimeRowKey(row, keyFields))));
      if (missing.length > 0) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ROW_MISSING, "realtime/rowKeys", {
            severity: "warning",
            message: "A realtime delete referenced a row that is not present.",
            relatedIds: missing,
          }),
        );
      }
    }
    if (input.upserts.length > 0) {
      const byKey = new Map<string, QueryState["rows"][number]>();
      for (const row of rows) {
        byKey.set(realtimeRowKey(row, keyFields), row);
      }
      for (const upsert of input.upserts) {
        byKey.set(upsert.key, upsert.row);
      }
      rows = Object.freeze([...byKey.values()]);
    }
    slot.realtimeDiagnostics = capDiagnostics([...slot.realtimeDiagnostics, ...diagnostics]);
    const mergedDiagnostics = capDiagnostics([...slot.realtimeDiagnostics]);
    const now = this.clock.now();
    const phase: QueryState["phase"] =
      previous.phase === "partial"
        ? "partial"
        : previous.phase === "error"
          ? "error"
          : rows.length === 0
            ? "empty"
            : "settled";
    const previousRowsByKey = new Map<string, QueryState["rows"][number]>();
    for (const row of previous.rows) {
      previousRowsByKey.set(realtimeRowKey(row, keyFields), row);
    }
    let nullStatusChanged = false;
    let introducedRow = false;
    for (const upsert of input.upserts) {
      const before = previousRowsByKey.get(upsert.key);
      if (before === undefined) {
        introducedRow = true;
        break;
      }
      for (const field of slot.plan.outputFields) {
        if (field.role !== "measure") {
          continue;
        }
        const beforeNull = !Object.hasOwn(before, field.fieldId) || before[field.fieldId] === null;
        const afterNull =
          !Object.hasOwn(upsert.row, field.fieldId) || upsert.row[field.fieldId] === null;
        if (beforeNull !== afterNull) {
          nullStatusChanged = true;
          break;
        }
      }
    }
    const metadataStale = input.deletes.length > 0 || introducedRow || nullStatusChanged;
    const nullCounts: Record<string, number> = Object.create(null) as Record<string, number>;
    if (metadataStale) {
      for (const field of slot.plan.outputFields) {
        if (field.role === "measure") {
          nullCounts[field.fieldId] = rows.filter(
            (row) => !Object.hasOwn(row, field.fieldId) || row[field.fieldId] === null,
          ).length;
        }
      }
    }
    return deepFreeze({
      ...previous,
      phase,
      rows,
      counts: Object.freeze({
        returnedRows: rows.length,
        totalRows: metadataStale ? null : previous.counts.totalRows,
        filteredRows: metadataStale
          ? Math.max(previous.counts.filteredRows, rows.length)
          : previous.counts.filteredRows,
        nullCounts: metadataStale ? Object.freeze(nullCounts) : previous.counts.nullCounts,
      }),
      diagnostics: mergedDiagnostics,
      complete: previous.complete,
      settledAt: now,
      updatedAt: now,
      staleReason: undefined,
      source: "realtime" as const,
      countsStale: metadataStale ? true : previous.countsStale,
    });
  }

  getRealtimeInfo(): RealtimeTransportInfo | null {
    if (this.realtimeTransport === undefined) {
      return null;
    }
    return Object.freeze({
      transportId: this.realtimeTransport.transportId,
      simulated: this.realtimeTransport.simulated,
    });
  }

  getRealtimeState(queryId: string): RealtimeSubscriptionState | undefined {
    return this.slots.get(queryId)?.realtime?.getState();
  }

  listRealtimeStates(): readonly RealtimeSubscriptionState[] {
    return Object.freeze(
      [...this.slots.values()]
        .filter((slot) => slot.realtime !== null)
        .sort((left, right) => lexicalCompare(left.queryId, right.queryId))
        .map((slot) => slot.realtime?.getState())
        .filter((state): state is RealtimeSubscriptionState => state !== undefined),
    );
  }

  pauseRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]> {
    return this.controlRealtime(queryId, "pause");
  }

  resumeRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]> {
    return this.controlRealtime(queryId, "resume");
  }

  resyncRealtime(
    queryId?: string,
    reason = "requested",
  ): Result<readonly RealtimeSubscriptionState[]> {
    return this.controlRealtime(queryId, "resync", reason);
  }

  closeRealtime(queryId?: string, reason = "host"): Result<readonly RealtimeSubscriptionState[]> {
    return this.controlRealtime(queryId, "close", reason);
  }

  private controlRealtime(
    queryId: string | undefined,
    action: "pause" | "resume" | "resync" | "close",
    reason?: string,
  ): Result<readonly RealtimeSubscriptionState[]> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "realtime")]);
    }
    const slots =
      queryId === undefined
        ? [...this.slots.values()].filter((slot) => slot.realtime !== null)
        : [this.slots.get(queryId)].filter((slot): slot is QuerySlot => slot !== undefined);
    if (queryId !== undefined) {
      const slot = slots[0];
      if (slot === undefined) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_NOT_FOUND, "queryId", {
            relatedIds: [queryId],
          }),
        ]);
      }
      if (slot.realtime === null) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.REALTIME_NOT_CONFIGURED, "realtime")]);
      }
    }
    const states: RealtimeSubscriptionState[] = [];
    for (const slot of slots) {
      const session = slot.realtime;
      if (session === null) {
        continue;
      }
      if (action === "pause") {
        session.pause();
      } else if (action === "resume") {
        session.resume();
      } else if (action === "resync") {
        session.resync(reason);
      } else {
        states.push(session.getState());
        const revisionBefore = slot.revision;
        const sessionToken = slot.realtimeToken;
        slot.realtime = null;
        slot.live = false;
        session.close(reason);
        if (
          this.slots.get(slot.queryId) !== slot ||
          slot.revision !== revisionBefore ||
          slot.realtimeToken !== sessionToken
        ) {
          continue;
        }
        const previous = slot.state;
        slot.state = deepFreeze({
          ...previous,
          phase: "stale" as const,
          staleReason: "realtime-closed",
          updatedAt: this.clock.now(),
          source: "realtime" as const,
        });
        slot.revision += 1;
        continue;
      }
      states.push(session.getState());
    }
    return ok(Object.freeze(states));
  }

  refreshQuery(queryId: string): Result<QueryState> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "query")]);
    }
    const slot = this.slots.get(queryId);
    if (!slot) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_NOT_FOUND, "queryId", { relatedIds: [queryId] }),
      ]);
    }
    if (!this.provider) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_MISSING, "provider")]);
    }
    if (slot.live) {
      if (slot.realtime !== null) {
        slot.realtime.resync("refresh");
      } else {
        return ok(this.startRealtime(slot, { live: true }, false));
      }
      return ok(slot.state);
    }
    const planKey = slot.plan.key.value;
    const generation = slot.generation;
    if (slot.currentToken !== 0 && !this.cancelInFlight(slot, "superseded")) {
      return this.resolveSuperseded(queryId, slot);
    }
    if (
      this.slots.get(queryId) !== slot ||
      slot.currentToken !== 0 ||
      slot.plan.key.value !== planKey ||
      slot.generation !== generation
    ) {
      return this.resolveSuperseded(queryId, slot);
    }
    return ok(this.startRequest(slot));
  }

  invalidateQuery(queryId: string, reason = "invalidated"): Result<QueryState> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "query")]);
    }
    const slot = this.slots.get(queryId);
    if (!slot) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_NOT_FOUND, "queryId", { relatedIds: [queryId] }),
      ]);
    }
    const planKey = slot.plan.key.value;
    const generation = slot.generation;
    if (slot.currentToken !== 0 && !this.cancelInFlight(slot, reason)) {
      return this.resolveSuperseded(queryId, slot);
    }
    if (
      this.slots.get(queryId) !== slot ||
      slot.currentToken !== 0 ||
      slot.plan.key.value !== planKey ||
      slot.generation !== generation
    ) {
      return this.resolveSuperseded(queryId, slot);
    }
    const previousKey = slot.plan.key.value;
    const previousGeneration = slot.generation;
    const previous = slot.state;
    const revisionBefore = slot.revision;
    if (slot.realtime !== null) {
      const session = slot.realtime;
      slot.realtimeToken += 1;
      slot.realtime = null;
      slot.realtimeSubscriptionId = null;
      session.close("query-invalidated");
      if (this.slots.get(queryId) !== slot || slot.revision !== revisionBefore) {
        return this.resolveSuperseded(queryId, slot);
      }
    }
    slot.generation += 1;
    const now = this.clock.now();
    const next = deepFreeze({
      ...previous,
      generation: slot.generation,
      phase: "stale" as const,
      complete: previous.complete,
      staleReason: reason,
      updatedAt: now,
      source: slot.live ? ("realtime" as const) : previous.source,
    });
    slot.state = next;
    slot.revision += 1;
    this.emit({
      type: "query:invalidated",
      queryId,
      previousQueryKey: previousKey,
      newQueryKey: slot.plan.key.value,
      previousGeneration,
      newGeneration: slot.generation,
      reason,
    });
    if (slot.live) {
      return ok(this.startRealtime(slot, { live: true }, false));
    }
    return ok(next);
  }

  cancelQuery(queryId: string, reason = "host"): Result<QueryState> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "query")]);
    }
    const slot = this.slots.get(queryId);
    if (!slot) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_NOT_FOUND, "queryId", { relatedIds: [queryId] }),
      ]);
    }
    if (slot.live) {
      const session = slot.realtime;
      const revisionBefore = slot.revision;
      slot.realtime = null;
      slot.live = false;
      if (session !== null) {
        slot.realtimeToken += 1;
        slot.realtimeSubscriptionId = null;
        session.close(reason);
        if (this.slots.get(queryId) !== slot || slot.revision !== revisionBefore) {
          return this.resolveSuperseded(queryId, slot);
        }
      }
      const now = this.clock.now();
      const next = this.createCancelledState(slot, reason, now);
      slot.state = next;
      slot.revision += 1;
      this.emit({
        type: "query:cancelled",
        queryId,
        queryKey: slot.plan.key.value,
        generation: slot.generation,
        reason,
      });
      return ok(next);
    }
    if (slot.currentToken === 0) {
      return ok(slot.state);
    }
    const requestId = slot.state.requestId ?? undefined;
    const requestToken = slot.currentToken;
    const queryKey = slot.plan.key.value;
    const generation = slot.generation;
    const controller = slot.controller;
    if (controller) {
      controller.abort(reason);
    }
    if (
      this.slots.get(queryId) !== slot ||
      slot.currentToken !== requestToken ||
      slot.controller !== controller
    ) {
      return this.resolveSuperseded(queryId, slot);
    }
    slot.controller = null;
    slot.currentToken = 0;
    const now = this.clock.now();
    const next = this.createCancelledState(slot, reason, now);
    slot.state = next;
    slot.revision += 1;
    this.emit({
      type: "query:cancelled",
      queryId,
      ...(requestId === undefined ? {} : { requestId }),
      requestToken,
      queryKey,
      generation,
      reason,
    });
    return ok(next);
  }

  removeQuery(queryId: string): Result<void> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "query")]);
    }
    const slot = this.slots.get(queryId);
    if (!slot) {
      return ok(undefined);
    }
    if (slot.realtime !== null) {
      const session = slot.realtime;
      slot.realtimeToken += 1;
      slot.realtime = null;
      slot.realtimeSubscriptionId = null;
      session.close("removed");
    }
    const requestToken = slot.currentToken;
    const controller = slot.controller;
    if (controller) {
      controller.abort("removed");
    }
    if (
      this.slots.get(queryId) !== slot ||
      slot.currentToken !== requestToken ||
      slot.controller !== controller
    ) {
      return ok(undefined);
    }
    slot.controller = null;
    slot.currentToken = 0;
    slot.revision += 1;
    this.slots.delete(queryId);
    return ok(undefined);
  }

  getQueryState(queryId: string): QueryState | undefined {
    return this.slots.get(queryId)?.state;
  }

  listQueryStates(): readonly QueryState[] {
    return Object.freeze(
      [...this.slots.values()]
        .sort((left, right) => lexicalCompare(left.queryId, right.queryId))
        .map((slot) => slot.state),
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const slot of this.slots.values()) {
      if (slot.controller) {
        slot.controller.abort("disposed");
      }
      if (slot.realtime !== null) {
        const session = slot.realtime;
        slot.realtime = null;
        session.close("disposed");
      }
      slot.currentToken = 0;
      slot.controller = null;
    }
    this.slots.clear();
  }

  private resolveSuperseded(queryId: string, slot: QuerySlot): Result<QueryState> {
    if (this.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "query")]);
    }
    const current = this.slots.get(queryId);
    if (current === slot) {
      return ok(slot.state);
    }
    if (current) {
      return ok(current.state);
    }
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_NOT_FOUND, "queryId", {
        relatedIds: [queryId],
      }),
    ]);
  }

  private createCancelledState(slot: QuerySlot, reason: string, now: number): QueryState {
    return deepFreeze({
      ...slot.state,
      phase: "cancelled" as const,
      requestId: null,
      rows: Object.freeze([]),
      counts: emptyQueryCounts(),
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_CANCELLED, "query", {
          severity: "warning",
          message: `The query was cancelled: ${reason}.`,
        }),
      ]),
      complete: false,
      cancelledReason: reason,
      settledAt: now,
      updatedAt: now,
    });
  }

  private createLoadingState(
    queryId: string,
    plan: QueryPlan,
    generation: number,
    requestId: string | null,
    requestToken: number,
    now: number,
  ): QueryState {
    return deepFreeze({
      queryId,
      datasetId: plan.request.datasetId,
      datasetVersion: plan.request.datasetVersion,
      ...(plan.request.sliceId === undefined ? {} : { sliceId: plan.request.sliceId }),
      queryKey: plan.key.value,
      generation,
      phase: "loading" as const,
      requestId,
      requestToken,
      fields: plan.outputFields,
      rows: Object.freeze([]),
      counts: emptyQueryCounts(),
      diagnostics: Object.freeze([]),
      complete: false,
      startedAt: now,
      settledAt: null,
      updatedAt: now,
    });
  }

  private startRequest(slot: QuerySlot): QueryState {
    const provider = this.provider;
    if (!provider) {
      return slot.state;
    }
    const now = this.clock.now();
    const requestToken = (this.requestSequence += 1);
    const requestId = this.idFactory.createId("query-request");
    const handle = createQueryAbortHandle();
    slot.controller = handle;
    slot.currentToken = requestToken;
    slot.revision += 1;
    const startedState = this.createLoadingState(
      slot.queryId,
      slot.plan,
      slot.generation,
      requestId,
      requestToken,
      now,
    );
    slot.state = startedState;
    const captured: CapturedRequest = Object.freeze({
      slot,
      plan: slot.plan,
      requestId,
      requestToken,
      queryKey: slot.plan.key.value,
      generation: slot.generation,
      datasetId: slot.plan.request.datasetId,
      ...(slot.plan.request.sliceId === undefined ? {} : { sliceId: slot.plan.request.sliceId }),
      startedAt: now,
    });
    this.emit({
      type: "query:started",
      queryId: slot.queryId,
      requestId,
      requestToken,
      queryKey: captured.queryKey,
      generation: captured.generation,
      datasetId: captured.datasetId,
      ...(captured.sliceId === undefined ? {} : { sliceId: captured.sliceId }),
    });
    if (!this.isCurrent(captured)) {
      return startedState;
    }
    const context: DatasetProviderContext = Object.freeze({
      signal: handle.signal,
      requestId,
      requestToken,
      queryKey: captured.queryKey,
      generation: captured.generation,
    });
    Promise.resolve()
      .then(() => provider.query(captured.plan.request, context))
      .then(
        (result) => this.handleResult(captured, result),
        (error: unknown) => this.handleError(captured, error),
      );
    return startedState;
  }

  private cancelInFlight(slot: QuerySlot, reason: string): boolean {
    if (slot.currentToken === 0) {
      return true;
    }
    const requestId = slot.state.requestId ?? undefined;
    const requestToken = slot.currentToken;
    const queryKey = slot.plan.key.value;
    const generation = slot.generation;
    const controller = slot.controller;
    if (controller) {
      controller.abort(reason);
    }
    if (
      this.slots.get(slot.queryId) !== slot ||
      slot.currentToken !== requestToken ||
      slot.controller !== controller
    ) {
      return false;
    }
    slot.controller = null;
    slot.currentToken = 0;
    slot.revision += 1;
    slot.state = this.createCancelledState(slot, reason, this.clock.now());
    this.emit({
      type: "query:cancelled",
      queryId: slot.queryId,
      ...(requestId === undefined ? {} : { requestId }),
      requestToken,
      queryKey,
      generation,
      reason,
    });
    return true;
  }

  private handleResult(captured: CapturedRequest, result: DatasetQueryResult): void {
    if (!this.isCurrent(captured)) {
      this.reportStale(captured);
      return;
    }
    try {
      this.handleResultAdmitted(captured, result);
    } catch {
      this.failRequest(captured, [
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result", {
          message: "The provider result could not be normalized.",
        }),
      ]);
    }
  }

  private handleResultAdmitted(captured: CapturedRequest, result: DatasetQueryResult): void {
    const admitted = admitProviderResult(result);
    if (!admitted.ok) {
      this.failRequest(captured, admitted.diagnostics);
      return;
    }
    const value = admitted.value;
    const diagnostics: Diagnostic[] = [];
    const requestId = own(value, "requestId");
    const datasetId = own(value, "datasetId");
    const datasetVersion = own(value, "datasetVersion");
    const sliceId = own(value, "sliceId");
    if (
      requestId !== captured.requestId ||
      datasetId !== captured.plan.request.datasetId ||
      datasetVersion !== captured.plan.request.datasetVersion ||
      sliceId !== captured.plan.request.sliceId
    ) {
      this.failRequest(captured, [
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result", {
          message: "The provider result identity does not match the request it answers.",
        }),
      ]);
      return;
    }
    const providerDiagnostics = normalizeDiagnostics(
      own(value, "diagnostics"),
      diagnostics,
      "result/diagnostics",
    );
    if (!providerDiagnostics || diagnostics.length > 0) {
      this.failRequest(captured, diagnostics);
      return;
    }
    if (own(value, "ok") !== true) {
      const hasErrorDiagnostic = providerDiagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
      const failureDiagnostics = hasErrorDiagnostic
        ? providerDiagnostics
        : [
            createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "query", {
              message: "The dataset provider failed without an error diagnostic.",
            }),
            ...providerDiagnostics,
          ];
      this.failRequest(captured, failureDiagnostics);
      return;
    }
    const allowGlobalAggregateRow =
      captured.plan.request.groupBy.length === 0 && captured.plan.request.aggregations.length > 0;
    const normalized = normalizeSuccess(
      value,
      diagnostics,
      captured.plan.outputFields,
      allowGlobalAggregateRow,
    );
    if (!normalized) {
      this.failRequest(captured, diagnostics);
      return;
    }
    const allDiagnostics = normalized.diagnostics;
    const incomplete = !normalized.complete || allDiagnostics.length > 0;
    const complete = normalized.complete && allDiagnostics.length === 0;
    const phase: QueryState["phase"] = incomplete
      ? "partial"
      : normalized.rows.length === 0
        ? "empty"
        : "settled";
    const now = this.clock.now();
    captured.slot.controller = null;
    captured.slot.currentToken = 0;
    const next = deepFreeze({
      queryId: captured.slot.queryId,
      datasetId: captured.datasetId,
      datasetVersion: captured.plan.request.datasetVersion,
      ...(captured.sliceId === undefined ? {} : { sliceId: captured.sliceId }),
      queryKey: captured.queryKey,
      generation: captured.generation,
      phase,
      requestId: captured.requestId,
      requestToken: captured.requestToken,
      fields: normalized.fields,
      rows: normalized.rows,
      counts: normalized.counts,
      diagnostics: allDiagnostics,
      complete,
      ...(normalized.nextCursor === undefined ? {} : { nextCursor: normalized.nextCursor }),
      startedAt: captured.startedAt,
      settledAt: now,
      updatedAt: now,
    });
    captured.slot.state = next;
    const nullCount = Object.values(normalized.counts.nullCounts).reduce(
      (total, count) => total + count,
      0,
    );
    this.emit({
      type: "query:settled",
      queryId: captured.slot.queryId,
      requestId: captured.requestId,
      requestToken: captured.requestToken,
      queryKey: captured.queryKey,
      generation: captured.generation,
      datasetId: captured.datasetId,
      ...(captured.sliceId === undefined ? {} : { sliceId: captured.sliceId }),
      phase,
      rowCount: normalized.rows.length,
      nullCount,
      complete,
    });
  }

  private handleError(captured: CapturedRequest, error: unknown): void {
    if (!this.isCurrent(captured)) {
      this.reportStale(captured);
      return;
    }
    captured.slot.controller = null;
    captured.slot.currentToken = 0;
    const diagnostic =
      error instanceof BoardloomError
        ? error.diagnostic
        : createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "query", {
            message: "The dataset provider failed to execute the query.",
          });
    this.failRequest(captured, [diagnostic]);
  }

  private failRequest(captured: CapturedRequest, diagnostics: readonly Diagnostic[]): void {
    captured.slot.controller = null;
    captured.slot.currentToken = 0;
    const withError = diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? [...diagnostics]
      : [
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "query", {
            message: "The dataset provider failed without an error diagnostic.",
          }),
          ...diagnostics,
        ];
    const frozenDiagnostics = Object.freeze(withError);
    const now = this.clock.now();
    const next = deepFreeze({
      queryId: captured.slot.queryId,
      datasetId: captured.datasetId,
      datasetVersion: captured.plan.request.datasetVersion,
      ...(captured.sliceId === undefined ? {} : { sliceId: captured.sliceId }),
      queryKey: captured.queryKey,
      generation: captured.generation,
      phase: "error" as const,
      requestId: captured.requestId,
      requestToken: captured.requestToken,
      fields: captured.plan.outputFields,
      rows: Object.freeze([]),
      counts: emptyQueryCounts(),
      diagnostics: frozenDiagnostics,
      complete: false,
      startedAt: captured.startedAt,
      settledAt: now,
      updatedAt: now,
    });
    captured.slot.state = next;
    const first =
      frozenDiagnostics.find((diagnostic) => diagnostic.severity === "error") ??
      frozenDiagnostics[0] ??
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_FAILED, "query");
    this.emit({
      type: "query:failed",
      queryId: captured.slot.queryId,
      requestId: captured.requestId,
      queryKey: captured.queryKey,
      generation: captured.generation,
      datasetId: captured.datasetId,
      ...(captured.sliceId === undefined ? {} : { sliceId: captured.sliceId }),
      diagnostic: first,
      diagnostics: frozenDiagnostics,
    });
  }

  private isCurrent(captured: CapturedRequest): boolean {
    const slot = this.slots.get(captured.slot.queryId);
    return (
      this.isActive() &&
      slot === captured.slot &&
      slot.currentToken === captured.requestToken &&
      slot.plan.key.value === captured.queryKey &&
      slot.generation === captured.generation
    );
  }

  private reportStale(captured: CapturedRequest): void {
    const slot = this.slots.get(captured.slot.queryId);
    if (!slot || !this.isActive()) {
      return;
    }
    const reason =
      slot.generation !== captured.generation
        ? "generation"
        : slot.plan.key.value !== captured.queryKey
          ? "query-key"
          : slot.currentToken !== 0
            ? "superseded"
            : slot.state.phase === "cancelled"
              ? "cancelled"
              : slot.state.phase === "stale"
                ? "invalidated"
                : "superseded";
    this.emit({
      type: "query:stale",
      queryId: captured.slot.queryId,
      requestId: captured.requestId,
      requestToken: captured.requestToken,
      queryKey: captured.queryKey,
      generation: captured.generation,
      reason,
    });
  }

  private emit(event: QueryEventInput): void {
    if (!this.isActive()) {
      return;
    }
    this.emitEvent(event);
  }
}

export function createQueryController(options: QueryControllerOptions): QueryController {
  return new QueryControllerImpl(options);
}
