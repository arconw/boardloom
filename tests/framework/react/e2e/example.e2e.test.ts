import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface E2eResult {
  readonly checks: Record<string, unknown>;
  readonly errors: readonly string[];
}

const root = process.cwd();
const buildRoot = path.join(root, ".tmp", "build", "packages");
const tempRoot = path.join(root, ".tmp", "T14", "e2e");
let server: Server;
let port = 0;
let chromePath = "";
let sequence = 0;

function built(relativePath: string): string {
  return path.join(buildRoot, relativePath);
}

function builtPackagePlugin(): Plugin {
  const aliases: ReadonlyArray<readonly [RegExp, string]> = [
    [/^@boardloom\/core$/, built("core/dist/index.js")],
    [/^@boardloom\/view-dom\/styles\.css$/, built("view-dom/styles.css")],
    [/^@boardloom\/view-dom$/, built("view-dom/dist/index.js")],
    [/^@boardloom\/react$/, built("react/dist/index.js")],
  ];
  return {
    name: "boardloom-built-packages",
    setup(builder) {
      for (const [filter, replacement] of aliases) {
        builder.onResolve({ filter }, () => ({ path: replacement }));
      }
    },
  };
}

async function bundle(entry: string, output: string): Promise<void> {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(tempRoot, output),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [builtPackagePlugin()],
    logLevel: "silent",
  });
}

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
  throw new Error("A Chromium browser is required for the T14 React E2E check.");
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
  return "text/plain; charset=utf-8";
}

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function runChrome(page: string): Promise<string> {
  sequence += 1;
  const profile = path.join(tempRoot, `profile-${sequence}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--force-device-scale-factor=1",
        `--user-data-dir=${profile}`,
        "--window-size=1280,900",
        "--virtual-time-budget=20000",
        "--dump-dom",
        `http://127.0.0.1:${port}/${page}`,
      ],
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
        rmSync(profile, { recursive: true, force: true });
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseResult(stdout: string): E2eResult {
  const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!match || match[1] === undefined || match[1].trim() === "") {
    throw new Error("The T14 React E2E page did not produce a result.");
  }
  return JSON.parse(decodeHtml(match[1])) as E2eResult;
}

beforeAll(async () => {
  for (const packageName of ["core", "view-dom", "react"]) {
    execFileSync(process.execPath, ["scripts/build-package.mjs", packageName], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(path.join(tempRoot, "xdg-cache"), { recursive: true });
  chromePath = findChrome();
  await bundle("tests/framework/react/e2e/page.tsx", "harness.js");
  await bundle("examples/react/src/main.tsx", "example.js");
  await bundle("tests/framework/react/e2e/example-driver.ts", "example-driver.js");
  writeFileSync(
    path.join(tempRoot, "harness.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Boardloom React adapter</title></head><body><script type="module" src="/harness.js"></script></body></html>\n',
    "utf8",
  );
  writeFileSync(
    path.join(tempRoot, "example.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Boardloom React example</title><link rel="stylesheet" href="/example.css" /></head><body><div id="root"></div><script type="module" src="/example.js"></script><script type="module" src="/example-driver.js"></script></body></html>\n',
    "utf8",
  );
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const name = path.basename(url.pathname);
    const file = path.join(tempRoot, name);
    try {
      const content = readFileSync(file);
      response.statusCode = 200;
      response.setHeader("content-type", contentType(file));
      response.setHeader("cache-control", "no-store");
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
}, 120_000);

afterAll(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("T14 React adapter and example in Chromium", () => {
  it("runs the adapter through StrictMode, updates, events, modes and cleanup", async () => {
    const result = parseResult(await runChrome("harness.html"));
    expect(result.errors).toEqual([]);
    expect(result.checks).toMatchObject({
      singleRoot: true,
      strictReady: true,
      strictDisposed: true,
      strictActive: true,
      initialTimezone: true,
      initialLocale: true,
      initialMessage: true,
      filterChipInitial: true,
      tableRows: true,
      sameInstanceAfterUpdate: true,
      messagesOverride: true,
      filterPreserved: true,
      rowsPreserved: true,
      localeEvent: true,
      editorMode: true,
      viewerMode: true,
      modeEvents: true,
      handleReady: true,
      focusResult: true,
      exportResult: true,
      themeUpdate: true,
      themeApplied: true,
      messagesCleared: true,
      leaseCleared: true,
      modeRecoveryPending: true,
      recoveryLease: true,
      modeRecovered: true,
      modeRecoverySingleError: true,
      siblingSuppressed: true,
      siblingLocaleRecovered: true,
      siblingThemeRecovered: true,
      siblingSingleError: true,
      unmountRoots: true,
      unmountDisposed: true,
      remountNewInstance: true,
      remountReady: true,
      noDuplicateRoots: true,
      expectedUpdateErrors: true,
    });
  }, 60_000);

  it("runs the example against the built package with locale, timezone, messages and cleanup", async () => {
    const result = parseResult(await runChrome("example.html"));
    expect(result.errors).toEqual([]);
    expect(result.checks).toMatchObject({
      oneRoot: true,
      activeInstance: true,
      initialTimezone: true,
      filterChip: true,
      tableRows: true,
      localeNote: true,
      localeForwarded: true,
      timezoneForwarded: true,
      sameInstance: true,
      filterPreserved: true,
      rowsPreserved: true,
      eventForwarded: true,
      messageOverride: true,
      builtInEditor: true,
      builtInViewer: true,
      hostEditor: true,
      hostViewer: true,
      exportPreview: true,
      unmountClean: true,
      disposeCounted: true,
      remount: true,
      remountSingle: true,
      remountActive: true,
      editorAddAvailable: true,
      dirtyRetained: true,
      dirtyUnmountNoRoot: true,
      retainedActiveZero: true,
      retainedCount: true,
      retainedViewNone: true,
      retainedStatus: true,
      retainedResolved: true,
      retainedDisposed: true,
      dirtyRemountActive: true,
      dirtyRemountSingle: true,
      dirtyRemountView: true,
      noRuntimeErrors: true,
    });
  }, 60_000);
});
