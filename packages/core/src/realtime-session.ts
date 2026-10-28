import type { QueryResultField, QueryResultRow } from "./data-contract.js";
import { DIAGNOSTIC_CODES, createDiagnostic, type Diagnostic } from "./diagnostics.js";
import type { RealtimeEventInput } from "./events.js";
import {
  DEFAULT_REALTIME_RECONNECT,
  normalizeRealtimeLimits,
  realtimeEnvelopeBytes,
  realtimeRowKey,
  validateRealtimeEnvelope,
  type RealtimeConnectionStatus,
  type RealtimeEnvelope,
  type RealtimeLimits,
  type RealtimeStatus,
  type RealtimeSubscriptionRequest,
  type RealtimeSubscriptionState,
  type RealtimeTransport,
  type RealtimeTransportListener,
  type RealtimeTransportStatus,
  type RealtimeTransportSubscription,
} from "./realtime-contract.js";
import { normalizeSuccess } from "./query-result.js";

export interface RealtimeSnapshotInput {
  readonly kind: "snapshot" | "reset";
  readonly fields: readonly QueryResultField[];
  readonly rows: readonly QueryResultRow[];
  readonly counts: {
    readonly returnedRows: number;
    readonly totalRows: number | null;
    readonly filteredRows: number;
    readonly nullCounts: Readonly<Record<string, number>>;
  };
  readonly complete: boolean;
  readonly nextCursor?: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly epoch: string;
  readonly sequence: number;
  readonly cursor?: string;
  readonly timestamp: number;
}

export interface RealtimeUpsertInput {
  readonly key: string;
  readonly row: QueryResultRow;
}

export interface RealtimeUpdateInput {
  readonly kind: "append" | "upsert" | "delete" | "heartbeat";
  readonly upserts: readonly RealtimeUpsertInput[];
  readonly deletes: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly epoch: string;
  readonly sequence: number;
  readonly cursor?: string;
  readonly timestamp: number;
}

export interface RealtimeSessionHost {
  isCurrent(): boolean;
  applySnapshot(input: RealtimeSnapshotInput): void;
  applyUpdate(input: RealtimeUpdateInput): void;
  markStale(reason: string): void;
  emit(event: RealtimeEventInput): void;
}

export interface RealtimeSessionOptions {
  readonly transport: RealtimeTransport;
  readonly queryId: string;
  readonly subscriptionId: string;
  readonly queryKey: string;
  readonly datasetId: string;
  readonly sliceId?: string;
  readonly generation: number;
  readonly keyFields: readonly string[];
  readonly expectedFields: readonly QueryResultField[];
  readonly allowGlobalAggregateRow: boolean;
  readonly cursor?: string;
  readonly limits?: Partial<RealtimeLimits>;
  readonly now?: () => number;
  readonly host: RealtimeSessionHost;
}

interface BufferedEnvelope {
  readonly envelope: RealtimeEnvelope;
  readonly bytes: number;
  readonly receivedAt: number;
}

interface PrunedMarker {
  readonly sequence: number;
  readonly epoch: string;
}

const MAX_ATTEMPTS = DEFAULT_REALTIME_RECONNECT.maxAttempts;

export class RealtimeSession {
  private readonly transport: RealtimeTransport;
  private readonly queryId: string;
  private readonly subscriptionId: string;
  private readonly queryKey: string;
  private readonly datasetId: string;
  private readonly sliceId?: string;
  private readonly generation: number;
  private readonly keyFields: readonly string[];
  private readonly expectedFields: readonly QueryResultField[];
  private readonly allowGlobalAggregateRow: boolean;
  private readonly limits: RealtimeLimits;
  private readonly now: () => number;
  private readonly host: RealtimeSessionHost;
  private handle: RealtimeTransportSubscription | null = null;
  private status: RealtimeStatus = "connecting";
  private attempt = 0;
  private maxAttempts: number = MAX_ATTEMPTS;
  private epoch: string | null = null;
  private sequence = -1;
  private cursor: string | null;
  private lastUpdate: number | null = null;
  private receivedMessages = 0;
  private appliedMessages = 0;
  private duplicateMessages = 0;
  private staleMessages = 0;
  private droppedMessages = 0;
  private baseEstablished = false;
  private needsResync = false;
  private paused = false;
  private closed = false;
  private hasConnected = false;
  private commandRevision = 0;
  private buffer: BufferedEnvelope[] = [];
  private bufferBytes = 0;
  private prunedUnresolved: PrunedMarker[] = [];
  private prunedUnresolvedOverflow = false;
  private lastDiagnostics: readonly Diagnostic[] = Object.freeze([]);

