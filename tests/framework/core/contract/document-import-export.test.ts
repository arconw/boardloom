import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  canonicalJson,
  createEmptyBoardDocument,
  createRuntime,
  defaultDocumentValidator,
  serializeBoardDocument,
  type BoardValidationCatalog,
  type JsonObject,
  type SpaceEvent,
  type SpaceSnapshot,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

const completeFixturePath = new URL("../fixtures/board-v1-complete.json", import.meta.url);
const legacyFixturePath = new URL("../fixtures/board-v0-synthetic.json", import.meta.url);

function readFixture(path: URL): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createHarness() {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("import"),
  });
  return { runtime, clock };
}

function findEvent<T extends SpaceEvent["type"]>(
  events: readonly SpaceEvent[],
  type: T,
): Extract<SpaceEvent, { readonly type: T }> | undefined {
  return events.find((event): event is Extract<SpaceEvent, { readonly type: T }> => {
    return event.type === type;
  });
}

function blockIds(document: JsonObject): readonly unknown[] {
  const blocks = document.blocks as Record<string, unknown>[];
  return blocks.map((entry) => entry.id);
}

function catalogFor(
  document: JsonObject,
  blockTypes: readonly string[] = [],
): BoardValidationCatalog {
  const datasets = document.datasets as Record<string, unknown>[];
  const slices = document.slices as Record<string, unknown>[];
  const catalogDatasets: Record<string, unknown> = {};
  for (const dataset of datasets) {
    const datasetId = String(dataset.id);
    const fields = (dataset.fields as Record<string, unknown>[] | undefined) ?? [];
    const providerSlices: Record<string, readonly string[]> = {};
    for (const slice of slices.filter((entry) => entry.datasetId === datasetId)) {
      const fieldIds = (slice.fieldIds as string[] | undefined) ?? [];
      providerSlices[String(slice.id)] = fieldIds;
    }
    catalogDatasets[datasetId] = {
      fields: Object.fromEntries(
        fields.map((field) => [
          String(field.id),
          {
            type: field.type,
            ...(field.role === undefined ? {} : { role: field.role }),
            ...(field.unit === undefined ? {} : { unit: field.unit }),
          },
        ]),
      ),
      slices: providerSlices,
    };
  }
  return { datasets: catalogDatasets, blockTypes } as unknown as BoardValidationCatalog;
}

interface SourceHarness {
  readonly runtime: ReturnType<typeof createHarness>["runtime"];
  readonly source: NonNullable<ReturnType<ReturnType<typeof createHarness>["runtime"]["getSpace"]>>;
  readonly sourceEvents: SpaceEvent[];
  readonly runtimeEvents: SpaceEvent[];
  readonly before: SpaceSnapshot;
  readonly leaseId: string;
}

function createSourceHarness(): SourceHarness {
  const { runtime } = createHarness();
  const fixture = readFixture(completeFixturePath);
  const source = unwrap(runtime.createSpace({ id: "source-space", document: fixture }));
  unwrap(runtime.createSpace({ id: "unrelated-space", document: makeDocument("Unrelated") }));
  unwrap(source.createView());
  const lease = unwrap(source.acquireEditorLease({ sessionId: "source-session" }));
  const draft = clone(fixture);
  draft.title = "Source dirty draft";
  const filters = draft.filters as Record<string, unknown>[];
  if (filters[0]) {
    filters[0].label = "Source filter label";
  }
  unwrap(source.updateDraft(lease, draft));
  const sourceEvents: SpaceEvent[] = [];
  const runtimeEvents: SpaceEvent[] = [];
  source.subscribe((event) => sourceEvents.push(event));
  runtime.subscribe((event) => runtimeEvents.push(event));
  return {
    runtime,
    source,
    sourceEvents,
    runtimeEvents,
    before: source.getSnapshot(),
    leaseId: lease.leaseId,
  };
}

