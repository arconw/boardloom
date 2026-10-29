import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./lib/repo.mjs";

const locales = ["en", "ru", "es", "fr", "de", "pt-BR", "zh-CN", "ja", "ko", "ar", "hi"];
const directory = path.join(repoRoot, "packages", "core", "src", "locales");
const failures = [];
const placeholders = (text) =>
  [...text.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");

function load(locale) {
  const file = path.join(directory, `${locale}.json`);
  if (!existsSync(file)) {
    failures.push(`${locale}: dictionary file is missing`);
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      failures.push(`${locale}: dictionary must be a JSON object`);
      return null;
    }
    return parsed;
  } catch (error) {
    failures.push(
      `${locale}: invalid JSON (${error instanceof Error ? error.message : "unknown"})`,
    );
    return null;
  }
}

const dictionaries = new Map(locales.map((locale) => [locale, load(locale)]));
const english = dictionaries.get("en");
const catalogPath = path.join(repoRoot, "docs", "design", "message-keys.json");
let catalog = null;
try {
  catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
} catch (error) {
  failures.push(
    `catalog: cannot read docs/design/message-keys.json (${error instanceof Error ? error.message : "unknown"})`,
  );
}
if (catalog !== null && Array.isArray(catalog.keys) && english !== null) {
  const documented = catalog.keys.map((entry) => entry.key).sort();
  const runtime = Object.keys(english).sort();
  if (
    documented.length !== runtime.length ||
    documented.some((key, index) => key !== runtime[index])
  ) {
    failures.push("catalog: documented keys do not match the runtime English key set");
  }
  for (const entry of catalog.keys) {
    if (entry.english !== english[entry.key]) {
      failures.push(`catalog: English text mismatch for ${entry.key}`);
    }
  }
}
if (english !== null) {
  const keys = Object.keys(english).sort();
  if (keys.length === 0) failures.push("en: dictionary is empty");
  for (const locale of locales) {
    const dictionary = dictionaries.get(locale);
    if (dictionary === null) continue;
    const localeKeys = Object.keys(dictionary).sort();
    const missing = keys.filter((key) => !Object.hasOwn(dictionary, key));
    const extra = localeKeys.filter((key) => !Object.hasOwn(english, key));
    if (missing.length > 0)
      failures.push(
        `${locale}: missing ${missing.length} keys (${missing.slice(0, 5).join(", ")})`,
      );
    if (extra.length > 0)
      failures.push(`${locale}: unexpected ${extra.length} keys (${extra.slice(0, 5).join(", ")})`);
    for (const key of keys) {
      const value = dictionary[key];
      if (typeof value !== "string" || value.trim() === "") {
        failures.push(`${locale}: ${key} must be a non-empty string`);
        continue;
      }
      if (placeholders(value) !== placeholders(english[key])) {
        failures.push(`${locale}: ${key} placeholder mismatch`);
      }
    }
  }
  for (const key of Object.keys(english)) {
    if (!key.endsWith(".one")) continue;
    const base = key.slice(0, -4);
    if (!Object.hasOwn(english, `${base}.other`)) continue;
    for (const category of ["zero", "one", "two", "few", "many", "other"]) {
      if (!Object.hasOwn(english, `${base}.${category}`)) {
        failures.push(`en: plural base ${base} is missing the ${category} category`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`check-locales: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `check-locales: ${locales.length} locales, ${Object.keys(english).length} exact keys each, placeholders aligned, catalog in sync.`,
);
