import { describe, expect, it } from "vitest";
import { createRuntime, type SpaceEvent } from "../../../../packages/core/src/index.js";
import { unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";
import { runSpaceLifecycleStress } from "../support/stress.js";

describe("create, switch and dispose stress", () => {
  it("creates and disposes many spaces without leaks or cross-space events", () => {
    const report = runSpaceLifecycleStress({ cycles: 10, spacesPerCycle: 20 });

    expect(report.createdSpaces).toBe(200);
    expect(report.disposedSpaces).toBe(200);
    expect(report.maxLiveSpaces).toBeGreaterThanOrEqual(20);
    expect(report.maxSpaceListeners).toBeGreaterThanOrEqual(1);
    expect(report.maxScheduledTasks).toBeGreaterThanOrEqual(1);
    expect(report.maxViews).toBeGreaterThanOrEqual(2);
    expect(report.crossSpaceEvents).toBe(0);
    expect(report.postDisposeEvents).toBe(0);
    expect(report.leakedListeners).toBe(0);
    expect(report.leakedTasks).toBe(0);
    expect(report.leakedViews).toBe(0);
    expect(report.leakedTimerCallbacks).toBe(0);
    expect(report.snapshotMismatches).toBe(0);
    expect(report.runtimeSpacesAfterDispose).toBe(0);
  });

  it("ignores late timer callbacks and prevents event resurrection after dispose", () => {
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("late"),
    });
    const space = unwrap(runtime.createSpace({ id: "late-space", document: makeDocument("Late") }));
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    let lateCalls = 0;
    unwrap(
      space.schedule(() => {
        lateCalls += 1;
        space.loadDocument(makeDocument("Resurrected"));
      }, 500),
    );

    unwrap(space.dispose());
    const eventCountAfterDispose = events.length;
    expect(events.at(-1)?.type).toBe("space:disposed");
    clock.advance(5_000);
    expect(lateCalls).toBe(0);
    expect(events.length).toBe(eventCountAfterDispose);
    expect(space.getSnapshot().committedDocument.title).toBe("Late");
    expect(space.getSnapshot().taskCount).toBe(0);
    expect(space.getSnapshot().listenerCount).toBe(0);
  });

  it("releases subscriptions and view resources deterministically", () => {
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("resources"),
    });
    const space = unwrap(
      runtime.createSpace({ id: "resources", document: makeDocument("Resources") }),
    );
    const runtimeEvents: SpaceEvent[] = [];
    const spaceEvents: SpaceEvent[] = [];
    runtime.subscribe((event) => runtimeEvents.push(event));
    const unsubscribe = space.subscribe((event) => spaceEvents.push(event));
    expect(space.listenerCount).toBe(1);

    const views = Array.from({ length: 12 }, () => unwrap(space.createView({ mode: "viewer" })));
    expect(space.viewCount).toBe(12);
    for (const view of views) {
      unwrap(view.dispose());
      unwrap(view.dispose());
    }
    expect(space.viewCount).toBe(0);
    expect(spaceEvents.filter((event) => event.type === "view:disposed")).toHaveLength(12);

    unsubscribe();
    unsubscribe();
    expect(space.listenerCount).toBe(0);
    spaceEvents.length = 0;
    unwrap(space.loadDocument(makeDocument("No listeners"), { source: "host" }));
    expect(spaceEvents).toHaveLength(0);
    expect(runtimeEvents.map((event) => event.type)).toContain("document:changed");

    unwrap(space.dispose());
    expect(runtime.spaceCount).toBe(0);
    expect(runtime.listenerCount).toBe(1);
    unwrap(runtime.dispose());
    expect(runtime.listenerCount).toBe(0);
  });

  it("handles repeated create and dispose cycles in one runtime", () => {
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("cycles"),
    });
    const runtimeEvents: SpaceEvent[] = [];
    runtime.subscribe((event) => runtimeEvents.push(event));

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const space = unwrap(
        runtime.createSpace({
          id: `cycle-${cycle}`,
          document: makeDocument(`Cycle ${cycle}`),
        }),
      );
      const view = unwrap(space.createView({ mode: "viewer" }));
      unwrap(space.loadDocument(makeDocument(`Cycle ${cycle} loaded`), { source: "host" }));
      expect(view.getSnapshot().committedRevision).toBe(2);
      unwrap(view.dispose());
      unwrap(space.dispose());
    }

    expect(runtime.spaceCount).toBe(0);
    expect(runtimeEvents.filter((event) => event.type === "space:created")).toHaveLength(100);
    expect(runtimeEvents.filter((event) => event.type === "space:disposed")).toHaveLength(100);
    expect(clock.activeTimerCount).toBe(0);
    unwrap(runtime.dispose());
  });
});
