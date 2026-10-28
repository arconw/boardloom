import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGalleryHarness, type GalleryHarness } from "./harness.js";

let harness: GalleryHarness;

beforeAll(async () => {
  harness = await startGalleryHarness();
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe("T07 renderer gallery", () => {
  it("renders all built-in renderers, policies and the custom renderer in Chromium", async () => {
    const result = await harness.run(1440);
    expect(result.errors).toEqual([]);
    expect(result.checks.blocks).toBe(9);
    expect(result.checks.charts).toBe(6);
    expect(Number(result.checks.canvases)).toBeGreaterThanOrEqual(6);
    expect(result.checks.chartTables).toBe(6);
    expect(result.checks.plotImages).toBe(6);
    expect(result.checks.chartSummaries).toBe(6);
    expect(result.checks.chartCaptions).toBe(6);
    expect(Number(result.checks.chartColumnHeaders)).toBeGreaterThanOrEqual(12);
    expect(Number(result.checks.chartRowHeaders)).toBeGreaterThanOrEqual(6);
    expect(result.checks.metricValue).toBe("5.2 points");
    expect(String(result.checks.metricLabel)).toContain("Average revenue: 5.2 points");
    expect(Number(result.checks.tableRows)).toBeGreaterThan(0);
    expect(result.checks.tableBlockHeaders).toEqual([
      "Positive revenue (points)",
      "Segment",
      "Revenue (points)",
    ]);
    expect(result.checks.tableRegions).toBeGreaterThanOrEqual(8);
    expect(String(result.checks.timezoneCell)).toContain("Jan 1, 2026");
    expect(result.checks.captionIdsUnique).toBe(true);
    expect(result.checks.tableFocusPreserved).toBe(true);
    expect(result.checks.missingKeys).toEqual([]);
    expect(result.checks.lineState).toBe("settled");
    expect(Number(result.checks.lineNulls)).toBeGreaterThan(0);
    expect(Number(result.checks.barNegatives)).toBeGreaterThan(0);
    expect(result.checks.scatterBaseline).toBe("padded");
    expect(Number(result.checks.scatterNulls)).toBe(1);
    expect(Number(result.checks.scatterPointCount)).toBe(31);
    expect(Number(result.checks.scatterXAxisMin)).toBe(0);
    expect(Number(result.checks.scatterXAxisMax)).toBe(10);
    expect(Number(result.checks.scatterYAxisMin)).toBe(0);
    expect(Number(result.checks.scatterYAxisMax)).toBe(60);
    expect(String(result.checks.scatterSummary)).toContain("31 data points");
    expect(String(result.checks.scatterSummary)).toContain("1 missing value excluded");
    expect(result.checks.donutState).toBe("settled");
    expect(result.checks.donutCategories).toBe("Delta|Beta|Alpha|Gamma");
    expect(result.checks.lineHasZeroBaseline).toBe(true);
    expect(String(result.checks.lineAria)).toContain("Line");
    expect(result.checks.summaryFocusable).toBe(true);
    expect(result.checks.detailsOpen).toBe(true);
    expect(String(result.checks.chartTableFirstRow)).not.toBe("");
    expect(result.checks.lineAltValue).toBe("4 points");

    expect(Number(result.checks.invalidErrors)).toBeGreaterThanOrEqual(1);
    expect(result.checks.invalidHasDiagnostic).toBe(true);
    expect(Number(result.checks.invalidCanvases)).toBe(0);

    expect(result.checks.emptyStates).toBeGreaterThanOrEqual(1);
    expect(Number(result.checks.emptyCanvases)).toBe(0);

    expect(result.checks.customRendered).toBe(1);
    expect(String(result.checks.customText)).toContain("custom renderer");
    expect(Number(result.checks.customUpdates)).toBeGreaterThanOrEqual(1);
    expect(result.checks.customDestroyed).toBe(1);
    expect(Number(result.checks.customCanvases)).toBe(0);
    console.log(
      "EDGE",
      JSON.stringify({
        edgeCharts: result.checks.edgeCharts,
        numericLineState: result.checks.numericLineState,
        numericLineNulls: result.checks.numericLineNulls,
        numericLinePoints: result.checks.numericLinePoints,
        groupedState: result.checks.groupedState,
        groupedNegatives: result.checks.groupedNegatives,
        groupedErrors: result.checks.groupedErrors,
        text: result.checks.numericLineText,
      }),
    );
    expect(result.checks.edgeCharts).toBe(2);
    expect(Number(result.checks.edgeCanvases)).toBeGreaterThanOrEqual(2);
    expect(result.checks.numericLineState).toBe("settled");
    expect(Number(result.checks.numericLineNulls)).toBe(1);
    expect(Number(result.checks.numericLinePoints)).toBe(8);
    expect(String(result.checks.numericLineSummary)).toContain("8 data points");
    expect(String(result.checks.numericLineSummary)).toContain("1 missing value excluded");
    expect(result.checks.groupedState).toBe("settled");
    expect(Number(result.checks.groupedNegatives)).toBeGreaterThan(0);
    expect(Number(result.checks.groupedErrors)).toBe(0);
    expect(result.checks.percentBindingValue).toBe("74%");
    expect(result.checks.percentConfigValue).toBe("74%");
    expect(result.checks.noHorizontalOverflow).toBe(true);
  }, 60_000);

  it("keeps the gallery usable and non-overflowing at 360 px", async () => {
    const result = await harness.run(360);
    expect(result.errors).toEqual([]);
    expect(result.checks.charts).toBe(6);
    expect(Number(result.checks.canvases)).toBeGreaterThanOrEqual(6);
    expect(result.checks.missingKeys).toEqual([]);
    expect(result.checks.noHorizontalOverflow).toBe(true);
  }, 60_000);
});
