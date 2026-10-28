import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createRuntime,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

function createRuntimeHarness(prefix: string) {
  const clock = new FakeClock();
  const logger = createRecordingLogger();
  const runtime = createRuntime({
    clock,
    logger,
    idFactory: createDeterministicIdFactory(prefix),
  });
  return { runtime, clock, logger };
}

describe("space isolation under concurrent use", () => {
  it("keeps documents, drafts, leases, locale and events per space", () => {
    const { runtime } = createRuntimeHarness("isolation");
    const alpha = unwrap(runtime.createSpace({ id: "alpha", document: makeDocument("Alpha") }));
    const beta = unwrap(runtime.createSpace({ id: "beta", document: makeDocument("Beta") }));
    const alphaEvents: SpaceEvent[] = [];
    const betaEvents: SpaceEvent[] = [];
    const runtimeEvents: SpaceEvent[] = [];
    alpha.subscribe((event) => alphaEvents.push(event));
    beta.subscribe((event) => betaEvents.push(event));
    runtime.subscribe((event) => runtimeEvents.push(event));

    const alphaLease = unwrap(alpha.acquireEditorLease({ sessionId: "alpha-editor" }));
    const betaLease = unwrap(beta.acquireEditorLease({ sessionId: "beta-editor" }));
    unwrap(alpha.updateDraft(alphaLease, makeDocument("Alpha draft")));
    unwrap(beta.updateDraft(betaLease, makeDocument("Beta draft")));
    unwrap(alpha.setLocale({ locale: "ar", timezone: "Asia/Riyadh" }));
    unwrap(beta.pause());
    unwrap(alpha.loadDocument(makeDocument("Alpha host"), { source: "host" }));

    const alphaSnapshot = alpha.getSnapshot();
    const betaSnapshot = beta.getSnapshot();
    expect(alphaSnapshot.committedDocument.title).toBe("Alpha host");
    expect(alphaSnapshot.draft?.document.title).toBe("Alpha draft");
    expect(alphaSnapshot.locale).toBe("ar");
    expect(alphaSnapshot.timezone).toBe("Asia/Riyadh");
    expect(alphaSnapshot.status).toBe("active");

    expect(betaSnapshot.committedDocument.title).toBe("Beta");
    expect(betaSnapshot.draft?.document.title).toBe("Beta draft");
    expect(betaSnapshot.locale).toBe("en");
    expect(betaSnapshot.timezone).toBe("UTC");
    expect(betaSnapshot.status).toBe("paused");

    expect(alphaEvents.every((event) => event.spaceId === "alpha")).toBe(true);
    expect(betaEvents.every((event) => event.spaceId === "beta")).toBe(true);
    expect(runtimeEvents.some((event) => event.spaceId === "alpha")).toBe(true);
    expect(runtimeEvents.some((event) => event.spaceId === "beta")).toBe(true);
    expect(alphaEvents.some((event) => event.spaceId === "beta")).toBe(false);
    expect(betaEvents.some((event) => event.spaceId === "alpha")).toBe(false);

    const alphaFormatted = alpha.getFormatters().formatDate("2024-01-01T00:00:00Z", {
      timeZone: "UTC",
      month: "long",
    });
    const betaFormatted = beta.getFormatters().formatDate("2024-01-01T00:00:00Z", {
      timeZone: "UTC",
      month: "long",
    });
    expect(alphaFormatted).not.toBe(betaFormatted);

    unwrap(alpha.dispose());
    expect(beta.disposed).toBe(false);
    expect(beta.getSnapshot().draft?.document.title).toBe("Beta draft");
    expectFailure(
      beta.acquireEditorLease({ sessionId: "another" }),
      DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT,
    );

    const alphaEventCount = alphaEvents.length;
    unwrap(beta.loadDocument(makeDocument("Beta host"), { source: "host" }));
    expect(alphaEvents.length).toBe(alphaEventCount);
    expect(beta.getSnapshot().committedDocument.title).toBe("Beta host");
  });

  it("keeps separate runtimes independent with no module-level storage", () => {
    const first = createRuntimeHarness("first");
    const second = createRuntimeHarness("second");
    const firstSpace = unwrap(
      first.runtime.createSpace({ id: "same-id", document: makeDocument("First") }),
    );
    const secondSpace = unwrap(
      second.runtime.createSpace({ id: "same-id", document: makeDocument("Second") }),
    );
    const firstLease = unwrap(firstSpace.acquireEditorLease({ sessionId: "first" }));
    unwrap(firstSpace.updateDraft(firstLease, makeDocument("First draft")));

    expect(firstSpace.getSnapshot().draft?.document.title).toBe("First draft");
    expect(secondSpace.getSnapshot().draft).toBeNull();
    expect(secondSpace.getSnapshot().committedDocument.title).toBe("Second");
    expect(first.runtime.getSpace("same-id")).toBe(firstSpace);
    expect(second.runtime.getSpace("same-id")).toBe(secondSpace);

    unwrap(first.runtime.dispose());
    expect(second.runtime.disposed).toBe(false);
    expect(secondSpace.disposed).toBe(false);
    expect(second.runtime.spaceCount).toBe(1);
  });

  it("does not move subscriptions or state when the visible space changes", () => {
    const { runtime } = createRuntimeHarness("switch");
    const first = unwrap(runtime.createSpace({ id: "view-a", document: makeDocument("A") }));
    const second = unwrap(runtime.createSpace({ id: "view-b", document: makeDocument("B") }));
    const firstEvents: SpaceEvent[] = [];
    const secondEvents: SpaceEvent[] = [];
    first.subscribe((event) => firstEvents.push(event));
    second.subscribe((event) => secondEvents.push(event));

    const firstView = unwrap(first.createView({ mode: "viewer" }));
    const secondView = unwrap(second.createView({ mode: "viewer" }));
    expect(firstView.getSnapshot().spaceId).toBe("view-a");
    expect(secondView.getSnapshot().spaceId).toBe("view-b");

    unwrap(first.loadDocument(makeDocument("A2"), { source: "host" }));
    expect(firstView.getSnapshot().committedRevision).toBe(2);
    expect(secondView.getSnapshot().committedRevision).toBe(1);
    expect(firstEvents.length).toBeGreaterThan(0);
    expect(secondEvents.length).toBe(0);

    unwrap(firstView.dispose());
    expect(secondView.disposed).toBe(false);
    expect(first.disposed).toBe(false);
    expect(second.disposed).toBe(false);
  });
});
