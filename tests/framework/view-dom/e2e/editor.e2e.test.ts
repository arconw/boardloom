import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface EditorE2eResult {
  readonly checks: Record<string, unknown>;
  readonly errors: readonly string[];
}

const root = process.cwd();
const e2eRoot = path.join(root, "tests", "framework", "view-dom", "e2e");
const buildRoot = path.join(root, ".tmp", "build", "packages");
const tempRoot = path.join(root, ".tmp", "T12", "e2e");
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
  throw new Error("A Chromium browser is required for the T12 editor E2E check.");
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
  if (requestPath === "/" || requestPath === "/editor-page.html") {
    return path.join(e2eRoot, "editor-page.html");
  }
  if (requestPath === "/editor-page.js") {
    return path.join(e2eRoot, "editor-page.js");
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
        timeout: 90_000,
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

async function runScenario(width: number): Promise<EditorE2eResult> {
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
      `--user-data-dir=${profile}`,
      `--window-size=${width},900`,
      "--virtual-time-budget=12000",
      "--dump-dom",
      `http://127.0.0.1:${port}/editor-page.html`,
    ]);
    const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    if (!match || match[1] === undefined || match[1].trim() === "") {
      throw new Error("The editor E2E page did not produce a result.");
    }
    return JSON.parse(decodeHtml(match[1])) as EditorE2eResult;
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