  constructor(options: RealtimeSessionOptions) {
    this.transport = options.transport;
    this.queryId = options.queryId;
    this.subscriptionId = options.subscriptionId;
    this.queryKey = options.queryKey;
    this.datasetId = options.datasetId;
    if (options.sliceId !== undefined) {
      this.sliceId = options.sliceId;
    }
    this.generation = options.generation;
    this.keyFields = Object.freeze([...options.keyFields]);
    this.expectedFields = options.expectedFields;
    this.allowGlobalAggregateRow = options.allowGlobalAggregateRow;
    this.cursor = options.cursor ?? null;
    this.limits = normalizeRealtimeLimits(options.limits);
    this.now = options.now ?? (() => Date.now());
    this.host = options.host;
  }

  start(): void {
    if (this.closed || this.handle !== null) {
      return;
    }
    this.emitStatus();
    this.openTransport();
  }

  pause(): void {
    if (this.closed || this.paused) {
      return;
    }
    this.paused = true;
    this.commandRevision += 1;
    this.status = "paused";
    this.send({ type: "pause" });
    this.host.markStale("realtime-paused");
    this.emitStatus();
  }

  resume(): void {
    if (this.closed || !this.paused) {
      return;
    }
    this.paused = false;
    this.commandRevision += 1;
    this.send({ type: "resume" });
    this.pruneBuffer(this.now());
    if (!this.isActive()) {
      return;
    }
    if (this.paused) {
      this.emitStatus();
      return;
    }
    if (this.needsResync) {
      this.beginResync("requested", "resume");
      return;
    }
    if (!this.baseEstablished) {
      this.status = "connecting";
    } else {
      this.status = "live";
    }
    this.emitStatus();
    this.drainBuffer();
  }

  resync(reason = "requested"): void {
    if (this.closed) {
      return;
    }
    this.commandRevision += 1;
    this.beginResync(reason, "resync");
  }

