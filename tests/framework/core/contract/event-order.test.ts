import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createRuntime,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

function createHarness() {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("events"),
  });
  return { runtime, clock };
}

function expectMonotonic(events: readonly SpaceEvent[]): void {
  const sequences = events.map((event) => event.sequence);
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
  expect(new Set(sequences).size).toBe(sequences.length);
}

describe("event ordering under reentrant listeners", () => {
  it("delivers nested mutations in monotonic order to every observer", () => {
    const { runtime } = createHarness();
    const space = unwrap(runtime.createSpace({ id: "nested", document: makeDocument("Initial") }));
    const first: SpaceEvent[] = [];
    const second: SpaceEvent[] = [];
    const runtimeEvents: SpaceEvent[] = [];
    runtime.subscribe((event) => runtimeEvents.push(event));

    space.subscribe((event) => {
      first.push(event);
      if (event.type === "document:changed" && event.document.title === "First") {
        unwrap(space.loadDocument(makeDocument("Second"), { source: "host" }));
      }
    });
    space.subscribe((event) => second.push(event));

    unwrap(space.loadDocument(makeDocument("First"), { source: "host" }));

    expect(space.getSnapshot().committedDocument.title).toBe("Second");
    expectMonotonic(first);
    expectMonotonic(second);
    expectMonotonic(runtimeEvents.filter((event) => event.spaceId === "nested"));
    expect(second.map((event) => event.type)).toEqual([
      "document:changed",
      "space:loaded",
      "document:changed",
      "space:loaded",
    ]);
  });

  it("delivers disposal after the notification that triggered it and then stops", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "dispose-during-event", document: makeDocument("Initial") }),
    );
    const first: SpaceEvent[] = [];
    const second: SpaceEvent[] = [];
    const runtimeEvents: SpaceEvent[] = [];
    runtime.subscribe((event) => runtimeEvents.push(event));

    let listenersAfterDispose = -1;
    space.subscribe((event) => {
      first.push(event);
      if (event.type === "document:changed") {
        unwrap(space.dispose());
        listenersAfterDispose = space.listenerCount;
      }
    });
    space.subscribe((event) => second.push(event));

    space.loadDocument(makeDocument("During"), { source: "host" });

    expect(second.map((event) => event.type)).toEqual(["space:disposed"]);
    expect(first.map((event) => event.type)).toEqual(["document:changed", "space:disposed"]);
    expectMonotonic(first);
    expectMonotonic(second);
    const relevantRuntime = runtimeEvents.filter(
      (event) => event.spaceId === "dispose-during-event",
    );
    expectMonotonic(relevantRuntime);
    expect(relevantRuntime.map((event) => event.type)).toEqual([
      "document:changed",
      "space:disposed",
    ]);
    expect(listenersAfterDispose).toBe(0);
    expect(space.disposed).toBe(true);
    expect(space.listenerCount).toBe(0);
  });

  it("suppresses queued normal notifications when disposal interrupts a mutation", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "queued-disposal", document: makeDocument("Initial") }),
    );
    const first: SpaceEvent[] = [];
    const second: SpaceEvent[] = [];
    const runtimeEvents: SpaceEvent[] = [];
    runtime.subscribe((event) => runtimeEvents.push(event));
    space.subscribe((event) => {
      first.push(event);
      if (event.type === "document:changed") {
        unwrap(space.loadDocument(makeDocument("Queued"), { source: "host" }));
        unwrap(space.dispose());
      }
    });
    space.subscribe((event) => second.push(event));

    space.loadDocument(makeDocument("Interrupting"), { source: "host" });

    expect(first.map((event) => event.type)).toEqual(["document:changed", "space:disposed"]);
    expect(second.map((event) => event.type)).toEqual(["space:disposed"]);
    const relevantRuntime = runtimeEvents.filter((event) => event.spaceId === "queued-disposal");
    expect(relevantRuntime.some((event) => event.type === "space:loaded")).toBe(false);
    expect(
      relevantRuntime.some(
        (event) => event.type === "document:changed" && event.document.title === "Queued",
      ),
    ).toBe(false);
    expectMonotonic(relevantRuntime);
  });

  it("does not deliver a disposed space's queued normal events through an active runtime", () => {
    const { runtime } = createHarness();
    const a = unwrap(runtime.createSpace({ id: "runtime-a", document: makeDocument("A") }));
    const b = unwrap(runtime.createSpace({ id: "runtime-b", document: makeDocument("B") }));
    const seen: Array<{ type: string; spaceId: string; disposedA: boolean; title: string | null }> =
      [];
    runtime.subscribe((event) => {
      seen.push({
        type: event.type,
        spaceId: event.spaceId,
        disposedA: a.disposed,
        title: event.type === "document:changed" ? String(event.document.title) : null,
      });
      if (event.type === "document:changed" && event.spaceId === "runtime-b") {
        unwrap(a.loadDocument(makeDocument("A queued"), { source: "host" }));
        unwrap(a.dispose());
      }
    });

    unwrap(b.loadDocument(makeDocument("B change"), { source: "host" }));

    expect(a.disposed).toBe(true);
    expect(runtime.disposed).toBe(false);
    expect(
      seen.filter(
        (event) =>
          event.disposedA && event.spaceId === "runtime-a" && event.type !== "space:disposed",
      ),
    ).toEqual([]);
    expect(
      seen.filter((event) => event.type === "space:disposed" && event.spaceId === "runtime-a"),
    ).toHaveLength(1);
  });

  it("keeps the old space reserved through space and runtime terminal listeners", () => {
    const { runtime } = createHarness();
    const oldSpace = unwrap(
      runtime.createSpace({ id: "space-reuse", document: makeDocument("old") }),
    );
    let runtimeSawOld = false;
    let firstSawOld = false;
    let secondSawOld = false;
    let duplicateCode = "";
    let terminalCount = 0;
    runtime.subscribe((event) => {
      if (event.type === "space:disposed" && event.spaceId === "space-reuse") {
        runtimeSawOld = runtime.getSpace("space-reuse") === oldSpace;
      }
    });
    oldSpace.subscribe((event) => {
      if (event.type !== "space:disposed") {
        return;
      }
      terminalCount += 1;
      firstSawOld = runtime.getSpace("space-reuse") === oldSpace;
      const duplicate = runtime.createSpace({
        id: "space-reuse",
        document: makeDocument("replacement"),
      });
      if (!duplicate.ok) {
        duplicateCode = duplicate.diagnostics[0]?.code ?? "";
      }
    });
    oldSpace.subscribe((event) => {
      if (event.type === "space:disposed") {
        secondSawOld = runtime.getSpace("space-reuse") === oldSpace;
      }
    });

    unwrap(oldSpace.dispose());

    expect(runtimeSawOld).toBe(true);
    expect(firstSawOld).toBe(true);
    expect(secondSawOld).toBe(true);
    expect(duplicateCode).toBe(DIAGNOSTIC_CODES.SPACE_ALREADY_EXISTS);
    expect(terminalCount).toBe(1);

    const replacement = unwrap(
      runtime.createSpace({ id: "space-reuse", document: makeDocument("replacement") }),
    );
    expect(replacement.lifetimeId).not.toBe(oldSpace.lifetimeId);
    expect(runtime.getSpace("space-reuse")).toBe(replacement);
  });

  it("defers same-ID reuse until the old lifetime terminal is delivered", () => {
    const { runtime } = createHarness();
    const b = unwrap(runtime.createSpace({ id: "reuse-b", document: makeDocument("B") }));
    const oldSpace = unwrap(runtime.createSpace({ id: "reuse", document: makeDocument("old") }));
    const seen: Array<{ type: string; spaceId: string; lifetimeId: string; sequence: number }> = [];
    let duplicateCode = "";
    let oldTerminalLifetime = "";
    let currentWasOld = false;
    runtime.subscribe((event) => {
      seen.push({
        type: event.type,
        spaceId: event.spaceId,
        lifetimeId: event.lifetimeId,
        sequence: event.sequence,
      });
      if (event.type === "document:changed" && event.spaceId === "reuse-b") {
        unwrap(oldSpace.loadDocument(makeDocument("old queued"), { source: "host" }));
        unwrap(oldSpace.dispose());
        const duplicate = runtime.createSpace({
          id: "reuse",
          document: makeDocument("new"),
        });
        if (!duplicate.ok) {
          duplicateCode = duplicate.diagnostics[0]?.code ?? "";
        }
      }
      if (event.type === "space:disposed" && event.spaceId === "reuse") {
        oldTerminalLifetime = event.lifetimeId;
        currentWasOld = runtime.getSpace("reuse") === oldSpace;
      }
    });

    unwrap(b.loadDocument(makeDocument("B2"), { source: "host" }));

    expect(duplicateCode).toBe(DIAGNOSTIC_CODES.SPACE_ALREADY_EXISTS);
    expect(currentWasOld).toBe(true);
    expect(oldTerminalLifetime).toBe(oldSpace.lifetimeId);
    expect(
      seen.some(
        (event) =>
          event.spaceId === "reuse" &&
          event.lifetimeId === oldSpace.lifetimeId &&
          event.type === "document:changed",
      ),
    ).toBe(false);

    const replacement = unwrap(runtime.createSpace({ id: "reuse", document: makeDocument("new") }));
    expect(replacement.lifetimeId).not.toBe(oldSpace.lifetimeId);
    expect(runtime.getSpace("reuse")).toBe(replacement);
    unwrap(replacement.loadDocument(makeDocument("new loaded"), { source: "host" }));
    expect(
      seen.filter(
        (event) => event.spaceId === "reuse" && event.lifetimeId === replacement.lifetimeId,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      seen.filter(
        (event) =>
          event.spaceId === "reuse" &&
          event.lifetimeId === oldSpace.lifetimeId &&
          event.type === "space:disposed",
      ),
    ).toHaveLength(1);
  });

  it("preserves a queued terminal space event across runtime disposal", () => {
    const { runtime } = createHarness();
    const a = unwrap(runtime.createSpace({ id: "terminal-a", document: makeDocument("A") }));
    const b = unwrap(runtime.createSpace({ id: "terminal-b", document: makeDocument("B") }));
    const seen: Array<{ type: string; spaceId: string }> = [];
    runtime.subscribe((event) => {
      seen.push({ type: event.type, spaceId: event.spaceId });
      if (event.type === "document:changed" && event.spaceId === "terminal-b") {
        unwrap(a.dispose());
        unwrap(runtime.dispose());
      }
    });

    unwrap(b.loadDocument(makeDocument("B2"), { source: "host" }));

    expect(
      seen.filter((event) => event.type === "space:disposed").map((event) => event.spaceId),
    ).toEqual(["terminal-a", "terminal-b"]);
    expect(
      seen.filter((event) => event.spaceId === "terminal-a" && event.type === "space:disposed"),
    ).toHaveLength(1);
    expect(
      seen.filter((event) => event.spaceId === "terminal-b" && event.type === "space:disposed"),
    ).toHaveLength(1);
    expect(runtime.disposed).toBe(true);
  });

  it("stops later runtime listeners when the notifying space is disposed", () => {
    const { runtime } = createHarness();
    const space = unwrap(runtime.createSpace({ id: "inflight-a", document: makeDocument("A") }));
    const seen: Array<{ listener: number; type: string; spaceId: string }> = [];
    runtime.subscribe((event) => {
      seen.push({ listener: 1, type: event.type, spaceId: event.spaceId });
      if (event.type === "document:changed" && event.spaceId === "inflight-a") {
        unwrap(space.dispose());
      }
    });
    runtime.subscribe((event) => {
      seen.push({ listener: 2, type: event.type, spaceId: event.spaceId });
    });

    unwrap(space.loadDocument(makeDocument("A2"), { source: "host" }));

    expect(
      seen.filter(
        (event) =>
          event.listener === 2 && event.spaceId === "inflight-a" && event.type !== "space:disposed",
      ),
    ).toEqual([]);
    expect(
      seen.filter((event) => event.listener === 2 && event.type === "space:disposed"),
    ).toHaveLength(1);
    expect(space.disposed).toBe(true);
    expect(runtime.disposed).toBe(false);
  });

  it("forwards only terminal space events while the runtime is shutting down", () => {
    const { runtime } = createHarness();
    const a = unwrap(runtime.createSpace({ id: "shutdown-a", document: makeDocument("A") }));
    const b = unwrap(runtime.createSpace({ id: "shutdown-b", document: makeDocument("B") }));
    const seen: Array<{ type: string; spaceId: string; runtimeDisposed: boolean }> = [];
    runtime.subscribe((event) => {
      seen.push({
        type: event.type,
        spaceId: event.spaceId,
        runtimeDisposed: runtime.disposed,
      });
      if (event.type === "space:disposed" && event.spaceId === "shutdown-a") {
        unwrap(b.loadDocument(makeDocument("B late"), { source: "host" }));
      }
    });

    unwrap(runtime.dispose());

    expect(runtime.disposed).toBe(true);
    expect(runtime.listenerCount).toBe(0);
    expect(
      seen.filter((event) => event.runtimeDisposed && event.type !== "space:disposed"),
    ).toEqual([]);
    expect(
      seen.filter((event) => event.type === "space:disposed").map((event) => event.spaceId),
    ).toEqual(["shutdown-a", "shutdown-b"]);
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
  });

  it("suppresses pending normal runtime notifications when the runtime is disposed", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "runtime-disposal", document: makeDocument("Initial") }),
    );
    const first: SpaceEvent[] = [];
    const second: SpaceEvent[] = [];
    runtime.subscribe((event) => {
      first.push(event);
      if (event.type === "document:changed" && event.document.title === "Interrupting") {
        space.loadDocument(makeDocument("Queued"), { source: "host" });
        unwrap(runtime.dispose());
      }
    });
    runtime.subscribe((event) => second.push(event));

    space.loadDocument(makeDocument("Interrupting"), { source: "host" });

    expect(runtime.disposed).toBe(true);
    expect(runtime.listenerCount).toBe(0);
    expect(second.every((event) => event.type === "space:disposed")).toBe(true);
    expect(second).toHaveLength(1);
    expect(first.some((event) => event.type === "document:changed")).toBe(true);
    expect(
      second.some(
        (event) => event.type === "document:changed" && event.document.title === "Queued",
      ),
    ).toBe(false);
  });
});