describe("import as a new space", () => {
  it("creates a fresh runtime space and preserves the source document, draft and focus", () => {
    const harness = createSourceHarness();
    const fixture = readFixture(completeFixturePath);
    harness.sourceEvents.length = 0;
    harness.runtimeEvents.length = 0;

    const imported = unwrap(
      harness.runtime.importDocument(readFileSync(completeFixturePath, "utf8"), {
        sourceSpaceId: "source-space",
      }),
    );

    expect(imported.space.id).not.toBe("source-space");
    expect(imported.space.lifetimeId).not.toBe(harness.source.lifetimeId);
    expect(imported.space.disposed).toBe(false);
    expect(harness.runtime.getSpace(imported.space.id)).toBe(imported.space);
    expect(harness.runtime.spaceCount).toBe(3);
    expect(harness.runtime.getSpace("unrelated-space")).toBeDefined();
    expect(imported.document.id).toBe(fixture.id);
    expect(blockIds(imported.document)).toEqual(blockIds(fixture));
    expect(imported.space.getSnapshot().committedDocument).toEqual(fixture);

    expect(harness.source.getSnapshot()).toEqual(harness.before);
    expect(harness.source.getSnapshot().editorLease?.leaseId).toBe(harness.leaseId);
    expect(harness.source.getSnapshot().draft?.document.title).toBe("Source dirty draft");
    expect(harness.sourceEvents).toEqual([]);

    const importedEvent = findEvent(harness.runtimeEvents, "space:imported");
    expect(importedEvent).toBeDefined();
    expect(importedEvent?.spaceId).toBe(imported.space.id);
    expect(importedEvent?.sourceSpaceId).toBe("source-space");
    expect(importedEvent?.documentId).toBe(fixture.id);
    expect(importedEvent?.migration).toBeNull();

    const afterImport = clone(fixture);
    afterImport.title = "After import";
    unwrap(harness.source.loadDocument(afterImport, { source: "host" }));
    expect(harness.sourceEvents.some((event) => event.type === "document:changed")).toBe(true);
  });

  it("returns a published success when an observer disposes the target during creation", () => {
    const { runtime } = createHarness();
    const events: SpaceEvent[] = [];
    let disposedTargetId = "";
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "space:created") {
        disposedTargetId = event.spaceId;
        const target = runtime.getSpace(event.spaceId);
        if (target) {
          unwrap(target.dispose());
        }
      }
    });
    const imported = unwrap(runtime.importDocument(readFileSync(completeFixturePath, "utf8")));
    expect(imported.space.id).toBe(disposedTargetId);
    expect(imported.space.disposed).toBe(true);
    const targetEvents = events.filter((event) => event.spaceId === disposedTargetId);
    expect(targetEvents.map((event) => event.type)).toEqual(["space:created", "space:disposed"]);
  });

  it("allocates a distinct space for each import while preserving the document identity", () => {
    const harness = createSourceHarness();
    const input = readFileSync(completeFixturePath, "utf8");
    const first = unwrap(harness.runtime.importDocument(input, { sourceSpaceId: "source-space" }));
    const second = unwrap(harness.runtime.importDocument(input, { sourceSpaceId: "source-space" }));
    expect(first.space.id).not.toBe(second.space.id);
    expect(first.space.lifetimeId).not.toBe(second.space.lifetimeId);
    expect(first.document.id).toBe(second.document.id);
    expect(harness.source.getSnapshot()).toEqual(harness.before);
  });

  it("migrates a synthetic v0 fixture and emits migration and import events", () => {
    const harness = createSourceHarness();
    harness.sourceEvents.length = 0;
    harness.runtimeEvents.length = 0;

    const migrated = unwrap(
      harness.runtime.importDocument(readFileSync(legacyFixturePath, "utf8"), {
        sourceSpaceId: "source-space",
      }),
    );

    expect(migrated.document.schemaVersion).toBe(1);
    expect(migrated.migration?.migrated).toBe(true);
    expect(migrated.migration?.syntheticSource).toBe(true);
    expect(migrated.migration?.steps).toHaveLength(1);
    expect(migrated.space.id).not.toBe("source-space");

    const migrationEvent = findEvent(harness.runtimeEvents, "document:migrated");
    expect(migrationEvent?.spaceId).toBe(migrated.space.id);
    expect(migrationEvent?.report.fromVersion).toBe(0);

    const importedEvent = findEvent(harness.runtimeEvents, "space:imported");
    expect(importedEvent?.migration?.migrated).toBe(true);
    expect(importedEvent?.warnings.map((warning) => warning.code)).toContain(
      DIAGNOSTIC_CODES.MIGRATION_SYNTHETIC_SOURCE,
    );

    expect(
      migrated.space
        .getSnapshot()
        .diagnostics.some(
          (diagnostic) => diagnostic.code === DIAGNOSTIC_CODES.MIGRATION_SYNTHETIC_SOURCE,
        ),
    ).toBe(true);
    expect(harness.source.getSnapshot()).toEqual(harness.before);
    expect(harness.sourceEvents).toEqual([]);
  });

  it("preserves the provider catalog through import, authoring and export", () => {
    const { runtime } = createHarness();
    const document = readFixture(completeFixturePath);
    const note = (document.blocks as Record<string, unknown>[]).find(
      (entry) => entry.id === "block-note",
    );
    if (!note) {
      throw new Error("Fixture note block is missing");
    }
    note.type = "com.example.note";
    const catalog = catalogFor(document, ["com.example.note"]);

    const withoutCatalog = runtime.importDocument(JSON.stringify(document));
    expect(withoutCatalog.ok).toBe(false);
    if (!withoutCatalog.ok) {
      expect(withoutCatalog.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE,
      );
    }
    expect(runtime.spaceCount).toBe(0);

    const imported = unwrap(runtime.importDocument(JSON.stringify(document), { catalog }));
    const lease = unwrap(imported.space.acquireEditorLease({ sessionId: "catalog-editor" }));
    const updated = clone(document);
    updated.title = "Catalog authoring";
    unwrap(imported.space.updateDraft(lease, updated));
    unwrap(imported.space.applyDraft(lease));
    const exported = unwrap(imported.space.exportDocument());
    expect(exported.document.title).toBe("Catalog authoring");
    expect(
      (exported.document.blocks as Record<string, unknown>[]).find(
        (entry) => entry.id === "block-note",
      )?.type,
    ).toBe("com.example.note");
  });

  it("deduplicates migration and validation warnings in import snapshots and events", () => {
    const harness = createSourceHarness();
    const document = clone(readFixture(completeFixturePath));
    const narrow = (document.layout as Record<string, Record<string, unknown>>).narrow;
    if (!narrow) {
      throw new Error("Fixture narrow layout is missing");
    }
    narrow.placements = (narrow.placements as Record<string, unknown>[]).filter(
      (placement) => placement.blockId !== "block-average-metric",
    );
    harness.runtimeEvents.length = 0;
    const imported = unwrap(
      harness.runtime.importDocument(JSON.stringify(document), {
        sourceSpaceId: "source-space",
      }),
    );
    const fallbackWarnings = imported.space
      .getSnapshot()
      .diagnostics.filter((diagnostic) => diagnostic.code === DIAGNOSTIC_CODES.LAYOUT_FALLBACK);
    expect(fallbackWarnings).toHaveLength(1);
    const loaded = findEvent(harness.runtimeEvents, "space:loaded");
    expect(
      loaded?.warnings.filter((warning) => warning.code === DIAGNOSTIC_CODES.LAYOUT_FALLBACK),
    ).toHaveLength(1);
    const importedEvent = findEvent(harness.runtimeEvents, "space:imported");
    expect(
      importedEvent?.warnings.filter(
        (warning) => warning.code === DIAGNOSTIC_CODES.LAYOUT_FALLBACK,
      ),
    ).toHaveLength(1);
  });

  it("keeps the import event payload tied to the imported document under creation reentry", () => {
    const { runtime } = createHarness();
    const fixture = readFixture(completeFixturePath);
    const events: SpaceEvent[] = [];
    let targetId = "";
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "space:created") {
        targetId = event.spaceId;
        const target = runtime.getSpace(event.spaceId);
        if (target) {
          const substituted = clone(fixture);
          substituted.title = "Substituted";
          unwrap(target.loadDocument(substituted));
        }
      }
    });
    const imported = unwrap(runtime.importDocument(readFixture(completeFixturePath)));
    expect(imported.space.id).toBe(targetId);
    expect(imported.document.id).toBe(fixture.id);
    const importedEvent = events.find(
      (event) => event.type === "space:imported" && event.spaceId === targetId,
    );
    expect(importedEvent?.type).toBe("space:imported");
    if (importedEvent?.type === "space:imported") {
      expect(importedEvent.documentId).toBe(fixture.id);
      expect(importedEvent.schemaVersion).toBe(1);
      expect(importedEvent.migration).toBeNull();
    }
    const loadedEvent = events
      .filter((event) => event.type === "space:loaded" && event.spaceId === targetId)
      .at(-1);
    expect(loadedEvent?.type).toBe("space:loaded");
    if (loadedEvent?.type === "space:loaded") {
      expect(loadedEvent.schemaVersion).toBe(1);
      expect(loadedEvent.warnings.map((warning) => warning.code)).toContain(
        DIAGNOSTIC_CODES.REFERENCE_UNVERIFIED,
      );
    }
    expect(imported.space.getSnapshot().committedDocument.title).toBe("Substituted");
  });

  it("imports without a source space", () => {
    const { runtime } = createHarness();
    const events: SpaceEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    const imported = unwrap(runtime.importDocument(readFileSync(completeFixturePath, "utf8")));
    expect(imported.space.id).toBeTruthy();
    const importedEvent = findEvent(events, "space:imported");
    expect(importedEvent?.sourceSpaceId).toBeUndefined();
  });
});

