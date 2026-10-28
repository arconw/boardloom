import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

export interface GalleryResult {
  readonly checks: Record<string, unknown>;
  readonly errors: readonly string[];
}

export interface GalleryHarness {
  run(width: number): Promise<GalleryResult>;
  close(): Promise<void>;
}

const root = process.cwd();
const e2eRoot = path.join(root, "tests", "framework", "renderers", "e2e");
const buildRoot = path.join(root, ".tmp", "build", "packages");
const tempRoot = path.join(root, ".tmp", "T07", "e2e");
const bundlePath = path.join(tempRoot, "renderers.js");

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
  throw new Error("A Chromium browser is required for the T07 renderer gallery.");
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

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function resolveRequestPath(requestPath: string): string | null {
  if (requestPath === "/" || requestPath === "/page.html") {
    return path.join(e2eRoot, "page.html");
  }
  if (requestPath === "/page.js") {
    return path.join(e2eRoot, "page.js");
  }
  if (requestPath === "/renderers.js") {
    return bundlePath;
  }
  if (requestPath.startsWith("/build/")) {
    const resolved = path.resolve(buildRoot, requestPath.slice("/build/".length));
    return resolved.startsWith(`${buildRoot}${path.sep}`) ? resolved : null;
  }
  return null;
}

function runChrome(chromePath: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      chromePath,
      [...args],
      {
        encoding: "utf8",
        timeout: 90_000,
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

export async function startGalleryHarness(): Promise<GalleryHarness> {
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
  mkdirSync(tempRoot, { recursive: true });
  await build({
    entryPoints: [path.join(root, "packages", "renderers-echarts", "src", "index.ts")],
    outfile: bundlePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    external: ["@boardloom/core"],
    legalComments: "none",
  });

  const chromePath = findChrome();
  let port = 0;
  const server: Server = createServer((request, response) => {
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

  let sequence = 0;
  return {
    async run(width: number): Promise<GalleryResult> {
      sequence += 1;
      const profile = path.join(tempRoot, `profile-${width}-${sequence}`);
      rmSync(profile, { recursive: true, force: true });
      mkdirSync(profile, { recursive: true });
      mkdirSync(path.join(tempRoot, "xdg-cache"), { recursive: true });
      try {
        const stdout = await runChrome(chromePath, [
          "--headless=new",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          "--no-sandbox",
          "--force-device-scale-factor=1",
          `--user-data-dir=${profile}`,
          `--window-size=${width},1200`,
          "--virtual-time-budget=12000",
          "--dump-dom",
          `http://127.0.0.1:${port}/page.html`,
        ]);
        const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
        if (!match || match[1] === undefined || match[1].trim() === "") {
          throw new Error("The renderer gallery page did not produce a result.");
        }
        return JSON.parse(decodeHtml(match[1])) as GalleryResult;
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
