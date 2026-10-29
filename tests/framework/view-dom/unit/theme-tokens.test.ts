import { describe, expect, it } from "vitest";
import { themeTokenProperty } from "../../../../packages/view-dom/src/theme-tokens.js";

describe("T06 document theme token mapping", () => {
  it("maps semantic, family and explicit token names to scoped custom properties", () => {
    expect(themeTokenProperty("accent")).toBe("--bl-color-accent");
    expect(themeTokenProperty("surface-raised")).toBe("--bl-color-surface-raised");
    expect(themeTokenProperty("font-sans")).toBe("--bl-font-sans");
    expect(themeTokenProperty("space-4")).toBe("--bl-space-4");
    expect(themeTokenProperty("chart-series-1")).toBe("--bl-chart-series-1");
    expect(themeTokenProperty("bl-color-focus")).toBe("--bl-color-focus");
    expect(themeTokenProperty("--bl-color-focus")).toBe("--bl-color-focus");
    expect(themeTokenProperty("ext.brand-color")).toBe("--bl-ext-brand-color");
  });
});
