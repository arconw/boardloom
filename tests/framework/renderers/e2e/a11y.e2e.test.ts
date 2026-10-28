import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGalleryHarness, type GalleryHarness } from "./harness.js";

let harness: GalleryHarness;

beforeAll(async () => {
  harness = await startGalleryHarness();
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe("T07 renderer gallery accessibility", () => {
  it("exposes chart images, summaries, data tables and keyboard focus", async () => {
    const result = await harness.run(1440);
    expect(result.errors).toEqual([]);
    expect(result.checks.missingKeys).toEqual([]);
    expect(result.checks.plotImages).toBe(6);
    expect(result.checks.chartSummaries).toBe(6);
    expect(result.checks.chartCaptions).toBe(6);
    expect(Number(result.checks.chartColumnHeaders)).toBeGreaterThanOrEqual(12);
    expect(Number(result.checks.chartRowHeaders)).toBeGreaterThanOrEqual(6);
    expect(String(result.checks.lineAria)).toContain("Line");
    expect(result.checks.summaryFocusable).toBe(true);
    expect(result.checks.detailsOpen).toBe(true);
    expect(result.checks.kpiRole).toBe("group");
    expect(String(result.checks.kpiAria)).toContain("Average revenue");
    expect(result.checks.tableRegionRole).toBe("region");
    expect(result.checks.tableRegionTabIndex).toBe("0");
    expect(String(result.checks.tableCaption)).toBe("Segment table");
    expect(Number(result.checks.invalidAlertRoles)).toBeGreaterThanOrEqual(1);
    expect(result.checks.invalidHasDiagnostic).toBe(true);
  }, 60_000);

  it("does not create page-level horizontal overflow at 360 px", async () => {
    const result = await harness.run(360);
    expect(result.errors).toEqual([]);
    expect(result.checks.noHorizontalOverflow).toBe(true);
    expect(result.checks.missingKeys).toEqual([]);
    expect(result.checks.plotImages).toBe(6);
  }, 60_000);
});
