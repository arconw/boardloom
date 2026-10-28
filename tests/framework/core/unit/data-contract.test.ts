import { describe, expect, it } from "vitest";
import {
  DATA_CONTRACT_VERSION,
  DIAGNOSTIC_CODES,
  describeDataContract,
  isTemporalField,
  isTemporalValue,
  createBoardValidationCatalog,
  createEmptyBoardDocument,
  validateBoardDocument,
  validateDatasetDescriptor,
  validateDatasetProviderContract,
} from "../../../../packages/core/src/index.js";
import {
  ASSESSMENT_DESCRIPTOR,
  cloneAssessmentDescriptor,
} from "../fixtures/assessment-fixture.js";

function diagnosticsOf(value: unknown): readonly string[] {
  return validateDatasetDescriptor(value).diagnostics.map((diagnostic) => diagnostic.code);
}

describe("dataset descriptor contract", () => {
  it("accepts and freezes the deterministic assessment descriptor", () => {
    const validation = validateDatasetDescriptor(ASSESSMENT_DESCRIPTOR);
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics).toEqual([]);
    const descriptor = validation.descriptor;
    expect(descriptor?.id).toBe("assessment-results");
    expect(descriptor?.version).toBe("2026.1");
    expect(descriptor?.timezone).toBe("UTC");
    expect(descriptor?.capabilities.maxResultSize).toBeNull();
    expect(descriptor?.fields.find((field) => field.id === "score")?.unit?.unit).toBe("points");
    expect(descriptor?.fields.find((field) => field.id === "attendance_rate")?.unit?.scale).toBe(
      100,
    );
    expect(
      descriptor?.fields.find((field) => field.id === "submitted_at")?.temporalRepresentation,
    ).toBe("iso8601-offset");
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor?.fields)).toBe(true);
    expect(Object.isFrozen(descriptor?.fields[0])).toBe(true);
    expect(describeDataContract().version).toBe(DATA_CONTRACT_VERSION);
  });

  it("rejects duplicate field identity, keys and slices", () => {
    const duplicateField = cloneAssessmentDescriptor({
      fields: [
        ASSESSMENT_DESCRIPTOR.fields[0]!,
        { ...ASSESSMENT_DESCRIPTOR.fields[1]!, id: "student_id", key: "school_id" },
      ],
    });
    expect(diagnosticsOf(duplicateField)).toContain(DIAGNOSTIC_CODES.DUPLICATE_ID);

    const duplicateKey = cloneAssessmentDescriptor({
      fields: [
        ASSESSMENT_DESCRIPTOR.fields[0]!,
        { ...ASSESSMENT_DESCRIPTOR.fields[1]!, key: "student_id" },
      ],
    });
    expect(diagnosticsOf(duplicateKey)).toContain(DIAGNOSTIC_CODES.DUPLICATE_ID);

    const duplicateSlice = cloneAssessmentDescriptor({
      slices: [ASSESSMENT_DESCRIPTOR.slices[0]!, ASSESSMENT_DESCRIPTOR.slices[0]!],
    });
    expect(diagnosticsOf(duplicateSlice)).toContain(DIAGNOSTIC_CODES.DUPLICATE_ID);
  });

  it("rejects invalid timezones, temporal roles and representations", () => {
    const timezone = cloneAssessmentDescriptor({ timezone: "Not/AZone" });
    expect(diagnosticsOf(timezone)).toContain(DIAGNOSTIC_CODES.INVALID_TIMEZONE);

    const fieldTimezone = cloneAssessmentDescriptor({
      fields: [
        ASSESSMENT_DESCRIPTOR.fields[0]!,
        { ...ASSESSMENT_DESCRIPTOR.fields[1]!, timezone: "Not/AZone" },
      ],
    });
    expect(diagnosticsOf(fieldTimezone)).toContain(DIAGNOSTIC_CODES.INVALID_TIMEZONE);

    const temporalRole = cloneAssessmentDescriptor({
      fields: [
        ASSESSMENT_DESCRIPTOR.fields[0]!,
        { ...ASSESSMENT_DESCRIPTOR.fields[0]!, id: "bad-temporal", key: "bad", role: "temporal" },
      ],
    });
    expect(diagnosticsOf(temporalRole)).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);

    const representation = cloneAssessmentDescriptor({
      temporalRepresentation: "local-time" as never,
    });
    expect(diagnosticsOf(representation)).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);
  });

  it("rejects unsupported capabilities, slices and malformed units", () => {
    const capabilities = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        grouping: "yes" as never,
        maxResultSize: 0,
      },
    });
    expect(diagnosticsOf(capabilities)).toContain(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID);

    const unsupportedAggregation = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        aggregations: ["mode", "mode"] as never,
      },
    });
    expect(diagnosticsOf(unsupportedAggregation)).toContain(DIAGNOSTIC_CODES.DUPLICATE_ID);

    const slice = cloneAssessmentDescriptor({
      slices: [
        {
          id: "broken",
          datasetId: "another-dataset",
          fieldIds: ["missing-field"],
          supportedOperations: ["teleport" as never],
        },
      ],
    });
    const sliceCodes = diagnosticsOf(slice);
    expect(sliceCodes).toContain(DIAGNOSTIC_CODES.INVALID_REFERENCE);
    expect(sliceCodes).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);

    const unit = cloneAssessmentDescriptor({
      fields: [
        ASSESSMENT_DESCRIPTOR.fields[0]!,
        {
          ...ASSESSMENT_DESCRIPTOR.fields[1]!,
          unit: { unit: "", scale: 0 },
        },
      ],
    });
    const unitCodes = diagnosticsOf(unit);
    expect(unitCodes).toContain(DIAGNOSTIC_CODES.MISSING_ID);
    expect(unitCodes).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);
  });

  it("validates slice parameters schemas as JSON objects", () => {
    const stringSchema = cloneAssessmentDescriptor({
      slices: [
        {
          id: "parameterized",
          datasetId: "assessment-results",
          parametersSchema: "not-an-object" as never,
        },
      ],
    });
    const stringValidation = validateDatasetDescriptor(stringSchema);
    expect(stringValidation.valid).toBe(false);
    expect(
      stringValidation.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID &&
          diagnostic.path.endsWith("/parametersSchema"),
      ),
    ).toBe(true);

    const arraySchema = cloneAssessmentDescriptor({
      slices: [
        {
          id: "parameterized",
          datasetId: "assessment-results",
          parametersSchema: [] as never,
        },
      ],
    });
    expect(diagnosticsOf(arraySchema)).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);

    const objectSchema = cloneAssessmentDescriptor({
      slices: [
        {
          id: "parameterized",
          datasetId: "assessment-results",
          parametersSchema: {
            type: "object",
            properties: { term: { type: "string" } },
          },
        },
      ],
    });
    expect(validateDatasetDescriptor(objectSchema).valid).toBe(true);
  });

  it("rejects sparse descriptor collections before validation", () => {
    const sparseFieldIds = new Array(2) as unknown[];
    sparseFieldIds[1] = "score";
    const sparseSlice = cloneAssessmentDescriptor({
      slices: [
        {
          id: "sparse",
          datasetId: "assessment-results",
          fieldIds: sparseFieldIds as never,
        },
      ],
    });
    expect(diagnosticsOf(sparseSlice)).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);

    const sparseFields = new Array(2) as unknown[];
    sparseFields[1] = ASSESSMENT_DESCRIPTOR.fields[0];
    const sparseFieldCollection = cloneAssessmentDescriptor({
      fields: sparseFields as never,
    });
    expect(diagnosticsOf(sparseFieldCollection)).toContain(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
    );
  });

  it("rejects accessors and non-JSON descriptor containers without executing them", () => {
    let reads = 0;
    const hostile = {
      ...ASSESSMENT_DESCRIPTOR,
      get id() {
        reads += 1;
        return "assessment-results";
      },
    };
    const codes = diagnosticsOf(hostile);
    expect(codes).toContain(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID);
    expect(reads).toBe(0);
  });

  it("checks provider shape through own properties only", () => {
    const inherited = Object.create({
      providerId: "inherited",
      listDatasetIds: () => [],
      getDatasetDescriptor: () => undefined,
      query: () => ({ ok: false }),
    });
    const inheritedResult = validateDatasetProviderContract(inherited);
    expect(inheritedResult.valid).toBe(false);
    expect(inheritedResult.diagnostics.map((entry) => entry.code)).toContain(
      DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID,
    );
    expect(
      validateDatasetProviderContract({
        providerId: "safe",
        listDatasetIds: () => [],
        getDatasetDescriptor: () => undefined,
        query: () => ({ ok: false }),
        toString: () => "not a provider member",
      }).valid,
    ).toBe(true);
    expect(validateDatasetProviderContract(null).valid).toBe(false);
  });

  it("keeps prototype-name field and slice identifiers own-entry safe", () => {
    const descriptor = cloneAssessmentDescriptor({
      fields: [
        {
          id: "__proto__",
          key: "toString",
          type: "string",
          role: "dimension",
          nullable: false,
        },
        {
          id: "constructor",
          key: "__proto__",
          type: "number",
          role: "measure",
          nullable: true,
        },
      ],
      slices: [
        {
          id: "toString",
          datasetId: "assessment-results",
          fieldIds: ["__proto__", "constructor"],
        },
      ],
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        aggregations: ["count"],
        filterOperators: ["equals"],
      },
    });
    const validation = validateDatasetDescriptor(descriptor);
    expect(validation.valid).toBe(true);
    expect(validation.descriptor?.fields.map((field) => field.id)).toEqual([
      "__proto__",
      "constructor",
    ]);
    expect(validation.descriptor?.slices[0]?.id).toBe("toString");
  });

  it("adapts data descriptors to the T03 board validation catalog", () => {
    const catalog = createBoardValidationCatalog([ASSESSMENT_DESCRIPTOR]);
    const providerDataset = catalog.datasets[ASSESSMENT_DESCRIPTOR.id];
    expect(providerDataset?.fields?.submitted_at?.role).toBe("dimension");
    expect(providerDataset?.fields?.score?.unit).toBe("points");
    expect(providerDataset?.fields?.submitted_at?.timezone).toBe("UTC");
    expect(providerDataset?.fields?.school_id?.operators).toContain("in");
    expect(providerDataset?.slices?.["all-results"]).toContain("score");

    const document = {
      ...createEmptyBoardDocument({
        id: "catalog-board",
        title: "Catalog board",
        createdAt: 1_700_000_000_000,
      }),
      datasets: [{ id: ASSESSMENT_DESCRIPTOR.id }],
      slices: [{ id: "all-results", datasetId: ASSESSMENT_DESCRIPTOR.id }],
    };
    const validation = validateBoardDocument(document, { catalog });
    expect(validation.valid).toBe(true);

    const prototypeCatalog = createBoardValidationCatalog([
      cloneAssessmentDescriptor({
        fields: [
          {
            id: "__proto__",
            key: "toString",
            type: "string",
            role: "dimension",
            nullable: false,
          },
        ],
        slices: [
          {
            id: "toString",
            datasetId: "assessment-results",
            fieldIds: ["__proto__"],
          },
        ],
      }),
    ]);
    expect(
      Object.hasOwn(prototypeCatalog.datasets[ASSESSMENT_DESCRIPTOR.id]?.fields ?? {}, "__proto__"),
    ).toBe(true);
  });

  it("validates provider contracts without executing accessors", () => {
    let providerReads = 0;
    const provider: Record<string, unknown> = {
      listDatasetIds: () => [],
      getDatasetDescriptor: () => undefined,
      query: () => ({ ok: false }),
    };
    Object.defineProperty(provider, "providerId", {
      enumerable: true,
      get() {
        providerReads += 1;
        throw new Error("provider accessor must not execute");
      },
    });
    const providerResult = validateDatasetProviderContract(provider);
    expect(providerResult.valid).toBe(false);
    expect(providerResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID,
    );
    expect(providerReads).toBe(0);

    let methodReads = 0;
    const methodProvider: Record<string, unknown> = {
      providerId: "accessor-method",
      listDatasetIds: () => [],
      getDatasetDescriptor: () => undefined,
    };
    Object.defineProperty(methodProvider, "query", {
      enumerable: true,
      get() {
        methodReads += 1;
        throw new Error("method accessor must not execute");
      },
    });
    const methodResult = validateDatasetProviderContract(methodProvider);
    expect(methodResult.valid).toBe(false);
    expect(methodResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID,
    );
    expect(methodReads).toBe(0);
  });

  it("describes temporal field and value helpers without local-time assumptions", () => {
    const temporal = ASSESSMENT_DESCRIPTOR.fields.find((field) => field.id === "submitted_at");
    const measure = ASSESSMENT_DESCRIPTOR.fields.find((field) => field.id === "score");
    expect(temporal && isTemporalField(temporal)).toBe(true);
    expect(measure && isTemporalField(measure)).toBe(false);
    expect(isTemporalValue("2026-10-01T00:30:00Z", "iso8601-offset")).toBe(true);
    expect(isTemporalValue("2026-10-01", "iso8601-offset")).toBe(true);
    expect(isTemporalValue("2026-10-01T00:30:00", "iso8601-offset")).toBe(false);
    expect(isTemporalValue(1_790_000_000_000, "epoch-milliseconds")).toBe(true);
    expect(isTemporalValue(Number.NaN, "epoch-milliseconds")).toBe(false);
  });
});
