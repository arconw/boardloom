import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  ok,
  parseBoardDocument,
  validateBoardDocument,
  validateJsonValue,
  type JsonObject,
} from "../../../../packages/core/src/index.js";

const completeFixturePath = new URL("../fixtures/board-v1-complete.json", import.meta.url);
const legacyFixturePath = new URL("../fixtures/board-v0-synthetic.json", import.meta.url);

function readFixture(path: URL): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

describe("safe document parsing", () => {
  it("rejects malformed text and non-object roots with stable codes", () => {
    const malformed = parseBoardDocument("{");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.MALFORMED_JSON);
    }

    const array = parseBoardDocument("[]");
    expect(array.ok).toBe(false);
    if (!array.ok) {
      expect(array.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.DOCUMENT_INVALID);
    }
  });

  it("enforces byte and structural limits before accepting a document", () => {
    const oversized = parseBoardDocument(readFileSync(completeFixturePath, "utf8"), {
      maxBytes: 64,
    });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE);
    }

    const limitedObject = parseBoardDocument(readFixture(completeFixturePath), {
      maxNodes: 6,
    });
    expect(limitedObject.ok).toBe(false);
    if (!limitedObject.ok) {
      expect(limitedObject.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.IMPORT_LIMIT_EXCEEDED);
    }

    const deep = { schemaVersion: 1, value: {} as Record<string, unknown> };
    let cursor = deep.value;
    for (let index = 0; index < 10; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const limitedDepth = parseBoardDocument(deep, { maxDepth: 4 });
    expect(limitedDepth.ok).toBe(false);
    if (!limitedDepth.ok) {
      expect(limitedDepth.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.IMPORT_LIMIT_EXCEEDED);
    }
  });

  it("stops oversized parsed objects and migration output before canonical allocation", () => {
    const repeated = {
      schemaVersion: 1,
      values: Array.from({ length: 1_000 }, () => "x".repeat(1_000)),
    };
    const objectLimited = parseBoardDocument(repeated, { maxBytes: 1_000 });
    expect(objectLimited.ok).toBe(false);
    if (!objectLimited.ok) {
      expect(objectLimited.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE);
    }

    const step = {
      fromVersion: 0,
      toVersion: 1 as const,
      migrate(document: JsonObject) {
        return ok({
          document: {
            ...document,
            schemaVersion: 1,
            payload: "x".repeat(5_000),
          },
          warnings: [],
          preservedFields: [],
          addedFields: ["payload"],
          removedFields: [],
          preservedIds: [],
        });
      },
    };
    const migrationLimited = parseBoardDocument(readFixture(legacyFixturePath), {
      maxBytes: 1_000,
      migrationChain: [step],
    });
    expect(migrationLimited.ok).toBe(false);
    if (!migrationLimited.ok) {
      expect(migrationLimited.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE);
    }
  });

  it("rejects future versions and honors disabled migration", () => {
    const future = readFixture(completeFixturePath);
    future.schemaVersion = 2;
    const futureResult = parseBoardDocument(future);
    expect(futureResult.ok).toBe(false);
    if (!futureResult.ok) {
      expect(futureResult.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION);
    }

    const legacy = parseBoardDocument(readFixture(legacyFixturePath), { allowMigration: false });
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) {
      expect(legacy.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.UNSUPPORTED_SCHEMA_VERSION);
    }
  });

  it("migrates and validates before returning a frozen parsed document", () => {
    const parsed = parseBoardDocument(readFixture(legacyFixturePath));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.document.schemaVersion).toBe(1);
    expect(parsed.value.migration?.migrated).toBe(true);
    expect(Object.isFrozen(parsed.value.document)).toBe(true);
    expect(validateBoardDocument(parsed.value.document).valid).toBe(true);
  });

  it("counts JSON nodes and collection entries before walking large values", () => {
    const nested = { a: [1, 2, 3, 4] };
    const nodeLimited = validateJsonValue(nested, { maxNodes: 3 });
    expect(nodeLimited.valid).toBe(false);
    expect(nodeLimited.issues[0]?.message).toContain("node count");

    const arrayLimited = validateJsonValue({ a: [1, 2, 3] }, { maxArrayLength: 2 });
    expect(arrayLimited.valid).toBe(false);
    expect(arrayLimited.issues[0]?.message).toContain("array");

    const objectLimited = validateJsonValue({ a: 1, b: 2 }, { maxObjectKeys: 1 });
    expect(objectLimited.valid).toBe(false);
    expect(objectLimited.issues[0]?.message).toContain("key count");
  });
});
