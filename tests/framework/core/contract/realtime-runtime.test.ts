import { describe, expect, it } from "vitest";
import {
  DEFAULT_REALTIME_LIMITS,
  canonicalJson,
  createLocalDatasetProvider,
  createSimulatedRealtimeTransport,
  createRuntime,
  type DatasetDescriptor,
  type RealtimeEnvelope,
  type RealtimeSubscriptionRequest,
  type RealtimeTransport,
  type RealtimeTransportListener,
  type RealtimeTransportSubscription,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import {
  ASSESSMENT_DESCRIPTOR,
  ASSESSMENT_ROWS,
  cloneAssessmentDescriptor,
} from "../fixtures/assessment-fixture.js";
import { unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

const LIVE_SPEC = Object.freeze({
  datasetId: "assessment-results",
  sliceId: "all-results",
  groupBy: Object.freeze([{ fieldId: "school_id" }]),
  aggregations: Object.freeze([{ output: "score", type: "average" as const, fieldId: "score" }]),
});

function realtimeDescriptor(): DatasetDescriptor {
  return cloneAssessmentDescriptor({
    capabilities: Object.freeze({
      ...ASSESSMENT_DESCRIPTOR.capabilities,
      realtime: true,
    }),
  });
}

function createHarness() {
  const clock = new FakeClock();
  const logger = createRecordingLogger();
  const transport = createSimulatedRealtimeTransport({ transportId: "contract-simulation" });
  const provider = unwrap(
    createLocalDatasetProvider({
      providerId: "realtime-fixture",
      datasets: [{ descriptor: realtimeDescriptor(), rows: ASSESSMENT_ROWS }],
    }),
  );
  const runtime = createRuntime({
    clock,
    logger,
    idFactory: createDeterministicIdFactory("realtime"),
    datasetProvider: provider,
    realtime: transport,
  });
  const space = unwrap(
    runtime.createSpace({ id: "realtime-space", document: makeDocument("Realtime") }),
  );
  const events: SpaceEvent[] = [];
  space.subscribe((event) => events.push(event));
  return { runtime, space, transport, events, clock, logger };
}

function queryKey(space: ReturnType<typeof createHarness>["space"], queryId: string): string {
  const state = space.getQueryState(queryId);
  if (state === undefined) {
    throw new Error("missing query state");
  }
  return state.queryKey;
}

function fieldsFor() {
  return Object.freeze([
    {
      fieldId: "school_id",
      type: "string" as const,
      role: "dimension" as const,
    },
    {
      fieldId: "score",
      type: "number" as const,
      role: "measure" as const,
      unit: { unit: "points" },
    },
  ]);
}

function rowKey(schoolId: string): string {
  return canonicalJson([schoolId] as never);
}

function snapshotEnvelope(
  space: ReturnType<typeof createHarness>["space"],
  queryId: string,
  overrides: Partial<RealtimeEnvelope> = {},
): RealtimeEnvelope {
  const state = space.getQueryState(queryId);
  if (state === undefined) {
    throw new Error("missing query state");
  }
  return Object.freeze({
    messageId: `snapshot-${state.generation}`,
    datasetId: "assessment-results",
    sliceId: "all-results",
    queryKey: state.queryKey,
    generation: state.generation,
    epoch: "epoch-2026-1",
    sequence: 0,
    cursor: "cursor-0",
    kind: "snapshot",
    rowKeys: Object.freeze([rowKey("north"), rowKey("south")]),
    rows: Object.freeze([
      Object.freeze({ school_id: "north", score: 5 }),
      Object.freeze({ school_id: "south", score: 4 }),
    ]),
    fields: fieldsFor(),
    counts: Object.freeze({
      returnedRows: 2,
      totalRows: null,
      filteredRows: 2,
      nullCounts: Object.freeze({}),
    }),
    complete: true,
    timestamp: 1_700_000_000_000,
    ...overrides,
  }) as RealtimeEnvelope;
}

function updateEnvelope(
  space: ReturnType<typeof createHarness>["space"],
  queryId: string,
  sequence: number,
  rows: ReadonlyArray<{ readonly school_id: string; readonly score: number }>,
  overrides: Partial<RealtimeEnvelope> = {},
): RealtimeEnvelope {
  const state = space.getQueryState(queryId);
  if (state === undefined) {
    throw new Error("missing query state");
  }
  return Object.freeze({
    messageId: `update-${sequence}`,
    datasetId: "assessment-results",
    sliceId: "all-results",
    queryKey: state.queryKey,
    generation: state.generation,
    epoch: "epoch-2026-1",
    sequence,
    cursor: `cursor-${sequence}`,
    kind: "upsert",
    rowKeys: Object.freeze(rows.map((row) => rowKey(row.school_id))),
    rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
    timestamp: 1_700_000_000_000 + sequence,
    ...overrides,
  }) as RealtimeEnvelope;
}

function deleteEnvelope(
  space: ReturnType<typeof createHarness>["space"],
  queryId: string,
  sequence: number,
  keys: readonly string[],
  overrides: Partial<RealtimeEnvelope> = {},
): RealtimeEnvelope {
  const state = space.getQueryState(queryId);
  if (state === undefined) {
    throw new Error("missing query state");
  }
  return Object.freeze({
    messageId: `delete-${sequence}`,
    datasetId: "assessment-results",
    sliceId: "all-results",
    queryKey: state.queryKey,
    generation: state.generation,
    epoch: "epoch-2026-1",
    sequence,
    cursor: `cursor-${sequence}`,
    kind: "delete",
    rowKeys: Object.freeze([...keys]),
    timestamp: 1_700_000_000_000 + sequence,
    ...overrides,
  }) as RealtimeEnvelope;
}

describe("realtime query orchestration", () => {
  it("completes the snapshot handshake and marks realtime state live", () => {
    const { space, transport, events } = createHarness();
    const created = unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    expect(created.phase).toBe("loading");
    const realtime = space.getRealtimeState("schools");
    expect(realtime?.status).toBe("connecting");
    expect(transport.publish(snapshotEnvelope(space, "schools"))).toBe(1);
    const state = space.getQueryState("schools");
    expect(state?.phase).toBe("settled");
    expect(state?.source).toBe("realtime");
    expect(state?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getRealtimeState("schools")?.sequence).toBe(0);
    expect(
      events.some((event) => event.type === "realtime:applied" && event.kind === "snapshot"),
    ).toBe(true);
  });

  it("applies ordered updates and ignores duplicates and older messages", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }]));
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 6 },
      { school_id: "south", score: 4 },
    ]);
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 7 }]));
    transport.publish(updateEnvelope(space, "schools", 0, [{ school_id: "north", score: 8 }]));
    expect(space.getQueryState("schools")?.rows[0]).toEqual({ school_id: "north", score: 6 });
    const duplicates = events.filter((event) => event.type === "realtime:duplicate");
    expect(duplicates).toHaveLength(2);
  });

  it("resyncs after a sequence gap and keeps the previous rows stale", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 3, [{ school_id: "north", score: 9 }]));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getQueryState("schools")?.phase).toBe("stale");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    const requested = events.find(
      (event) => event.type === "realtime:resync" && event.reason === "sequence-gap",
    );
    expect(requested).toBeDefined();
    if (requested !== undefined && requested.type === "realtime:resync") {
      expect(requested.fromEpoch).toBe("epoch-2026-1");
      expect(requested.toEpoch).toBeNull();
    }
    transport.publish(
      snapshotEnvelope(space, "schools", {
        sequence: 3,
        messageId: "resync-snapshot",
        rows: [{ school_id: "north", score: 9 }],
        rowKeys: [rowKey("north")],
        counts: {
          returnedRows: 1,
          totalRows: null,
          filteredRows: 1,
          nullCounts: {},
        },
      }),
    );
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.phase).toBe("settled");
    expect(space.getQueryState("schools")?.rows).toEqual([{ school_id: "north", score: 9 }]);
    const completed = events.find(
      (event) => event.type === "realtime:resync" && event.reason === "snapshot-applied",
    );
    expect(completed).toBeDefined();
    if (completed !== undefined && completed.type === "realtime:resync") {
      expect(completed.toEpoch).toBe("epoch-2026-1");
    }
  });

  it("never lets an older snapshot overwrite newer stream data", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    transport.publish(
      snapshotEnvelope(space, "schools", {
        sequence: 2,
        messageId: "older-snapshot",
        rows: [{ school_id: "north", score: 1 }],
        rowKeys: [rowKey("north")],
      }),
    );
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(space.getRealtimeState("schools")?.sequence).toBe(5);
  });

  it("treats a new epoch as incomparable, resyncs and replaces atomically", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools", { epoch: "epoch-1" }));
    transport.publish(
      updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }], {
        epoch: "epoch-2",
      }),
    );
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getQueryState("schools")?.rows[0]).toEqual({ school_id: "north", score: 5 });
    transport.publish(
      snapshotEnvelope(space, "schools", {
        epoch: "epoch-2",
        sequence: 0,
        rows: [{ school_id: "north", score: 2 }],
        rowKeys: [rowKey("north")],
        counts: { returnedRows: 1, totalRows: null, filteredRows: 1, nullCounts: {} },
      }),
    );
    expect(space.getRealtimeState("schools")?.epoch).toBe("epoch-2");
    expect(space.getQueryState("schools")?.rows).toEqual([{ school_id: "north", score: 2 }]);
    transport.publish(
      updateEnvelope(space, "schools", 2, [{ school_id: "north", score: 3 }], {
        epoch: "epoch-1",
      }),
    );
    expect(space.getQueryState("schools")?.rows).toEqual([{ school_id: "north", score: 2 }]);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
  });

  it("replaces the subscription when filters change the canonical query", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    const previousKey = queryKey(space, "schools");
    const previousGeneration = space.getRealtimeState("schools")?.generation;
    unwrap(
      space.setQuery(
        "schools",
        {
          ...LIVE_SPEC,
          filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
        },
        { live: true },
      ),
    );
    expect(space.getRealtimeState("schools")?.generation).toBe((previousGeneration ?? 0) + 1);
    expect(queryKey(space, "schools")).not.toBe(previousKey);
    expect(transport.subscriptionCount()).toBe(1);
    expect(events.some((event) => event.type === "query:invalidated")).toBe(true);
    const stale = snapshotEnvelope(space, "schools", {
      queryKey: previousKey,
      generation: previousGeneration ?? 1,
      messageId: "old-generation-snapshot",
    });
    expect(transport.publish(stale)).toBe(0);
    transport.publish(
      snapshotEnvelope(space, "schools", {
        rows: [{ school_id: "north", score: 7 }],
        rowKeys: [rowKey("north")],
        counts: { returnedRows: 1, totalRows: null, filteredRows: 1, nullCounts: {} },
      }),
    );
    expect(space.getQueryState("schools")?.rows).toEqual([{ school_id: "north", score: 7 }]);
  });

  it("buffers while paused and applies contiguous updates on resume", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getQueryState("schools")?.phase).toBe("stale");
    transport.publish(updateEnvelope(space, "schools", 2, [{ school_id: "south", score: 5 }]));
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }]));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(2);
    expect(space.getQueryState("schools")?.rows[0]).toEqual({ school_id: "north", score: 5 });
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(0);
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 6 },
      { school_id: "south", score: 5 },
    ]);
    expect(events.some((event) => event.type === "realtime:status")).toBe(true);
  });

  it("bounds the paused buffer, reports backpressure and resyncs", () => {
    const { space, transport, events } = createHarness();
    unwrap(
      space.setQuery("schools", LIVE_SPEC, {
        live: true,
        limits: {
          maxBufferedMessages: 2,
          maxBufferedBytes: DEFAULT_REALTIME_LIMITS.maxBufferedBytes,
          maxBufferAgeMs: 5_000,
        },
      }),
    );
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }]));
    transport.publish(updateEnvelope(space, "schools", 2, [{ school_id: "south", score: 5 }]));
    transport.publish(updateEnvelope(space, "schools", 3, [{ school_id: "north", score: 7 }]));
    const realtime = space.getRealtimeState("schools");
    expect(realtime?.bufferedMessages).toBe(0);
    expect(realtime?.needsResync).toBe(true);
    expect(realtime?.droppedMessages).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "realtime:backpressure")).toBe(true);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    transport.publish(
      snapshotEnvelope(space, "schools", {
        sequence: 3,
        rows: [{ school_id: "north", score: 7 }],
        rowKeys: [rowKey("north")],
        counts: { returnedRows: 1, totalRows: null, filteredRows: 1, nullCounts: {} },
      }),
    );
    expect(space.getQueryState("schools")?.rows).toEqual([{ school_id: "north", score: 7 }]);
  });

  it("reports byte-size and age backpressure and coalesces repeated row keys", () => {
    const byteHarness = createHarness();
    unwrap(
      byteHarness.space.setQuery("schools", LIVE_SPEC, {
        live: true,
        limits: { maxBufferedMessages: 100, maxBufferedBytes: 40, maxBufferAgeMs: 5_000 },
      }),
    );
    byteHarness.transport.publish(snapshotEnvelope(byteHarness.space, "schools"));
    unwrap(byteHarness.space.pauseRealtime("schools"));
    byteHarness.transport.publish(
      updateEnvelope(byteHarness.space, "schools", 1, [{ school_id: "north", score: 6 }]),
    );
    expect(byteHarness.space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(
      byteHarness.events.some(
        (event) => event.type === "realtime:backpressure" && event.strategy === "drop-oldest",
      ),
    ).toBe(true);
    byteHarness.runtime.dispose();

    const ageHarness = createHarness();
    unwrap(ageHarness.space.setQuery("schools", LIVE_SPEC, { live: true }));
    ageHarness.transport.publish(snapshotEnvelope(ageHarness.space, "schools"));
    unwrap(ageHarness.space.pauseRealtime("schools"));
    ageHarness.transport.publish(
      updateEnvelope(ageHarness.space, "schools", 1, [{ school_id: "north", score: 6 }]),
    );
    ageHarness.clock.advance(6_000);
    ageHarness.transport.publish(
      updateEnvelope(ageHarness.space, "schools", 2, [{ school_id: "south", score: 5 }]),
    );
    expect(
      ageHarness.events.some(
        (event) => event.type === "realtime:backpressure" && event.strategy === "age",
      ),
    ).toBe(true);
    expect(ageHarness.space.getRealtimeState("schools")?.droppedMessages).toBeGreaterThan(0);
    ageHarness.runtime.dispose();

    const coalesceHarness = createHarness();
    unwrap(
      coalesceHarness.space.setQuery("schools", LIVE_SPEC, {
        live: true,
        limits: { maxBufferedMessages: 2, maxBufferedBytes: 1_000_000, maxBufferAgeMs: 5_000 },
      }),
    );
    coalesceHarness.transport.publish(snapshotEnvelope(coalesceHarness.space, "schools"));
    unwrap(coalesceHarness.space.pauseRealtime("schools"));
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      coalesceHarness.transport.publish(
        updateEnvelope(coalesceHarness.space, "schools", sequence, [
          { school_id: "north", score: 5 + sequence },
        ]),
      );
    }
    expect(
      coalesceHarness.events.some(
        (event) => event.type === "realtime:backpressure" && event.strategy === "coalesce",
      ),
    ).toBe(true);
    coalesceHarness.runtime.dispose();
  });

  it("keeps paused memory bounded under a long update burst", () => {
    const { space, transport } = createHarness();
    unwrap(
      space.setQuery("schools", LIVE_SPEC, {
        live: true,
        limits: { maxBufferedMessages: 5, maxBufferedBytes: 1_000_000, maxBufferAgeMs: 5_000 },
      }),
    );
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      transport.publish(
        updateEnvelope(space, "schools", sequence, [
          { school_id: sequence % 2 === 0 ? "north" : "south", score: sequence },
        ]),
      );
    }
    const state = space.getRealtimeState("schools");
    expect(state?.bufferedMessages).toBeLessThanOrEqual(5);
    expect(state?.bufferedBytes).toBeLessThanOrEqual(1_000_000);
    expect(state?.droppedMessages).toBeGreaterThan(0);
    expect(transport.subscriptionCount()).toBe(1);
  });

  it("reconciles pre-snapshot updates after the authoritative snapshot", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(0);
    expect(space.getRealtimeState("schools")?.sequence).toBe(6);
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 42 },
      { school_id: "south", score: 4 },
    ]);
    const applied = events.filter((event) => event.type === "realtime:applied");
    expect(applied.map((event) => [event.kind, event.appliedCount])).toEqual([
      ["snapshot", 2],
      ["upsert", 1],
    ]);
  });

  it("keeps newer paused updates when a snapshot is buffered", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(2);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.sequence).toBe(6);
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 42 },
      { school_id: "south", score: 4 },
    ]);
  });

  it("does not discard a non-contiguous pre-snapshot update silently", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(updateEnvelope(space, "schools", 8, [{ school_id: "north", score: 42 }]));
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getQueryState("schools")?.phase).toBe("stale");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(events.some((event) => event.type === "realtime:resync")).toBe(true);
  });

  it("rejects a lower same-epoch snapshot during resync", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    transport.publish(updateEnvelope(space, "schools", 8, [{ school_id: "north", score: 9 }]));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    transport.publish(
      snapshotEnvelope(space, "schools", {
        sequence: 2,
        messageId: "stale-resync-snapshot",
        rows: [{ school_id: "north", score: 1 }],
        rowKeys: [rowKey("north")],
      }),
    );
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.sequence).toBe(5);
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(
      events.some(
        (event) => event.type === "realtime:duplicate" && event.reason === "older-snapshot",
      ),
    ).toBe(true);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 8 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getRealtimeState("schools")?.sequence).toBe(8);
  });

  it("cannot report live after a reconnect while recovery is required", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    transport.disconnect();
    expect(space.getRealtimeState("schools")?.status).toBe("reconnecting");
    transport.reconnect();
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("requires recovery after a reconnect while paused", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    transport.disconnect();
    transport.reconnect();
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 1 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("bounds a paused snapshot by byte size and recovers on resume", () => {
    const { space, transport, events } = createHarness();
    unwrap(
      space.setQuery("schools", LIVE_SPEC, {
        live: true,
        limits: { maxBufferedMessages: 100, maxBufferedBytes: 50, maxBufferAgeMs: 5_000 },
      }),
    );
    unwrap(space.pauseRealtime("schools"));
    transport.publish(snapshotEnvelope(space, "schools"));
    const state = space.getRealtimeState("schools");
    expect(state?.bufferedMessages).toBe(0);
    expect(state?.needsResync).toBe(true);
    expect(state?.status).toBe("paused");
    expect(
      events.some(
        (event) =>
          event.type === "realtime:backpressure" &&
          event.strategy === "drop-oldest" &&
          event.dropped > 0,
      ),
    ).toBe(true);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 1 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("expires an idle paused buffer by age before resume", () => {
    const { space, transport, clock, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 9 }]));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    clock.advance(6_000);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(0);
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 5,
    });
    expect(
      events.some((event) => event.type === "realtime:backpressure" && event.strategy === "age"),
    ).toBe(true);
  });

  it("preserves partial metadata and query pagination across live updates", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(
      snapshotEnvelope(space, "schools", {
        complete: false,
        nextCursor: "page-2",
        counts: {
          returnedRows: 2,
          totalRows: 10,
          filteredRows: 5,
          nullCounts: { score: 1 },
        },
      }),
    );
    expect(space.getQueryState("schools")?.phase).toBe("partial");
    expect(space.getQueryState("schools")?.countsStale).toBe(false);
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }]));
    const state = space.getQueryState("schools");
    expect(state?.phase).toBe("partial");
    expect(state?.complete).toBe(false);
    expect(state?.nextCursor).toBe("page-2");
    expect(state?.counts.totalRows).toBe(10);
    expect(state?.counts.filteredRows).toBe(5);
    expect(state?.counts.returnedRows).toBe(2);
    expect(state?.counts.nullCounts).toEqual({ score: 1 });
    expect(state?.countsStale).toBe(false);
  });

  it("marks result counts stale after delete and null-changing updates", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    expect(space.getQueryState("schools")?.countsStale).toBe(false);
    transport.publish(deleteEnvelope(space, "schools", 1, [rowKey("north")]));
    let state = space.getQueryState("schools");
    expect(state?.counts.returnedRows).toBe(1);
    expect(state?.counts.totalRows).toBeNull();
    expect(state?.countsStale).toBe(true);
    transport.publish(
      updateEnvelope(space, "schools", 2, [{ school_id: "south", score: null as never }]),
    );
    state = space.getQueryState("schools");
    expect(state?.counts.nullCounts).toEqual({ score: 1 });
    expect(state?.countsStale).toBe(true);
  });

  it("keeps recovery required when snapshot acceptance drops an expired newer update", () => {
    const { space, transport, clock, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    clock.advance(6_000);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(
      events.some((event) => event.type === "realtime:backpressure" && event.strategy === "age"),
    ).toBe(true);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 6 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("keeps recovery required when a recovery snapshot expires a newer update", () => {
    const { space, transport, clock } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "south", score: 8 }]));
    clock.advance(6_000);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 6 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("keeps recovery required when a paused pre-baseline update expires", () => {
    const { space, transport, clock, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    clock.advance(6_000);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(
      events.some((event) => event.type === "realtime:backpressure" && event.strategy === "age"),
    ).toBe(true);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 6 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("emits resync completion only after buffered reconciliation succeeds", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 7, [{ school_id: "south", score: 8 }]));
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(
      events.some(
        (event) => event.type === "realtime:resync" && event.reason === "snapshot-applied",
      ),
    ).toBe(false);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 7 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(
      events.some(
        (event) => event.type === "realtime:resync" && event.reason === "snapshot-applied",
      ),
    ).toBe(true);
  });

  it("does not emit resync completion when acceptance drops an expired newer update", () => {
    const { space, transport, clock, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "south", score: 8 }]));
    clock.advance(6_000);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(
      events.some(
        (event) => event.type === "realtime:resync" && event.reason === "snapshot-applied",
      ),
    ).toBe(false);
  });

  it("does not silently drop a paused mixed-epoch update when a snapshot is buffered", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools", { epoch: "epoch-1" }));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(
      updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 9 }], {
        epoch: "epoch-2",
      }),
    );
    transport.publish(
      snapshotEnvelope(space, "schools", {
        epoch: "epoch-1",
        sequence: 1,
        rows: [{ school_id: "north", score: 1 }],
        rowKeys: [rowKey("north")],
        counts: { returnedRows: 1, totalRows: null, filteredRows: 1, nullCounts: {} },
      }),
    );
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(2);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(events.some((event) => event.type === "realtime:resync")).toBe(true);
    transport.publish(
      snapshotEnvelope(space, "schools", {
        epoch: "epoch-2",
        sequence: 1,
        rows: [{ school_id: "north", score: 9 }],
        rowKeys: [rowKey("north")],
        counts: { returnedRows: 1, totalRows: null, filteredRows: 1, nullCounts: {} },
      }),
    );
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getRealtimeState("schools")?.epoch).toBe("epoch-2");
  });

  it("stops old-session emissions after a re-entrant remove on the applied event", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    let removed = false;
    space.subscribe((event) => {
      if (
        !removed &&
        event.type === "realtime:applied" &&
        event.kind === "snapshot" &&
        event.streamSequence === 5
      ) {
        removed = true;
        space.removeQuery("schools");
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(removed).toBe(true);
    expect(space.getQueryState("schools")).toBeUndefined();
    expect(
      events.some(
        (event) =>
          event.type === "realtime:resync" &&
          event.generation === 1 &&
          event.reason === "snapshot-applied",
      ),
    ).toBe(false);
  });

  it("stops old-session emissions after a re-entrant replacement on the applied event", () => {
    const { space, transport, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    let replaced = false;
    space.subscribe((event) => {
      if (
        !replaced &&
        event.type === "realtime:applied" &&
        event.kind === "snapshot" &&
        event.streamSequence === 5
      ) {
        replaced = true;
        unwrap(
          space.setQuery(
            "schools",
            {
              ...LIVE_SPEC,
              filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
            },
            { live: true },
          ),
        );
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(replaced).toBe(true);
    expect(space.getRealtimeState("schools")?.generation).toBe(2);
    expect(
      events.some(
        (event) =>
          event.type === "realtime:resync" &&
          event.generation === 1 &&
          event.reason === "snapshot-applied",
      ),
    ).toBe(false);
  });

  it("honours a re-entrant pause from the recovery snapshot applied event", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    let paused = false;
    space.subscribe((event) => {
      if (
        !paused &&
        event.type === "realtime:applied" &&
        event.kind === "snapshot" &&
        event.streamSequence === 5
      ) {
        paused = true;
        unwrap(space.pauseRealtime("schools"));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(paused).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    expect(space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 5,
    });
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 42,
    });
  });

  it("honours a re-entrant resync from the recovery snapshot applied event", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    let requested = false;
    space.subscribe((event) => {
      if (
        !requested &&
        event.type === "realtime:applied" &&
        event.kind === "snapshot" &&
        event.streamSequence === 5
      ) {
        requested = true;
        unwrap(space.resyncRealtime("schools", "reentrant"));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(requested).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    expect(space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 5,
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 6 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 5,
    });
  });

  it("honours a re-entrant pause from a buffered update applied event", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    transport.publish(updateEnvelope(space, "schools", 7, [{ school_id: "south", score: 8 }]));
    let paused = false;
    space.subscribe((event) => {
      if (
        !paused &&
        event.type === "realtime:applied" &&
        event.kind === "upsert" &&
        event.streamSequence === 6
      ) {
        paused = true;
        unwrap(space.pauseRealtime("schools"));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(paused).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 42 },
      { school_id: "south", score: 4 },
    ]);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 42 },
      { school_id: "south", score: 8 },
    ]);
  });

  it("merges synchronously delivered updates with paused pending entries", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    let handled = false;
    space.subscribe((event) => {
      if (
        !handled &&
        event.type === "realtime:applied" &&
        event.kind === "snapshot" &&
        event.streamSequence === 5
      ) {
        handled = true;
        unwrap(space.pauseRealtime("schools"));
        transport.publish(updateEnvelope(space, "schools", 7, [{ school_id: "south", score: 8 }]));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(handled).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(2);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 42 },
      { school_id: "south", score: 8 },
    ]);
  });

  it("merges synchronously delivered updates with recovery pending entries", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    transport.publish(updateEnvelope(space, "schools", 5, [{ school_id: "north", score: 9 }]));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    let handled = false;
    space.subscribe((event) => {
      if (
        !handled &&
        event.type === "realtime:applied" &&
        event.kind === "snapshot" &&
        event.streamSequence === 5
      ) {
        handled = true;
        unwrap(space.resyncRealtime("schools", "reentrant"));
        transport.publish(updateEnvelope(space, "schools", 7, [{ school_id: "south", score: 8 }]));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(handled).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(2);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 7 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("stops resume draining after a re-entrant pause", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }]));
    transport.publish(updateEnvelope(space, "schools", 2, [{ school_id: "south", score: 5 }]));
    let paused = false;
    space.subscribe((event) => {
      if (
        !paused &&
        event.type === "realtime:applied" &&
        event.kind === "upsert" &&
        event.streamSequence === 1
      ) {
        paused = true;
        unwrap(space.pauseRealtime("schools"));
      }
    });
    unwrap(space.resumeRealtime("schools"));
    expect(paused).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 6 },
      { school_id: "south", score: 4 },
    ]);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
    expect(space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 6 },
      { school_id: "south", score: 5 },
    ]);
  });

  it("stops resume draining after a re-entrant resync", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.pauseRealtime("schools"));
    transport.publish(updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 6 }]));
    transport.publish(updateEnvelope(space, "schools", 2, [{ school_id: "south", score: 5 }]));
    let requested = false;
    space.subscribe((event) => {
      if (
        !requested &&
        event.type === "realtime:applied" &&
        event.kind === "upsert" &&
        event.streamSequence === 1
      ) {
        requested = true;
        unwrap(space.resyncRealtime("schools", "reentrant"));
      }
    });
    unwrap(space.resumeRealtime("schools"));
    expect(requested).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getRealtimeState("schools")?.bufferedMessages).toBe(1);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 2 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("honours a re-entrant pause from an age backpressure event during acceptance", () => {
    const { space, transport, clock, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    clock.advance(6_000);
    let paused = false;
    space.subscribe((event) => {
      if (!paused && event.type === "realtime:backpressure" && event.strategy === "age") {
        paused = true;
        unwrap(space.pauseRealtime("schools"));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(paused).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("paused");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getQueryState("schools")?.rows).toEqual([]);
    expect(events.some((event) => event.type === "realtime:backpressure")).toBe(true);
    unwrap(space.resumeRealtime("schools"));
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 6 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("honours a re-entrant resync from an age backpressure event during acceptance", () => {
    const { space, transport, clock, events } = createHarness();
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(updateEnvelope(space, "schools", 6, [{ school_id: "north", score: 42 }]));
    clock.advance(6_000);
    let requested = false;
    space.subscribe((event) => {
      if (!requested && event.type === "realtime:backpressure" && event.strategy === "age") {
        requested = true;
        unwrap(space.resyncRealtime("schools", "backpressure"));
      }
    });
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 5 }));
    expect(requested).toBe(true);
    expect(space.getRealtimeState("schools")?.status).toBe("resyncing");
    expect(space.getRealtimeState("schools")?.needsResync).toBe(true);
    expect(space.getQueryState("schools")?.rows).toEqual([]);
    expect(events.some((event) => event.type === "realtime:backpressure")).toBe(true);
    transport.publish(snapshotEnvelope(space, "schools", { sequence: 6 }));
    expect(space.getRealtimeState("schools")?.status).toBe("live");
  });

  it("unsubscribes on remove, cancel and dispose and ignores late messages", () => {
    const harness = createHarness();
    const { space, transport, events } = harness;
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    const lateUpdate = updateEnvelope(space, "schools", 1, [{ school_id: "north", score: 1 }]);
    unwrap(space.removeQuery("schools"));
    expect(transport.subscriptionCount()).toBe(0);
    expect(space.getQueryState("schools")).toBeUndefined();
    expect(transport.publish(lateUpdate)).toBe(0);
    expect(events.some((event) => event.type === "realtime:closed")).toBe(true);

    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(snapshotEnvelope(space, "schools"));
    unwrap(space.cancelQuery("schools"));
    expect(transport.subscriptionCount()).toBe(0);
    expect(space.getQueryState("schools")?.phase).toBe("cancelled");

    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    unwrap(space.dispose());
    expect(transport.subscriptionCount()).toBe(0);
    expect(space.getQueryState("schools")).toBeUndefined();
  });

  it("tracks primary and reference subscriptions independently", () => {
    const { space, transport } = createHarness();
    unwrap(space.setQuery("primary", LIVE_SPEC, { live: true }));
    unwrap(space.setQuery("reference", LIVE_SPEC, { live: true }));
    expect(transport.subscriptionCount()).toBe(2);
    transport.publish(snapshotEnvelope(space, "primary"));
    transport.publish(snapshotEnvelope(space, "reference"));
    expect(space.getQueryState("primary")?.rows).toHaveLength(2);
    expect(space.getQueryState("reference")?.rows).toHaveLength(2);
    unwrap(
      space.setQuery(
        "primary",
        {
          ...LIVE_SPEC,
          filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
        },
        { live: true },
      ),
    );
    expect(space.getRealtimeState("primary")?.generation).toBe(2);
    expect(space.getRealtimeState("reference")?.generation).toBe(1);
    expect(transport.subscriptionCount()).toBe(2);
    expect(
      transport.publish(updateEnvelope(space, "reference", 1, [{ school_id: "south", score: 6 }])),
    ).toBe(1);
    expect(space.getQueryState("reference")?.rows[1]).toEqual({ school_id: "south", score: 6 });
    expect(space.getQueryState("primary")?.rows).toEqual([]);
  });

  it("keeps spaces isolated with separate transports", () => {
    const first = createHarness();
    const second = createHarness();
    unwrap(first.space.setQuery("schools", LIVE_SPEC, { live: true }));
    unwrap(second.space.setQuery("schools", LIVE_SPEC, { live: true }));
    first.transport.publish(snapshotEnvelope(first.space, "schools"));
    expect(first.space.getQueryState("schools")?.rows).toHaveLength(2);
    expect(second.space.getQueryState("schools")?.rows).toHaveLength(0);
    expect(second.transport.publish(snapshotEnvelope(second.space, "schools"))).toBe(1);
    expect(second.space.getQueryState("schools")?.rows).toHaveLength(2);
  });

  it("ignores late callbacks from a replaced subscription and old generation", () => {
    const transport = new ControllableTransport();
    const clock = new FakeClock();
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "realtime-fixture",
        datasets: [{ descriptor: realtimeDescriptor(), rows: ASSESSMENT_ROWS }],
      }),
    );
    const runtime = createRuntime({
      clock,
      idFactory: createDeterministicIdFactory("late"),
      datasetProvider: provider,
      realtime: transport,
      logger: createRecordingLogger(),
    });
    const space = unwrap(runtime.createSpace({ document: makeDocument("Late") }));
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    const first = transport.subscriptions[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    first.listener.onEnvelope(snapshotEnvelope(space, "schools"));
    const oldKey = queryKey(space, "schools");
    const oldGeneration = space.getRealtimeState("schools")?.generation ?? 1;
    unwrap(
      space.setQuery(
        "schools",
        {
          ...LIVE_SPEC,
          filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
        },
        { live: true },
      ),
    );
    const snapshotEvents = events.filter(
      (event) => event.type === "realtime:applied" && event.kind === "snapshot",
    ).length;
    const statusEvents = events.filter((event) => event.type === "realtime:status").length;
    first.listener.onStatus({ status: "open" });
    first.listener.onStatus({ status: "reconnecting", attempt: 2, maxAttempts: 5 });
    first.listener.onError({
      code: "REALTIME_SUBSCRIPTION_FAILED",
      path: "realtime",
      message: "Late transport error",
      severity: "error",
    });
    expect(events.filter((event) => event.type === "realtime:status")).toHaveLength(statusEvents);
    first.listener.onEnvelope(
      snapshotEnvelope(space, "schools", {
        queryKey: oldKey,
        generation: oldGeneration,
        messageId: "late-old-generation",
        rows: [{ school_id: "north", score: 99 }],
        rowKeys: [rowKey("north")],
      }),
    );
    expect(
      events.filter((event) => event.type === "realtime:applied" && event.kind === "snapshot"),
    ).toHaveLength(snapshotEvents);
    expect(space.getQueryState("schools")?.rows).toEqual([]);
    expect(transport.subscriptions[0]?.closed).toBe(true);
  });

  it("does not log payloads or credentials from realtime failures", () => {
    const { space, transport, logger } = createHarness();
    const syntheticValue = ["fake", "Token", "Value"].join("");
    unwrap(space.setQuery("schools", LIVE_SPEC, { live: true }));
    transport.publish(
      Object.freeze({
        ...snapshotEnvelope(space, "schools"),
        kind: "error",
        rows: undefined,
        rowKeys: [],
        diagnostics: [
          {
            code: "REALTIME_ERROR",
            path: "realtime",
            message: "Provider rejected the subscription",
            severity: "error",
          },
        ],
        credentials: syntheticValue,
      }),
    );
    const serialized = JSON.stringify({ logger: logger.entries, queries: space.getQueryStates() });
    expect(serialized).not.toContain(syntheticValue);
  });
});

class ControllableTransport implements RealtimeTransport {
  readonly transportId = "controllable";
  readonly simulated = false;
  readonly subscriptions: Array<{
    readonly request: RealtimeSubscriptionRequest;
    readonly listener: RealtimeTransportListener;
    closed: boolean;
  }> = [];

  subscribe(
    request: RealtimeSubscriptionRequest,
    listener: RealtimeTransportListener,
  ): RealtimeTransportSubscription {
    const entry = { request, listener, closed: false };
    this.subscriptions.push(entry);
    listener.onStatus({ status: "open" });
    return {
      send: () => undefined,
      close: () => {
        entry.closed = true;
      },
    };
  }
}
