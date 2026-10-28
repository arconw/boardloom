import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createLocalDatasetProvider,
  createRuntime,
  type DatasetProvider,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";
import {
  ASSESSMENT_DESCRIPTOR,
  ASSESSMENT_ROWS,
  cloneAssessmentDescriptor,
} from "../fixtures/assessment-fixture.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createProvider(descriptor = ASSESSMENT_DESCRIPTOR): DatasetProvider {
  return unwrap(
    createLocalDatasetProvider({
      providerId: "assessment-local",
      datasets: [{ descriptor, rows: ASSESSMENT_ROWS }],
    }),
  );
}

const BASE_QUERY = {
  datasetId: "assessment-results",
  sliceId: "all-results",
  fields: ["school_id", "score"],
} as const;

describe("space-owned query orchestration", () => {
  it("keeps query state and events isolated between spaces", async () => {
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("isolation"),
      datasetProvider: createProvider(),
    });
    const alpha = unwrap(
      runtime.createSpace({ id: "query-alpha", document: makeDocument("Alpha") }),
    );
    const beta = unwrap(runtime.createSpace({ id: "query-beta", document: makeDocument("Beta") }));
    const alphaEvents: SpaceEvent[] = [];
    const betaEvents: SpaceEvent[] = [];
    alpha.subscribe((event) => alphaEvents.push(event));
    beta.subscribe((event) => betaEvents.push(event));

    unwrap(
      alpha.setQuery("shared", {
        ...BASE_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "north" }],
      }),
    );
    unwrap(
      beta.setQuery("shared", {
        ...BASE_QUERY,
        filters: [{ fieldId: "school_id", operator: "equals", value: "east" }],
      }),
    );
    await flush();
    const alphaState = alpha.getQueryState("shared");
    const betaState = beta.getQueryState("shared");
    expect(alphaState?.rows).toHaveLength(3);
    expect(betaState?.rows).toHaveLength(3);
    expect(alphaState?.rows).not.toEqual(betaState?.rows);
    expect(alphaState?.queryKey).not.toBe(betaState?.queryKey);
    expect(alphaEvents.every((event) => event.spaceId === "query-alpha")).toBe(true);
    expect(betaEvents.every((event) => event.spaceId === "query-beta")).toBe(true);
    expect(alpha.getSnapshot().queries).toHaveLength(1);
    expect(beta.getSnapshot().queries).toHaveLength(1);
    unwrap(alpha.dispose());
    expect(alpha.getQueryStates()).toEqual([]);
    expect(beta.getQueryState("shared")?.phase).toBe("settled");
  });

  it("honors a per-space provider override over the runtime default", async () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("override"),
      datasetProvider: createProvider(),
    });
    const truncating = createProvider(
      cloneAssessmentDescriptor({
        capabilities: {
          ...ASSESSMENT_DESCRIPTOR.capabilities,
          maxResultSize: 2,
        },
      }),
    );
    const normal = unwrap(
      runtime.createSpace({ id: "query-normal", document: makeDocument("Normal") }),
    );
    const limited = unwrap(
      runtime.createSpace({
        id: "query-limited",
        document: makeDocument("Limited"),
        datasetProvider: truncating,
      }),
    );
    unwrap(normal.setQuery("rows", BASE_QUERY));
    unwrap(limited.setQuery("rows", BASE_QUERY));
    await flush();
    expect(normal.getQueryState("rows")?.phase).toBe("settled");
    expect(normal.getQueryState("rows")?.rows).toHaveLength(8);
    expect(limited.getQueryState("rows")?.phase).toBe("partial");
    expect(limited.getQueryState("rows")?.rows).toHaveLength(2);
  });

  it("fails with a stable diagnostic when no provider is configured", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("no-provider"),
    });
    const space = unwrap(
      runtime.createSpace({ id: "query-missing", document: makeDocument("Missing") }),
    );
    expectFailure(space.setQuery("rows", BASE_QUERY), DIAGNOSTIC_CODES.QUERY_PROVIDER_MISSING);
    expect(space.getQueryState("rows")).toBeUndefined();
  });

  it("attributes settled events to the triggering operation under listener reentry", async () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("reentry"),
      datasetProvider: createProvider(),
    });
    const space = unwrap(
      runtime.createSpace({ id: "query-reentry", document: makeDocument("Reentry") }),
    );
    const settledEvents: SpaceEvent[] = [];
    let nested = false;
    space.subscribe((event) => {
      if (event.type === "query:settled") {
        settledEvents.push(event);
        if (event.queryId === "first" && !nested) {
          nested = true;
          unwrap(
            space.setQuery("second", {
              ...BASE_QUERY,
              filters: [{ fieldId: "school_id", operator: "equals", value: "south" }],
            }),
          );
        }
      }
    });
    unwrap(space.setQuery("first", BASE_QUERY));
    await flush();
    expect(settledEvents).toHaveLength(2);
    const first = settledEvents[0];
    const second = settledEvents[1];
    expect(first?.type).toBe("query:settled");
    expect(second?.type).toBe("query:settled");
    if (first?.type === "query:settled" && second?.type === "query:settled") {
      expect(first.queryId).toBe("first");
      expect(second.queryId).toBe("second");
      expect(first.requestToken).toBeLessThan(second.requestToken);
      expect(first.queryKey).not.toBe(second.queryKey);
    }
    expect(space.getQueryState("first")?.phase).toBe("settled");
    expect(space.getQueryState("second")?.phase).toBe("settled");
  });
  it("carries a source space provider into an imported target", async () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("import-source-provider"),
    });
    const source = unwrap(
      runtime.createSpace({
        id: "query-source-provider",
        document: makeDocument("Source provider"),
        datasetProvider: createProvider(),
      }),
    );
    const imported = unwrap(
      runtime.importDocument(makeDocument("Imported source provider"), {
        sourceSpaceId: source.id,
      }),
    );
    unwrap(imported.space.setQuery("rows", BASE_QUERY));
    await flush();
    expect(imported.space.getQueryState("rows")?.phase).toBe("settled");
    expect(imported.space.getQueryState("rows")?.rows).toHaveLength(8);
  });

  it("rejects an invalid provider contract at space creation", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("invalid-provider"),
    });
    const invalidProvider = {
      providerId: "",
      listDatasetIds: () => [],
      getDatasetDescriptor: () => undefined,
      query: () => ({ ok: false }),
    } as never;
    expectFailure(
      runtime.createSpace({
        id: "query-invalid-provider",
        document: makeDocument("Invalid provider"),
        datasetProvider: invalidProvider,
      }),
      DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID,
    );
    expect(runtime.spaceCount).toBe(0);
  });

  it("classifies provider accessor failures as provider diagnostics", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("provider-accessor"),
    });
    let reads = 0;
    const provider: Record<string, unknown> = {
      listDatasetIds: () => [],
      getDatasetDescriptor: () => undefined,
      query: () => ({ ok: false }),
    };
    Object.defineProperty(provider, "providerId", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("synthetic provider accessor detail");
      },
    });
    const result = runtime.createSpace({
      id: "query-provider-accessor",
      document: makeDocument("Provider accessor"),
      datasetProvider: provider as never,
    });
    expectFailure(result, DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).not.toBe(DIAGNOSTIC_CODES.FORMATTER_INIT_FAILED);
      expect(result.diagnostics[0]?.message).not.toContain("synthetic provider accessor detail");
    }
    expect(reads).toBe(0);
    expect(runtime.spaceCount).toBe(0);
  });

  it("carries the runtime provider into imported spaces", async () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("import-provider"),
      datasetProvider: createProvider(),
    });
    const imported = unwrap(runtime.importDocument(makeDocument("Imported")));
    unwrap(imported.space.setQuery("rows", BASE_QUERY));
    await flush();
    expect(imported.space.getQueryState("rows")?.phase).toBe("settled");
    expect(imported.space.getQueryState("rows")?.rows).toHaveLength(8);
  });
});
