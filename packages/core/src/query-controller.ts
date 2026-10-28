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
import type { QueryEventInput } from "./events.js";
import type { IdFactory } from "./ids.js";
import { deepFreeze } from "./json.js";
import { own } from "./board-validation-shared.js";
import { createQueryAbortHandle } from "./query-abort.js";
import { admitQuerySpec, buildQueryPlan, type QueryPlan } from "./query-planning.js";
import { admitProviderResult, normalizeDiagnostics, normalizeSuccess } from "./query-result.js";

export interface QueryControllerOptions {
  readonly provider?: DatasetProvider;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly emit: (event: QueryEventInput) => void;
  readonly isActive?: () => boolean;
}

export interface QueryController {
  readonly pendingCount: number;
  setQuery(queryId: string, spec: QuerySpec): Result<QueryState>;
  refreshQuery(queryId: string): Result<QueryState>;
  invalidateQuery(queryId: string, reason?: string): Result<QueryState>;
  cancelQuery(queryId: string, reason?: string): Result<QueryState>;
  removeQuery(queryId: string): Result<void>;
  getQueryState(queryId: string): QueryState | undefined;
  listQueryStates(): readonly QueryState[];
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

class QueryControllerImpl implements QueryController {
  private readonly provider?: DatasetProvider;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly emitEvent: (event: QueryEventInput) => void;
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

  setQuery(queryId: string, spec: QuerySpec): Result<QueryState> {
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
    const existing = this.slots.get(queryId);
    let generation = 1;
    let invalidated = false;
    if (existing) {
      generation = existing.plan.key.value === key ? existing.generation : existing.generation + 1;
      invalidated = existing.plan.key.value !== key;
      const slotKeyBefore = existing.plan.key.value;
      const slotGenerationBefore = existing.generation;
      const wasInFlight = existing.currentToken !== 0;
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
    return ok(this.startRequest(slot));
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
    slot.generation += 1;
    const now = this.clock.now();
    const next = deepFreeze({
      ...previous,
      generation: slot.generation,
      phase: "stale" as const,
      complete: previous.complete,
      staleReason: reason,
      updatedAt: now,
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
