import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  validateExtensionStyles,
  type Diagnostic,
  type Result,
} from "@boardloom/core";

export interface ScopedStyleEntry {
  readonly id: string;
  readonly css: string;
}

export interface ScopedStylesHandle {
  readonly element: HTMLStyleElement;
  readonly scopeSelector: string;
  dispose(): void;
}

const CONDITIONAL_AT_RULES = new Set(["@media", "@supports", "@layer", "@container"]);

function styleFailure(path: string, message: string): readonly Diagnostic[] {
  return Object.freeze([
    createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID, path, { message }),
  ]);
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote !== "") {
      current += character;
      if (character === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      current += character;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      current += character;
      continue;
    }
    if (character === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function findBlockEnd(css: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let index = start; index < css.length; index += 1) {
    const character = css[index] ?? "";
    if (quote !== "") {
      if (character === quote && css[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function escapeScope(scopeToken: string): string {
  return scopeToken.replace(/[^A-Za-z0-9_-]/g, "-");
}

function scopeSelectorList(selectors: string, scopeSelector: string, path: string): Result<string> {
  const scoped: string[] = [];
  for (const selector of splitTopLevel(selectors, ",")) {
    const trimmed = selector.trim();
    if (trimmed === "") {
      continue;
    }
    if (/(^|[\s,>+~])(html|body|:root)(?=$|[\s,.#:[>+~])/i.test(trimmed)) {
      return fail(
        styleFailure(
          path,
          `The selector "${trimmed}" targets the host document and cannot be scoped to a Boardloom instance.`,
        ),
      );
    }
    scoped.push(trimmed.startsWith(scopeSelector) ? trimmed : `${scopeSelector} ${trimmed}`);
  }
  return scoped.length === 0
    ? fail(styleFailure(path, "An extension style rule has no selector."))
    : ok(scoped.join(", "));
}

function scopeRules(css: string, scopeSelector: string, path: string): Result<string> {
  let output = "";
  let index = 0;
  while (index < css.length) {
    const nextBrace = css.indexOf("{", index);
    if (nextBrace < 0) {
      const remainder = css.slice(index).trim();
      if (remainder === "" || remainder.startsWith("/*")) {
        output += remainder;
        break;
      }
      return fail(styleFailure(path, "The extension style sheet has an unterminated rule."));
    }
    const end = findBlockEnd(css, nextBrace);
    if (end < 0) {
      return fail(styleFailure(path, "The extension style sheet has an unbalanced block."));
    }
    const prelude = css.slice(index, nextBrace).trim();
    const body = css.slice(nextBrace + 1, end);
    if (prelude.startsWith("@")) {
      const name = prelude.split(/[\s(]/, 1)[0] ?? prelude;
      const normalized = name.toLowerCase();
      if (!CONDITIONAL_AT_RULES.has(normalized)) {
        return fail(
          styleFailure(path, `The at-rule ${name} cannot be scoped to a Boardloom instance.`),
        );
      }
      const inner = scopeRules(body, scopeSelector, path);
      if (!inner.ok) {
        return inner;
      }
      output += `${prelude}{${inner.value}}`;
    } else {
      const selectors = scopeSelectorList(prelude, scopeSelector, path);
      if (!selectors.ok) {
        return selectors;
      }
      output += `${selectors.value}{${body}}`;
    }
    index = end + 1;
  }
  return ok(output);
}

export function scopeExtensionCss(
  css: string,
  scopeToken: string,
  path = "extension/styles",
): Result<string> {
  const unsafe = validateExtensionStyles(css, path);
  if (unsafe.length > 0) {
    return fail(unsafe);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(scopeToken)) {
    return fail(styleFailure(path, "The style scope token contains unsupported characters."));
  }
  return scopeRules(css, `[data-boardloom-scope="${escapeScope(scopeToken)}"]`, path);
}

export function installScopedStyles(
  document: Document,
  scopeToken: string,
  entries: readonly ScopedStyleEntry[],
): Result<ScopedStylesHandle> {
  const scoped: string[] = [];
  for (const entry of entries) {
    if (entry.css.trim() === "") {
      continue;
    }
    const result = scopeExtensionCss(entry.css, scopeToken, `extension/${entry.id}/styles`);
    if (!result.ok) {
      return result;
    }
    scoped.push(result.value);
  }
  if (scoped.length === 0) {
    return fail(styleFailure("extension/styles", "No extension styles were supplied."));
  }
  const element = document.createElement("style");
  element.setAttribute("data-boardloom-plugin-styles", "true");
  element.setAttribute("data-boardloom-scope", scopeToken);
  element.textContent = scoped.join("\n");
  const parent = document.head ?? document.body;
  parent.append(element);
  let disposed = false;
  return ok(
    Object.freeze({
      element,
      scopeSelector: `[data-boardloom-scope="${escapeScope(scopeToken)}"]`,
      dispose(): void {
        if (disposed) {
          return;
        }
        disposed = true;
        element.remove();
      },
    }),
  );
}
