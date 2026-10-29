import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";

const FORBIDDEN_AT_RULES = [
  "@import",
  "@charset",
  "@namespace",
  "@font-face",
  "@page",
  "@keyframes",
  "@-webkit-keyframes",
  "@counter-style",
  "@property",
];

const FORBIDDEN_FRAGMENTS = [
  "</style",
  "<script",
  "javascript:",
  "expression(",
  "behavior:",
  "-moz-binding",
];

const EXTERNAL_SCHEME = /(?:^|[^a-z0-9_-])(?:https?|ftp|file|blob):/i;
const PROTOCOL_RELATIVE = /["']\s*\/\//;
const URL_FUNCTION = /url\s*\(/gi;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function urlTargets(css: string): string[] {
  const targets: string[] = [];
  URL_FUNCTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_FUNCTION.exec(css)) !== null) {
    const start = match.index + match[0].length;
    let quote = "";
    let depth = 0;
    let value = "";
    for (let index = start; index < css.length; index += 1) {
      const character = css[index] ?? "";
      if (quote !== "") {
        if (character === quote) {
          quote = "";
        }
        value += character;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        value += character;
        continue;
      }
      if (character === "(") {
        depth += 1;
        value += character;
        continue;
      }
      if (character === ")") {
        if (depth === 0) {
          break;
        }
        depth -= 1;
        value += character;
        continue;
      }
      value += character;
    }
    targets.push(unquote(value));
  }
  return targets;
}

function externalTarget(target: string): boolean {
  if (target === "") {
    return false;
  }
  if (target.startsWith("#") || target.startsWith("data:")) {
    return false;
  }
  if (target.startsWith("//") || target.includes("\\")) {
    return true;
  }
  if (target.startsWith("var(")) {
    return true;
  }
  return EXTERNAL_SCHEME.test(target);
}

export function validateExtensionStyles(
  css: unknown,
  path = "extension/styles",
): readonly Diagnostic[] {
  if (typeof css !== "string") {
    return Object.freeze([
      createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
        message: "Extension styles must be a string of CSS declarations.",
      }),
    ]);
  }
  const diagnostics: Diagnostic[] = [];
  const lower = css.toLowerCase();
  if (css.includes("\\")) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
        message: "CSS escapes are not accepted in extension styles.",
      }),
    );
  }
  for (const token of FORBIDDEN_AT_RULES) {
    if (lower.includes(token)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
          message: `The at-rule ${token} cannot be scoped to a Boardloom instance.`,
          relatedIds: [token],
        }),
      );
    }
  }
  for (const token of FORBIDDEN_FRAGMENTS) {
    if (lower.includes(token)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
          message: "The style sheet contains an unsafe or external resource reference.",
        }),
      );
      break;
    }
  }
  if (EXTERNAL_SCHEME.test(css) || PROTOCOL_RELATIVE.test(css)) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
        message: "External URL schemes are not allowed in extension styles.",
      }),
    );
  }
  for (const target of urlTargets(css)) {
    if (externalTarget(target)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
          message: "Extension styles may only reference local fragments or data URLs.",
        }),
      );
      break;
    }
  }
  if (/(^|[},])\s*(html|body|:root)\s*[,{]/i.test(css)) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, {
        message:
          "Extension styles must be scoped to the Boardloom host; host document selectors are rejected.",
      }),
    );
  }
  return Object.freeze(diagnostics);
}

export function assertExtensionStyles(css: unknown, path = "extension/styles"): Result<void> {
  const diagnostics = validateExtensionStyles(css, path);
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}
