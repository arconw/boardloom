import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createLocalDatasetProvider,
  createRuntime,
  createSimulatedRealtimeTransport,
  type DatasetDescriptor,
  type QueryResultRow,
  type QueryState,
  type RealtimeEnvelope,
} from "../../../../packages/core/src/index.js";
import { mountBoardView } from "../../../../packages/view-dom/src/index.js";
import {
  ASSESSMENT_DESCRIPTOR,
  ASSESSMENT_ROWS,
  cloneAssessmentDescriptor,
} from "../../core/fixtures/assessment-fixture.js";
import { unwrap } from "../../core/support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
} from "../../core/support/fakes.js";
import {
  createMiniDocument,
  findByClass,
  type MiniDocument,
  type MiniElement,
} from "../support/mini-dom.js";
import { viewerFixtureDocument } from "../support/fixture.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function realtimeDescriptor(): DatasetDescriptor {
  return cloneAssessmentDescriptor({
    capabilities: Object.freeze({
      ...ASSESSMENT_DESCRIPTOR.capabilities,
      realtime: true,
    }),
  });
}

function rowFor(state: QueryState): QueryResultRow {
  const row: Record<string, string | number | boolean | null> = {};
  for (const field of state.fields) {
    row[field.fieldId] = field.type === "number" ? 4 : "north";
  }
  return Object.freeze(row);
}

function snapshotFor(
  state: QueryState,
  keyFields: readonly string[],
  sequence = 0,
): RealtimeEnvelope {
  const row = rowFor(state);
  return Object.freeze({
    messageId: `viewer-snapshot-${sequence}`,
    datasetId: state.datasetId,
    ...(state.sliceId === undefined ? {} : { sliceId: state.sliceId }),
    queryKey: state.queryKey,
    generation: state.generation,
    epoch: "viewer-epoch-1",
    sequence,
    cursor: `viewer-cursor-${sequence}`,
    kind: "snapshot",
    rowKeys: [canonicalJson(keyFields.map((field) => row[field] ?? null) as never)],
    rows: [row],
    fields: state.fields,
    counts: {
      returnedRows: 1,
      totalRows: null,
      filteredRows: 1,
      nullCounts: {},
    },
    complete: true,
    timestamp: 1_700_000_000_000 + sequence,
  }) as RealtimeEnvelope;
}

async function createHarness() {
  const document = createMiniDocument();
  const target = document.createElement("div");
  target.clientWidth = 1280;
  document.body.append(target);
  const transport = createSimulatedRealtimeTransport();
  const provider = unwrap(
    createLocalDatasetProvider({
      providerId: "viewer-fixture",
      datasets: [{ descriptor: realtimeDescriptor(), rows: ASSESSMENT_ROWS }],
    }),
  );
  const runtime = createRuntime({
    clock: new FakeClock(),
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("viewer-realtime"),
    datasetProvider: provider,
    realtime: transport,
  });
  const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
  const handle = unwrap(
    mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
  );
  return { document, target, transport, runtime, space, handle };
}

function queryByClass(document: MiniDocument, className: string): MiniElement | null {
  return findByClass(document.body, className)[0] ?? null;
}

describe("realtime status UI integration", () => {
  it("labels the simulation, renders live status and exposes pause/resume/resync controls", async () => {
    const harness = await createHarness();
    try {
      await flush();
      expect(harness.space.getRealtimeStates().length).toBeGreaterThan(0);
      const status = queryByClass(harness.document, "bl-status");
      expect(status).not.toBeNull();
      expect(status?.getAttribute("data-status")).toBe("connecting");
      expect(status?.getAttribute("data-message-key")).toBe("a11y.realtimeStatus");
      const root = harness.handle.element as unknown as MiniElement;
      expect(root.getAttribute("data-boardloom-realtime")).toBe("simulated");

      for (const state of harness.space.getQueryStates()) {
        const keyFields = harness.space.getRealtimeState(state.queryId)?.keyFields ?? [];
        harness.transport.publish(snapshotFor(state, keyFields));
      }
      await flush();
      expect(status?.getAttribute("data-status")).toBe("live");
      const simulated = queryByClass(harness.document, "bl-statusbar__simulated");
      expect(simulated?.hasAttribute("hidden")).toBe(false);
      expect(simulated?.textContent).toContain("Simulated live data");
      expect(simulated?.getAttribute("title")).toContain("not a real transport verification");
      const pause = findByClass(harness.document.body, "bl-realtime-control").find(
        (element) => element.getAttribute("data-realtime-action") === "pause",
      );
      const resync = findByClass(harness.document.body, "bl-realtime-control").find(
        (element) => element.getAttribute("data-realtime-action") === "resync",
      );
      expect(pause?.hasAttribute("hidden")).toBe(false);
      expect(pause?.textContent).toContain("Pause updates");
      expect(pause?.getAttribute("aria-label")).toBe("Pause realtime updates");
      expect(resync?.getAttribute("aria-label")).toBe("Resynchronize realtime data");

      pause?.click();
      await flush();
      expect(status?.getAttribute("data-status")).toBe("paused");
      expect(pause?.textContent).toContain("Resume updates");
      pause?.click();
      await flush();
      expect(status?.getAttribute("data-status")).toBe("live");

      resync?.click();
      await flush();
      expect(status?.getAttribute("data-status")).toBe("resyncing");
      for (const state of harness.space.getQueryStates()) {
        const keyFields = harness.space.getRealtimeState(state.queryId)?.keyFields ?? [];
        harness.transport.publish(snapshotFor(state, keyFields, 1));
      }
      await flush();
      expect(status?.getAttribute("data-status")).toBe("live");
      expect(harness.space.getRealtimeStates().every((state) => state.sequence === 1)).toBe(true);
    } finally {
      unwrap(harness.handle.unmount());
      harness.runtime.dispose();
      expect(harness.transport.subscriptionCount()).toBe(0);
    }
  });

  it("updates the rendered blocks after a realtime snapshot without stale overlay", async () => {
    const harness = await createHarness();
    try {
      await flush();
      const states = harness.space.getQueryStates();
      for (const state of states) {
        const keyFields = harness.space.getRealtimeState(state.queryId)?.keyFields ?? [];
        harness.transport.publish(snapshotFor(state, keyFields));
      }
      await flush();
      const root = harness.handle.element as unknown as MiniElement;
      expect(root.getAttribute("data-boardloom-realtime-status")).toBe("live");
      const metric = queryByClass(harness.document, "bl-metric__value");
      expect(metric?.textContent).toContain("4");
      const stale = findByClass(harness.document.body, "bl-state").filter(
        (element) => element.getAttribute("data-state") === "stale",
      );
      expect(stale).toHaveLength(0);
    } finally {
      unwrap(harness.handle.unmount());
      harness.runtime.dispose();
    }
  });
});
