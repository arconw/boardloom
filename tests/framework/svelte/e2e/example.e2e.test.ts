import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface E2eResult {
  readonly checks: Record<string, unknown>;
  readonly errors: readonly string[];
}

const root = process.cwd();
const exampleRoot = path.join(root, "examples", "svelte");
const exampleOutput = path.join(root, ".tmp", "examples", "svelte");
const tempRoot = path.join(root, ".tmp", "T16", "e2e");
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
  throw new Error("A Chromium browser is required for the T16 Svelte E2E check.");
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
        "--virtual-time-budget=25000",
        "--dump-dom",
        `http://127.0.0.1:${port}/${page}`,
      ],
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
    throw new Error("The T16 Svelte E2E page did not produce a result.");
  }
  return JSON.parse(decodeHtml(match[1])) as E2eResult;
}

beforeAll(async () => {
  for (const packageName of ["core", "view-dom", "svelte"]) {
    execFileSync(process.execPath, ["scripts/build-package.mjs", packageName], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  execFileSync(
    process.execPath,
    [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"],
    {
      cwd: exampleRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(path.join(tempRoot, "xdg-cache"), { recursive: true });
  chromePath = findChrome();
  await build({
    entryPoints: [path.join(root, "tests", "framework", "svelte", "e2e", "driver.ts")],
    outfile: path.join(tempRoot, "driver.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    logLevel: "silent",
  });
  const index = readFileSync(path.join(exampleOutput, "index.html"), "utf8");
  writeFileSync(
    path.join(tempRoot, "index.html"),
    index.replace("</body>", '<script type="module" src="/driver.js"></script></body>'),
    "utf8",
  );
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const name = path.basename(url.pathname);
    const file =
      name === "" || name === "/" || name === "index.html"
        ? path.join(tempRoot, "index.html")
        : name === "driver.js"
          ? path.join(tempRoot, "driver.js")
          : path.join(exampleOutput, name);
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
}, 180_000);

afterAll(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("T16 Svelte adapter and example in Chromium", () => {
  it("mounts, forwards locale/timezone/messages, switches modes and cleans up", async () => {
    const result = parseResult(await runChrome("index.html"));
    expect(result.errors).toEqual([]);
    expect(result.checks).toMatchObject({
      oneRoot: true,
      readyCount: "1",
      initialLocale: "en",
      initialTimezone: "UTC",
      initialViewer: true,
      svelteHostMarker: true,
      sameInstanceAfterLocale: true,
      localeForwarded: true,
      timezoneForwarded: true,
      localeEventForwarded: true,
      metricFormatChanged: true,
      dateFormatChanged: true,
      filterPreserved: true,
      tablePreserved: true,
      hostMessages: true,
      sameInstanceAfterMessages: true,
      hostMessagesCleared: true,
      editorMode: true,
      sameInstanceAfterMode: true,
      modeEventForwarded: true,
      editorSurface: true,
      viewerMode: true,
      sameInstanceAfterViewer: true,
      builtInEditorThenHostViewer: true,
      focusAction: true,
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
      retainedViewNone: true,
      retainedStatus: true,
      retainedResolvedButton: true,
      retainedResolved: true,
      retainedDisposed: true,
      dirtyRemountActive: true,
      dirtyRemountSingle: true,
      dirtyRemountView: true,
      noRuntimeErrors: true,
    });
    expect(result.checks.tableRows).toBeGreaterThan(0);
    expect(typeof result.checks.initialInstance).toBe("string");
    expect(result.checks.initialInstance).not.toBe("");
  }, 120_000);
});