describe("invalid imports are atomic", () => {
  function expectRejected(
    harness: SourceHarness,
    input: unknown,
    code: string,
    options: Record<string, unknown> = {},
  ): void {
    const spacesBefore = harness.runtime.listSpaces();
    const snapshotBefore = harness.source.getSnapshot();
    harness.sourceEvents.length = 0;
    harness.runtimeEvents.length = 0;

    const result = harness.runtime.importDocument(input, {
      sourceSpaceId: "source-space",
      ...options,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    }
    expect(harness.runtime.listSpaces()).toEqual(spacesBefore);
    expect(harness.source.getSnapshot()).toEqual(snapshotBefore);
    expect(harness.sourceEvents).toEqual([]);

    const failed = findEvent(harness.runtimeEvents, "import:failed");
    expect(failed).toBeDefined();
    expect(failed?.sourceSpaceId).toBe("source-space");
    expect(failed?.scope).toBe("runtime");
    expect(failed?.runtimeId).toBe(harness.runtime.runtimeId);
    expect(failed?.spaceId).toBe("");
    expect(failed?.lifetimeId).toBe("");
    expect(failed?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  }

  it("creates no space for malformed, oversized, duplicate, future or invalid-reference imports", () => {
    const harness = createSourceHarness();
    expectRejected(harness, "{", DIAGNOSTIC_CODES.MALFORMED_JSON);

    const oversized = readFileSync(completeFixturePath, "utf8");
    expectRejected(harness, oversized, DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, { maxBytes: 128 });

    const duplicate = clone(readFixture(completeFixturePath));
    const blocks = duplicate.blocks as Record<string, unknown>[];
    blocks.push(clone(blocks[0] ?? {}));
    expectRejected(harness, JSON.stringify(duplicate), DIAGNOSTIC_CODES.DUPLICATE_ID);

    const future = clone(readFixture(completeFixturePath));
    future.schemaVersion = 2;
    expectRejected(harness, JSON.stringify(future), DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION);

    const invalidReference = clone(readFixture(completeFixturePath));
    const filters = invalidReference.filters as Record<string, unknown>[];
    const target = filters[0]?.target as Record<string, unknown>;
    target.kind = "block";
    target.blockId = "missing-block";
    delete target.groupId;
    expectRejected(harness, JSON.stringify(invalidReference), DIAGNOSTIC_CODES.INVALID_REFERENCE);
  });

  it("rejects inherited provider names without throwing during import", () => {
    const harness = createSourceHarness();
    const document = createEmptyBoardDocument({
      id: "prototype-import",
      title: "Prototype import",
      createdAt: 1,
    }) as unknown as JsonObject;
    document.datasets = [{ id: "ds", fields: [{ id: "toString", type: "number" }] }];
    document.slices = [{ id: "toString", datasetId: "ds", fieldIds: ["toString"] }];
    document.filters = [
      {
        id: "toString",
        field: { datasetId: "ds", fieldId: "toString" },
        operator: "equals",
        defaultValue: 1,
        target: { kind: "board" },
      },
    ];
    const catalog = {
      datasets: { ds: { fields: {}, slices: {} } },
    } as unknown as BoardValidationCatalog;
    expectRejected(harness, JSON.stringify(document), DIAGNOSTIC_CODES.INVALID_REFERENCE, {
      catalog,
    });
  });

  it("uses a distinct runtime sequence domain for repeated import failures", () => {
    const harness = createSourceHarness();
    const sourceSequence = harness.source.getSnapshot().sequence;
    harness.runtimeEvents.length = 0;
    harness.runtime.importDocument("{", { sourceSpaceId: "source-space" });
    harness.runtime.importDocument("}", { sourceSpaceId: "source-space" });
    const failures = harness.runtimeEvents.filter((event) => event.type === "import:failed");
    expect(failures).toHaveLength(2);
    expect(failures.map((event) => event.sequence)).toEqual([1, 2]);
    expect(failures.every((event) => event.spaceId === "" && event.lifetimeId === "")).toBe(true);
    expect(harness.source.getSnapshot().sequence).toBe(sourceSequence);
  });

  it("keeps import failures outside the source lifetime during terminal reentry", () => {
    const harness = createSourceHarness();
    harness.runtimeEvents.length = 0;
    harness.runtime.subscribe((event) => {
      if (event.type === "space:disposed" && event.spaceId === "source-space") {
        harness.runtime.importDocument("{", { sourceSpaceId: "source-space" });
      }
    });
    unwrap(harness.source.dispose());
    const terminal = findEvent(harness.runtimeEvents, "space:disposed");
    const failure = findEvent(harness.runtimeEvents, "import:failed");
    expect(terminal?.spaceId).toBe("source-space");
    expect(failure?.scope).toBe("runtime");
    expect(failure?.spaceId).toBe("");
    expect(failure?.lifetimeId).toBe("");
    expect(failure?.lifetimeId).not.toBe(terminal?.lifetimeId);
  });

  it("reports an unknown source space and still creates no space", () => {
    const harness = createSourceHarness();
    const spacesBefore = harness.runtime.listSpaces();
    harness.runtimeEvents.length = 0;
    const result = harness.runtime.importDocument(readFileSync(completeFixturePath, "utf8"), {
      sourceSpaceId: "missing-source",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.SPACE_NOT_FOUND);
    }
    expect(harness.runtime.listSpaces()).toEqual(spacesBefore);
    const failed = findEvent(harness.runtimeEvents, "import:failed");
    expect(failed?.sourceSpaceId).toBe("missing-source");
  });
});

describe("baseline admission and validation context", () => {
  it("does not let a host validator disable the schema baseline", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("baseline"),
      documentValidator: () => Object.freeze({ valid: true, diagnostics: Object.freeze([]) }),
    });
    const result = runtime.createSpace({
      document: { schemaVersion: 1, title: "Incomplete" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY,
      );
    }
    expect(runtime.spaceCount).toBe(0);
  });

  it("applies a runtime provider catalog to direct create and export", () => {
    const document = readFixture(completeFixturePath);
    const note = (document.blocks as Record<string, unknown>[]).find(
      (entry) => entry.id === "block-note",
    );
    if (!note) {
      throw new Error("Fixture note block is missing");
    }
    note.type = "com.example.note";
    const catalog = catalogFor(document, ["com.example.note"]);
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("catalog-runtime"),
      validationCatalog: catalog,
    });
    const space = unwrap(runtime.createSpace({ document }));
    expect(
      (space.getSnapshot().committedDocument.blocks as Record<string, unknown>[]).find(
        (entry) => entry.id === "block-note",
      )?.type,
    ).toBe("com.example.note");
    expect(unwrap(space.exportDocument()).schemaVersion).toBe(1);
  });

  it("returns diagnostics for prototype-name block types through create and import", () => {
    const document = readFixture(completeFixturePath);
    const chart = (document.blocks as Record<string, unknown>[]).find(
      (entry) => entry.id === "block-score-chart",
    );
    if (!chart) {
      throw new Error("Fixture chart block is missing");
    }
    chart.type = "toString";
    const catalog = catalogFor(document, ["toString"]);

    const withoutCatalog = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("prototype-block"),
    });
    const createResult = withoutCatalog.createSpace({ document });
    expect(createResult.ok).toBe(false);
    if (!createResult.ok) {
      expect(createResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE,
      );
    }
    const importResult = withoutCatalog.importDocument(JSON.stringify(document));
    expect(importResult.ok).toBe(false);
    if (!importResult.ok) {
      expect(importResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE,
      );
    }
    expect(withoutCatalog.spaceCount).toBe(0);

    const withCatalog = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("prototype-block-catalog"),
      validationCatalog: catalog,
    });
    const created = unwrap(withCatalog.createSpace({ document }));
    expect(created.getSnapshot().committedDocument.id).toBe(document.id);
    const imported = unwrap(withCatalog.importDocument(JSON.stringify(document)));
    expect(imported.space.disposed).toBe(false);
  });
});

