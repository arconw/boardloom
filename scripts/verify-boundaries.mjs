import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { lexicalCompare, listPackages, repoRoot, toPosix } from "./lib/repo.mjs";

const packagePolicies = new Map([
  [
    "@boardloom/core",
    {
      internal: new Set(),
      external: new Set(),
    },
  ],
  [
    "@boardloom/view-dom",
    {
      internal: new Set(["@boardloom/core"]),
      external: new Set(),
    },
  ],
  [
    "@boardloom/renderers-echarts",
    {
      internal: new Set(["@boardloom/core"]),
      external: new Set(["echarts"]),
    },
  ],
  [
    "@boardloom/react",
    {
      internal: new Set(["@boardloom/core", "@boardloom/view-dom"]),
      external: new Set(["react", "react-dom"]),
    },
  ],
  [
    "@boardloom/angular",
    {
      internal: new Set(["@boardloom/core", "@boardloom/view-dom"]),
      external: new Set(["@angular/core"]),
    },
  ],
  [
    "@boardloom/svelte",
    {
      internal: new Set(["@boardloom/core", "@boardloom/view-dom"]),
      external: new Set(["svelte"]),
    },
  ],
]);

const forbiddenBarePackages = new Set([
  "@fastify/cors",
  "@fastify/helmet",
  "@nestjs/common",
  "@nestjs/core",
  "@prisma/client",
  "better-sqlite3",
  "drizzle-orm",
  "express",
  "fastify",
  "knex",
  "koa",
  "mongodb",
  "mysql",
  "mysql2",
  "pg",
  "prisma",
  "sequelize",
  "sqlite3",
  "typeorm",
]);

const forbiddenBarePrefixes = ["@fastify/", "@nestjs/", "@prisma/"];

const forbiddenNodeBuiltins = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "fs",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "tls",
  "tty",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

const forbiddenSourceNames = new Set(["server", "prisma", "legacy"]);
const forbiddenTargetSegments = new Set([
  ".ctx",
  ".env",
  ".evidence",
  ".git",
  ".questions",
  ".tmp",
  "coverage",
  "frontend",
  "legacy",
  "node_modules",
  "prisma",
  "src",
  "test",
  "tests",
  "video-materials",
]);

function packageNameOf(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function dependencyViolation(name, policy) {
  const bare = packageNameOf(name);

  if (bare.startsWith("@boardloom/")) {
    return policy.internal.has(bare)
      ? null
      : `internal dependency ${name} is not allowed by the package graph`;
  }

  if (
    forbiddenBarePackages.has(bare) ||
    forbiddenBarePrefixes.some((prefix) => bare.startsWith(prefix))
  ) {
    return `forbidden dependency ${name}`;
  }

  if (bare.startsWith("node:") || forbiddenNodeBuiltins.has(bare)) {
    return `Node or server dependency ${name} is forbidden`;
  }

  if (!policy.external.has(bare)) {
    return `external dependency ${name} is not allowed for this package`;
  }

  return null;
}

function extractSpecifiers(fileName, sourceText) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = [];

  function addStringLiteral(node) {
    if (node && ts.isStringLiteral(node)) {
      specifiers.push(node.text);
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    }

    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addStringLiteral(node.moduleReference.expression);
    }

    if (ts.isImportTypeNode(node)) {
      addStringLiteral(node.argument.literal);
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword) {
        addStringLiteral(node.arguments[0]);
      }
      if (ts.isIdentifier(expression) && expression.text === "require") {
        addStringLiteral(node.arguments[0]);
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isMetaProperty(expression.expression) &&
        expression.name.text === "resolve"
      ) {
        addStringLiteral(node.arguments[0]);
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "require" &&
        expression.name.text === "resolve"
      ) {
        addStringLiteral(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function listSourceFiles(directory) {
  const files = [];
  if (!existsSync(directory)) {
    return files;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...listSourceFiles(fullPath));
      }
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort(lexicalCompare);
}

function checkManifestSections(relativeDirectory, manifest, policy, violations) {
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      const violation = dependencyViolation(dependency, policy);
      if (violation) {
        violations.push(`${relativeDirectory}/package.json: ${section}: ${violation}`);
      }
    }
  }

  for (const field of ["bundledDependencies", "bundleDependencies"]) {
    const bundled = manifest[field];
    if (bundled === undefined) {
      continue;
    }
    if (!Array.isArray(bundled)) {
      violations.push(`${relativeDirectory}/package.json: ${field} must be an array`);
      continue;
    }
    for (const dependency of bundled) {
      const violation = dependencyViolation(dependency, policy);
      if (violation) {
        violations.push(`${relativeDirectory}/package.json: ${field}: ${violation}`);
      }
    }
  }
}

