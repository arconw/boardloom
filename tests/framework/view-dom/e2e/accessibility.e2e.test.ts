import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface AuditScenario {
  readonly name: string;
  readonly violations: readonly {
    readonly id: string;
    readonly impact: string | null;
    readonly nodes: number;
    readonly targets: readonly (readonly string[])[];
  }[];
  readonly criticalSerious: number;
  readonly seriousIncomplete: number;
}

interface ContrastEntry {
  readonly selector: string;
  readonly theme: string;
  readonly missing?: boolean;
  readonly ratio?: number;
}

interface ReflowReport {
  readonly breakpoint: string | null;
  readonly viewport: number;
  readonly gridColumns: string | null;
  readonly blockCount: number;
  readonly noPageOverflow: boolean;
  readonly noRootOverflow: boolean;
  readonly noBlockOverflow: boolean;
}

interface AuditResult {
  readonly checks: {
    readonly viewerLight: AuditScenario;
    readonly viewerDark: AuditScenario;
    readonly editor: AuditScenario;
    readonly editorDark: AuditScenario;
    readonly editorReduced?: AuditScenario;
    readonly editorContrastReduced?: readonly ContrastEntry[];
    readonly editorContrast: readonly ContrastEntry[];
    readonly editorContrastDark: readonly ContrastEntry[];
    readonly contrastLight: readonly ContrastEntry[];
    readonly contrastDark: readonly ContrastEntry[];
    readonly focusLight: { readonly ratio: number | null; readonly outlineWidth: string };
    readonly focusDark: { readonly ratio: number | null; readonly outlineWidth: string };
    readonly liveRegions: {
      readonly live: {
        readonly role: string | null;
        readonly ariaLive: string | null;
        readonly ariaAtomic: string | null;
        readonly presentAtMount: boolean;
      };
      readonly status: { readonly role: string | null; readonly ariaLive: string | null };
    };
    readonly chartAlternatives: readonly {
      readonly hasSummary: boolean;
      readonly detailsOpen: boolean;
      readonly regionRole: string | null;
      readonly regionTabIndex: string | null;
      readonly caption: string;
      readonly columnHeaders: number;
      readonly rowHeaders: number;
      readonly plotLabel: string | null;
    }[];
    readonly targetSizes: readonly {
      readonly className: string;
      readonly width: number;
      readonly height: number;
    }[];
    readonly editorTargetSizes: readonly {
      readonly className: string;
      readonly width: number;
      readonly height: number;
    }[];
    readonly reflow: ReflowReport;
    readonly editorReflow: ReflowReport;
    readonly motion: {
      readonly prefersReducedMotion: boolean;
      readonly scopedTransition: string | null;
      readonly scopedAnimation: string | null;
      readonly durations: Record<string, string | null>;
      readonly animated: readonly unknown[];
    };
    readonly keyboardLayout: {
      readonly selected: string | null;
      readonly current: string | null;
      readonly beforeMove: { readonly x: string; readonly height: string } | null;
      readonly afterMove: { readonly x: string; readonly height: string } | null;
      readonly afterResize: { readonly x: string; readonly height: string } | null;
    };
    readonly keyboardEscape: { readonly selected: string | null; readonly current: string | null };
    readonly confirmationDialog: {
      readonly audit: AuditScenario;
      readonly visible: boolean;
      readonly labelledBy: string | null;
      readonly focusEntered: boolean;
      readonly wrappedForward: boolean;
      readonly wrappedBackward: boolean;
      readonly backgroundInert: boolean;
    };
    readonly confirmationReturn: { readonly focusedTrigger: boolean; readonly hidden: boolean };
    readonly chartDisclosure: {
      readonly wasOpen: boolean;
      readonly nowOpen: boolean;
      readonly summaryFocusable: boolean;
    };
    readonly skipLink: {
      readonly firstFocusable: boolean;
      readonly targetExists: boolean;
      readonly targetTabIndex: string | null;
    };
    readonly multiInstance: {
      readonly firstBackground: string;
      readonly secondBackground: string;
      readonly firstTheme: string | null;
      readonly secondTheme: string | null;
      readonly hostBackground: string;
      readonly firstInstanceId: string | null;
      readonly secondInstanceId: string | null;
    };
    readonly addBlockFocus: {
      readonly type: string | null;
      readonly libraryOpen: boolean;
      readonly focusedTag: string | null;
      readonly focusedClass: string | null;
      readonly focusedAddType: string | null;
      readonly insideLibrary: boolean;
      readonly notBody: boolean;
    };
    readonly addBlockEscapeFromBody?: {
      readonly libraryOpenAfter: boolean;
      readonly focusReturned: boolean;
      readonly activeTag: string | null;
      readonly activeClass: string | null;
    };
    readonly discardConfirmFocus: {
      readonly mode: string | null;
      readonly focusedTag: string | null;
      readonly focusedClass: string | null;
      readonly notBody: boolean;
      readonly visible: boolean;
      readonly disabled: boolean;
      readonly confirmationHidden: boolean;
    };
    readonly releaseConfirmFocus: {
      readonly mode: string | null;
      readonly focusedTag: string | null;
      readonly focusedClass: string | null;
      readonly notBody: boolean;
      readonly visible: boolean;
      readonly disabled: boolean;
    };
    readonly crossInstanceEscape: {
      readonly confirmationStillOpen: boolean;
      readonly focusStayedInGuard: boolean;
    };
    readonly inspectorSheetDiscardFocus?: {
      readonly inspectorOpen: boolean;
      readonly focusedTag: string | null;
      readonly focusedClass: string | null;
      readonly insideInspector: boolean;
      readonly notBody: boolean;
      readonly visible: boolean;
      readonly disabled: boolean;
      readonly confirmationHidden: boolean | null;
    };
    readonly filterResetFocus: {
      readonly filterId: string | null;
      readonly focusedTag: string | null;
      readonly focusedClass: string | null;
      readonly notBody: boolean;
      readonly sameReset: boolean;
      readonly filterHeading: boolean;
      readonly visible: boolean;
    };
    readonly libraryDrawer?: {
      readonly audit: AuditScenario;
      readonly role: string | null;
      readonly ariaModal: string | null;
      readonly focusInside: boolean;
      readonly backgroundInert: boolean;
    };
    readonly libraryDrawerReturn?: {
      readonly focusedTrigger: boolean;
      readonly inertCleared: boolean;
    };
    readonly inspectorDrawer?: {
      readonly audit: AuditScenario;
      readonly role: string | null;
      readonly ariaModal: string | null;
      readonly focusInside: boolean;
      readonly backgroundInert: boolean;
      readonly wrappedForward: boolean;
      readonly wrappedBackward: boolean;
    };
    readonly inspectorDrawerReturn?: { readonly focusedTrigger: boolean };
  };
  readonly errors: readonly string[];
}