describe("document:invalid events", () => {
  it("emits a load validation failure without changing committed document or draft", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "invalid-load", document: readFixture(completeFixturePath) }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "invalid-load-editor" }));
    const preservedDraft = clone(readFixture(completeFixturePath));
    preservedDraft.title = "Preserved draft";
    unwrap(space.updateDraft(lease, preservedDraft));
    const before = space.getSnapshot();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));

    const result = space.loadDocument({ schemaVersion: 1, title: "Incomplete" });
    expect(result.ok).toBe(false);
    const invalid = findEvent(events, "document:invalid");
    expect(invalid?.source).toBe("load");
    expect(invalid?.diagnostics.length).toBeGreaterThan(0);

    const after = space.getSnapshot();
    expect(after.committedDocument).toEqual(before.committedDocument);
    expect(after.committedRevision).toBe(before.committedRevision);
    expect(after.draft).toEqual(before.draft);
    expect(after.editorLease?.leaseId).toBe(before.editorLease?.leaseId);
  });

  it("emits an apply validation failure and preserves the rejected draft", () => {
    let rejectApply = false;
    const validator = (document: unknown) => {
      if (
        rejectApply &&
        typeof document === "object" &&
        document !== null &&
        (document as Record<string, unknown>).title === "Apply invalid"
      ) {
        return {
          valid: false,
          diagnostics: Object.freeze([
            {
              code: DIAGNOSTIC_CODES.DOCUMENT_INVALID,
              path: "/title",
              message: "The title is rejected for this test.",
              severity: "error" as const,
            },
          ]),
        };
      }
      return defaultDocumentValidator(document);
    };
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("apply-invalid"),
      documentValidator: validator,
    });
    const space = unwrap(
      runtime.createSpace({ id: "invalid-apply", document: readFixture(completeFixturePath) }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "invalid-apply-editor" }));
    const draft = clone(readFixture(completeFixturePath));
    draft.title = "Apply invalid";
    unwrap(space.updateDraft(lease, draft));
    const before = space.getSnapshot();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    rejectApply = true;

    const result = space.applyDraft(lease);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.DRAFT_INVALID,
      );
    }
    const invalid = findEvent(events, "document:invalid");
    expect(invalid?.source).toBe("apply");
    expect(invalid?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.DRAFT_INVALID,
    );
    const after = space.getSnapshot();
    expect(after.committedDocument).toEqual(before.committedDocument);
    expect(after.committedRevision).toBe(before.committedRevision);
    expect(after.draft).toEqual(before.draft);
  });

  it("keeps the successful load payload tied to its own document under reentry", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "load-reentry", document: makeDocument("Base") }),
    );
    const outer = clone(readFixture(completeFixturePath));
    outer.title = "Outer load";
    const events: SpaceEvent[] = [];
    let reentered = false;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        const nested = clone(readFixture(completeFixturePath));
        nested.title = "Nested";
        unwrap(space.loadDocument(nested));
      }
    });
    unwrap(space.loadDocument(outer));

    const changedTitles = events
      .filter((event) => event.type === "document:changed")
      .map((event) => event.document.title);
    expect(changedTitles).toEqual(["Outer load", "Nested"]);
    const outerChanged = events.find(
      (event) => event.type === "document:changed" && event.document.title === "Outer load",
    );
    expect(outerChanged?.type).toBe("document:changed");
    if (outerChanged?.type === "document:changed") {
      expect(outerChanged.document.id).toBe(outer.id);
    }
  });

  it("keeps the initial creation warnings under creation reentry", () => {
    const { runtime } = createHarness();
    const events: SpaceEvent[] = [];
    let targetId = "";
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "space:created") {
        targetId = event.spaceId;
        const target = runtime.getSpace(event.spaceId);
        if (target) {
          const nestedCreate = clone(readFixture(completeFixturePath));
          nestedCreate.title = "Nested create";
          unwrap(target.loadDocument(nestedCreate));
        }
      }
    });
    const created = unwrap(
      runtime.createSpace({ id: "create-reentry", document: readFixture(completeFixturePath) }),
    );
    expect(created.id).toBe(targetId);
    const loadedEvents = events.filter(
      (event) => event.type === "space:loaded" && event.spaceId === targetId,
    );
    expect(loadedEvents.length).toBeGreaterThanOrEqual(2);
    const outerLoaded = loadedEvents.at(-1);
    expect(outerLoaded?.type).toBe("space:loaded");
    if (outerLoaded?.type === "space:loaded") {
      expect(outerLoaded.warnings.map((warning) => warning.code)).toContain(
        DIAGNOSTIC_CODES.REFERENCE_UNVERIFIED,
      );
    }
    expect(created.getSnapshot().committedDocument.title).toBe("Nested create");
  });

  it("keeps the outer draft notification under a nested draft update", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "draft-update-reentry", document: makeDocument("Base") }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "draft-update" }));
    const events: SpaceEvent[] = [];
    let reentered = false;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        unwrap(space.updateDraft(lease, makeDocument("Nested draft")));
      }
    });
    const outer = clone(readFixture(completeFixturePath));
    outer.title = "Outer draft";
    unwrap(space.updateDraft(lease, outer));
    const changes = events.filter((event) => event.type === "draft:changed");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ revision: 1, canUndo: true, canRedo: false });
    expect(changes[1]).toMatchObject({ revision: 2, canUndo: true, canRedo: false });
  });

  it("keeps undo notification data under a nested draft update", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "draft-undo-reentry", document: makeDocument("Base") }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "draft-undo" }));
    const outer = clone(readFixture(completeFixturePath));
    outer.title = "Undo outer";
    unwrap(space.updateDraft(lease, outer));
    expectFailure(
      space.loadDocument({ schemaVersion: 1, title: "Incomplete" }),
      DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY,
    );
    const events: SpaceEvent[] = [];
    let reentered = false;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        unwrap(space.updateDraft(lease, makeDocument("Nested undo")));
      }
    });
    unwrap(space.undoDraft(lease));
    const changes = events.filter((event) => event.type === "draft:changed");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ revision: 2, canUndo: false, canRedo: true });
    expect(changes[1]).toMatchObject({ revision: 3, canUndo: true, canRedo: false });
  });

  it("keeps redo notification data under a nested draft cancel", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "draft-redo-reentry", document: makeDocument("Base") }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "draft-redo" }));
    const first = clone(readFixture(completeFixturePath));
    first.title = "Redo first";
    unwrap(space.updateDraft(lease, first));
    const second = clone(readFixture(completeFixturePath));
    second.title = "Redo second";
    unwrap(space.updateDraft(lease, second));
    unwrap(space.undoDraft(lease));
    expectFailure(
      space.loadDocument({ schemaVersion: 1, title: "Incomplete" }),
      DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY,
    );
    const events: SpaceEvent[] = [];
    let reentered = false;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        unwrap(space.cancelDraft(lease));
      }
    });
    unwrap(space.redoDraft(lease));
    const changes = events.filter((event) => event.type === "draft:changed");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ revision: 4, canUndo: true, canRedo: false });
  });

  it("keeps the rejected diagnostics when a diagnostics observer reenters", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "invalid-reentry", document: readFixture(completeFixturePath) }),
    );
    const events: SpaceEvent[] = [];
    let reentered = false;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        unwrap(space.loadDocument(readFixture(completeFixturePath)));
      }
    });
    const result = space.loadDocument({ schemaVersion: 1, title: "Incomplete" });
    expect(result.ok).toBe(false);
    const invalidEvents = events.filter((event) => event.type === "document:invalid");
    expect(invalidEvents).toHaveLength(1);
    expect(invalidEvents[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY,
    );
  });

  it("keeps terminal ordering when an observer disposes during document:invalid", () => {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({ id: "invalid-terminal", document: readFixture(completeFixturePath) }),
    );
    const events: SpaceEvent[] = [];
    let disposedAt: SpaceSnapshot | null = null;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "document:invalid") {
        unwrap(space.dispose());
        disposedAt = space.getSnapshot();
      }
    });
    const result = space.loadDocument({ schemaVersion: 1, title: "Incomplete" });
    expect(result.ok).toBe(false);
    expect(disposedAt).not.toBeNull();
    expect(space.getSnapshot()).toEqual(disposedAt);
    expect(events.map((event) => event.type)).toEqual([
      "diagnostics:changed",
      "document:invalid",
      "space:disposed",
    ]);
  });
});

