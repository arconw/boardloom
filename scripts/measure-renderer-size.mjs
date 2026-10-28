import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { repoRoot } from "./lib/repo.mjs";

const limitBytes = 400 * 1024;
const outputDirectory = path.join(repoRoot, ".tmp", "T07", "size");
mkdirSync(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [path.join(repoRoot, "packages", "renderers-echarts", "src", "index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  treeShaking: true,
  legalComments: "none",
  write: false,
  alias: {
    "@boardloom/core": path.join(repoRoot, "packages", "core", "src", "index.ts"),
  },
});

const output = result.outputFiles?.[0];
if (!output) {
  console.error("measure-renderer-size: esbuild produced no output");
  process.exit(1);
}
const rawBytes = output.contents.byteLength;
const gzipBytes = gzipSync(output.contents, { level: 9 }).byteLength;
const report = {
  task: "T07",
  package: "@boardloom/renderers-echarts",
  entry: "packages/renderers-echarts/src/index.ts",
  rawBytes,
  gzipBytes,
  limitGzipBytes: limitBytes,
  withinLimit: gzipBytes <= limitBytes,
};
writeFileSync(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outputDirectory, "renderers-echarts.min.js"), output.contents);

console.log(
  `ECharts renderer bundle: ${String(gzipBytes)} bytes gzip (${(gzipBytes / 1024).toFixed(1)} KiB), limit ${String(limitBytes)} bytes.`,
);
if (!report.withinLimit) {
  console.error("measure-renderer-size: bundle exceeds the NFR-001 renderer chunk target");
  process.exit(1);
}
