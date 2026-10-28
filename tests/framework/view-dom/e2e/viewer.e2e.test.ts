import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface E2eResult {
  readonly checks: Record<string, unknown>;
  readonly errors: readonly string[];
}

const root = process.cwd();
const e2eRoot = path.join(root, "tests", "framework", "view-dom", "e2e");
const buildRoot = path.join(root, ".tmp", "build", "packages");
const tempRoot = path.join(root, ".tmp", "T06", "e2e");
let server: Server;
let port = 0;
let chromePath = "";
let scenarioSequence = 0;

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ].filter((value): value is string => typeof value === "string" && value !== "");
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      return candidate;
    }
    const found = spawnSync("which", [candidate], { encoding: "utf8" });
    if (found.status === 0) {
      return found.stdout.trim();
    }
  }
  throw new Error("A Chromium browser is required for the T06 viewer E2E check.");
}

function contentType(file: string): string {
  if (file.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (file.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (file.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (file.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function resolveRequestPath(requestPath: string): string | null {
  if (requestPath === "/" || requestPath === "/page.html") {
    return path.join(e2eRoot, "page.html");
  }
  if (requestPath === "/page.js") {
    return path.join(e2eRoot, "page.js");
  }
  if (requestPath.startsWith("/build/")) {
    const resolved = path.resolve(buildRoot, requestPath.slice("/build/".length));
    return resolved.startsWith(`${buildRoot}${path.sep}`) ? resolved : null;
  }
  return null;
}

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function runChrome(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      chromePath,
      [...args],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          XDG_CACHE_HOME: path.join(tempRoot, "xdg-cache"),
          XDG_CONFIG_HOME: path.join(tempRoot, "xdg-cache"),
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function runScenario(width: number): Promise<E2eResult> {
  scenarioSequence += 1;
  const profile = path.join(tempRoot, `profile-${width}-${scenarioSequence}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(path.join(tempRoot, "xdg-cache"), { recursive: true });
  try {
    const stdout = await runChrome([
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--window-size=${width},900`,
      "--virtual-time-budget=5000",
      "--dump-dom",
      `http://127.0.0.1:${port}/page.html`,
    ]);
    const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    if (!match || match[1] === undefined || match[1].trim() === "") {
      throw new Error("The viewer E2E page did not produce a result.");
    }
    return JSON.parse(decodeHtml(match[1])) as E2eResult;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/build-package.mjs", "core"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync(process.execPath, ["scripts/build-package.mjs", "view-dom"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  chromePath = findChrome();
  mkdirSync(tempRoot, { recursive: true });
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const file = resolveRequestPath(url.pathname);
    if (file === null) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    try {
      const content = readFileSync(file);
      response.statusCode = 200;
      response.setHeader("content-type", contentType(file));
      response.end(content);
    } catch {
      response.statusCode = 404;
      response.end("not found");
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        resolve();
        return;
      }
      port = address.port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("T06 browser viewer", () => {
  it("mounts, updates, switches mode and disposes a real viewer instance", async () => {
    const result = await runScenario(1440);
    expect(result.errors).toEqual([]);
    expect(result.checks.blocks).toBe(5);
    expect(result.checks.loading).toBe(0);
    expect(Number(result.checks.settled)).toBeGreaterThanOrEqual(3);
    expect(String(result.checks.metricValue)).not.toBe("");
    expect(Number(result.checks.tableRows)).toBeGreaterThan(0);
    expect(result.checks.tableRegions).toBe(2);
    expect(Number(result.checks.gridRowStart)).toBe(5);
    expect(String(result.checks.gridRowEnd)).toMatch(/^(9|span 4)$/);
    expect(result.checks.dirBefore).toBe("ltr");
    expect(result.checks.hostDirBefore).toBeNull();
    expect(result.checks.skipTarget).toBe(`#${String(result.checks.bodyId)}`);
    expect(result.checks.headerRole).toBe("banner");
    expect(result.checks.bodyRole).toBe("region");
    expect(result.checks.statusRole).toBe("status");
    expect(result.checks.modeGroupRole).toBe("group");
    expect(result.checks.breakpoint).toBe("desktop");
    expect(Number(result.checks.scrollWidth)).toBeLessThanOrEqual(Number(result.checks.innerWidth));
    expect(result.checks.missingKeys).toEqual([]);
    const filterUi = result.checks.filterUi as {
      readonly item: boolean;
      readonly control: boolean;
      readonly chip: string | null;
      readonly resetButtons: number;
    };
    expect(filterUi).toMatchObject({ item: true, control: true });
    expect(filterUi.chip).toContain("north, south");
    expect(filterUi.resetButtons).toBeGreaterThanOrEqual(2);
    expect(result.checks.filterActive).toMatchObject({
      state: [{ filterId: "filter-school", value: ["east"] }],
      chip: "east",
    });
    expect(Number((result.checks.filterActive as { tableRows?: number }).tableRows)).toBe(1);
    expect(result.checks.filterReset).toEqual({
      state: [],
      chip: "north, south",
    });
    expect(result.checks.filterA11y).toMatchObject({
      resetKey: "common.reset",
      liveKey: "viewer.filters.reset",
      crossPressed: "false",
    });
    expect(String((result.checks.filterA11y as { controlLabel?: string }).controlLabel)).toContain(
      "School",
    );
    expect(String((result.checks.filterA11y as { resetLabel?: string }).resetLabel)).toContain(
      "School",
    );
    expect(result.checks.crossFilterOn).toMatchObject({
      selections: 1,
      chips: 1,
      pressed: "true",
    });
    const labelBefore = String((result.checks.filterA11y as { crossLabel?: string }).crossLabel);
    const labelAfter = String((result.checks.crossFilterOn as { label?: string }).label);
    expect(labelBefore).toContain("Select value");
    expect(labelAfter).toBe(labelBefore);
    const chipText = String((result.checks.crossFilterOn as { chipText?: string }).chipText);
    expect(chipText).toContain("school_id");
    expect(chipText.match(/north/g) ?? []).toHaveLength(1);
    expect(result.checks.crossFilterOff).toEqual({ selections: 0, chips: 0 });
    expect(result.checks.multiDatasetUnmapped).toMatchObject({
      disabled: "disabled",
      note: "Not included: incompatible field (no explicit field mapping)",
    });
    expect(result.checks.multiDatasetMapped).toMatchObject({
      included: "included",
      otherRows: 1,
    });
    expect(result.checks.lightBackground).not.toBe(result.checks.darkBackground);
    expect(result.checks.bodyBackground).toBe(result.checks.bodyBackgroundAfter);
    expect(result.checks.dirAfter).toBe("rtl");
    expect(result.checks.langAfter).toBe("ar");
    expect(result.checks.hostDirAfter).toBeNull();
    expect(result.checks.revisionPreserved).toBe(true);
    expect(result.checks.queryCountPreserved).toBe(true);
    expect(result.checks.themeChanged).toBe(true);
    expect(result.checks.messageBoardName).toBe("Board region e2e");
    expect(result.checks.messageFilterName).toBe("Filter region e2e");
    expect(result.checks.messageLiveName).toBe("Live region e2e");
    expect(result.checks.messageFilterHeadings).toEqual([
      "Active filters e2e",
      "Active filters e2e",
    ]);
    expect(result.checks.metricDir).toBe("ltr");
    expect(Number(result.checks.numericDirCount)).toBeGreaterThan(1);
    const metricAlignment = result.checks.metricAlignment as {
      readonly label: string | null;
      readonly value: string | null;
    };
    expect(metricAlignment.value).toBe(metricAlignment.label);
    const tableAlignment = result.checks.tableAlignment as {
      readonly header: string | null;
      readonly value: string | null;
      readonly headerDirection: string | null;
      readonly valueDirection: string | null;
    };
    expect(tableAlignment.value).toBe(tableAlignment.header);
    expect(tableAlignment.headerDirection).toBe("rtl");
    expect(tableAlignment.valueDirection).toBe("rtl");
    expect(result.checks.modeAfterSwitch).toBe("editor");
    expect(result.checks.modeAfterReturn).toBe("viewer");
    expect(result.checks.bindingInspector).toMatchObject({
      hidden: false,
      slots: true,
      sumEnabled: true,
      countEnabled: true,
      medianEnabled: false,
      stringMeasureEnabled: false,
      numericMeasureEnabled: true,
      metricLocked: true,
      metricAggregationLocked: true,
      metricMode: "fixed",
    });
    expect(String((result.checks.bindingInspector as { lockText?: string }).lockText)).toContain(
      "not a security boundary",
    );
    expect(result.checks.bindingDraft).toMatchObject({
      aggregation: "sum",
      seriesRole: "series",
      seriesField: "subject",
      committedAggregation: "average",
    });
    expect(result.checks.bindingRejections).toMatchObject({
      invalidAggregation: "RENDERER_INCOMPATIBLE",
      fixedBinding: "FIXED_BINDING_LOCKED",
    });
    expect(result.checks.filterManager).toMatchObject({
      present: true,
      rowsBefore: 1,
      rowsAfter: 2,
      defaultAfter: ["west"],
      filtersInDraft: 2,
      addPresent: true,
    });
    expect(result.checks.inspectorAfterReturn).toBe(true);
    expect(result.checks.multi).toMatchObject({
      firstTheme: "dark",
      secondTheme: "light",
      firstDir: "rtl",
      secondDir: "ltr",
      secondBlocks: 5,
    });
    expect(result.checks.unmounted).toBe(true);
    expect(result.checks.spaceAlive).toBe(true);
    expect(result.checks.siblingAlive).toBe(true);
    expect(result.checks.viewCountAfterUnmount).toBe(1);
    expect(result.checks.queriesAfterUnmount).toBe(0);
    expect(result.checks.secondStillMounted).toBe(true);
    expect(result.checks.embeddedNarrow).toMatchObject({
      breakpoint: "narrow",
      headerDirection: "column",
      viewerGap: "16px",
      chartDisplay: "none",
      chartRects: 0,
      blocks: 5,
    });
    const filterDocumentUpdate = result.checks.filterDocumentUpdate as {
      readonly chipText: string;
      readonly scopeText: string;
    };
    expect(filterDocumentUpdate.chipText).toContain("Campus");
    expect(filterDocumentUpdate.chipText).toContain("east");
    expect(filterDocumentUpdate.scopeText).toContain("Campus: east");
    const comparison = result.checks.comparison as {
      readonly rows: number;
      readonly zeroReason: string | null;
      readonly zeroText: string | null;
      readonly primaryOnly: string | null;
      readonly summary: string | null;
      readonly sideBySide: number;
      readonly rejectionCodes: readonly string[];
      readonly draftReference: string | null;
      readonly percentageCells: number;
    };
    expect(comparison.rows).toBe(7);
    expect(comparison.zeroReason).toBe("ZERO_REFERENCE");
    expect(String(comparison.zeroText)).toContain("not available");
    expect(comparison.primaryOnly).toBe("primary-only");
    expect(String(comparison.summary)).toContain("matched");
    expect(Number(comparison.sideBySide)).toBeGreaterThan(0);
    expect(comparison.rejectionCodes).toContain("INCOMPATIBLE_COMPARISON");
    expect(comparison.draftReference).toBe("cmp-previous");
    expect(Number(comparison.percentageCells)).toBeGreaterThan(0);
    expect(result.checks.realtimeConnecting).toBe("connecting");
    expect(result.checks.realtimeLive).toMatchObject({
      status: "live",
      rootMode: "simulated",
      controls: 2,
    });
    expect(String((result.checks.realtimeLive as { simulated?: string }).simulated)).toContain(
      "Simulated live data",
    );
    expect(String((result.checks.realtimeLive as { metric?: string }).metric)).toContain("4");
    expect(result.checks.realtimePaused).toBe("paused");
    expect(result.checks.realtimeResumed).toBe("live");
    expect(result.checks.realtimeResyncing).toBe("resyncing");
    expect(result.checks.realtimeAfterResync).toMatchObject({ status: "live" });
    expect(String((result.checks.realtimeAfterResync as { metric?: string }).metric)).toContain(
      "6",
    );
    expect(result.checks.remountedBlocks).toBe(5);
    expect(result.checks.complete).toBe(true);
  }, 60_000);

  it("stacks blocks without page-level horizontal overflow at a narrow viewport", async () => {
    const result = await runScenario(360);
    expect(result.errors).toEqual([]);
    expect(result.checks.blocks).toBe(5);
    expect(result.checks.loading).toBe(0);
    expect(Number(result.checks.innerWidth)).toBeLessThanOrEqual(768);
    expect(result.checks.breakpoint).toBe("narrow");
    expect(Number(result.checks.scrollWidth)).toBeLessThanOrEqual(Number(result.checks.innerWidth));
    expect(result.checks.tableRegions).toBe(2);
    expect(result.checks.embeddedNarrow).toMatchObject({
      breakpoint: "narrow",
      headerDirection: "column",
      chartDisplay: "none",
      chartRects: 0,
    });
    expect(result.checks.missingKeys).toEqual([]);
    expect(result.checks.complete).toBe(true);
  }, 60_000);
});