function collectExportTargets(manifest) {
  const targets = [];
  for (const field of ["main", "module", "types", "style", "browser"]) {
    if (typeof manifest[field] === "string") {
      targets.push({ field, target: manifest[field] });
    }
  }

  function walk(value, label) {
    if (typeof value === "string") {
      targets.push({ field: label, target: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${label}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        walk(entry, `${label}.${key}`);
      }
    }
  }

  walk(manifest.exports, "exports");
  return targets;
}

function targetViolation(target) {
  if (target === ".." || target.startsWith("../")) {
    return "export target escapes the package";
  }
  if (!target.startsWith("./")) {
    return "export target must start with ./";
  }
  if (target.includes("\\")) {
    return "export target must use forward slashes";
  }
  const normalized = path.posix.normalize(target.slice(2));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return "export target escapes the package";
  }
  for (const segment of normalized.split("/")) {
    if (forbiddenTargetSegments.has(segment)) {
      return `export target exposes forbidden segment ${segment}`;
    }
  }
  if (
    normalized !== "package.json" &&
    normalized !== "styles.css" &&
    !normalized.startsWith("dist/")
  ) {
    return "export target must point to package.json, styles.css or dist";
  }
  return null;
}

function checkExportTargets(packageInfo, violations, buildRequired, stagingRoot) {
  const { directory, manifest, relativeDirectory } = packageInfo;
  const targets = collectExportTargets(manifest);
  if (targets.length === 0) {
    violations.push(`${relativeDirectory}/package.json: package must declare export targets`);
    return;
  }

  for (const { field, target } of targets) {
    const violation = targetViolation(target);
    if (violation) {
      violations.push(`${relativeDirectory}/package.json: ${field}: ${violation}`);
      continue;
    }

    const normalized = path.posix.normalize(target.slice(2));
    const absoluteTarget = path.resolve(directory, normalized);
    const packageRoot = path.resolve(directory);
    if (absoluteTarget !== packageRoot && !absoluteTarget.startsWith(`${packageRoot}${path.sep}`)) {
      violations.push(`${relativeDirectory}/package.json: ${field}: target escapes the package`);
      continue;
    }

    if (!existsSync(absoluteTarget)) {
      if (normalized.startsWith("dist/")) {
        const stagingTarget = path.join(stagingRoot, path.basename(directory), normalized);
        if (!existsSync(stagingTarget)) {
          buildRequired.push(`${relativeDirectory}/package.json ${field} -> ${target}`);
        }
      } else {
        violations.push(`${relativeDirectory}/package.json: ${field}: target is missing`);
      }
      continue;
    }

    if (!statSync(absoluteTarget).isFile()) {
      violations.push(`${relativeDirectory}/package.json: ${field}: target is not a file`);
    }
  }

  const files = manifest.files;
  if (!Array.isArray(files)) {
    violations.push(`${relativeDirectory}/package.json: files must be an array`);
    return;
  }
  for (const required of ["dist", "README.md", "LICENSE"]) {
    if (!files.includes(required)) {
      violations.push(`${relativeDirectory}/package.json: files must include ${required}`);
    }
  }
  if (manifest.name === "@boardloom/view-dom" && !files.includes("styles.css")) {
    violations.push(`${relativeDirectory}/package.json: view-dom files must include styles.css`);
  }
  for (const entry of files) {
    if (typeof entry !== "string" || entry.startsWith("/") || entry.includes("..")) {
      violations.push(`${relativeDirectory}/package.json: invalid files entry ${String(entry)}`);
      continue;
    }
    for (const segment of entry.split("/")) {
      if (forbiddenTargetSegments.has(segment)) {
        violations.push(`${relativeDirectory}/package.json: files exposes ${segment}`);
      }
    }
    if (
      entry !== "dist" &&
      entry !== "README.md" &&
      entry !== "LICENSE" &&
      entry !== "styles.css" &&
      !entry.startsWith("dist/")
    ) {
      violations.push(`${relativeDirectory}/package.json: files entry ${entry} is not publishable`);
    }
  }
}

