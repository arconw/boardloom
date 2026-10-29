import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { repoRoot, run } from "./lib/repo.mjs";

function fail(message) {
  console.error(`verify-consumers: ${message}`);
  process.exit(1);
}

const stagingRoot = path.join(repoRoot, ".tmp", "build", "packages");
const consumerRoot = path.join(repoRoot, ".tmp", "consumers", "frameworks");
const packRoot = path.join(consumerRoot, "packs");
const requiredPackages = ["core", "view-dom", "react", "angular"];

for (const packageName of requiredPackages) {
  try {
    run(process.execPath, ["scripts/build-package.mjs", packageName], { cwd: repoRoot });
  } catch (error) {
    fail(
      `failed to build ${packageName} before consumer verification: ${error.stderr || error.message}`,
    );
  }
}

try {
  run(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      "examples/react/tsconfig.build.json",
      "--noEmit",
    ],
    { cwd: repoRoot },
  );
} catch (error) {
  fail(`example typecheck against packed declarations failed: ${error.stderr || error.message}`);
}

try {
  run(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      "examples/angular/tsconfig.app.json",
      "--noEmit",
    ],
    { cwd: repoRoot },
  );
} catch (error) {
  fail(
    `angular example typecheck against built declarations failed: ${error.stderr || error.message}`,
  );
}

for (const packageName of requiredPackages) {
  const directory = path.join(stagingRoot, packageName);
  if (!existsSync(path.join(directory, "dist", "index.js"))) {
    fail(`${packageName} build staging is missing; run npm run build before verify:consumers`);
  }
}

rmSync(consumerRoot, { recursive: true, force: true });
mkdirSync(packRoot, { recursive: true });

const tarballs = new Map();
for (const packageName of requiredPackages) {
  const directory = path.join(stagingRoot, packageName);
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", packRoot], { cwd: directory }),
  );
  const entry = packed[0];
  if (!entry || typeof entry.filename !== "string") {
    fail(`npm pack did not return a tarball for ${packageName}`);
  }
  const files = entry.files.map((file) => file.path);
  for (const file of files) {
    if (file.startsWith("src/") || file.includes("/src/") || file.includes("..")) {
      fail(`${packageName} tarball exposes a forbidden path: ${file}`);
    }
    if (
      packageName === "angular" &&
      (file.startsWith("dist/core/") || file.startsWith("dist/view-dom/"))
    ) {
      fail(`angular tarball includes a compiled workspace dependency: ${file}`);
    }
  }
  tarballs.set(packageName, path.join(packRoot, entry.filename));
}

const manifest = {
  name: "boardloom-framework-consumer",
  version: "0.0.0",
  private: true,
  type: "module",
  dependencies: {
    "@boardloom/core": `file:${path.relative(consumerRoot, tarballs.get("core")).split(path.sep).join("/")}`,
    "@boardloom/view-dom": `file:${path.relative(consumerRoot, tarballs.get("view-dom")).split(path.sep).join("/")}`,
    "@boardloom/react": `file:${path.relative(consumerRoot, tarballs.get("react")).split(path.sep).join("/")}`,
    "@boardloom/angular": `file:${path.relative(consumerRoot, tarballs.get("angular")).split(path.sep).join("/")}`,
    react: "19.3.1",
    "react-dom": "19.3.1",
    "@angular/common": "21.2.25",
    "@angular/compiler": "21.2.25",
    "@angular/core": "21.2.25",
    "@angular/platform-browser": "21.2.25",
    rxjs: "7.8.2",
    tslib: "2.8.1",
  },
};
writeFileSync(path.join(consumerRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

try {
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: consumerRoot,
  });
} catch (error) {
  fail(`packed consumer install failed: ${error.stderr || error.message}`);
}

const smokeSource = `import { readFileSync } from "node:fs";
import { createRuntime, ENGLISH_MESSAGES } from "@boardloom/core";
import { mountBoardView } from "@boardloom/view-dom";
import * as adapter from "@boardloom/react";
import * as angularAdapter from "@boardloom/angular";

const reactManifest = JSON.parse(
  readFileSync(new URL("./node_modules/@boardloom/react/package.json", import.meta.url), "utf8"),
);
const angularManifest = JSON.parse(
  readFileSync(new URL("./node_modules/@boardloom/angular/package.json", import.meta.url), "utf8"),
);
const viewManifest = JSON.parse(
  readFileSync(new URL("./node_modules/@boardloom/view-dom/package.json", import.meta.url), "utf8"),
);
const coreManifest = JSON.parse(
  readFileSync(new URL("./node_modules/@boardloom/core/package.json", import.meta.url), "utf8"),
);

if (reactManifest.name !== "@boardloom/react" || angularManifest.name !== "@boardloom/angular" || viewManifest.name !== "@boardloom/view-dom" || coreManifest.name !== "@boardloom/core") {
  throw new Error("packed package identity mismatch");
}
if (reactManifest.dependencies === undefined || reactManifest.dependencies["@boardloom/view-dom"] === undefined) {
  throw new Error("react tarball does not declare the shared runtime dependency");
}
if (angularManifest.dependencies === undefined || angularManifest.dependencies["@boardloom/view-dom"] === undefined) {
  throw new Error("angular tarball does not declare the shared runtime dependency");
}
if (angularManifest.peerDependencies === undefined || angularManifest.peerDependencies["@angular/core"] === undefined) {
  throw new Error("angular tarball does not declare the Angular peer dependency");
}
const angularComponent = angularAdapter.BoardloomViewComponent;
if (typeof angularComponent !== "function" || angularComponent.ɵcmp === undefined) {
  throw new Error("packed angular adapter does not export a compiled standalone component");
}
if (angularComponent.ɵcmp.standalone !== true) {
  throw new Error("packed angular adapter component is not standalone");
}
if (typeof createRuntime !== "function" || typeof mountBoardView !== "function") {
  throw new Error("packed runtime exports are incomplete");
}
if (typeof adapter.BoardloomView !== "function" && typeof adapter.BoardloomView !== "object") {
  throw new Error("packed react adapter does not export BoardloomView");
}
if (ENGLISH_MESSAGES["mode.viewer"] === undefined) {
  throw new Error("packed core message foundation is missing");
}
const runtime = createRuntime();
runtime.dispose();
console.log("packed consumer smoke passed");
`;
writeFileSync(path.join(consumerRoot, "smoke.mjs"), smokeSource);

