import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOARD_MIGRATION_CHAIN,
  DIAGNOSTIC_CODES,
  SYNTHETIC_V0_TO_V1_MIGRATION,
  canonicalJson,
  createEmptyBoardDocument,
  defaultDocumentValidator,
  migrateBoardDocument,
  ok,
  serializeBoardDocument,
  validateBoardDocument,
  type BoardDocumentValidation,
  type BoardValidationCatalog,
  type JsonObject,
} from "../../../../packages/core/src/index.js";

const completeFixturePath = new URL("../fixtures/board-v1-complete.json", import.meta.url);
const legacyFixturePath = new URL("../fixtures/board-v0-synthetic.json", import.meta.url);

function readFixture(path: URL): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function codes(validation: BoardDocumentValidation): readonly string[] {
  return validation.diagnostics.map((diagnostic) => diagnostic.code);
}

function errorCodes(validation: BoardDocumentValidation): readonly string[] {
  return validation.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

function block(document: JsonObject, id: string): Record<string, unknown> {
  const blocks = document.blocks as Record<string, unknown>[];
  const found = blocks.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Missing block ${id}`);
  }
  return found;
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
      providerSlices[String(slice.id)] = (slice.fieldIds as string[] | undefined) ?? [];
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

function withConvertedUnits(document: JsonObject): JsonObject {
  const dataset = (document.datasets as Record<string, unknown>[])[0];
  if (!dataset) {
    throw new Error("Fixture dataset is missing");
  }
  (dataset.fields as Record<string, unknown>[]).push({
    id: "scorePercent",
    type: "number",
    role: "measure",
    unit: "percent",
  });
  for (const slice of document.slices as Record<string, unknown>[]) {
    if (slice.datasetId === dataset.id) {
      (slice.fieldIds as string[]).push("scorePercent");
    }
  }
  const comparison = (document.comparisons as Record<string, unknown>[])[0];
  if (!comparison) {
    throw new Error("Fixture comparison is missing");
  }
  const mapping = comparison.mapping as Record<string, unknown>[];
  const measure = mapping.find((entry) => entry.role === "measure");
  if (!measure) {
    throw new Error("Fixture measure mapping is missing");
  }
  (measure.reference as Record<string, unknown>).fieldId = "scorePercent";
  comparison.unitPolicy = { mode: "explicit", conversions: [] };
  return document;
}

describe("board schema v1 validation", () => {
  it("accepts the complete fixture without errors", () => {
    const validation = validateBoardDocument(readFixture(completeFixturePath));
    expect(validation.schemaVersion).toBe(1);
    expect(errorCodes(validation)).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("rejects malformed roots and unsupported future versions without downgrade", () => {
    const malformed = validateBoardDocument(null);
    expect(malformed.valid).toBe(false);
    expect(errorCodes(malformed)).toContain(DIAGNOSTIC_CODES.DOCUMENT_INVALID);

    const future = clone(readFixture(completeFixturePath));
    future.schemaVersion = 2;
    const futureResult = validateBoardDocument(future);
    expect(futureResult.valid).toBe(false);
    expect(futureResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION);
    expect(futureResult.schemaVersion).toBe(2);
  });

  it("rejects duplicate IDs, overlap, unknown properties and invalid references", () => {
    const duplicate = clone(readFixture(completeFixturePath));
    const blocks = duplicate.blocks as Record<string, unknown>[];
    blocks.push(clone(blocks[0] ?? {}));
    expect(codes(validateBoardDocument(duplicate))).toContain(DIAGNOSTIC_CODES.DUPLICATE_ID);

    const overlap = clone(readFixture(completeFixturePath));
    const layout = overlap.layout as Record<string, Record<string, unknown>>;
    const desktop = layout.desktop as Record<string, unknown>;
    const placements = desktop.placements as Record<string, unknown>[];
    if (placements[1]) {
      placements[1].x = 0;
    }
    expect(codes(validateBoardDocument(overlap))).toContain(DIAGNOSTIC_CODES.LAYOUT_OVERLAP);

    const unknown = clone(readFixture(completeFixturePath));
    unknown.runtimeHandle = { type: "AbortController" };
    expect(codes(validateBoardDocument(unknown))).toContain(DIAGNOSTIC_CODES.UNKNOWN_PROPERTY);

    const nestedUnknown = clone(readFixture(completeFixturePath));
    const chartConfig = block(nestedUnknown, "block-score-chart").config as Record<string, unknown>;
    chartConfig.runtimeHandle = "x";
    expect(codes(validateBoardDocument(nestedUnknown))).toContain(
      DIAGNOSTIC_CODES.UNKNOWN_PROPERTY,
    );

    const badReference = clone(readFixture(completeFixturePath));
    const filters = badReference.filters as Record<string, unknown>[];
    const target = filters[0]?.target as Record<string, unknown>;
    target.blockId = "missing-block";
    target.kind = "block";
    delete target.groupId;
    expect(codes(validateBoardDocument(badReference))).toContain(
      DIAGNOSTIC_CODES.INVALID_REFERENCE,
    );

    const badField = clone(readFixture(completeFixturePath));
    const bindings = block(badField, "block-score-chart").bindings as Record<string, unknown>[];
    const field = bindings[0]?.field as Record<string, unknown>;
    field.fieldId = "missing-field";
    expect(codes(validateBoardDocument(badField))).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);

    const badAggregation = clone(readFixture(completeFixturePath));
    const chartBindings = block(badAggregation, "block-score-chart").bindings as Record<
      string,
      unknown
    >[];
    const scoreField = chartBindings[1]?.field as Record<string, unknown>;
    scoreField.fieldId = "subject";
    const aggregation = chartBindings[1]?.aggregation as Record<string, unknown>;
    aggregation.type = "sum";
    expect(codes(validateBoardDocument(badAggregation))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
    );

    const badTheme = clone(readFixture(completeFixturePath));
    const theme = badTheme.theme as Record<string, unknown>;
    theme.tokens = { "Bad Token": 1 };
    expect(codes(validateBoardDocument(badTheme))).toContain(DIAGNOSTIC_CODES.INVALID_THEME_TOKEN);
  });

  it("rejects unknown block types and non-namespaced extension data", () => {
    const unknownBlock = clone(readFixture(completeFixturePath));
    block(unknownBlock, "block-note").type = "unknown-visual";
    expect(codes(validateBoardDocument(unknownBlock))).toContain(
      DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE,
    );

    const extension = clone(readFixture(completeFixturePath));
    extension.extensions = { unprefixed: { value: 1 } };
    expect(codes(validateBoardDocument(extension))).toContain(
      DIAGNOSTIC_CODES.INVALID_EXTENSION_KEY,
    );
  });

  it("applies the strict schema to full envelopes through the default validator", () => {
    const fixture = readFixture(completeFixturePath);
    expect(defaultDocumentValidator(fixture).valid).toBe(true);
    const withUnknown = clone(fixture);
    withUnknown.runtimeHandle = "x";
    expect(defaultDocumentValidator(withUnknown).valid).toBe(false);
    expect(defaultDocumentValidator({ schemaVersion: 1, title: "Minimal" }).valid).toBe(false);
  });

  it("reports layout fallback as a warning and still accepts the document", () => {
    const fallback = clone(readFixture(completeFixturePath));
    const layout = fallback.layout as Record<string, Record<string, unknown>>;
    const narrow = layout.narrow as Record<string, unknown>;
    const placements = narrow.placements as Record<string, unknown>[];
    narrow.placements = placements.filter(
      (placement) => placement.blockId !== "block-average-metric",
    );
    const validation = validateBoardDocument(fallback);
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: DIAGNOSTIC_CODES.LAYOUT_FALLBACK,
        severity: "warning",
        relatedIds: ["block-average-metric"],
      }),
    );
  });
});

describe("binding, filter and comparison admission", () => {
  it("validates conversion-backed comparisons and alignment keys", () => {
    const missingConversion = withConvertedUnits(clone(readFixture(completeFixturePath)));
    expect(codes(validateBoardDocument(missingConversion))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
    );

    const invalidConversion = withConvertedUnits(clone(readFixture(completeFixturePath)));
    const invalidComparison = (invalidConversion.comparisons as Record<string, unknown>[])[0];
    if (!invalidComparison) {
      throw new Error("Fixture comparison is missing");
    }
    invalidComparison.unitPolicy = {
      mode: "explicit",
      conversions: [
        {
          from: "points",
          to: "percent",
          factor: 1,
          provider: "local.fixture",
        },
      ],
    };
    expect(codes(validateBoardDocument(invalidConversion))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
    );

    const validConversion = withConvertedUnits(clone(readFixture(completeFixturePath)));
    const validComparison = (validConversion.comparisons as Record<string, unknown>[])[0];
    if (!validComparison) {
      throw new Error("Fixture comparison is missing");
    }
    validComparison.unitPolicy = {
      mode: "explicit",
      conversions: [
        {
          from: "points",
          to: "percent",
          factor: 1,
          provider: "local.fixture",
          lossless: true,
        },
      ],
    };
    expect(validateBoardDocument(validConversion).valid).toBe(true);

    const noCapability = catalogFor(validConversion);
    const noCapabilityValidation = validateBoardDocument(validConversion, {
      catalog: noCapability,
    });
    expect(noCapabilityValidation.valid).toBe(true);
    expect(codes(noCapabilityValidation)).toContain(DIAGNOSTIC_CODES.REFERENCE_UNVERIFIED);

    const declaredCapability = {
      ...catalogFor(validConversion),
      conversionProviders: ["local.fixture"],
    } as unknown as BoardValidationCatalog;
    expect(validateBoardDocument(validConversion, { catalog: declaredCapability }).valid).toBe(
      true,
    );

    const missingCapability = {
      ...catalogFor(validConversion),
      conversionProviders: [],
    } as unknown as BoardValidationCatalog;
    const missingCapabilityValidation = validateBoardDocument(validConversion, {
      catalog: missingCapability,
    });
    expect(missingCapabilityValidation.valid).toBe(false);
    expect(codes(missingCapabilityValidation)).toContain(
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
    );

    const badAlignment = clone(readFixture(completeFixturePath));
    const alignmentComparison = (badAlignment.comparisons as Record<string, unknown>[])[0];
    if (!alignmentComparison) {
      throw new Error("Fixture comparison is missing");
    }
    (alignmentComparison.alignment as Record<string, unknown>).keys = ["missing-key"];
    expect(codes(validateBoardDocument(badAlignment))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
    );

    const badWindow = clone(readFixture(completeFixturePath));
    const windowComparison = (badWindow.comparisons as Record<string, unknown>[])[0];
    if (!windowComparison) {
      throw new Error("Fixture comparison is missing");
    }
    const windows = windowComparison.windows as Record<string, Record<string, unknown>>;
    if (windows.primary) {
      windows.primary.start = "2026-02-30";
    }
    expect(codes(validateBoardDocument(badWindow))).toContain(
      DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
    );
  });

  it("enforces scalar filter values and temporal window configuration", () => {
    const scalarArray = clone(readFixture(completeFixturePath));
    const subjectFilter = (scalarArray.filters as Record<string, unknown>[])[0];
    if (!subjectFilter) {
      throw new Error("Fixture filter is missing");
    }
    subjectFilter.field = { datasetId: "assessments", fieldId: "score" };
    subjectFilter.operator = "equals";
    subjectFilter.defaultValue = [1];
    expect(codes(validateBoardDocument(scalarArray))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
    );

    const badTemporalValue = clone(readFixture(completeFixturePath));
    const temporalFilter = (badTemporalValue.filters as Record<string, unknown>[]).find(
      (entry) => entry.id === "filter-submitted",
    );
    if (!temporalFilter) {
      throw new Error("Temporal fixture filter is missing");
    }
    temporalFilter.defaultValue = ["not-a-date", "2026-06-30"];
    expect(codes(validateBoardDocument(badTemporalValue))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
    );

    const badCalendarDate = clone(readFixture(completeFixturePath));
    const calendarFilter = (badCalendarDate.filters as Record<string, unknown>[]).find(
      (entry) => entry.id === "filter-submitted",
    );
    if (!calendarFilter) {
      throw new Error("Temporal fixture filter is missing");
    }
    calendarFilter.defaultValue = ["2026-02-30", "2026-06-30"];
    expect(codes(validateBoardDocument(badCalendarDate))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
    );

    const implicitOffset = clone(readFixture(completeFixturePath));
    const implicitFilter = (implicitOffset.filters as Record<string, unknown>[]).find(
      (entry) => entry.id === "filter-submitted",
    );
    if (!implicitFilter) {
      throw new Error("Temporal fixture filter is missing");
    }
    implicitFilter.defaultValue = ["2026-01-01T00:00:00", "2026-06-30T23:59:59Z"];
    expect(codes(validateBoardDocument(implicitOffset))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
    );

    const missingTemporal = clone(readFixture(completeFixturePath));
    const missingTemporalFilter = (missingTemporal.filters as Record<string, unknown>[]).find(
      (entry) => entry.id === "filter-submitted",
    );
    if (!missingTemporalFilter) {
      throw new Error("Temporal fixture filter is missing");
    }
    delete missingTemporalFilter.temporal;
    expect(codes(validateBoardDocument(missingTemporal))).toContain(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
    );
  });

  it("checks slice identity against the provider catalog without projection fields", () => {
    const document = clone(readFixture(completeFixturePath));
    const slices = document.slices as Record<string, unknown>[];
    const referenceSlice = slices.find((entry) => entry.id === "term-2025");
    if (!referenceSlice) {
      throw new Error("Reference slice is missing");
    }
    delete referenceSlice.fieldIds;
    const catalog = catalogFor(document) as {
      datasets: Record<string, { slices?: Record<string, readonly string[]> }>;
    };
    const assessmentCatalog = catalog.datasets.assessments;
    if (!assessmentCatalog?.slices) {
      throw new Error("Catalog slices are missing");
    }
    delete assessmentCatalog.slices["term-2025"];
    expect(
      codes(
        validateBoardDocument(document, { catalog: catalog as unknown as BoardValidationCatalog }),
      ),
    ).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);

    const mismatched = clone(readFixture(completeFixturePath));
    const mismatchedCatalog = catalogFor(mismatched) as {
      datasets: Record<string, { slices?: Record<string, readonly string[]> }>;
    };
    const mismatchedSlices = mismatchedCatalog.datasets.assessments?.slices;
    if (!mismatchedSlices) {
      throw new Error("Catalog slices are missing");
    }
    mismatchedSlices["term-2025"] = ["subject"];
    expect(
      codes(
        validateBoardDocument(mismatched, {
          catalog: mismatchedCatalog as unknown as BoardValidationCatalog,
        }),
      ),
    ).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);
  });

  it("returns diagnostics for prototype-name block types and admits registered ones", () => {
    const document = clone(readFixture(completeFixturePath));
    block(document, "block-score-chart").type = "toString";
    const unknown = validateBoardDocument(document);
    expect(unknown.valid).toBe(false);
    expect(codes(unknown)).toContain(DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE);

    const registered = validateBoardDocument(document, {
      catalog: catalogFor(document, ["toString"]),
    });
    expect(registered.valid).toBe(true);
  });

  it("does not resolve inherited catalog names as provider entries", () => {
    const document = createEmptyBoardDocument({
      id: "prototype-board",
      title: "Prototype names",
      createdAt: 1,
    }) as unknown as JsonObject;
    document.datasets = [
      {
        id: "ds",
        fields: [{ id: "toString", type: "number" }],
      },
    ];
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
      datasets: {
        ds: {
          fields: {},
          slices: {},
        },
      },
    } as unknown as BoardValidationCatalog;
    const validation = validateBoardDocument(document, { catalog });
    expect(validation.valid).toBe(false);
    expect(codes(validation)).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);
  });
});

describe("canonical serialization", () => {
  it("round-trips deterministically without runtime ownership metadata", () => {
    const fixture = readFixture(completeFixturePath);
    const first = serializeBoardDocument(fixture);
    const second = serializeBoardDocument(clone(fixture));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.value.canonical).toBe(second.value.canonical);
    expect(canonicalJson(JSON.parse(first.value.canonical) as JsonObject)).toBe(
      first.value.canonical,
    );
    expect(JSON.parse(first.value.canonical)).toMatchObject({
      schemaVersion: 1,
      id: "board-assessment-overview",
    });
    for (const forbidden of [
      "spaceId",
      "lifetimeId",
      "viewId",
      "leaseId",
      "editorLease",
      "committedDocument",
      "draft",
      "views",
      "subscribers",
      "subscriptions",
      "abortController",
      "websocket",
    ]) {
      expect(first.value.canonical).not.toContain(`"${forbidden}"`);
    }
  });

  it("rejects lossy or invalid documents on export", () => {
    const fixture = readFixture(completeFixturePath);
    (fixture as Record<string, unknown>).blocks = (
      fixture.blocks as Record<string, unknown>[]
    ).filter((entry) => entry.id !== "block-note");
    const result = serializeBoardDocument(fixture);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
      );
    }
  });
});

describe("migration harness", () => {
  it("migrates the synthetic v0 fixture through a pure step with a report", () => {
    const legacy = readFixture(legacyFixturePath);
    const result = migrateBoardDocument(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.report).toMatchObject({
      fromVersion: 0,
      toVersion: 1,
      migrated: true,
      syntheticSource: true,
    });
    expect(result.value.report.steps).toHaveLength(1);
    expect(result.value.report.steps[0]).toMatchObject({
      fromVersion: 0,
      toVersion: 1,
    });
    expect(result.value.report.steps[0]?.warnings[0]?.code).toBe(
      DIAGNOSTIC_CODES.MIGRATION_SYNTHETIC_SOURCE,
    );
    expect(result.value.report.steps[0]?.addedFields).toContain("layout");
    expect(result.value.report.steps[0]?.addedFields).toContain("theme");
    expect(result.value.report.steps[0]?.preservedIds).toContain("legacy-note");
    expect(result.value.report.steps[0]?.preservedFields).toContain("title");
    expect(validateBoardDocument(result.value.document).valid).toBe(true);
  });

  it("supports multi-step chains and reports every step", () => {
    const secondStep = {
      fromVersion: 1,
      toVersion: 2,
      migrate(document: JsonObject) {
        const next = clone(document);
        next.schemaVersion = 2;
        return ok({
          document: next,
          warnings: [],
          preservedFields: ["id", "title"],
          addedFields: ["schemaVersion"],
          removedFields: [],
          preservedIds: [String(next.id)],
        });
      },
    };
    const result = migrateBoardDocument(readFixture(legacyFixturePath), {
      chain: [...BOARD_MIGRATION_CHAIN, secondStep],
      targetVersion: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.report.steps.map((step) => [step.fromVersion, step.toVersion])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(result.value.report.toVersion).toBe(2);
  });

  it("reports preserved dataset field and binding identifiers", () => {
    const legacy = clone(readFixture(legacyFixturePath));
    legacy.datasets = [
      {
        id: "ds",
        fields: [{ id: "alpha", type: "number" }],
      },
    ];
    legacy.slices = [];
    legacy.blocks = [
      {
        id: "legacy-block",
        type: "text",
        config: { text: "Synthetic" },
        bindings: [{ id: "legacy-binding" }],
      },
    ];
    const result = migrateBoardDocument(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.report.steps[0]?.preservedIds).toContain("alpha");
    expect(result.value.report.steps[0]?.preservedIds).toContain("legacy-binding");
  });

  it("contains malformed, getter-backed, cyclic and oversized step outcomes", () => {
    const legacy = readFixture(legacyFixturePath);
    let getterReads = 0;
    const accessorOutcome = {
      get ok() {
        getterReads += 1;
        return true;
      },
    } as never;
    const accessorResult = migrateBoardDocument(legacy, {
      chain: [
        {
          fromVersion: 0,
          toVersion: 1,
          migrate() {
            return accessorOutcome;
          },
        },
      ],
    });
    expect(accessorResult.ok).toBe(false);
    if (!accessorResult.ok) {
      expect(accessorResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.MIGRATION_FAILED);
    }
    expect(getterReads).toBe(0);

    const cyclicDocument: Record<string, unknown> = { schemaVersion: 1 };
    cyclicDocument.self = cyclicDocument;
    const cyclicResult = migrateBoardDocument(legacy, {
      chain: [
        {
          fromVersion: 0,
          toVersion: 1,
          migrate() {
            return ok({
              document: cyclicDocument as never,
              warnings: [],
              preservedFields: [],
              addedFields: [],
              removedFields: [],
              preservedIds: [],
            });
          },
        },
      ],
    });
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) {
      expect(cyclicResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.MIGRATION_FAILED);
    }

    const oversizedResult = migrateBoardDocument(legacy, {
      maxBytes: 1_000,
      chain: [
        {
          fromVersion: 0,
          toVersion: 1,
          migrate(document: JsonObject) {
            return ok({
              document: { ...document, schemaVersion: 1, payload: "x".repeat(5_000) },
              warnings: [],
              preservedFields: [],
              addedFields: ["payload"],
              removedFields: [],
              preservedIds: [],
            });
          },
        },
      ],
    });
    expect(oversizedResult.ok).toBe(false);
    if (!oversizedResult.ok) {
      expect(oversizedResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE);
    }

    const malformedResult = migrateBoardDocument(legacy, {
      chain: [
        {
          fromVersion: 0,
          toVersion: 1,
          migrate() {
            return ok({
              document: { schemaVersion: 1 },
              warnings: [{ code: "X" } as never],
              preservedFields: [],
              addedFields: [],
              removedFields: [],
              preservedIds: [],
            });
          },
        },
      ],
    });
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.MIGRATION_FAILED);
    }
  });

  it("fails cleanly for missing steps, cycles and future versions", () => {
    const missing = migrateBoardDocument(readFixture(legacyFixturePath), { chain: [] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.MIGRATION_FAILED);
    }

    const cycleStep = {
      fromVersion: 0,
      toVersion: 1,
      migrate(document: JsonObject) {
        return SYNTHETIC_V0_TO_V1_MIGRATION.migrate(document, {
          clock: { now: () => 1, setTimeout: () => 1, clearTimeout: () => undefined },
          idFactory: { createId: (namespace: string) => `${namespace}-1` },
        });
      },
    };
    const cyclic = migrateBoardDocument(readFixture(legacyFixturePath), {
      chain: [cycleStep, { ...cycleStep, fromVersion: 1, toVersion: 0 }],
      targetVersion: 2,
    });
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) {
      expect(cyclic.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.MIGRATION_FAILED);
    }

    const future = clone(readFixture(completeFixturePath));
    future.schemaVersion = 9;
    const futureResult = migrateBoardDocument(future);
    expect(futureResult.ok).toBe(false);
    if (!futureResult.ok) {
      expect(futureResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION);
    }
  });
});
