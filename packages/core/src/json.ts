export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface JsonValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface JsonValidationResult {
  readonly valid: boolean;
  readonly issues: readonly JsonValidationIssue[];
}

const MAX_DEPTH = 64;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndex(key: string, length: number): boolean {
  if (key === "") {
    return false;
  }
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

export function validateJsonValue(value: unknown, maxDepth = MAX_DEPTH): JsonValidationResult {
  const issues: JsonValidationIssue[] = [];
  const ancestors = new Set<unknown>();

  function visit(current: unknown, path: string, depth: number): void {
    if (depth > maxDepth) {
      issues.push({ path, message: `JSON value exceeds the maximum depth of ${maxDepth}` });
      return;
    }

    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return;
    }

    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        issues.push({ path, message: "JSON numbers must be finite" });
      }
      return;
    }

    if (typeof current !== "object") {
      issues.push({ path, message: `Unsupported JSON value type: ${typeof current}` });
      return;
    }

    if (ancestors.has(current)) {
      issues.push({ path, message: "Cyclic references are not valid JSON" });
      return;
    }

    ancestors.add(current);
    if (Array.isArray(current)) {
      visitArray(current, path, depth);
    } else if (isPlainObject(current)) {
      visitObject(current, path, depth);
    } else {
      issues.push({ path, message: "Only plain objects and arrays are valid JSON containers" });
    }
    ancestors.delete(current);
  }

  function visitArray(current: unknown[], path: string, depth: number): void {
    const length = current.length;
    if (Object.getOwnPropertySymbols(current).length > 0) {
      issues.push({
        path: `${path}/[symbol]`,
        message: "Symbol properties are not valid JSON data",
      });
    }
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === "length") {
        continue;
      }
      const childPath = `${path}/${escapePointerSegment(key)}`;
      if (!isArrayIndex(key, length)) {
        issues.push({ path: childPath, message: "Array properties must be indexed JSON values" });
        continue;
      }
      visitOwnDescriptor(current, key, childPath, depth);
    }
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(current, String(index))) {
        issues.push({
          path: `${path}/${index}`,
          message: "Array holes are not valid JSON data",
        });
      }
    }
  }

  function visitObject(current: Record<string, unknown>, path: string, depth: number): void {
    if (Object.getOwnPropertySymbols(current).length > 0) {
      issues.push({
        path: `${path}/[symbol]`,
        message: "Symbol properties are not valid JSON data",
      });
    }
    for (const key of Object.getOwnPropertyNames(current)) {
      visitOwnDescriptor(current, key, `${path}/${escapePointerSegment(key)}`, depth);
    }
  }

  function visitOwnDescriptor(
    current: object,
    key: string,
    childPath: string,
    depth: number,
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor) {
      return;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      issues.push({
        path: childPath,
        message: "Accessor properties are not valid JSON data",
      });
      return;
    }
    if (!descriptor.enumerable) {
      issues.push({
        path: childPath,
        message: "Non-enumerable properties are not valid JSON data",
      });
      return;
    }
    visit(descriptor.value, childPath, depth + 1);
  }

  visit(value, "", 0);
  return { valid: issues.length === 0, issues };
}

export function isJsonValue(value: unknown): value is JsonValue {
  return validateJsonValue(value).valid;
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const clone = new Array(value.length);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Symbol properties are not JSON data.");
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length") {
        continue;
      }
      if (!isArrayIndex(key, value.length)) {
        throw new TypeError("Array properties must be indexed JSON values.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new TypeError("Accessor properties are not JSON data.");
      }
      if (!descriptor.enumerable) {
        throw new TypeError("Non-enumerable properties are not JSON data.");
      }
      clone[Number(key)] = cloneJson(descriptor.value as JsonValue);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, String(index))) {
        throw new TypeError("Array holes are not JSON data.");
      }
    }
    return clone as T;
  }
  if (!isPlainObject(value)) {
    throw new TypeError("Only plain objects are JSON data.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Symbol properties are not JSON data.");
  }
  const prototype = Object.getPrototypeOf(value);
  const clone = Object.create(prototype === null ? null : Object.prototype) as Record<
    string,
    JsonValue
  >;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("Accessor properties are not JSON data.");
    }
    if (!descriptor.enumerable) {
      throw new TypeError("Non-enumerable properties are not JSON data.");
    }
    Object.defineProperty(clone, key, {
      value: cloneJson(descriptor.value as JsonValue),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clone as T;
}

export function freezeJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Symbol properties are not JSON data.");
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length") {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new TypeError("Accessor properties are not JSON data.");
      }
      freezeJson(descriptor.value as JsonValue);
    }
    return Object.freeze(value);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Symbol properties are not JSON data.");
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("Accessor properties are not JSON data.");
    }
    freezeJson(descriptor.value as JsonValue);
  }
  return Object.freeze(value) as T;
}

function canonicalize(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  const sorted = {} as Record<string, JsonValue>;
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry !== undefined) {
      Object.defineProperty(sorted, key, {
        value: canonicalize(entry),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return sorted;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(cloneJson(value)));
}

export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }
  seen.add(objectValue);
  for (const entry of Object.values(objectValue)) {
    deepFreeze(entry, seen);
  }
  return Object.freeze(value) as T;
}