const root = process.cwd();
const e2eRoot = path.join(root, "tests", "framework", "view-dom", "e2e");
const buildRoot = path.join(root, ".tmp", "build", "packages");
const tempRoot = path.join(root, ".tmp", "T18", "a11y");
const rendererBundle = path.join(tempRoot, "renderers.js");
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const visualBaselineRoot = path.join(e2eRoot, "visual-baselines");
const visualScenarios = [
  { name: "viewer-light", width: 1440 },
  { name: "viewer-dark", width: 1440 },
  { name: "viewer-narrow", width: 320 },
  { name: "editor-light", width: 1440 },
  { name: "editor-narrow", width: 320 },
] as const;
let server: Server;
let port = 0;
let chromePath = "";
let sequence = 0;

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
  throw new Error("A Chromium browser is required for the T18 accessibility audit.");
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
  if (requestPath === "/" || requestPath === "/a11y.html") {
    return path.join(e2eRoot, "a11y-page.html");
  }
  if (requestPath === "/a11y.js") {
    return path.join(e2eRoot, "a11y-page.js");
  }
  if (requestPath === "/renderers.js") {
    return rendererBundle;
  }
  if (requestPath === "/axe.js") {
    return axePath;
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
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
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

async function runAudit(
  width: number,
  extraFlags: readonly string[] = [],
  query = "",
): Promise<AuditResult> {
  sequence += 1;
  const profile = path.join(tempRoot, `profile-${width}-${sequence}`);
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
      ...extraFlags,
      `--user-data-dir=${profile}`,
      `--window-size=${width},900`,
      "--virtual-time-budget=30000",
      "--dump-dom",
      `http://127.0.0.1:${port}/a11y.html${query === "" ? "" : `?${query}`}`,
    ]);
    const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    if (!match || match[1] === undefined || match[1].trim() === "") {
      throw new Error("The accessibility audit page did not produce a result.");
    }
    return JSON.parse(decodeHtml(match[1])) as AuditResult;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

