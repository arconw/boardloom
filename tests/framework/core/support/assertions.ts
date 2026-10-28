import { expect } from "vitest";
import type { Result } from "../../../../packages/core/src/index.js";

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(
      `Expected success but received: ${result.diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}`)
        .join(", ")}`,
    );
  }
  return result.value;
}

export function expectFailure(result: Result<unknown>, code: string): readonly { code: string }[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return [];
  }
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  return result.diagnostics;
}