describe("draft conflict payload ownership", () => {
  function runConflict(releaseLease: boolean): void {
    const { runtime } = createHarness();
    const space = unwrap(
      runtime.createSpace({
        id: `conflict-${String(releaseLease)}`,
        document: makeDocument("Base"),
      }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "conflict" }));
    const stale = clone(readFixture(completeFixturePath));
    stale.title = "Stale draft";
    unwrap(space.updateDraft(lease, stale));
    unwrap(space.loadDocument(makeDocument("Advanced"), { source: "host" }));
    const events: SpaceEvent[] = [];
    let reentered = false;
    space.subscribe((event) => {
      events.push(event);
      if (event.type === "diagnostics:changed" && !reentered) {
        reentered = true;
        unwrap(space.loadDocument(makeDocument("Nested conflict"), { source: "host" }));
      }
    });
    const result = releaseLease
      ? space.releaseEditorLease(lease, { decision: "apply" })
      : space.applyDraft(lease);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.REVISION_CONFLICT,
      );
    }
    const conflict = findEvent(events, "draft:conflict");
    expect(conflict).toBeDefined();
    expect(conflict?.expectedRevision).toBe(1);
    expect(conflict?.actualRevision).toBe(2);
    expect(conflict?.diagnostics[0]?.message).toContain("revision is 2");
    expect(space.getSnapshot().committedRevision).toBe(3);
  }

  it("captures the direct-apply conflict revision before diagnostics reentry", () => {
    runConflict(false);
  });

  it("captures the lease-release apply conflict revision before diagnostics reentry", () => {
    runConflict(true);
  });
});

