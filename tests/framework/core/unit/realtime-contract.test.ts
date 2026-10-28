import { describe, expect, it } from "vitest";
import {
  BoardloomError,
  DEFAULT_REALTIME_LIMITS,
  canonicalJson,
  createSimulatedRealtimeTransport,
  createWebSocketRealtimeTransport,
  normalizeRealtimeLimits,
  realtimeRowKey,
  validateRealtimeEnvelope,
  type RealtimeTransportListener,
  type RealtimeSubscriptionRequest,
} from "../../../../packages/core/src/index.js";

function baseEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: "message-1",
    datasetId: "assessment-results",
    sliceId: "all-results",
    queryKey: "BQK1:{}",
    generation: 1,
    epoch: "epoch-1",
    sequence: 3,
    cursor: "cursor-3",
    kind: "upsert",
    rowKeys: [canonicalJson(["north"] as never)],
    rows: [{ school_id: "north", score: 4 }],
    timestamp: 1_700_000_000_003,
    ...overrides,
  };
}

describe("realtime envelope contract", () => {
  it("admits a complete query-shaped envelope with mandatory identity", () => {
    const result = validateRealtimeEnvelope(baseEnvelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.datasetId).toBe("assessment-results");
      expect(result.value.generation).toBe(1);
      expect(result.value.epoch).toBe("epoch-1");
      expect(result.value.sequence).toBe(3);
      expect(result.value.rowKeys).toEqual([canonicalJson(["north"] as never)]);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it.each([
    ["messageId", { messageId: "" }],
    ["datasetId", { datasetId: undefined }],
    ["queryKey", { queryKey: "not-a-canonical-key" }],
    ["generation", { generation: 0 }],
    ["epoch", { epoch: "" }],
    ["sequence", { sequence: -1 }],
    ["kind", { kind: "patch" }],
    ["rowKeys", { rowKeys: ["a", "a"] }],
    ["timestamp", { timestamp: Number.NaN }],
  ])("rejects a missing or malformed %s", (_name, override) => {
    const result = validateRealtimeEnvelope(baseEnvelope(override));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("REALTIME_ENVELOPE_INVALID");
    }
  });

  it("rejects unknown properties and malformed row payloads", () => {
    const unknown = validateRealtimeEnvelope(baseEnvelope({ secretPayload: "hidden" }));
    expect(unknown.ok).toBe(false);

    const rows = validateRealtimeEnvelope(
      baseEnvelope({ rows: [{ school_id: "north", nested: undefined }], rowKeys: ["a"] }),
    );
    expect(rows.ok).toBe(false);

    const deleteRows = validateRealtimeEnvelope(
      baseEnvelope({ kind: "delete", rowKeys: ["a"], rows: [{ school_id: "north" }] }),
    );
    expect(deleteRows.ok).toBe(false);
  });

  it("computes declared result keys and byte sizes deterministically", () => {
    expect(realtimeRowKey({ school_id: "north", score: 4 }, ["school_id"])).toBe(
      canonicalJson(["north"] as never),
    );
    expect(realtimeRowKey({ school_id: "north" }, [])).toBe(canonicalJson([] as never));
    expect(realtimeRowKey({ score: 1 }, ["missing"])).toBe(canonicalJson([null] as never));
    const admitted = validateRealtimeEnvelope(baseEnvelope());
    expect(admitted.ok).toBe(true);
  });

  it("normalizes bounded buffer limits and exposes v0.1 defaults", () => {
    expect(normalizeRealtimeLimits()).toEqual(DEFAULT_REALTIME_LIMITS);
    expect(
      normalizeRealtimeLimits({
        maxBufferedMessages: 2.9,
        maxBufferedBytes: 10,
        maxBufferAgeMs: 0,
      }),
    ).toEqual({ maxBufferedMessages: 2, maxBufferedBytes: 10, maxBufferAgeMs: 0 });
    expect(normalizeRealtimeLimits({ maxBufferedMessages: -1 }).maxBufferedMessages).toBe(
      DEFAULT_REALTIME_LIMITS.maxBufferedMessages,
    );
  });

  it("validates WebSocket transport inputs without echoing the endpoint", () => {
    let message = "";
    try {
      createWebSocketRealtimeTransport({ url: "  " });
    } catch (error) {
      message = error instanceof BoardloomError ? error.diagnostic.message : String(error);
    }
    expect(message).toContain("non-empty");
    expect(message).not.toContain("ws://");
    const transport = createWebSocketRealtimeTransport({ url: "ws://127.0.0.1:1/realtime" });
    expect(transport.simulated).toBe(false);
  });
});

describe("simulated realtime transport", () => {
  it("labels itself simulated and delivers only matching subscriptions", () => {
    const transport = createSimulatedRealtimeTransport();
    expect(transport.simulated).toBe(true);
    const seen: unknown[] = [];
    const listener: RealtimeTransportListener = {
      onEnvelope: (value) => seen.push(value),
      onStatus: () => undefined,
      onError: () => undefined,
    };
    const request: RealtimeSubscriptionRequest = {
      subscriptionId: "sub-1",
      queryId: "query-1",
      queryKey: "BQK1:{}",
      datasetId: "assessment-results",
      sliceId: "all-results",
      generation: 1,
      keyFields: ["school_id"],
      limits: DEFAULT_REALTIME_LIMITS,
    };
    const handle = transport.subscribe(request, listener);
    expect(transport.subscriptionCount()).toBe(1);
    expect(transport.publish(baseEnvelope())).toBe(1);
    expect(transport.publish(baseEnvelope({ generation: 2 }))).toBe(0);
    expect(seen).toHaveLength(1);
    handle.close();
    expect(transport.subscriptionCount()).toBe(0);
  });
});

interface FakeSocketEvent {
  readonly data?: unknown;
}

class FakeSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: FakeSocketEvent) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.emit("close", {});
  }

  addEventListener(type: string, listener: (event: FakeSocketEvent) => void): void {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: FakeSocketEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  private emit(type: string, event: FakeSocketEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

describe("WebSocket adapter reconnect policy", () => {
  it("uses bounded exponential backoff, degrades after the maximum and reconnects on resync", () => {
    const sockets: FakeSocket[] = [];
    const delays: number[] = [];
    const timers: Array<() => void> = [];
    const statuses: Array<{ status: string; attempt?: number; maxAttempts?: number }> = [];
    const errors: string[] = [];
    const transport = createWebSocketRealtimeTransport({
      url: "ws://127.0.0.1:9/realtime",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnect: {
        initialDelayMs: 100,
        factor: 2,
        maxDelayMs: 1_000,
        maxAttempts: 2,
        jitter: 0,
      } as never,
      random: () => 0.5,
      timerHost: {
        setTimeout: (callback, delayMs) => {
          delays.push(delayMs);
          timers.push(callback);
          return callback;
        },
        clearTimeout: () => undefined,
      },
    });
    const listener: RealtimeTransportListener = {
      onEnvelope: () => undefined,
      onStatus: (status) => statuses.push(status),
      onError: (diagnostic) => errors.push(diagnostic.message),
    };
    const request: RealtimeSubscriptionRequest = {
      subscriptionId: "sub-socket",
      queryId: "query-socket",
      queryKey: "BQK1:{}",
      datasetId: "assessment-results",
      generation: 1,
      keyFields: [],
      limits: DEFAULT_REALTIME_LIMITS,
    };
    const handle = transport.subscribe(request, listener);
    expect(sockets).toHaveLength(1);
    sockets[0]?.open();
    expect(statuses.at(-1)?.status).toBe("open");
    expect(sockets[0]?.sent[0]).toContain('"subscribe"');
    sockets[0]?.close();
    expect(statuses.at(-1)).toMatchObject({ status: "reconnecting", attempt: 1, maxAttempts: 2 });
    expect(delays).toEqual([100]);
    timers.shift()?.();
    expect(sockets).toHaveLength(2);
    sockets[1]?.close();
    expect(statuses.at(-1)).toMatchObject({ status: "reconnecting", attempt: 2 });
    expect(delays).toEqual([100, 200]);
    timers.shift()?.();
    expect(sockets).toHaveLength(3);
    sockets[2]?.close();
    expect(statuses.at(-1)?.status).toBe("degraded");
    handle.send({ type: "resync", cursor: "cursor-1" });
    expect(sockets.length).toBe(4);
    sockets[3]?.open();
    const frames = sockets[3]?.sent ?? [];
    expect(frames[0]).toContain('"subscribe"');
    expect(frames[1]).toContain('"resync"');
    handle.send({ type: "close" });
    expect(statuses.at(-1)?.status).toBe("closed");
    expect(errors).toEqual([]);
  });
});