  close(reason = "closed"): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.commandRevision += 1;
    const handle = this.handle;
    this.handle = null;
    this.buffer = [];
    this.bufferBytes = 0;
    if (handle !== null) {
      try {
        handle.send({ type: "close" });
      } catch {
        void 0;
      }
      try {
        handle.close();
      } catch {
        void 0;
      }
    }
    this.status = "closed";
    this.host.emit({
      type: "realtime:closed",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      reason,
    });
    this.emitStatus(true);
  }

  getState(): RealtimeSubscriptionState {
    return Object.freeze({
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      keyFields: this.keyFields,
      status: this.status,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
      epoch: this.epoch,
      sequence: this.sequence,
      cursor: this.cursor,
      bufferedMessages: this.buffer.length,
      bufferedBytes: this.bufferBytes,
      droppedMessages: this.droppedMessages,
      receivedMessages: this.receivedMessages,
      appliedMessages: this.appliedMessages,
      duplicateMessages: this.duplicateMessages,
      staleMessages: this.staleMessages,
      lastUpdate: this.lastUpdate,
      simulated: this.transport.simulated,
      baseEstablished: this.baseEstablished,
      needsResync: this.needsResync,
    });
  }

  private openTransport(): void {
    const request: RealtimeSubscriptionRequest = Object.freeze({
      subscriptionId: this.subscriptionId,
      queryId: this.queryId,
      queryKey: this.queryKey,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      generation: this.generation,
      ...(this.cursor === null ? {} : { cursor: this.cursor }),
      keyFields: this.keyFields,
      limits: this.limits,
    });
    const listener: RealtimeTransportListener = Object.freeze({
      onEnvelope: (value: unknown) => this.handleEnvelope(value),
      onStatus: (status: RealtimeTransportStatus) => this.handleStatus(status),
      onError: (diagnostic: Diagnostic) => this.handleTransportError(diagnostic),
    });
    let handle: RealtimeTransportSubscription;
    try {
      handle = this.transport.subscribe(request, listener);
    } catch {
      this.status = "error";
      this.host.markStale("transport-unavailable");
      this.host.emit({
        type: "realtime:error",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        diagnostic: createDiagnostic(DIAGNOSTIC_CODES.REALTIME_TRANSPORT_UNAVAILABLE, "realtime", {
          message: "The realtime transport could not open a subscription.",
        }),
      });
      this.emitStatus();
      return;
    }
    if (this.closed) {
      try {
        handle.close();
      } catch {
        void 0;
      }
      return;
    }
    this.handle = handle;
    this.emitStatus();
  }

  private isActive(): boolean {
    return !this.closed && this.host.isCurrent();
  }

  private handleStatus(status: RealtimeTransportStatus): void {
    if (!this.isActive()) {
      return;
    }
    if (typeof status.attempt === "number" && Number.isInteger(status.attempt)) {
      this.attempt = Math.max(0, status.attempt);
    }
    if (typeof status.maxAttempts === "number" && Number.isInteger(status.maxAttempts)) {
      this.maxAttempts = Math.max(1, status.maxAttempts);
    }
    const next = mapConnectionStatus(status.status, this.baseEstablished, this.paused);
    if (status.status === "open") {
      if (this.hasConnected && this.baseEstablished) {
        this.hasConnected = true;
        if (this.paused) {
          this.needsResync = true;
          this.status = "paused";
          this.host.markStale("realtime-reconnected");
          this.emitStatus();
          return;
        }
        this.beginResync("reconnected", "reconnected");
        return;
      }
      this.hasConnected = true;
    }
    this.status = next;
    if (next === "reconnecting" || next === "degraded" || next === "error") {
      this.host.markStale(`realtime-${next}`);
    }
    if (next === "resyncing") {
      this.needsResync = true;
      this.host.markStale("realtime-resyncing");
    }
    if (status.diagnostic !== undefined && next === "error") {
      this.host.emit({
        type: "realtime:error",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        diagnostic: status.diagnostic,
      });
    }
    this.emitStatus();
  }

  private handleTransportError(diagnostic: Diagnostic): void {
    if (!this.isActive()) {
      return;
    }
    this.status = "error";
    this.host.markStale("transport-error");
    this.host.emit({
      type: "realtime:error",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      diagnostic,
    });
    this.emitStatus();
  }

  private handleEnvelope(raw: unknown): void {
    if (!this.isActive()) {
      return;
    }
    const admitted = validateRealtimeEnvelope(raw);
    if (!admitted.ok) {
      const diagnostic =
        admitted.diagnostics[0] ??
        createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ENVELOPE_INVALID, "realtime");
      this.host.emit({
        type: "realtime:error",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        diagnostic,
      });
      this.beginResync("envelope-invalid", "invalid-envelope", diagnostic);
      return;
    }
    this.receivedMessages += 1;
    const envelope = admitted.value;
    if (!this.matchesIdentity(envelope)) {
      this.staleMessages += 1;
      this.host.emit({
        type: "realtime:stale",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        reason: envelope.queryKey !== this.queryKey ? "query-key" : "generation",
        messageId: envelope.messageId,
        streamSequence: envelope.sequence,
      });
      return;
    }
    if (envelope.kind === "error") {
      const diagnostic =
        envelope.diagnostics?.find((entry) => entry.severity === "error") ??
        createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ERROR, "realtime", {
          message: "The realtime provider reported an error.",
        });
      this.status = "error";
      this.host.markStale("provider-error");
      this.host.emit({
        type: "realtime:error",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        diagnostic,
      });
      this.emitStatus();
      return;
    }
    if (this.paused) {
      this.bufferEnvelope(envelope);
      return;
    }
    if (!this.baseEstablished) {
      if (envelope.kind === "snapshot" || envelope.kind === "reset") {
        this.acceptSnapshot(envelope);
        return;
      }
      this.bufferEnvelope(envelope);
      return;
    }
    if (this.needsResync || this.status === "resyncing") {
      if (envelope.kind === "snapshot" || envelope.kind === "reset") {
        if (
          this.baseEstablished &&
          envelope.epoch === this.epoch &&
          envelope.sequence < this.sequence
        ) {
          this.duplicateMessages += 1;
          this.host.emit({
            type: "realtime:duplicate",
            queryId: this.queryId,
            subscriptionId: this.subscriptionId,
            queryKey: this.queryKey,
            generation: this.generation,
            datasetId: this.datasetId,
            ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
            reason: "older-snapshot",
            streamSequence: envelope.sequence,
          });
          return;
        }
        this.acceptSnapshot(envelope);
        return;
      }
      this.bufferEnvelope(envelope);
      return;
    }
    if (envelope.kind === "snapshot" || envelope.kind === "reset") {
      this.handleSnapshotAfterBaseline(envelope);
      return;
    }
    this.handleUpdate(envelope);
  }

  private matchesIdentity(envelope: RealtimeEnvelope): boolean {
    return (
      envelope.queryKey === this.queryKey &&
      envelope.generation === this.generation &&
      envelope.datasetId === this.datasetId &&
      envelope.sliceId === this.sliceId
    );
  }

  private handleSnapshotAfterBaseline(envelope: RealtimeEnvelope): void {
    if (this.epoch !== envelope.epoch) {
      this.beginResync("epoch-mismatch", "snapshot-epoch", this.epochDiagnostic(envelope));
      return;
    }
    if (envelope.sequence <= this.sequence) {
      this.duplicateMessages += 1;
      this.host.emit({
        type: "realtime:duplicate",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        reason: "older-snapshot",
        streamSequence: envelope.sequence,
      });
      return;
    }
    this.acceptSnapshot(envelope);
  }

  private handleUpdate(envelope: RealtimeEnvelope): void {
    if (this.epoch !== envelope.epoch) {
      this.beginResync("epoch-mismatch", "update-epoch", this.epochDiagnostic(envelope));
      return;
    }
    if (envelope.sequence <= this.sequence) {
      this.duplicateMessages += 1;
      this.host.emit({
        type: "realtime:duplicate",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        reason: envelope.sequence === this.sequence ? "duplicate" : "older",
        streamSequence: envelope.sequence,
      });
      return;
    }
    if (envelope.sequence > this.sequence + 1) {
      this.beginResync(
        "sequence-gap",
        "sequence-gap",
        createDiagnostic(DIAGNOSTIC_CODES.REALTIME_SEQUENCE_GAP, "realtime/sequence", {
          message: "A realtime sequence gap requires resynchronization.",
          relatedIds: [String(this.sequence), String(envelope.sequence)],
        }),
      );
      return;
    }
    this.acceptUpdate(envelope);
  }

  private acceptSnapshot(envelope: RealtimeEnvelope): void {
    const normalized = this.normalizeEnvelopeRows(envelope);
    if (!normalized.ok) {
      this.host.emit({
        type: "realtime:error",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        diagnostic: normalized.diagnostic,
      });
      this.beginResync("row-invalid", "invalid-rows", normalized.diagnostic);
      return;
    }
    const previousEpoch = this.epoch;
    const wasResyncing = this.needsResync;
    const commandRevisionBefore = this.commandRevision;
    this.pruneBuffer(this.now());
    if (!this.isActive()) {
      return;
    }
    const commandIssued = this.commandRevision !== commandRevisionBefore;
    if (commandIssued && this.paused) {
      this.needsResync = true;
      this.status = "paused";
      this.host.markStale("realtime-paused-before-base");
      this.emitStatus();
      return;
    }
    if (commandIssued && this.needsResync) {
      return;
    }
    const prunedOverflow = this.prunedUnresolvedOverflow;
    const prunedMarkers = this.prunedUnresolved;
    this.prunedUnresolved = [];
    this.prunedUnresolvedOverflow = false;
    const pending = this.buffer;
    this.epoch = envelope.epoch;
    this.sequence = envelope.sequence;
    this.cursor = envelope.cursor ?? this.cursor;
    this.lastUpdate = envelope.timestamp;
    this.baseEstablished = true;
    this.needsResync = false;
    this.lastDiagnostics = normalized.diagnostics;
    this.buffer = [];
    this.bufferBytes = 0;
    this.status = "live";
    this.appliedMessages += 1;
    this.host.applySnapshot({
      kind: envelope.kind === "reset" ? "reset" : "snapshot",
      fields: normalized.fields,
      rows: normalized.rows,
      counts: normalized.counts,
      complete: normalized.complete,
      ...(normalized.nextCursor === undefined ? {} : { nextCursor: normalized.nextCursor }),
      diagnostics: normalized.diagnostics,
      epoch: envelope.epoch,
      sequence: envelope.sequence,
      ...(envelope.cursor === undefined ? {} : { cursor: envelope.cursor }),
      timestamp: envelope.timestamp,
    });
    if (!this.isActive()) {
      return;
    }
    this.host.emit({
      type: "realtime:applied",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      kind: envelope.kind,
      epoch: envelope.epoch,
      streamSequence: envelope.sequence,
      ...(envelope.cursor === undefined ? {} : { cursor: envelope.cursor }),
      appliedCount: normalized.rows.length,
    });
    if (!this.isActive()) {
      return;
    }
    if (this.paused) {
      this.retainPending(pending);
      this.emitStatus();
      return;
    }
    if (this.needsResync) {
      this.retainPending(pending);
      return;
    }
    this.reconcileBuffered(pending);
    const expiredUnresolved =
      prunedOverflow ||
      prunedMarkers.some(
        (entry) => entry.epoch !== envelope.epoch || entry.sequence > envelope.sequence,
      );
    if (expiredUnresolved) {
      this.needsResync = true;
      this.status = this.paused ? "paused" : "resyncing";
      this.host.markStale("realtime-buffer-age");
      if (!this.paused) {
        this.send({ type: "resync", ...(this.cursor === null ? {} : { cursor: this.cursor }) });
      }
    }
    if (!this.isActive()) {
      return;
    }
    if (wasResyncing && !this.needsResync && !this.paused) {
      this.host.emit({
        type: "realtime:resync",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        reason: "snapshot-applied",
        fromEpoch: previousEpoch,
        toEpoch: envelope.epoch,
        streamSequence: envelope.sequence,
        diagnostic: createDiagnostic(DIAGNOSTIC_CODES.REALTIME_RESYNC_COMPLETED, "realtime", {
          severity: "warning",
          message: "Realtime resynchronization completed with an authoritative snapshot.",
        }),
      });
    }
    if (this.isActive()) {
      this.emitStatus();
    }
  }

  private retainPending(pending: readonly BufferedEnvelope[]): void {
    if (pending.length === 0) {
      return;
    }
    const bySequence = new Map<string, BufferedEnvelope>();
    const seenMessages = new Set<string>();
    for (const entry of [...pending, ...this.buffer]) {
      if (seenMessages.has(entry.envelope.messageId)) {
        continue;
      }
      seenMessages.add(entry.envelope.messageId);
      const key = `${entry.envelope.epoch}\u0000${entry.envelope.sequence}`;
      const existing = bySequence.get(key);
      if (existing === undefined || entry.receivedAt >= existing.receivedAt) {
        bySequence.set(key, entry);
      }
    }
    this.buffer = [...bySequence.values()].sort(
      (left, right) =>
        left.envelope.sequence - right.envelope.sequence || left.receivedAt - right.receivedAt,
    );
    this.bufferBytes = this.buffer.reduce((total, entry) => total + entry.bytes, 0);
    this.pruneBuffer(this.now());
    this.enforceBufferLimits();
  }

  private reconcileBuffered(pending: readonly BufferedEnvelope[]): void {
    if (pending.length === 0) {
      return;
    }
    const ordered = [...pending].sort(
      (left, right) => left.envelope.sequence - right.envelope.sequence,
    );
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index];
      if (entry === undefined || !this.isActive()) {
        return;
      }
      if (this.paused || this.needsResync) {
        this.retainPending(ordered.slice(index));
        if (this.paused) {
          this.emitStatus();
        }
        return;
      }
      const envelope = entry.envelope;
      if (!this.matchesIdentity(envelope)) {
        this.staleMessages += 1;
        this.host.emit({
          type: "realtime:stale",
          queryId: this.queryId,
          subscriptionId: this.subscriptionId,
          queryKey: this.queryKey,
          generation: this.generation,
          datasetId: this.datasetId,
          ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
          reason: envelope.queryKey !== this.queryKey ? "query-key" : "generation",
          messageId: envelope.messageId,
          streamSequence: envelope.sequence,
        });
        continue;
      }
      if (envelope.epoch !== this.epoch) {
        this.beginResync("buffered-epoch", "buffered-epoch", this.epochDiagnostic(envelope));
        return;
      }
      if (envelope.sequence <= this.sequence) {
        this.duplicateMessages += 1;
        this.host.emit({
          type: "realtime:duplicate",
          queryId: this.queryId,
          subscriptionId: this.subscriptionId,
          queryKey: this.queryKey,
          generation: this.generation,
          datasetId: this.datasetId,
          ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
          reason:
            envelope.sequence === this.sequence && envelope.kind === "snapshot"
              ? "older-snapshot"
              : envelope.sequence === this.sequence
                ? "duplicate"
                : "older",
          streamSequence: envelope.sequence,
        });
        continue;
      }
      if (envelope.sequence !== this.sequence + 1) {
        this.beginResync(
          "buffered-gap",
          "buffered-gap",
          createDiagnostic(DIAGNOSTIC_CODES.REALTIME_SEQUENCE_GAP, "realtime/sequence", {
            message: "Buffered realtime updates do not continue the accepted snapshot.",
            relatedIds: [String(this.sequence), String(envelope.sequence)],
          }),
        );
        return;
      }
      if (envelope.kind === "snapshot" || envelope.kind === "reset") {
        this.acceptSnapshot(envelope);
        continue;
      }
      if (envelope.kind === "error") {
        const diagnostic =
          envelope.diagnostics?.find((entryDiagnostic) => entryDiagnostic.severity === "error") ??
          createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ERROR, "realtime", {
            message: "The realtime provider reported an error.",
          });
        this.status = "error";
        this.host.markStale("provider-error");
        this.host.emit({
          type: "realtime:error",
          queryId: this.queryId,
          subscriptionId: this.subscriptionId,
          queryKey: this.queryKey,
          generation: this.generation,
          datasetId: this.datasetId,
          ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
          diagnostic,
        });
        return;
      }
      this.acceptUpdate(envelope);
    }
  }

  private acceptUpdate(envelope: RealtimeEnvelope): void {
    const normalized = this.normalizeEnvelopeRows(envelope);
    if (!normalized.ok) {
      this.host.emit({
        type: "realtime:error",
        queryId: this.queryId,
        subscriptionId: this.subscriptionId,
        queryKey: this.queryKey,
        generation: this.generation,
        datasetId: this.datasetId,
        ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
        diagnostic: normalized.diagnostic,
      });
      this.beginResync("row-invalid", "invalid-rows", normalized.diagnostic);
      return;
    }
    this.epoch = envelope.epoch;
    this.sequence = envelope.sequence;
    this.cursor = envelope.cursor ?? this.cursor;
    this.lastUpdate = envelope.timestamp;
    this.status = "live";
    this.appliedMessages += 1;
    const upserts: RealtimeUpsertInput[] = [];
    const deletes: string[] = [];
    if (envelope.kind === "delete") {
      deletes.push(...envelope.rowKeys);
    } else if (envelope.kind !== "heartbeat") {
      normalized.rows.forEach((row, index) => {
        const key = envelope.rowKeys[index];
        if (key !== undefined) {
          upserts.push(Object.freeze({ key, row }));
        }
      });
    }
    this.lastDiagnostics = normalized.diagnostics;
    const updateKind: "append" | "upsert" | "delete" | "heartbeat" =
      envelope.kind === "append" ||
      envelope.kind === "upsert" ||
      envelope.kind === "delete" ||
      envelope.kind === "heartbeat"
        ? envelope.kind
        : "upsert";
    this.host.applyUpdate({
      kind: updateKind,
      upserts: Object.freeze(upserts),
      deletes: Object.freeze(deletes),
      diagnostics: normalized.diagnostics,
      epoch: envelope.epoch,
      sequence: envelope.sequence,
      ...(envelope.cursor === undefined ? {} : { cursor: envelope.cursor }),
      timestamp: envelope.timestamp,
    });
    if (!this.isActive()) {
      return;
    }
    this.host.emit({
      type: "realtime:applied",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      kind: updateKind,
      epoch: envelope.epoch,
      streamSequence: envelope.sequence,
      ...(envelope.cursor === undefined ? {} : { cursor: envelope.cursor }),
      appliedCount: upserts.length + deletes.length,
    });
    this.emitStatus();
  }

  private normalizeEnvelopeRows(envelope: RealtimeEnvelope):
    | {
        readonly ok: true;
        readonly fields: readonly QueryResultField[];
        readonly rows: readonly QueryResultRow[];
        readonly counts: RealtimeSnapshotInput["counts"];
        readonly complete: boolean;
        readonly nextCursor?: string;
        readonly diagnostics: readonly Diagnostic[];
      }
    | { readonly ok: false; readonly diagnostic: Diagnostic } {
    const fields = envelope.fields ?? this.expectedFields;
    if (
      fields.length !== this.expectedFields.length ||
      fields.some((field, index) => {
        const expected = this.expectedFields[index];
        return (
          expected === undefined ||
          field.fieldId !== expected.fieldId ||
          field.type !== expected.type ||
          field.role !== expected.role
        );
      })
    ) {
      return {
        ok: false,
        diagnostic: createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ROW_INVALID, "realtime/fields", {
          message: "Realtime result fields do not match the planned query output.",
        }),
      };
    }
    if (envelope.kind === "delete" || envelope.kind === "heartbeat" || envelope.kind === "error") {
      return {
        ok: true,
        fields,
        rows: Object.freeze([]),
        counts: Object.freeze({
          returnedRows: 0,
          totalRows: null,
          filteredRows: 0,
          nullCounts: Object.freeze({}),
        }),
        complete: true,
        diagnostics: envelope.diagnostics ?? Object.freeze([]),
      };
    }
    const rows = envelope.rows ?? Object.freeze([]);
    if (rows.length !== envelope.rowKeys.length) {
      return {
        ok: false,
        diagnostic: createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ROW_INVALID, "realtime/rowKeys", {
          message: "Realtime row keys must match the number of rows.",
        }),
      };
    }
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) {
        return {
          ok: false,
          diagnostic: createDiagnostic(
            DIAGNOSTIC_CODES.REALTIME_ROW_INVALID,
            `realtime/rows/${index}`,
          ),
        };
      }
      const key = realtimeRowKey(row, this.keyFields);
      const provided = envelope.rowKeys[index];
      if (provided !== key) {
        return {
          ok: false,
          diagnostic: createDiagnostic(
            DIAGNOSTIC_CODES.REALTIME_ROW_INVALID,
            `realtime/rowKeys/${index}`,
            { message: "A realtime row key does not match the declared result key fields." },
          ),
        };
      }
      if (seen.has(key)) {
        return {
          ok: false,
          diagnostic: createDiagnostic(
            DIAGNOSTIC_CODES.REALTIME_ROW_INVALID,
            `realtime/rows/${index}`,
            {
              message: "A realtime message contains duplicate result row keys.",
            },
          ),
        };
      }
      seen.add(key);
    }
    const counts =
      envelope.counts ??
      Object.freeze({
        returnedRows: rows.length,
        totalRows: null,
        filteredRows: rows.length,
        nullCounts: Object.freeze({}),
      });
    const diagnostics: Diagnostic[] = [];
    const normalized = normalizeSuccess(
      {
        fields,
        rows,
        counts,
        complete: envelope.complete ?? true,
        diagnostics: envelope.diagnostics ?? [],
        ...(envelope.nextCursor === undefined ? {} : { nextCursor: envelope.nextCursor }),
      },
      diagnostics,
      this.expectedFields,
      this.allowGlobalAggregateRow,
    );
    if (!normalized) {
      return {
        ok: false,
        diagnostic:
          diagnostics[0] ??
          createDiagnostic(DIAGNOSTIC_CODES.REALTIME_ROW_INVALID, "realtime/rows"),
      };
    }
    return {
      ok: true,
      fields: normalized.fields,
      rows: normalized.rows,
      counts: normalized.counts,
      complete: normalized.complete,
      ...(normalized.nextCursor === undefined ? {} : { nextCursor: normalized.nextCursor }),
      diagnostics: normalized.diagnostics,
    };
  }

  private epochDiagnostic(envelope: RealtimeEnvelope): Diagnostic {
    return createDiagnostic(DIAGNOSTIC_CODES.REALTIME_EPOCH_MISMATCH, "realtime/epoch", {
      message: "A realtime epoch mismatch requires resynchronization.",
      relatedIds: [String(this.epoch), envelope.epoch],
    });
  }

  private beginResync(reason: string, eventReason: string, diagnostic?: Diagnostic): void {
    if (!this.isActive()) {
      return;
    }
    const effective =
      diagnostic ??
      createDiagnostic(DIAGNOSTIC_CODES.REALTIME_SEQUENCE_GAP, "realtime", {
        message: `Realtime resynchronization required: ${reason}.`,
      });
    this.needsResync = true;
    this.status = this.paused ? "paused" : "resyncing";
    this.buffer = [];
    this.bufferBytes = 0;
    this.prunedUnresolved = [];
    this.prunedUnresolvedOverflow = false;
    this.host.markStale(`realtime-${eventReason}`);
    this.send({
      type: "resync",
      ...(this.cursor === null ? {} : { cursor: this.cursor }),
      reason,
    });
    this.host.emit({
      type: "realtime:resync",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      reason,
      fromEpoch: this.epoch,
      toEpoch: null,
      streamSequence: this.sequence,
      diagnostic: effective,
    });
    this.emitStatus();
  }

  private bufferEnvelope(envelope: RealtimeEnvelope): void {
    const now = this.now();
    const bytes = realtimeEnvelopeBytes(envelope);
    this.pruneBuffer(now);
    if (envelope.kind === "snapshot" || envelope.kind === "reset") {
      const retained = this.buffer.filter(
        (entry) =>
          entry.envelope.epoch !== envelope.epoch || entry.envelope.sequence > envelope.sequence,
      );
      this.buffer = [Object.freeze({ envelope, bytes, receivedAt: now }), ...retained];
      this.bufferBytes = this.buffer.reduce((total, entry) => total + entry.bytes, 0);
      this.enforceBufferLimits();
      this.emitStatus();
      return;
    }
    this.buffer.push(Object.freeze({ envelope, bytes, receivedAt: now }));
    this.bufferBytes += bytes;
    this.enforceBufferLimits();
    this.emitStatus();
  }

  private pruneBuffer(now: number): readonly BufferedEnvelope[] {
    if (this.limits.maxBufferAgeMs <= 0) {
      return Object.freeze([]);
    }
    const cutoff = now - this.limits.maxBufferAgeMs;
    const dropped = this.buffer.filter((entry) => entry.receivedAt < cutoff);
    if (dropped.length === 0) {
      return Object.freeze([]);
    }
    this.buffer = this.buffer.filter((entry) => entry.receivedAt >= cutoff);
    this.bufferBytes = this.buffer.reduce((total, entry) => total + entry.bytes, 0);
    this.droppedMessages += dropped.length;
    for (const entry of dropped) {
      this.prunedUnresolved.push(
        Object.freeze({ sequence: entry.envelope.sequence, epoch: entry.envelope.epoch }),
      );
    }
    if (this.prunedUnresolved.length > this.limits.maxBufferedMessages) {
      this.prunedUnresolved = this.prunedUnresolved.slice(-this.limits.maxBufferedMessages);
      this.prunedUnresolvedOverflow = true;
    }
    this.reportBackpressure("age", dropped.length);
    if (this.baseEstablished) {
      this.needsResync = true;
      this.host.markStale("realtime-buffer-age");
    }
    return Object.freeze(dropped);
  }

  private enforceBufferLimits(): void {
    if (
      this.buffer.length <= this.limits.maxBufferedMessages &&
      this.bufferBytes <= this.limits.maxBufferedBytes
    ) {
      return;
    }
    const droppedBefore = this.droppedMessages;
    let strategy: "count" | "bytes" | "coalesce" | "drop-oldest" =
      this.buffer.length > this.limits.maxBufferedMessages ? "count" : "bytes";
    const coalesced = this.coalesceBuffer();
    if (coalesced) {
      strategy = "coalesce";
    }
    while (
      this.buffer.length > 0 &&
      (this.buffer.length > this.limits.maxBufferedMessages ||
        this.bufferBytes > this.limits.maxBufferedBytes)
    ) {
      const dropped = this.buffer.shift();
      if (dropped !== undefined) {
        this.bufferBytes -= dropped.bytes;
        this.droppedMessages += 1;
      }
      strategy = "drop-oldest";
    }
    this.reportBackpressure(strategy, this.droppedMessages - droppedBefore);
    this.needsResync = true;
    this.status = this.paused ? "paused" : "resyncing";
    this.host.markStale("realtime-backpressure");
    this.buffer = [];
    this.bufferBytes = 0;
    if (!this.paused) {
      this.send({ type: "resync", ...(this.cursor === null ? {} : { cursor: this.cursor }) });
    }
    this.emitStatus();
  }

  private coalesceBuffer(): boolean {
    const latestByKey = new Map<string, number>();
    let coalesced = false;
    const next: BufferedEnvelope[] = [];
    for (let index = this.buffer.length - 1; index >= 0; index -= 1) {
      const entry = this.buffer[index];
      if (entry === undefined) {
        continue;
      }
      const keyKey =
        entry.envelope.kind === "append" || entry.envelope.kind === "upsert"
          ? entry.envelope.rowKeys.join("\u0000")
          : null;
      if (keyKey !== null && entry.envelope.rowKeys.length === 1) {
        if (latestByKey.has(keyKey)) {
          this.droppedMessages += 1;
          coalesced = true;
          continue;
        }
        latestByKey.set(keyKey, index);
      }
      next.unshift(entry);
    }
    if (coalesced) {
      this.buffer = next;
      this.bufferBytes = next.reduce((total, entry) => total + entry.bytes, 0);
    }
    return coalesced;
  }

  private reportBackpressure(
    strategy: "count" | "bytes" | "age" | "coalesce" | "drop-oldest",
    dropped: number,
  ): void {
    this.host.emit({
      type: "realtime:backpressure",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      bufferedMessages: this.buffer.length,
      bufferedBytes: this.bufferBytes,
      dropped,
      strategy,
    });
  }

  private drainBuffer(): void {
    if (this.buffer.length === 0) {
      if (!this.baseEstablished) {
        this.status = "connecting";
        this.emitStatus();
      }
      return;
    }
    const pending = [...this.buffer].sort((left, right) => {
      return left.envelope.sequence - right.envelope.sequence;
    });
    this.buffer = [];
    this.bufferBytes = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      if (entry === undefined || !this.isActive()) {
        return;
      }
      if (this.paused || this.needsResync) {
        this.retainPending(pending.slice(index));
        if (this.paused) {
          this.emitStatus();
        }
        return;
      }
      const envelope = entry.envelope;
      if (!this.matchesIdentity(envelope)) {
        this.staleMessages += 1;
        this.host.emit({
          type: "realtime:stale",
          queryId: this.queryId,
          subscriptionId: this.subscriptionId,
          queryKey: this.queryKey,
          generation: this.generation,
          datasetId: this.datasetId,
          ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
          reason: envelope.queryKey !== this.queryKey ? "query-key" : "generation",
          messageId: envelope.messageId,
          streamSequence: envelope.sequence,
        });
        continue;
      }
      if (!this.baseEstablished) {
        if (envelope.kind === "snapshot" || envelope.kind === "reset") {
          this.acceptSnapshot(envelope);
          continue;
        }
        this.beginResync("pre-snapshot-buffer", "pre-snapshot-buffer");
        return;
      }
      if (envelope.epoch !== this.epoch) {
        this.beginResync("epoch-mismatch", "buffered-epoch", this.epochDiagnostic(envelope));
        return;
      }
      if (envelope.sequence <= this.sequence) {
        this.duplicateMessages += 1;
        this.host.emit({
          type: "realtime:duplicate",
          queryId: this.queryId,
          subscriptionId: this.subscriptionId,
          queryKey: this.queryKey,
          generation: this.generation,
          datasetId: this.datasetId,
          ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
          reason:
            envelope.sequence === this.sequence
              ? envelope.kind === "snapshot"
                ? "older-snapshot"
                : "duplicate"
              : "older",
          streamSequence: envelope.sequence,
        });
        continue;
      }
      if (envelope.sequence !== this.sequence + 1) {
        this.beginResync("resume-gap", "resume-gap");
        return;
      }
      if (envelope.kind === "snapshot" || envelope.kind === "reset") {
        this.acceptSnapshot(envelope);
      } else if (envelope.kind === "error") {
        this.handleEnvelope(envelope);
      } else {
        this.acceptUpdate(envelope);
      }
    }
    if (this.isActive() && !this.needsResync && this.baseEstablished && !this.paused) {
      this.status = "live";
      this.emitStatus();
    }
  }

  private send(command: Parameters<RealtimeTransportSubscription["send"]>[0]): void {
    if (this.handle === null || this.closed) {
      return;
    }
    try {
      this.handle.send(command);
    } catch {
      this.status = "error";
      this.host.markStale("transport-send-failed");
      this.emitStatus();
    }
  }

  private emitStatus(allowClosed = false): void {
    if (!allowClosed && (!this.isActive() || this.closed)) {
      return;
    }
    if (this.closed && this.status !== "closed") {
      return;
    }
    this.host.emit({
      type: "realtime:status",
      queryId: this.queryId,
      subscriptionId: this.subscriptionId,
      queryKey: this.queryKey,
      generation: this.generation,
      datasetId: this.datasetId,
      ...(this.sliceId === undefined ? {} : { sliceId: this.sliceId }),
      status: this.status,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
      simulated: this.transport.simulated,
      bufferedMessages: this.buffer.length,
      bufferedBytes: this.bufferBytes,
    });
  }

  get diagnosticSnapshot(): readonly Diagnostic[] {
    return this.lastDiagnostics;
  }
}

function mapConnectionStatus(
  status: RealtimeConnectionStatus,
  baseEstablished: boolean,
  paused: boolean,
): RealtimeStatus {
  switch (status) {
    case "open":
      if (paused) {
        return "paused";
      }
      return baseEstablished ? "live" : "connecting";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "resyncing":
      return "resyncing";
    case "degraded":
      return "degraded";
    case "closed":
      return "closed";
    case "error":
      return "error";
  }
}
