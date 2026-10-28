import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  createLocalDatasetProvider,
  createRuntime,
  createWebSocketRealtimeTransport,
  type DatasetDescriptor,
  type RealtimeEnvelope,
  type RealtimeSubscriptionRequest,
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
import {
  createWebSocketTestServer,
  waitFor,
  type WebSocketTestConnection,
} from "../support/ws-server.js";

const LIVE_SPEC = Object.freeze({
  datasetId: "assessment-results",
  sliceId: "all-results",
  groupBy: Object.freeze([{ fieldId: "school_id" }]),
  aggregations: Object.freeze([{ output: "score", type: "average" as const, fieldId: "score" }]),
});

const CLEANUPS: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (CLEANUPS.length > 0) {
    const cleanup = CLEANUPS.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

function realtimeDescriptor(): DatasetDescriptor {
  return cloneAssessmentDescriptor({
    capabilities: Object.freeze({
      ...ASSESSMENT_DESCRIPTOR.capabilities,
      realtime: true,
    }),
  });
}

function rowKey(schoolId: string): string {
  return canonicalJson([schoolId] as never);
}

function fields(): RealtimeEnvelope["fields"] {
  return Object.freeze([
    { fieldId: "school_id", type: "string", role: "dimension" },
    {
      fieldId: "score",
      type: "number",
      role: "measure",
      unit: { unit: "points" },
    },
  ]);
}

function envelope(
  request: RealtimeSubscriptionRequest,
  overrides: Partial<RealtimeEnvelope> = {},
): RealtimeEnvelope {
  return Object.freeze({
    messageId: `message-${overrides.sequence ?? 0}`,
    datasetId: request.datasetId,
    ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
    queryKey: request.queryKey,
    generation: request.generation,
    epoch: "socket-epoch-1",
    sequence: 0,
    cursor: "socket-cursor-0",
    kind: "snapshot",
    rowKeys: [rowKey("north"), rowKey("south")],
    rows: [
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ],
    fields: fields(),
    counts: {
      returnedRows: 2,
      totalRows: null,
      filteredRows: 2,
      nullCounts: {},
    },
    complete: true,
    timestamp: 1_700_000_000_000,
    ...overrides,
  }) as RealtimeEnvelope;
}

async function createSocketHarness() {
  let request: RealtimeSubscriptionRequest | null = null;
  let connection: WebSocketTestConnection | null = null;
  let sentSequence = 0;
  const server = await createWebSocketTestServer({
    onSubscribe(next, nextConnection) {
      request = next as unknown as RealtimeSubscriptionRequest;
      connection = nextConnection;
      nextConnection.send(envelope(request, { sequence: sentSequence }));
    },
    onMessage(message, nextConnection) {
      if (message.type === "resync" && request !== null) {
        connection = nextConnection;
        nextConnection.send(
          envelope(request, { sequence: sentSequence, messageId: `resync-${sentSequence}` }),
        );
      }
    },
  });
  CLEANUPS.push(() => server.close());
  const provider = unwrap(
    createLocalDatasetProvider({
      providerId: "socket-fixture",
      datasets: [{ descriptor: realtimeDescriptor(), rows: ASSESSMENT_ROWS }],
    }),
  );
  const transport = createWebSocketRealtimeTransport({
    url: server.url,
    reconnect: {
      initialDelayMs: 10,
      factor: 2,
      maxDelayMs: 60,
      maxAttempts: 5,
      jitter: 0,
    } as never,
    random: () => 0.5,
  });
  const runtime = createRuntime({
    clock: new FakeClock(),
    idFactory: createDeterministicIdFactory("socket"),
    datasetProvider: provider,
    realtime: transport,
    logger: createRecordingLogger(),
  });
  CLEANUPS.push(() => void runtime.dispose());
  const space = unwrap(runtime.createSpace({ document: makeDocument("Socket") }));
  const events: SpaceEvent[] = [];
  space.subscribe((event) => events.push(event));
  return {
    server,
    space,
    events,
    connection: () => connection,
    currentRequest: () => request,
    sendUpdate(sequence: number, rows: ReadonlyArray<{ school_id: string; score: number }>) {
      const target = connection;
      const active = request;
      if (target === null || active === null) {
        throw new Error("socket is not ready");
      }
      sentSequence = sequence;
      target.send(
        envelope(active, {
          kind: "upsert",
          sequence,
          messageId: `update-${sequence}`,
          rowKeys: rows.map((row) => rowKey(row.school_id)),
          rows,
          counts: {
            returnedRows: rows.length,
            totalRows: null,
            filteredRows: rows.length,
            nullCounts: {},
          },
        }),
      );
    },
  };
}

describe("real local WebSocket realtime transport", () => {
  it("streams a snapshot, ordered updates, duplicate/out-of-order frames, pause/resume and unsubscribe", async () => {
    const harness = await createSocketHarness();
    unwrap(harness.space.setQuery("schools", LIVE_SPEC, { live: true }));
    await waitFor(() => harness.space.getQueryState("schools")?.phase === "settled");
    expect(harness.space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 4 },
    ]);
    expect(harness.space.getRealtimeState("schools")?.status).toBe("live");
    harness.sendUpdate(1, [{ school_id: "north", score: 6 }]);
    await waitFor(() => harness.space.getRealtimeState("schools")?.sequence === 1);
    harness.sendUpdate(1, [{ school_id: "north", score: 7 }]);
    harness.sendUpdate(0, [{ school_id: "north", score: 8 }]);
    await waitFor(() => (harness.space.getRealtimeState("schools")?.duplicateMessages ?? 0) >= 2);
    expect(harness.space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 6,
    });
    unwrap(harness.space.pauseRealtime("schools"));
    expect(harness.space.getRealtimeState("schools")?.status).toBe("paused");
    harness.sendUpdate(2, [{ school_id: "south", score: 5 }]);
    harness.sendUpdate(3, [{ school_id: "north", score: 9 }]);
    await waitFor(() => (harness.space.getRealtimeState("schools")?.bufferedMessages ?? 0) === 2);
    expect(harness.space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 6,
    });
    unwrap(harness.space.resumeRealtime("schools"));
    await waitFor(() => harness.space.getRealtimeState("schools")?.status === "live");
    expect(harness.space.getRealtimeState("schools")?.bufferedMessages).toBe(0);
    expect(harness.space.getQueryState("schools")?.rows[0]).toEqual({
      school_id: "north",
      score: 9,
    });
    unwrap(harness.space.removeQuery("schools"));
    await waitFor(() => harness.server.connectionCount === 0);
    expect(harness.space.getQueryState("schools")).toBeUndefined();
    expect(harness.events.some((event) => event.type === "realtime:closed")).toBe(true);
  });

  it("reconnects after a socket drop and resynchronizes without stale callbacks", async () => {
    const harness = await createSocketHarness();
    unwrap(harness.space.setQuery("schools", LIVE_SPEC, { live: true }));
    await waitFor(() => harness.space.getRealtimeState("schools")?.status === "live");
    harness.sendUpdate(1, [{ school_id: "north", score: 7 }]);
    await waitFor(() => harness.space.getRealtimeState("schools")?.sequence === 1);
    harness.server.closeClients();
    await waitFor(() =>
      harness.events.some(
        (event) =>
          event.type === "realtime:status" &&
          event.queryId === "schools" &&
          event.status === "reconnecting",
      ),
    );
    await waitFor(() => harness.space.getRealtimeState("schools")?.status === "live", 10_000);
    await waitFor(() => harness.server.connectionCount === 1);
    const connection = harness.connection();
    const request = harness.currentRequest();
    expect(connection).not.toBeNull();
    expect(request).not.toBeNull();
    if (connection !== null && request !== null) {
      connection.send(
        envelope(request, {
          kind: "upsert",
          sequence: 2,
          messageId: "after-reconnect",
          rowKeys: [rowKey("south")],
          rows: [{ school_id: "south", score: 8 }],
          counts: {
            returnedRows: 1,
            totalRows: null,
            filteredRows: 1,
            nullCounts: {},
          },
        }),
      );
    }
    await waitFor(() => harness.space.getRealtimeState("schools")?.sequence === 2);
    expect(harness.space.getQueryState("schools")?.rows).toEqual([
      { school_id: "north", score: 5 },
      { school_id: "south", score: 8 },
    ]);
    expect(
      harness.events.some(
        (event) => event.type === "realtime:resync" && event.queryId === "schools",
      ),
    ).toBe(true);
  });

  it("detects a sequence gap, requests a real resync and stays bounded on overflow", async () => {
    const harness = await createSocketHarness();
    unwrap(
      harness.space.setQuery("schools", LIVE_SPEC, {
        live: true,
        limits: {
          maxBufferedMessages: 2,
          maxBufferedBytes: 5 * 1024 * 1024,
          maxBufferAgeMs: 5_000,
        },
      }),
    );
    await waitFor(() => harness.space.getRealtimeState("schools")?.status === "live");
    harness.sendUpdate(5, [{ school_id: "north", score: 6 }]);
    await waitFor(() => harness.space.getRealtimeState("schools")?.sequence === 5);
    await waitFor(() => harness.space.getRealtimeState("schools")?.status === "live", 10_000);
    expect(harness.events.some((event) => event.type === "realtime:resync")).toBe(true);
    expect(harness.space.getQueryState("schools")?.rows).toHaveLength(2);

    unwrap(harness.space.pauseRealtime("schools"));
    for (let sequence = 6; sequence <= 12; sequence += 1) {
      harness.sendUpdate(sequence, [{ school_id: "north", score: sequence }]);
    }
    await waitFor(() => (harness.space.getRealtimeState("schools")?.droppedMessages ?? 0) > 0);
    const buffered = harness.space.getRealtimeState("schools");
    expect(buffered?.bufferedMessages).toBeLessThanOrEqual(2);
    expect(buffered?.needsResync).toBe(true);
    expect(
      harness.events.some(
        (event) => event.type === "realtime:backpressure" && event.queryId === "schools",
      ),
    ).toBe(true);
    unwrap(harness.space.resumeRealtime("schools"));
    await waitFor(() => harness.space.getRealtimeState("schools")?.status === "live", 10_000);
    await waitFor(() => harness.space.getRealtimeState("schools")?.sequence === 12);
  });
});