try {
  run(process.execPath, ["smoke.mjs"], { cwd: consumerRoot });
} catch (error) {
  fail(`packed consumer Node smoke failed: ${error.stderr || error.message}`);
}

const domSmokeSource = `import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BoardloomView } from "@boardloom/react";

const { Window } = await import(process.env.BOARDLOOM_HAPPY_DOM);
const window = new Window({ url: "http://127.0.0.1/" });
for (const [key, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MutationObserver: window.MutationObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

async function waitFor(predicate, label, timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("timed out waiting for " + label);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
root.render(
  createElement(BoardloomView, {
    document: {
      schemaVersion: 1,
      id: "consumer-board",
      title: "Packed consumer board",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      theme: { mode: "light" },
      datasets: [],
      slices: [],
      filterGroups: [],
      blocks: [
        {
          id: "note",
          type: "text",
          title: "Packed consumer",
          bindings: [],
          config: { text: "Mounted from packed Boardloom tarballs." },
        },
      ],
      filters: [],
      comparisons: [],
      layout: {
        desktop: { columns: 12, placements: [{ blockId: "note", x: 0, y: 0, width: 6, height: 2 }] },
        tablet: { columns: 8, placements: [{ blockId: "note", x: 0, y: 0, width: 6, height: 2 }] },
        narrow: { columns: 4, placements: [{ blockId: "note", x: 0, y: 0, width: 4, height: 2 }] }
      },
      extensions: {}
    }
  })
);
await waitFor(() => container.querySelectorAll(".boardloom").length === 1, "packed adapter mount");
const mounted = container.querySelectorAll(".boardloom").length;
if (mounted !== 1) {
  throw new Error("packed adapter mounted " + mounted + " roots");
}
root.unmount();
await waitFor(() => container.querySelectorAll(".boardloom").length === 0, "packed adapter cleanup");
if (container.querySelectorAll(".boardloom").length !== 0) {
  throw new Error("packed adapter left a mounted root");
}
console.log("packed consumer DOM smoke passed");
`;
writeFileSync(path.join(consumerRoot, "smoke-dom.mjs"), domSmokeSource);

try {
  execFileSync(process.execPath, ["smoke-dom.mjs"], {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BOARDLOOM_HAPPY_DOM: import.meta.resolve("happy-dom") },
  });
} catch (error) {
  fail(`packed consumer DOM smoke failed: ${error.stderr || error.message}`);
}

