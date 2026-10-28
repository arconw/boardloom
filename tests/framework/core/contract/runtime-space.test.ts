import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  createRuntime,
  defaultDocumentValidator,
  type BoardSpace,
  type DocumentValidation,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  collectTypes,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

function createHarness() {
  const clock = new FakeClock();
  const logger = createRecordingLogger();
  const ids = createDeterministicIdFactory("contract");
  const runtime = createRuntime({ clock, logger, idFactory: ids });
  return { runtime, clock, logger, ids };
}

describe("runtime and space public contract", () => {
  it("creates a space with an immutable public snapshot", () => {
    const { runtime } = createHarness();
    const space = unwrap(runtime.createSpace({ id: "space-a", document: makeDocument("Alpha") }));

    const snapshot = space.getSnapshot();
    expect(snapshot.spaceId).toBe("space-a");
    expect(snapshot.committedRevision).toBe(1);
    expect(snapshot.draft).toBeNull();
    expect(snapshot.editorLease).toBeNull();
    expect(snapshot.views).toEqual([]);
    expect(snapshot.locale).toBe("en");
    expect(snapshot.timezone).toBe("UTC");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.committedDocument)).toBe(true);
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true);
    expect(Object.isFrozen(snapshot.views)).toBe(true);
    expect(() => {
      (snapshot as { status: string }).status = "paused";
    }).toThrow();
    expect(() => {
      (snapshot.committedDocument as Record<string, unknown>).title = "Mutated";
    }).toThrow();
    expect(space.getSnapshot()).not.toBe(snapshot);
  });

  it("emits ordered immutable lifecycle events through the runtime", () => {
    const { runtime } = createHarness();
    const events: SpaceEvent[] = [];
    const unsubscribe = runtime.subscribe((event) => events.push(event));
    const space = unwrap(
      runtime.createSpace({ id: "space-events", document: makeDocument("Events") }),
    );

    expect(collectTypes(events)).toEqual(["space:created", "space:loaded"]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.every((event) => event.spaceId === "space-events")).toBe(true);
    expect(events.every((event) => Object.isFrozen(event))).toBe(true);

    unwrap(space.dispose());
    expect(collectTypes(events).at(-1)).toBe("space:disposed");
    expect(space.getSnapshot().sequence).toBe(3);
    unsubscribe();
    expect(runtime.listenerCount).toBe(0);
  });

  it("rejects duplicate IDs and invalid initial documents without creating a space", () => {
    const { runtime } = createHarness();
    unwrap(runtime.createSpace({ id: "duplicate", document: makeDocument("One") }));
    expectFailure(
      runtime.createSpace({ id: "duplicate", document: makeDocument("Two") }),
      DIAGNOSTIC_CODES.SPACE_ALREADY_EXISTS,
    );
    expectFailure(
      runtime.createSpace({
        id: "invalid",
        document: { schemaVersion: 1, nested: Number.NaN } as never,
      }),
      DIAGNOSTIC_CODES.DOCUMENT_INVALID,
    );
    expect(runtime.spaceCount).toBe(1);
    expect(runtime.getSpace("invalid")).toBeUndefined();
  });

  it("loads a host document atomically and preserves an existing draft", () => {
    const { runtime, clock } = createHarness();
    const space = unwrap(runtime.createSpace({ id: "loader", document: makeDocument("Original") }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "host-loader" }));
    unwrap(space.updateDraft(lease, makeDocument("Draft", 2)));

    clock.advance(10);
    const loaded = unwrap(space.loadDocument(makeDocument("Host", 3), { source: "host" }));
    expect(loaded.committedRevision).toBe(2);
    expect(loaded.committedDocument.title).toBe("Host");
    expect(loaded.draft?.document.title).toBe("Draft");
    expect(loaded.draft?.dirty).toBe(true);
    expect(loaded.editorLease?.leaseId).toBe(lease.leaseId);
  });

  it("rejects non-plain document containers with actionable paths", () => {
    const { runtime } = createHarness();
    class Sample {
      readonly value = 1;
    }
    for (const value of [
      new Date("2024-01-01T00:00:00Z"),
      new Map([["a", 1]]),
      new Number(1),
      new Sample(),
    ]) {
      const result = runtime.createSpace({
        id: `non-plain-${String(value.constructor.name)}`,
        document: { schemaVersion: 1, value } as never,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.DOCUMENT_INVALID);
        expect(result.diagnostics[0]?.path).toBe("/value");
      }
    }
    const rootResult = runtime.createSpace({
      id: "non-plain-root",
      document: new Date("2024-01-01T00:00:00Z") as never,
    });
    expect(rootResult.ok).toBe(false);
    if (!rootResult.ok) {
      expect(rootResult.diagnostics[0]?.path).toBe("");
    }
    expect(runtime.spaceCount).toBe(0);
  });

  it("rejects accessor, non-enumerable and symbol input without side effects", () => {
    const { runtime } = createHarness();
    let reads = 0;
    const accessorDocument = {
      schemaVersion: 1,
      get title() {
        reads += 1;
        return "Accessor";
      },
    };
    const accessorResult = runtime.createSpace({
      id: "accessor-document",
      document: accessorDocument as never,
    });
    expect(accessorResult.ok).toBe(false);
    if (!accessorResult.ok) {
      expect(accessorResult.diagnostics[0]?.path).toBe("/title");
      expect(accessorResult.diagnostics[0]?.message).toContain("Accessor");
    }
    expect(reads).toBe(0);

    const hiddenDocument = { schemaVersion: 1 };
    Object.defineProperty(hiddenDocument, "hidden", { value: 1, enumerable: false });
    const hiddenResult = runtime.createSpace({
      id: "hidden-document",
      document: hiddenDocument as never,
    });
    expect(hiddenResult.ok).toBe(false);
    if (!hiddenResult.ok) {
      expect(hiddenResult.diagnostics[0]?.path).toBe("/hidden");
    }

    const symbolDocument = { schemaVersion: 1, [Symbol("hidden")]: 1 };
    const symbolResult = runtime.createSpace({
      id: "symbol-document",
      document: symbolDocument as never,
    });
    expect(symbolResult.ok).toBe(false);
    expect(runtime.spaceCount).toBe(0);
  });

  it("preserves own __proto__ data inside a namespaced extension snapshot", () => {
    const { runtime } = createHarness();
    const serialized = JSON.stringify({
      ...makeDocument("Proto"),
      extensions: { "com.example.proto": {} },
    });
    const parsed = JSON.parse(
      serialized.replace(
        '"com.example.proto":{}',
        '"com.example.proto":{"__proto__":{"polluted":true}}',
      ),
    ) as never;
    const space = unwrap(runtime.createSpace({ id: "proto-space", document: parsed }));
    const document = space.getSnapshot().committedDocument as Record<string, unknown>;
    const extensions = document.extensions as Record<string, Record<string, unknown>>;
    const extension = extensions["com.example.proto"];

    expect(extension).toBeDefined();
    expect(Object.hasOwn(extension as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(extension)).toBe(Object.prototype);
    expect((extension as Record<string, unknown>).__proto__).toEqual({ polluted: true });
    expect(Object.isFrozen((extension as Record<string, unknown>).__proto__)).toBe(true);
    expect(Object.isFrozen(extension)).toBe(true);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not mutate a disposed snapshot when commands are rejected", () => {
    const { runtime, clock } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "disposed-stable", document: makeDocument("Stable") }),
    );
    unwrap(space.dispose());
    const before = space.getSnapshot();
    clock.advance(10_000);

    expectFailure(
      space.loadDocument(makeDocument("After dispose")),
      DIAGNOSTIC_CODES.SPACE_DISPOSED,
    );
    expectFailure(space.setLocale({ locale: "ru" }), DIAGNOSTIC_CODES.SPACE_DISPOSED);
    expectFailure(space.pause(), DIAGNOSTIC_CODES.SPACE_DISPOSED);
    expectFailure(space.resume(), DIAGNOSTIC_CODES.SPACE_DISPOSED);
    expectFailure(space.createView(), DIAGNOSTIC_CODES.SPACE_DISPOSED);
    expectFailure(space.acquireEditorLease(), DIAGNOSTIC_CODES.SPACE_DISPOSED);
    expectFailure(
      space.schedule(() => undefined, 1),
      DIAGNOSTIC_CODES.SPACE_DISPOSED,
    );
    expect(unwrap(space.dispose())).toBeUndefined();

    expect(space.getSnapshot()).toEqual(before);
  });

  it("surfaces validator warnings without blocking creation or load", () => {
    const warning = createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "/title", {
      severity: "warning",
      message: "The title uses a legacy form.",
    });
    const validator = (document: unknown): DocumentValidation => {
      const base = defaultDocumentValidator(document);
      if (!base.valid) {
        return base;
      }
      const title =
        typeof document === "object" && document !== null
          ? (document as Record<string, unknown>).title
          : undefined;
      return {
        valid: true,
        diagnostics: Object.freeze(title === "Warned" ? [warning] : []),
      };
    };
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("warnings"),
      documentValidator: validator,
    });
    const events: SpaceEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    const space = unwrap(
      runtime.createSpace({ id: "warned-space", document: makeDocument("Warned") }),
    );

    const loaded = events.find((event) => event.type === "space:loaded");
    expect(loaded?.type).toBe("space:loaded");
    if (loaded?.type === "space:loaded") {
      expect(loaded.warnings.map((diagnostic) => diagnostic.code)).toEqual([
        DIAGNOSTIC_CODES.DOCUMENT_INVALID,
      ]);
    }
    expect(space.getSnapshot().diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      "warning",
    ]);

    unwrap(space.loadDocument(makeDocument("Warned"), { source: "host" }));
    expect(space.getSnapshot().diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "The title uses a legacy form.",
    ]);
  });

  it("rejects an invalid host load and leaves the committed document unchanged", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "invalid-load", document: makeDocument("Stable") }),
    );
    expectFailure(
      space.loadDocument({ schemaVersion: 1, value: Number.NaN } as never, { source: "host" }),
      DIAGNOSTIC_CODES.DOCUMENT_INVALID,
    );
    expect(space.getSnapshot().committedDocument.title).toBe("Stable");
    expect(space.getSnapshot().committedRevision).toBe(1);
  });

  it("pauses and resumes without losing state", () => {
    const { runtime } = createHarness();
    const space = unwrap(runtime.createSpace({ id: "pausable", document: makeDocument("Pause") }));
    const paused = unwrap(space.pause());
    expect(paused.status).toBe("paused");
    expect(unwrap(space.pause()).status).toBe("paused");
    expect(unwrap(space.resume()).status).toBe("active");
    expect(unwrap(space.resume()).status).toBe("active");
    expect(space.getSnapshot().committedDocument.title).toBe("Pause");
  });

  it("schedules cancellable space-owned tasks and disposes them", () => {
    const { runtime, clock } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "scheduler", document: makeDocument("Timers") }),
    );
    const calls: string[] = [];
    const cancel = unwrap(space.schedule(() => calls.push("kept"), 50));
    const cancelCancelled = unwrap(space.schedule(() => calls.push("cancelled"), 100));
    expect(space.taskCount).toBe(2);

    clock.advance(50);
    expect(calls).toEqual(["kept"]);
    expect(space.taskCount).toBe(1);

    cancel();
    cancel();
    expect(space.taskCount).toBe(1);
    cancelCancelled();
    cancelCancelled();
    expect(space.taskCount).toBe(0);
    clock.advance(100);
    expect(calls).toEqual(["kept"]);
    expect(space.taskCount).toBe(0);

    unwrap(space.schedule(() => calls.push("late"), 10));
    unwrap(space.dispose());
    clock.advance(100);
    expect(calls).toEqual(["kept"]);
    expect(space.taskCount).toBe(0);
  });

  it("keeps zero-view spaces alive and makes disposal idempotent", () => {
    const { runtime } = createHarness();
    const space: BoardSpace = unwrap(
      runtime.createSpace({ id: "zero-view", document: makeDocument("Zero") }),
    );
    const view = unwrap(space.createView({ mode: "viewer" }));
    unwrap(view.dispose());
    expect(space.disposed).toBe(false);
    expect(space.viewCount).toBe(0);
    expect(runtime.getSpace("zero-view")).toBe(space);

    const first = space.dispose();
    const second = space.dispose();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(space.disposed).toBe(true);
    expect(space.listenerCount).toBe(0);
    expect(space.getSnapshot().status).toBe("disposed");
    expect(runtime.getSpace("zero-view")).toBeUndefined();
    expectFailure(space.loadDocument(makeDocument("After")), DIAGNOSTIC_CODES.SPACE_DISPOSED);
  });

  it("disposes active views, drafts and timers when the runtime is disposed", () => {
    const { runtime, clock } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "runtime-active", document: makeDocument("Active") }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "active-host" }));
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.updateDraft(makeDocument("Dirty runtime draft")));
    unwrap(space.schedule(() => undefined, 500));
    expect(space.taskCount).toBe(1);

    unwrap(runtime.dispose());
    expect(runtime.spaceCount).toBe(0);
    expect(space.disposed).toBe(true);
    expect(view.disposed).toBe(true);
    expect(space.taskCount).toBe(0);
    expect(space.listenerCount).toBe(0);
    expect(space.getSnapshot().draft).toBeNull();
    clock.advance(5_000);
    expect(space.taskCount).toBe(0);
    expect(space.getSnapshot().status).toBe("disposed");
  });

  it("disposes the runtime idempotently and rejects later creation", () => {
    const { runtime } = createHarness();
    unwrap(runtime.createSpace({ id: "one", document: makeDocument("One") }));
    unwrap(runtime.createSpace({ id: "two", document: makeDocument("Two") }));
    const events: SpaceEvent[] = [];
    runtime.subscribe((event) => events.push(event));

    expect(unwrap(runtime.dispose())).toBeUndefined();
    expect(unwrap(runtime.dispose())).toBeUndefined();
    expect(runtime.disposed).toBe(true);
    expect(runtime.spaceCount).toBe(0);
    expect(runtime.listenerCount).toBe(0);
    expect(collectTypes(events)).toEqual(["space:disposed", "space:disposed"]);
    expectFailure(
      runtime.createSpace({ id: "three", document: makeDocument("Three") }),
      DIAGNOSTIC_CODES.RUNTIME_DISPOSED,
    );
  });

  it("isolates listener failures and records them through the logger", () => {
    const { runtime, logger } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "listeners", document: makeDocument("Listeners") }),
    );
    const received: string[] = [];
    space.subscribe(() => {
      throw new Error("listener failure");
    });
    space.subscribe((event) => received.push(event.type));

    unwrap(space.loadDocument(makeDocument("Loaded"), { source: "host" }));
    expect(received).toEqual(["document:changed", "space:loaded"]);
    expect(logger.errors[0]?.message).toContain("event listener failed");
  });
});