async function captureVisual(scenario: string, width: number): Promise<string> {
  sequence += 1;
  const profile = path.join(tempRoot, `visual-profile-${width}-${sequence}`);
  const output = path.join(tempRoot, "screens", `${scenario}.png`);
  rmSync(profile, { recursive: true, force: true });
  rmSync(output, { force: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(path.dirname(output), { recursive: true });
  try {
    await runChrome([
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--window-size=${width},900`,
      "--virtual-time-budget=30000",
      `--screenshot=${output}`,
      `http://127.0.0.1:${port}/a11y.html?visual=${scenario}`,
    ]);
    return output;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

function comparePng(actualPath: string, baselinePath: string): number {
  const actual = PNG.sync.read(readFileSync(actualPath));
  const baseline = PNG.sync.read(readFileSync(baselinePath));
  expect([actual.width, actual.height]).toEqual([baseline.width, baseline.height]);
  let differing = 0;
  const total = actual.width * actual.height;
  const tolerance = 12;
  for (let index = 0; index < actual.data.length; index += 4) {
    if (
      Math.abs((actual.data[index] ?? 0) - (baseline.data[index] ?? 0)) > tolerance ||
      Math.abs((actual.data[index + 1] ?? 0) - (baseline.data[index + 1] ?? 0)) > tolerance ||
      Math.abs((actual.data[index + 2] ?? 0) - (baseline.data[index + 2] ?? 0)) > tolerance
    ) {
      differing += 1;
    }
  }
  return differing / total;
}

function expectNoBlockingAudit(scenario: AuditScenario): void {
  expect(
    scenario.criticalSerious,
    `${scenario.name}: ${scenario.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => `${violation.id} (${violation.impact})`)
      .join(", ")}`,
  ).toBe(0);
  expect(scenario.seriousIncomplete, `${scenario.name} serious incomplete results remain`).toBe(0);
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
  execFileSync(process.execPath, ["scripts/build-package.mjs", "renderers-echarts"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  chromePath = findChrome();
  mkdirSync(tempRoot, { recursive: true });
  await build({
    entryPoints: [path.join(root, "packages", "renderers-echarts", "src", "index.ts")],
    outfile: rendererBundle,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    external: ["@boardloom/core"],
    legalComments: "none",
  });
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
      if (address !== null && typeof address !== "string") {
        port = address.port;
      }
      resolve();
    });
  });
}, 120_000);

afterAll(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("T18 accessibility audit", () => {
  it("has no critical or serious axe findings and exposes alternatives in desktop states", async () => {
    const result = await runAudit(1440);
    expect(result.errors).toEqual([]);
    expectNoBlockingAudit(result.checks.viewerLight);
    expectNoBlockingAudit(result.checks.viewerDark);
    expectNoBlockingAudit(result.checks.editor);
    expectNoBlockingAudit(result.checks.editorDark);
    expectNoBlockingAudit(result.checks.confirmationDialog.audit);

    for (const entry of [
      ...result.checks.contrastLight,
      ...result.checks.contrastDark,
      ...result.checks.editorContrast,
      ...result.checks.editorContrastDark,
    ]) {
      expect(entry.missing, `${entry.theme} ${entry.selector}`).not.toBe(true);
      expect(entry.ratio, `${entry.theme} ${entry.selector}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(result.checks.focusLight.ratio).toBeGreaterThanOrEqual(3);
    expect(result.checks.focusDark.ratio).toBeGreaterThanOrEqual(3);

    expect(result.checks.chartAlternatives).toHaveLength(1);
    const chart = result.checks.chartAlternatives[0];
    expect(chart).toMatchObject({
      hasSummary: true,
      detailsOpen: true,
      regionRole: "region",
      regionTabIndex: "0",
    });
    expect(chart?.caption).not.toBe("");
    expect(chart?.columnHeaders).toBeGreaterThanOrEqual(2);
    expect(chart?.rowHeaders).toBeGreaterThanOrEqual(1);
    expect(chart?.plotLabel).not.toBeNull();

    expect(result.checks.targetSizes).toEqual([]);
    expect(result.checks.editorTargetSizes).toEqual([]);
    expect(result.checks.reflow).toMatchObject({
      breakpoint: "desktop",
      gridColumns: "12",
      blockCount: 5,
      noPageOverflow: true,
      noRootOverflow: true,
      noBlockOverflow: true,
    });
    expect(result.checks.liveRegions).toEqual({
      live: { role: "status", ariaLive: "polite", ariaAtomic: "true", presentAtMount: true },
      status: { role: "status", ariaLive: "polite" },
    });
    expect(result.checks.editorReflow).toMatchObject({
      noPageOverflow: true,
      noRootOverflow: true,
      noBlockOverflow: true,
    });

    expect(result.checks.keyboardLayout.selected).toBe("true");
    expect(result.checks.keyboardLayout.current).toBe("true");
    expect(result.checks.keyboardLayout.beforeMove?.x).toBe("0");
    expect(result.checks.keyboardLayout.afterMove?.x).toBe("1");
    expect(Number(result.checks.keyboardLayout.afterResize?.height)).toBeGreaterThan(
      Number(result.checks.keyboardLayout.afterMove?.height),
    );
    expect(result.checks.keyboardEscape).toMatchObject({ selected: "false", current: null });

    expect(result.checks.addBlockFocus).toMatchObject({
      libraryOpen: true,
      insideLibrary: true,
      notBody: true,
    });
    expect(
      result.checks.addBlockFocus.focusedAddType ?? result.checks.addBlockFocus.focusedClass,
    ).not.toBeNull();

    expect(result.checks.confirmationDialog).toMatchObject({
      visible: true,
      focusEntered: true,
      wrappedForward: true,
      wrappedBackward: true,
      backgroundInert: true,
    });
    expect(result.checks.confirmationDialog.labelledBy).not.toBeNull();
    expect(result.checks.confirmationReturn).toEqual({ focusedTrigger: true, hidden: true });
    expect(result.checks.crossInstanceEscape).toEqual({
      confirmationStillOpen: true,
      focusStayedInGuard: true,
    });
    expect(result.checks.discardConfirmFocus).toMatchObject({
      mode: "editor",
      notBody: true,
      visible: true,
      disabled: false,
      confirmationHidden: true,
    });
    expect(result.checks.releaseConfirmFocus).toMatchObject({
      mode: "viewer",
      notBody: true,
      visible: true,
      disabled: false,
    });
    expect(result.checks.filterResetFocus).toMatchObject({
      notBody: true,
      visible: true,
    });
    expect(
      result.checks.filterResetFocus.sameReset || result.checks.filterResetFocus.filterHeading,
    ).toBe(true);

    expect(result.checks.chartDisclosure.summaryFocusable).toBe(true);
    expect(result.checks.chartDisclosure.nowOpen).not.toBe(result.checks.chartDisclosure.wasOpen);
    expect(result.checks.skipLink).toMatchObject({
      firstFocusable: true,
      targetExists: true,
      targetTabIndex: "-1",
    });

    expect(result.checks.multiInstance.firstBackground).not.toBe(
      result.checks.multiInstance.secondBackground,
    );
    expect(result.checks.multiInstance.firstTheme).toBe("light");
    expect(result.checks.multiInstance.secondTheme).toBe("dark");
    expect(result.checks.multiInstance.firstInstanceId).not.toBe(
      result.checks.multiInstance.secondInstanceId,
    );
    expect(result.checks.multiInstance.hostBackground).toBe("rgb(221, 221, 221)");
    expect(result.checks.motion.animated).toEqual([]);
    expect(result.checks.motion.prefersReducedMotion).toBe(false);
    expect(result.checks.motion.scopedTransition).not.toBe("0s");
    expect(result.checks.motion.scopedAnimation).not.toBe("none");
  }, 120_000);

  it.each([320, 640, 720])(
    "reflows without page overflow and keeps dialogs modal at %i px",
    async (width) => {
      const result = await runAudit(width);
      expect(result.errors).toEqual([]);
      expectNoBlockingAudit(result.checks.viewerLight);
      expectNoBlockingAudit(result.checks.viewerDark);
      expectNoBlockingAudit(result.checks.editor);
      expectNoBlockingAudit(result.checks.editorDark);
      expectNoBlockingAudit(result.checks.confirmationDialog.audit);
      expect(result.checks.reflow).toMatchObject({
        breakpoint: "narrow",
        gridColumns: "4",
        blockCount: 5,
        noPageOverflow: true,
        noRootOverflow: true,
        noBlockOverflow: true,
      });
      expect(result.checks.editorReflow).toMatchObject({
        noPageOverflow: true,
        noRootOverflow: true,
        noBlockOverflow: true,
      });
      expect(result.checks.targetSizes).toEqual([]);
      expect(result.checks.editorTargetSizes).toEqual([]);
      expect(result.checks.libraryDrawer).toMatchObject({
        role: "dialog",
        ariaModal: "true",
        focusInside: true,
        backgroundInert: true,
      });
      expectNoBlockingAudit(result.checks.libraryDrawer?.audit as AuditScenario);
      expect(result.checks.libraryDrawerReturn).toMatchObject({
        focusedTrigger: true,
        inertCleared: true,
      });
      expect(result.checks.inspectorDrawer).toMatchObject({
        role: "dialog",
        ariaModal: "true",
        focusInside: true,
        backgroundInert: true,
        wrappedForward: true,
        wrappedBackward: true,
      });
      expectNoBlockingAudit(result.checks.inspectorDrawer?.audit as AuditScenario);
      expect(result.checks.inspectorDrawerReturn).toMatchObject({ focusedTrigger: true });
      expect(result.checks.inspectorSheetDiscardFocus).toMatchObject({
        inspectorOpen: true,
        insideInspector: true,
        notBody: true,
        visible: true,
        disabled: false,
        confirmationHidden: true,
      });
      expect(result.checks.addBlockFocus).toMatchObject({
        libraryOpen: true,
        insideLibrary: true,
        notBody: true,
      });
      expect(result.checks.addBlockEscapeFromBody).toMatchObject({
        libraryOpenAfter: false,
        focusReturned: true,
      });
      expect(result.checks.discardConfirmFocus).toMatchObject({
        mode: "editor",
        notBody: true,
        visible: true,
        disabled: false,
      });
      expect(result.checks.releaseConfirmFocus).toMatchObject({
        mode: "viewer",
        notBody: true,
        visible: true,
        disabled: false,
      });
      expect(result.checks.filterResetFocus).toMatchObject({
        notBody: true,
        visible: true,
      });
      expect(
        result.checks.filterResetFocus.sameReset || result.checks.filterResetFocus.filterHeading,
      ).toBe(true);
      expect(result.checks.crossInstanceEscape).toEqual({
        confirmationStillOpen: true,
        focusStayedInGuard: true,
      });
      expect(result.checks.confirmationDialog).toMatchObject({
        visible: true,
        focusEntered: true,
        wrappedForward: true,
        wrappedBackward: true,
        backgroundInert: true,
      });
      expect(result.checks.chartDisclosure.summaryFocusable).toBe(true);
    },
    120_000,
  );

  it("matches light, dark and narrow visual baselines", async () => {
    for (const scenario of visualScenarios) {
      const actualPath = await captureVisual(scenario.name, scenario.width);
      const baselinePath = path.join(visualBaselineRoot, `${scenario.name}.png`);
      if (!existsSync(baselinePath)) {
        if (process.env.UPDATE_VISUAL_BASELINES === "1") {
          mkdirSync(visualBaselineRoot, { recursive: true });
          writeFileSync(baselinePath, readFileSync(actualPath));
          continue;
        }
        throw new Error(
          `Missing visual baseline ${path.relative(root, baselinePath)}; rerun with UPDATE_VISUAL_BASELINES=1 to create it.`,
        );
      }
      const ratio = comparePng(actualPath, baselinePath);
      expect(ratio, `${scenario.name} pixel difference`).toBeLessThanOrEqual(0.002);
    }
  }, 180_000);

  it("honors the reduced motion preference", async () => {
    const result = await runAudit(1440, ["--force-prefers-reduced-motion"]);
    expect(result.errors).toEqual([]);
    expect(result.checks.motion.prefersReducedMotion).toBe(true);
    for (const duration of Object.values(result.checks.motion.durations)) {
      expect(duration).not.toBeNull();
      expect(Number.parseFloat(String(duration))).toBeLessThanOrEqual(0.01);
    }
    expect(result.checks.motion.animated).toEqual([]);
    expect(result.checks.motion.scopedTransition).toBe("0s");
    expect(result.checks.motion.scopedAnimation).toBe("none");
    expectNoBlockingAudit(result.checks.editorReduced as AuditScenario);
    expect(result.checks.editorContrastReduced).toHaveLength(3);
    for (const entry of result.checks.editorContrastReduced!) {
      expect(entry.missing, `${entry.theme} ${entry.selector}`).not.toBe(true);
      expect(entry.ratio, `${entry.theme} ${entry.selector}`).toBeGreaterThanOrEqual(4.5);
    }

    const dark = await runAudit(1440, ["--force-prefers-reduced-motion"], "theme=dark");
    expect(dark.errors).toEqual([]);
    expectNoBlockingAudit(dark.checks.viewerDark);
    expect(dark.checks.motion.prefersReducedMotion).toBe(true);
    expect(dark.checks.motion.animated).toEqual([]);
    expect(dark.checks.motion.scopedTransition).toBe("0s");
    expect(dark.checks.motion.scopedAnimation).toBe("none");
    expectNoBlockingAudit(dark.checks.editorDark);
    for (const entry of dark.checks.editorContrastDark) {
      expect(entry.missing, `${entry.theme} ${entry.selector}`).not.toBe(true);
      expect(entry.ratio, `${entry.theme} ${entry.selector}`).toBeGreaterThanOrEqual(4.5);
    }
  }, 120_000);
});