describe("T12 editor workflow", () => {
  it("opens the editor, runs block and keyboard layout operations and preserves drafts", async () => {
    const result = await runScenario(1440);
    expect(result.errors).toEqual([]);
    expect(result.checks.missingKeys).toEqual([]);
    expect(result.checks.initial).toMatchObject({
      mode: "viewer",
      blocks: 4,
      entries: 1,
      dirtyBarHidden: true,
    });
    expect(result.checks.editorOpened).toMatchObject({
      mode: "editor",
      lease: true,
      libraryVisible: true,
      draftBarVisible: true,
    });
    expect(
      Number((result.checks.editorOpened as { libraryItems?: number }).libraryItems),
    ).toBeGreaterThanOrEqual(5);
    expect(result.checks.blockCrud).toMatchObject({
      blocks: 9,
      valid: true,
      placements: 9,
      selected: 1,
    });
    expect(result.checks.keyboardSelect).toMatchObject({
      selected: "true",
      activeBlock: "chart",
      toolbarVisible: true,
    });
    expect(result.checks.keyboardSemantics).toMatchObject({
      escapeDeselected: true,
      mentionsDeleteUndo: true,
      reselected: true,
    });
    expect(result.checks.keyboardLayout).toMatchObject({
      moved: true,
      resized: true,
      valid: true,
      beforeX: 0,
    });
    expect(result.checks.textEditing).toMatchObject({
      text: "Edited text",
      focusPreserved: true,
      undoAvailable: true,
    });
    expect(result.checks.layoutFocus).toEqual({
      action: "right",
      target: "note",
      selected: "true",
    });
    expect(result.checks.undoRedo).toMatchObject({
      undoChanged: true,
      redoChanged: true,
      canRedoAfterUndo: true,
    });
    const localeRu = result.checks.localeRu as {
      readonly lang: string | null;
      readonly dir: string | null;
      readonly timezone: string | null;
      readonly mode: string | null;
      readonly modeLabel: string;
      readonly expected: string;
      readonly draft: unknown;
      readonly draftBefore: unknown;
    };
    expect(localeRu.lang).toBe("ru");
    expect(localeRu.dir).toBe("ltr");
    expect(localeRu.timezone).toBe("Europe/Moscow");
    expect(localeRu.mode).toBe("editor");
    expect(localeRu.modeLabel).toBe(localeRu.expected);
    expect(localeRu.draft).toEqual(localeRu.draftBefore);
    const localeJa = result.checks.localeJa as {
      readonly lang: string | null;
      readonly dir: string | null;
      readonly timezone: string | null;
      readonly mode: string | null;
      readonly modeLabel: string;
      readonly expected: string;
      readonly draft: unknown;
    };
    expect(localeJa.lang).toBe("ja");
    expect(localeJa.dir).toBe("ltr");
    expect(localeJa.timezone).toBe("Asia/Tokyo");
    expect(localeJa.mode).toBe("editor");
    expect(localeJa.modeLabel).toBe(localeJa.expected);
    expect(localeJa.draft).toEqual(localeRu.draftBefore);
    const localeAr = result.checks.localeAr as {
      readonly lang: string | null;
      readonly dir: string | null;
      readonly timezone: string | null;
      readonly mode: string | null;
      readonly modeLabel: string;
      readonly expected: string;
      readonly hostDir: string | null;
      readonly libraryLabel: string | null;
      readonly expectedLibrary: string;
      readonly workspaceLabel: string | null;
      readonly expectedWorkspace: string;
      readonly workspaceDir: string | null;
      readonly workspaceLang: string | null;
      readonly draft: unknown;
    };
    expect(localeAr.lang).toBe("ar");
    expect(localeAr.dir).toBe("rtl");
    expect(localeAr.hostDir).toBeNull();
    expect(localeAr.mode).toBe("editor");
    expect(localeAr.modeLabel).toBe(localeAr.expected);
    expect(localeAr.libraryLabel).toBe(localeAr.expectedLibrary);
    expect(localeAr.workspaceLabel).toBe(localeAr.expectedWorkspace);
    expect(localeAr.workspaceDir).toBe("rtl");
    expect(localeAr.workspaceLang).toBe("ar");
    expect(localeAr.draft).toEqual(localeRu.draftBefore);
    const localeEn = result.checks.localeEn as {
      readonly lang: string | null;
      readonly dir: string | null;
      readonly timezone: string | null;
      readonly draft: unknown;
    };
    expect(localeEn.lang).toBe("en");
    expect(localeEn.dir).toBe("ltr");
    expect(localeEn.timezone).toBe("UTC");
    expect(localeEn.draft).toEqual(localeRu.draftBefore);
    expect(result.checks.workspaceInvalidDictionaries).toEqual({ ok: false, children: 0 });
    expect(result.checks.workspaceDictionaryPrecedence).toEqual({
      boards: "Host boards",
      runtimeOnly: "Runtime only",
      hostOnly: "Host only",
      heading: "Host boards",
    });
    expect(result.checks.modeSwitch).toMatchObject({
      viewerMode: "viewer",
      draftPreserved: true,
      committedBlocks: 4,
    });
    expect(result.checks.discard).toMatchObject({
      confirmation: true,
      clean: true,
      blocks: 4,
    });
    expect(result.checks.apply).toMatchObject({
      committedTitle: "Applied title",
      draftDirty: false,
    });
    expect(result.checks.theme).toMatchObject({
      mode: "dark",
      accent: "#3366cc",
      success: "#00aa00",
      extra: "#123456",
      rendered: "dark",
      themeFocus: { themeToken: "accent", value: "#3366cc" },
    });
    expect(
      Number((result.checks.theme as { tokenRows?: number }).tokenRows),
    ).toBeGreaterThanOrEqual(3);
    expect(result.checks.protoTheme).toMatchObject({
      hasProto: false,
      extra: "#123456",
    });
    expect(String((result.checks.protoTheme as { notice?: string }).notice)).not.toBe("");
    expect(result.checks.themeRemoval).toEqual({
      success: null,
      accent: "#3366cc",
      extra: "#123456",
    });
    expect(result.checks.conflict).toMatchObject({
      draftTitle: "Conflict draft",
      committedTitle: "Scores",
      hostTitle: "Host changed",
    });
    expect(String((result.checks.conflict as { notice?: string }).notice)).not.toBe("");
    expect(result.checks.secondLease).toMatchObject({
      ok: false,
      code: "EDITOR_LEASE_CONFLICT",
    });
    expect(result.checks.dirtyExport).toMatchObject({
      buttonText: "Export committed board",
      draftTitle: "Source draft",
    });
    expect(String((result.checks.dirtyExport as { notice?: string }).notice)).toContain(
      "not included",
    );
    expect(result.checks.importNewSpace).toMatchObject({
      entries: 2,
      activeChanged: true,
      sourceDraftTitle: "Source draft",
      sourceCanUndo: true,
      sourceDisposed: false,
    });
    const workspaceScope = result.checks.workspaceScope as {
      readonly afterImport: {
        readonly dir: string | null;
        readonly lang: string | null;
        readonly heading: string | null;
      };
      readonly arabic: {
        readonly dir: string | null;
        readonly lang: string | null;
        readonly heading: string | null;
      };
      readonly english: {
        readonly dir: string | null;
        readonly lang: string | null;
        readonly heading: string | null;
      };
      readonly expectedArabicHeading: string;
      readonly expectedEnglishHeading: string;
    };
    expect(workspaceScope.afterImport).toMatchObject({ dir: "ltr", lang: "en" });
    expect(workspaceScope.arabic).toMatchObject({ dir: "rtl", lang: "ar" });
    expect(workspaceScope.arabic.heading).toBe(workspaceScope.expectedArabicHeading);
    expect(workspaceScope.english).toMatchObject({ dir: "ltr", lang: "en" });
    expect(workspaceScope.english.heading).toBe(workspaceScope.expectedEnglishHeading);
    expect(result.checks.importTabs).toMatchObject({
      focused: true,
      marker: "true",
      importedTitle: "Host changed",
    });
    expect(
      String((result.checks.importTabs as { markerText?: string }).markerText).trim(),
    ).not.toBe("");
    expect(result.checks.tabKeyboard).toEqual({
      source: { active: expect.any(String), focused: true },
      imported: true,
    });
    expect(result.checks.tabTitleSync).toBe("Renamed source");
    expect(result.checks.invalidImport).toMatchObject({
      entries: 2,
      focus: true,
      draftTitle: "Source draft",
    });
    expect(result.checks.exportViewer).toMatchObject({
      sourceMode: "viewer",
      exportedId: "editor-e2e-board",
      exportedBlocks: 4,
      viewerBlocks: 4,
    });
    expect(result.checks.disposalValidation).toMatchObject({
      failed: true,
      code: "REVISION_CONFLICT",
      workspaceDisposed: false,
      entries: 2,
      importedDraftTitle: "Imported conflict draft",
      sourceDraftTitle: "Source draft",
    });
    expect(result.checks.workspaceDispose).toMatchObject({
      firstFailed: true,
      code: "DRAFT_REQUIRES_DECISION",
      disposed: false,
      entries: 2,
      finished: true,
      finishedDisposed: true,
      sourceDisposed: true,
      importedDisposed: true,
    });
    expect(result.checks.externalImport).toMatchObject({
      ok: true,
      explicitOk: true,
      entries: 3,
      activeIsNew: true,
      sourceAlive: true,
      sourceDraftTitle: "Sibling dirty",
      disposed: true,
      sourceStillAlive: true,
      importedDisposed: true,
      explicitDisposed: true,
      committedTitle: "Sibling dirty",
      leaseReleased: true,
    });
    expect(result.checks.siblingDisposal).toMatchObject({
      cancel: {
        decision: "cancel",
        disposed: true,
        workspaceDisposed: true,
        sourceAlive: true,
        committedTitle: "Scores",
        draftDirty: false,
        hasLease: false,
      },
      keep: {
        decision: "keep",
        disposed: true,
        workspaceDisposed: true,
        sourceAlive: true,
        draftTitle: "Sibling keep",
        draftDirty: true,
        hasLease: true,
      },
    });
    expect(result.checks.reentrantMultiSpace).toMatchObject({
      disposed: true,
      workspaceDisposed: true,
      firstCommittedTitle: "Draft A",
      secondCommittedTitle: "Draft B",
      normalEventsSuppressed: true,
      eventsAfterDecision: 0,
    });
    expect(
      (result.checks.reentrantMultiSpace as { reentrantLoadOk?: boolean | null }).reentrantLoadOk,
    ).not.toBe(true);
    expect(result.checks.directReentry).toMatchObject({
      apply: {
        kind: "apply",
        disposed: true,
        workspaceDisposed: true,
        reentered: false,
        firstCommittedTitle: "Direct A",
        secondCommittedTitle: "Direct B",
        firstDisposed: true,
        secondDisposed: true,
      },
      cancel: {
        kind: "cancel",
        disposed: true,
        workspaceDisposed: true,
        reentered: false,
        firstCommittedTitle: "Scores",
        secondCommittedTitle: "Scores",
        firstDisposed: true,
        secondDisposed: true,
      },
    });
    expect(result.checks.reentrantDraft).toMatchObject({
      disposed: true,
      reentered: false,
      workspaceDisposed: true,
      spaceDisposed: true,
      committedTitle: "Original dirty",
      draftTitle: null,
      hasLease: false,
    });
    expect(result.checks.droppedActiveEntry).toMatchObject({
      failed: true,
      panelVisible: true,
      tabSelected: "true",
      oldTabConnected: false,
    });
    expect((result.checks.droppedActiveEntry as { active: string }).active).toBe(
      (result.checks.droppedActiveEntry as { survivor: string }).survivor,
    );
    expect(result.checks.partialDisposal).toMatchObject({
      failed: true,
      code: "DISPOSAL_PARTIAL",
      relatedIds: expect.arrayContaining([expect.any(String)]),
      workspaceDisposed: false,
    });
    expect((result.checks.partialDisposal as { relatedIds: string[] }).relatedIds).toContain(
      (result.checks.partialDisposal as { expectedId: string }).expectedId,
    );
    expect(result.checks.hostCallbackError).toMatchObject({
      message: "A host event callback failed",
    });
    expect(result.checks.lateImport).toMatchObject({
      entriesBefore: 1,
      entriesAfter: 1,
      activeUnchanged: true,
    });
    expect(result.checks.hostDisposedSpace).toMatchObject({
      disposed: true,
      workspaceDisposed: true,
      entries: 0,
      rootRemoved: true,
    });
    expect(result.checks.cleanLeaseDispose).toMatchObject({
      none: { decision: "none", disposed: true, workspaceDisposed: true, spaceDisposed: true },
      apply: {
        decision: "apply",
        disposed: true,
        workspaceDisposed: true,
        spaceDisposed: true,
      },
      cancel: {
        decision: "cancel",
        disposed: true,
        workspaceDisposed: true,
        spaceDisposed: true,
      },
    });
    expect(result.checks.terminalReentry).toMatchObject({
      disposed: true,
      workspaceDisposed: true,
      listenerRan: true,
      draftCreated: false,
      firstDisposed: true,
      secondDisposed: true,
      firstCommittedTitle: "Scores",
      secondCommittedTitle: "Scores",
    });
    expect(result.checks.eventOrdering).toMatchObject({
      disposed: true,
      workspaceDisposed: true,
      sourceAlive: true,
      reentered: true,
      ordered: true,
      sawApplyBeforeReload: true,
      committedTitle: "After ordering apply",
    });
    expect(result.checks.complete).toBe(true);
  }, 60_000);

  it("uses narrow drawers with a modal inspector and no page overflow", async () => {
    const result = await runScenario(390);
    expect(result.errors).toEqual([]);
    expect(result.checks.responsive).toMatchObject({
      hiddenInitially: true,
      libraryOpen: true,
      scrimVisible: true,
      inspectorOpen: true,
      backgroundInert: true,
      sheetActions: true,
      tabForwardWrapped: true,
      tabBackwardWrapped: true,
      confirmationInSheet: true,
      confirmationTabWrapped: true,
      overflow: true,
    });
    expect(Number((result.checks.responsive as { width?: number }).width)).toBeLessThan(768);
    expect(result.checks.complete).toBe(true);
  }, 60_000);
});
