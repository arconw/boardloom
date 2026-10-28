import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CODES } from "../../../../packages/core/src/index.js";
import { BUILT_IN_BLOCK_TYPES } from "../../../../packages/view-dom/src/built-in-blocks.js";
import {
  createBlockRegistry,
  type BlockSurfaceEnvironment,
  type BlockTypeDefinition,
} from "../../../../packages/view-dom/src/block-registry.js";
import { expectFailure, unwrap } from "../../core/support/assertions.js";

function customDefinition(type = "custom.sample"): BlockTypeDefinition {
  return {
    type,
    version: "1.0.0",
    createSurface(environment: BlockSurfaceEnvironment) {
      const element = environment.createElement("div", "custom-surface");
      return {
        element,
        update(next: BlockSurfaceEnvironment) {
          element.textContent = String(next.block.id);
        },
      };
    },
  };
}

describe("T06 block registry foundation", () => {
  it("registers the built-in text, metric, table, chart and filter surfaces", () => {
    const registry = unwrap(createBlockRegistry(BUILT_IN_BLOCK_TYPES));
    expect(registry.list().map((definition) => definition.type)).toEqual([
      "chart",
      "filter",
      "metric",
      "table",
      "text",
    ]);
    for (const type of ["text", "metric", "table", "chart", "filter"]) {
      expect(registry.has(type), type).toBe(true);
      expect(registry.get(type)?.version).toBe("1.0.0");
    }
    expect(registry.has("prototype")).toBe(false);
    expect(registry.get("constructor")).toBeUndefined();
  });

  it("rejects duplicate stable type IDs with a diagnostic", () => {
    const duplicate = customDefinition("text");
    const result = createBlockRegistry([...BUILT_IN_BLOCK_TYPES, duplicate]);
    expectFailure(result, DIAGNOSTIC_CODES.INVALID_ARGUMENT);
  });

  it("accepts a custom block type without mutating another registry", () => {
    const first = unwrap(createBlockRegistry(BUILT_IN_BLOCK_TYPES));
    const second = unwrap(createBlockRegistry([...BUILT_IN_BLOCK_TYPES, customDefinition()]));
    expect(first.has("custom.sample")).toBe(false);
    expect(second.has("custom.sample")).toBe(true);
    expect(second.get("custom.sample")?.version).toBe("1.0.0");
  });

  it("rejects malformed block definitions instead of registering them", () => {
    for (const definition of [
      { type: "", version: "1.0.0", createSurface: () => ({}) },
      { type: "custom.bad", version: "", createSurface: () => ({}) },
      { type: "custom.bad", version: "1.0.0", createSurface: null },
    ] as unknown as BlockTypeDefinition[]) {
      const registry = unwrap(createBlockRegistry());
      expect(registry.register(definition).ok).toBe(false);
    }
  });
});
