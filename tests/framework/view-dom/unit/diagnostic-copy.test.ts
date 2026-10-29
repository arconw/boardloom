import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DICTIONARIES,
  createDiagnostic,
  createMessageProvider,
} from "../../../../packages/core/src/index.js";
import { createViewMessages } from "../../../../packages/view-dom/src/messages.js";
import { renderDiagnosticList } from "../../../../packages/view-dom/src/states.js";
import { createMiniDocument, findByClass, type MiniElement } from "../support/mini-dom.js";

function container(): HTMLElement {
  return createMiniDocument().createElement("div") as unknown as HTMLElement;
}

describe("T17 localized diagnostic detail", () => {
  const messages = createViewMessages({ provider: createMessageProvider({ locale: "ja" }) });

  it("shows localized framework detail from a stable detail key", () => {
    const target = container();
    renderDiagnosticList(target, messages, [
      createDiagnostic("INCOMPATIBLE_BINDING", "blocks/chart/bindings/score", {
        detailKey: "diagnostic.detail.unitConflict",
        detailParams: { unit: "kg", baseUnit: "lb" },
      }),
    ]);
    const detail = findByClass(target as unknown as MiniElement, "bl-diagnostic__detail")[0];
    const expected =
      BUILT_IN_DICTIONARIES.ja["diagnostic.detail.unitConflict"]
        ?.replace("{unit}", "kg")
        .replace("{baseUnit}", "lb") ?? "";
    expect(detail?.textContent).toBe(expected);
    const message = findByClass(target as unknown as MiniElement, "bl-diagnostic__message")[0];
    expect(message?.textContent).toBe(BUILT_IN_DICTIONARIES.ja["diagnostic.INCOMPATIBLE_BINDING"]);
    expect(target.textContent).not.toContain('Unit "kg"');
  });

  it("shows a localized comparison reason from a detail key", () => {
    const target = container();
    renderDiagnosticList(target, messages, [
      createDiagnostic("INCOMPATIBLE_COMPARISON", "comparisons/example/unitPolicy", {
        detailKey: "diagnostic.detail.comparison.unitsIncompatible",
      }),
    ]);
    const detail = findByClass(target as unknown as MiniElement, "bl-diagnostic__detail")[0];
    expect(detail?.textContent).toBe(
      BUILT_IN_DICTIONARIES.ja["diagnostic.detail.comparison.unitsIncompatible"],
    );
    expect(detail?.textContent).not.toBe(
      BUILT_IN_DICTIONARIES.en["diagnostic.detail.comparison.unitsIncompatible"],
    );
  });

  it("uses own-entry-safe defaults for prototype-name diagnostic codes", () => {
    const diagnostic = createDiagnostic("constructor", "host/code", { source: "host" });
    expect(diagnostic.message).toBe("Diagnostic constructor");
    expect(typeof diagnostic.message).toBe("string");
    const target = container();
    renderDiagnosticList(target, messages, [diagnostic]);
    const message = findByClass(target as unknown as MiniElement, "bl-diagnostic__message")[0];
    expect(message?.textContent).toBe("Diagnostic constructor");
    expect(target.textContent).not.toContain("native code");
  });

  it("preserves a host-supplied diagnostic message as detail", () => {
    const target = container();
    renderDiagnosticList(target, messages, [
      createDiagnostic("BLOCK_SURFACE_FAILED", "block/surface", {
        message: "Host plugin failed while drawing",
        source: "host",
      }),
    ]);
    const detail = findByClass(target as unknown as MiniElement, "bl-diagnostic__detail")[0];
    expect(detail?.textContent).toBe("Host plugin failed while drawing");
  });
});