describe("document export", () => {
  it("emits an export event and produces stable runtime-free JSON", () => {
    const harness = createSourceHarness();
    harness.sourceEvents.length = 0;
    const exported = unwrap(harness.source.exportDocument());
    const event = findEvent(harness.sourceEvents, "document:exported");
    expect(event?.schemaVersion).toBe(1);
    expect(event?.document).toEqual(exported.document);

    const reparsed = JSON.parse(exported.canonical) as JsonObject;
    expect(canonicalJson(reparsed)).toBe(exported.canonical);
    const roundTrip = unwrap(serializeBoardDocument(reparsed));
    expect(roundTrip.canonical).toBe(exported.canonical);
    for (const forbidden of [
      "spaceId",
      "lifetimeId",
      "viewId",
      "leaseId",
      "editorLease",
      "committedDocument",
      "draft",
      "views",
    ]) {
      expect(exported.canonical).not.toContain(`"${forbidden}"`);
    }
  });

  it("rejects an incomplete board at create and export admission", () => {
    const { runtime } = createHarness();
    const inline = runtime.createSpace({
      document: { schemaVersion: 1, title: "Incomplete" },
    });
    expect(inline.ok).toBe(false);
    const exported = serializeBoardDocument({ schemaVersion: 1, title: "Incomplete" });
    expect(exported.ok).toBe(false);
  });
});