function checkSource(packageInfo, policy, violations) {
  const { directory, manifest } = packageInfo;
  const declaredRuntime = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const sourceFiles = listSourceFiles(path.join(directory, "src"));

  for (const file of sourceFiles) {
    const relativeFile = toPosix(path.relative(repoRoot, file));
    const segments = relativeFile.split("/");
    for (const segment of segments) {
      if (forbiddenSourceNames.has(segment.replace(/\.[^.]+$/, ""))) {
        violations.push(`${relativeFile}: forbidden source file name segment ${segment}`);
      }
    }

    const sourceText = readFileSync(file, "utf8");
    if (/\beval\s*\(/.test(sourceText)) {
      violations.push(`${relativeFile}: eval is forbidden in framework packages`);
    }
    if (/new\s+Function\s*\(/.test(sourceText)) {
      violations.push(`${relativeFile}: dynamic Function construction is forbidden`);
    }

    for (const specifier of extractSpecifiers(file, sourceText)) {
      if (specifier.startsWith("node:")) {
        violations.push(`${relativeFile}: Node built-in import ${specifier}`);
        continue;
      }

      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        if (specifier.startsWith("/")) {
          violations.push(`${relativeFile}: absolute import ${specifier}`);
          continue;
        }
        const resolved = path.resolve(path.dirname(file), specifier);
        const packageRoot = path.resolve(directory) + path.sep;
        if (!resolved.startsWith(packageRoot)) {
          violations.push(`${relativeFile}: import escapes the package boundary: ${specifier}`);
        }
        const resolvedRelative = toPosix(path.relative(repoRoot, resolved));
        for (const segment of resolvedRelative.split("/")) {
          if (forbiddenSourceNames.has(segment.replace(/\.[^.]+$/, ""))) {
            violations.push(`${relativeFile}: import reaches forbidden path ${specifier}`);
          }
        }
        continue;
      }

      const bare = packageNameOf(specifier);
      const violation = dependencyViolation(specifier, policy);
      if (violation) {
        violations.push(`${relativeFile}: ${violation}`);
      }
      if (!declaredRuntime.has(bare) && bare !== manifest.name) {
        violations.push(
          `${relativeFile}: import ${specifier} is not declared in runtime dependencies`,
        );
      }
    }
  }
}

function checkPackage(packageInfo, violations, buildRequired, stagingRoot) {
  const { manifest, relativeDirectory } = packageInfo;
  const policy = packagePolicies.get(manifest.name);

  if (!policy) {
    violations.push(
      `${relativeDirectory}: package name ${manifest.name} is not in the planned boundary graph`,
    );
    return;
  }

  if (manifest.type !== "module") {
    violations.push(`${relativeDirectory}/package.json: package must declare type=module`);
  }

  if (!Object.hasOwn(manifest, "sideEffects")) {
    violations.push(`${relativeDirectory}/package.json: package must declare sideEffects`);
  }

  checkManifestSections(relativeDirectory, manifest, policy, violations);
  checkExportTargets(packageInfo, violations, buildRequired, stagingRoot);
  checkSource(packageInfo, policy, violations);
}

function parseOptions(argv) {
  let packagesDirectory;
  let stagingRoot = path.join(repoRoot, ".tmp", "build", "packages");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--packages" || argv[index] === "--staging-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argv[index]} requires a directory`);
      }
      if (argv[index] === "--packages") {
        packagesDirectory = path.resolve(repoRoot, value);
      } else {
        stagingRoot = path.resolve(repoRoot, value);
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argv[index]}`);
  }
  return { packagesDirectory, stagingRoot };
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const packages = listPackages(options.packagesDirectory);
  const violations = [];
  const buildRequired = [];

  if (packages.length === 0) {
    violations.push("packages/: no package skeleton found");
  }

  for (const packageInfo of packages) {
    checkPackage(packageInfo, violations, buildRequired, options.stagingRoot);
  }

  if (violations.length > 0) {
    console.error("Package boundary check failed:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Package boundary check passed for ${packages.length} packages and ${packages
      .map((packageInfo) => packageInfo.manifest.name)
      .join(", ")}.`,
  );
  if (buildRequired.length > 0) {
    console.log(
      `Build required for ${buildRequired.length} package targets; run npm run build then npm run verify:packages.`,
    );
  }
}

main();
