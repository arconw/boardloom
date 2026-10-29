import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENGLISH_MESSAGES, createMessageProvider } from "../../../../packages/core/src/index.js";
import { createViewMessages } from "../../../../packages/view-dom/src/index.js";

const root = process.cwd();

interface Catalog {
  readonly keys: ReadonlyArray<{
    readonly key: string;
    readonly english: string;
  }>;
}

describe("T06 English UI message foundation", () => {
  const catalog = JSON.parse(
    readFileSync(path.join(root, "docs/design/message-keys.json"), "utf8"),
  ) as Catalog;

  it("publishes every proposed UI key with the approved English text", () => {
    for (const entry of catalog.keys) {
      expect(ENGLISH_MESSAGES[entry.key], entry.key).toBe(entry.english);
    }
  });

  it("keeps all shell state and accessible-name keys available through the provider", () => {
    const provider = createMessageProvider({ locale: "en" });
    for (const key of [
      "state.loading.title",
      "state.empty.title",
      "state.error.title",
      "state.stale.title",
      "state.partial.title",
      "state.cancelled.title",
      "viewer.meta.historical",
      "viewer.filters.origin.group",
      "viewer.diagnostics.summary.other",
      "a11y.skipToContent",
      "a11y.boardRegion",
      "a11y.modeNavigation",
      "a11y.filterRegion",
      "a11y.liveRegion",
    ]) {
      expect(provider.has(key), key).toBe(true);
    }
    expect(provider.format("viewer.filters.origin.group", { name: "Middle school" }).text).toBe(
      "Group: Middle school",
    );
    expect(provider.plural("viewer.diagnostics.summary", 2).text).toBe("2 data warnings");
  });

  it("keeps runtime host plural entries ahead of built-in forms when the view overrides only other", () => {
    const messages = createViewMessages({
      provider: createMessageProvider({
        locale: "ru",
        dictionaries: { ru: { "p.items.one": "HOST_ONE", "p.items.other": "HOST_OTHER" } },
      }),
      overrides: { "p.items.other": "VIEW_OTHER" },
    });
    expect(messages.plural("p.items", 1)).toBe("HOST_ONE");
    expect(messages.plural("p.items", 5)).toBe("VIEW_OTHER");
  });
});
