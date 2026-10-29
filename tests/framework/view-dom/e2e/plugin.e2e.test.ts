import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface PluginE2eResult {
  readonly checks: Record<string, unknown>;
  readonly errors: readonly string[];
}

const root = process.cwd();
const e2eRoot = path.join(root, "tests", "framework", "view-dom", "e2e");
const buildRoot = path.join(root, ".tmp", "build", "packages");
const tempRoot = path.join(root, ".tmp", "T13", "e2e");
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
  throw new Error("A Chromium browser is required for the T13 plugin E2E check.");
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
  if (requestPath === "/" || requestPath === "/plugin-page.html") {
    return path.join(e2eRoot, "plugin-page.html");
  }
  if (requestPath === "/plugin-page.js") {
    return path.join(e2eRoot, "plugin-page.js");
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

async function runScenario(): Promise<PluginE2eResult> {
  sequence += 1;
  const profile = path.join(tempRoot, `profile-${sequence}`);
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
      "--window-size=1440,1000",
      "--virtual-time-budget=8000",
      "--dump-dom",
      `http://127.0.0.1:${port}/plugin-page.html`,
    ]);
    const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    if (!match || match[1] === undefined || match[1].trim() === "") {
      throw new Error("The plugin E2E page did not produce a result.");
    }
    return JSON.parse(decodeHtml(match[1])) as PluginE2eResult;
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
}, 90_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("T13 plugin walkthrough", () => {
  it("registers, adds, renders, contains errors and disposes scoped plugin styles", async () => {
    const result = await runScenario();
    expect(result.errors).toEqual([]);
    const registered = result.checks.registered as Record<string, boolean> | undefined;
    const customBlock = result.checks.customBlock as Record<string, unknown> | undefined;
    const scopes = result.checks.styleScopes as Record<string, string | boolean> | undefined;
    const disposed = result.checks.disposed as Record<string, boolean> | undefined;
    expect(registered?.block).toBe(true);
    expect(registered?.renderer).toBe(true);
    expect(registered?.formatter).toBe(true);
    expect(registered?.dictionary).toBe(true);
    expect(registered?.theme).toBe(true);
    expect(customBlock?.blocks).toBe(2);
    expect(customBlock?.bars).toBe(3);
    expect(customBlock?.error).toBe(true);
    expect(customBlock?.survivingText).toBe(true);
    expect(scopes?.firstScope).not.toBe(scopes?.secondScope);
    expect(scopes?.firstColor).toBe("rgb(170, 0, 0)");
    expect(scopes?.secondColor).toBe("rgb(0, 0, 170)");
    expect(scopes?.hostColor).not.toBe(scopes?.firstColor);
    expect(disposed?.styleRemoved).toBe(true);
    expect(disposed?.elementRemoved).toBe(true);
    expect(disposed?.extensionsDisposed).toBe(true);
  }, 120_000);
});