const angularDomSmokeSource = `import { readFileSync } from "node:fs";

const { Window } = await import(process.env.BOARDLOOM_HAPPY_DOM);
const window = new Window({ url: "http://127.0.0.1/" });
for (const [key, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  ShadowRoot: window.ShadowRoot,
  DocumentFragment: window.DocumentFragment,
  Text: window.Text,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  MutationObserver: window.MutationObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

await import("@angular/compiler");
const { provideZonelessChangeDetection } = await import("@angular/core");
const { TestBed } = await import("@angular/core/testing");
const { BrowserTestingModule, platformBrowserTesting } = await import("@angular/platform-browser/testing");
const { BoardloomViewComponent } = await import("@boardloom/angular");

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
const makeBlockType = () => ({
  type: "consumer.custom",
  version: "1.0.0",
  createSurface() {
    const element = document.createElement("div");
    return { element, update() {} };
  },
});
const fixture = TestBed.createComponent(BoardloomViewComponent);
const errors = [];
fixture.componentInstance.adapterError.subscribe((error) => errors.push(error));
fixture.componentRef.setInput("blockTypes", [makeBlockType()]);
fixture.componentRef.setInput("document", {
  schemaVersion: 1,
  id: "consumer-board",
  title: "Packed consumer board",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  theme: { mode: "light" },
  datasets: [],
  slices: [],
  filterGroups: [],
  blocks: [
    {
      id: "note",
      type: "text",
      title: "Packed consumer",
      bindings: [],
      config: { text: "Mounted from packed Boardloom tarballs." },
    },
  ],
  filters: [],
  comparisons: [],
  layout: {
    desktop: { columns: 12, placements: [{ blockId: "note", x: 0, y: 0, width: 6, height: 2 }] },
    tablet: { columns: 8, placements: [{ blockId: "note", x: 0, y: 0, width: 6, height: 2 }] },
    narrow: { columns: 4, placements: [{ blockId: "note", x: 0, y: 0, width: 4, height: 2 }] }
  },
  extensions: {}
});
fixture.detectChanges();
await new Promise((resolve) => setTimeout(resolve, 50));
const host = fixture.nativeElement;
const mounted = host.querySelectorAll(".boardloom").length;
if (mounted !== 1) {
  throw new Error("packed angular adapter mounted " + mounted + " roots");
}
if (host.getAttribute("data-boardloom-angular") !== "") {
  throw new Error("packed angular adapter host marker is missing");
}
const instance = host.querySelector(".boardloom")?.getAttribute("data-boardloom-instance");
fixture.componentRef.setInput("locale", "de");
fixture.componentRef.setInput("blockTypes", [makeBlockType()]);
fixture.detectChanges();
await new Promise((resolve) => setTimeout(resolve, 50));
if (host.querySelectorAll(".boardloom").length !== 1) {
  throw new Error("packed angular adapter duplicated a root during function churn");
}
if (host.querySelector(".boardloom")?.getAttribute("data-boardloom-instance") !== instance) {
  throw new Error("packed angular adapter remounted during function churn");
}
if (host.querySelector(".boardloom")?.getAttribute("data-boardloom-locale") !== "de") {
  throw new Error("packed angular adapter dropped presentation input during function churn");
}
if (errors.length !== 1 || errors[0].phase !== "input") {
  throw new Error("packed angular adapter did not report one input diagnostic during churn");
}
fixture.destroy();
if (host.querySelectorAll(".boardloom").length !== 0) {
  throw new Error("packed angular adapter left a mounted root");
}
TestBed.resetTestingModule();
console.log("packed angular consumer DOM smoke passed");
`;
writeFileSync(path.join(consumerRoot, "smoke-angular-dom.mjs"), angularDomSmokeSource);

try {
  execFileSync(process.execPath, ["smoke-angular-dom.mjs"], {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BOARDLOOM_HAPPY_DOM: import.meta.resolve("happy-dom") },
  });
} catch (error) {
  fail(`packed angular consumer DOM smoke failed: ${error.stderr || error.message}`);
}

const appSource = `import { createElement } from "react";
import { BoardloomView } from "@boardloom/react";

export const app = createElement(BoardloomView, {
  document: {
    schemaVersion: 1,
    id: "consumer-board",
    title: "Packed consumer board",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    theme: { mode: "light" },
    datasets: [],
    slices: [],
    filterGroups: [],
    blocks: [
      {
        id: "note",
        type: "text",
        title: "Packed consumer",
        bindings: [],
        config: { text: "Rendered from packed Boardloom tarballs." },
      },
    ],
    filters: [],
    comparisons: [],
    layout: {
      desktop: { columns: 12, placements: [{ blockId: "note", x: 0, y: 0, width: 6, height: 2 }] },
      tablet: { columns: 8, placements: [{ blockId: "note", x: 0, y: 0, width: 6, height: 2 }] },
      narrow: { columns: 4, placements: [{ blockId: "note", x: 0, y: 0, width: 4, height: 2 }] }
    },
    extensions: {}
  }
});
`;
writeFileSync(path.join(consumerRoot, "app.tsx"), appSource);

const bundlePath = path.join(consumerRoot, "app.bundle.js");
const stripTarballSourceMaps = {
  name: "strip-tarball-source-maps",
  setup(builder) {
    builder.onLoad({ filter: /node_modules[\\/]@boardloom[\\/].*\.js$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(/\/\/# sourceMappingURL=.*$/gm, ""),
      loader: "js",
    }));
  },
};
try {
  await build({
    entryPoints: [path.join(consumerRoot, "app.tsx")],
    outfile: bundlePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    sourcemap: false,
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
    plugins: [stripTarballSourceMaps],
    logLevel: "silent",
  });
} catch (error) {
  fail(`packed consumer React bundle failed: ${error.message}`);
}

const bundleText = readFileSync(bundlePath, "utf8");
for (const forbidden of [
  "packages/react/src",
  "packages/view-dom/src",
  "packages/core/src",
  ".tmp/build/packages",
]) {
  if (bundleText.includes(forbidden)) {
    fail(`packed consumer bundle references workspace source: ${forbidden}`);
  }
}
if (!bundleText.includes("BoardloomView")) {
  fail("packed consumer bundle does not include the React adapter");
}

console.log(
  `Packed consumer verification passed for ${requiredPackages.length} Boardloom tarballs, built-declaration typecheck, Node and DOM smokes for React and Angular, and a React bundle in .tmp/consumers/frameworks.`,
);
