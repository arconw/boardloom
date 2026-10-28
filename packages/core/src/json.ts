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

export interface JsonValidationLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxArrayLength?: number;
  readonly maxObjectKeys?: number;
  readonly maxStringLength?: number;
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

export function validateJsonValue(
  value: unknown,
  options: number | JsonValidationLimits = {},
): JsonValidationResult {
  const limits = typeof options === "number" ? { maxDepth: options } : options;
  const maxDepth = limits.maxDepth ?? MAX_DEPTH;
  const issues: JsonValidationIssue[] = [];
  const ancestors = new Set<unknown>();
  let nodeCount = 0;
  let nodeLimitReached = false;

  function visit(current: unknown, path: string, depth: number): void {
    if (nodeLimitReached) {
      return;
    }
    nodeCount += 1;
    if (limits.maxNodes !== undefined && nodeCount > limits.maxNodes) {
      issues.push({
        path,
        message: `JSON value exceeds the maximum node count of ${limits.maxNodes}`,
      });
      nodeLimitReached = true;
      return;
    }
    if (depth > maxDepth) {
      issues.push({ path, message: `JSON value exceeds the maximum depth of ${maxDepth}` });
      return;
    }

    if (current === null || typeof current === "boolean") {
      return;
    }

    if (typeof current === "string") {
      if (limits.maxStringLength !== undefined && current.length > limits.maxStringLength) {
        issues.push({
          path,
          message: `JSON string exceeds the maximum length of ${limits.maxStringLength}`,
        });
      }
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
    if (limits.maxArrayLength !== undefined && length > limits.maxArrayLength) {
      issues.push({
        path,
        message: `JSON array exceeds the maximum length of ${limits.maxArrayLength}`,
      });
      return;
    }
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
    if (limits.maxObjectKeys !== undefined) {
      const keys = Object.getOwnPropertyNames(current);
      if (keys.length > limits.maxObjectKeys) {
        issues.push({
          path,
          message: `JSON object exceeds the maximum key count of ${limits.maxObjectKeys}`,
        });
        return;
      }
    }
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

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function jsonByteLength(value: JsonValue, maxBytes = Number.POSITIVE_INFINITY): number {
  const budget = Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : Number.POSITIVE_INFINITY;
  let total = 0;
  let exceeded = false;

  function add(bytes: number): boolean {
    total += bytes;
    if (total > budget) {
      exceeded = true;
      return false;
    }
    return true;
  }

  function walk(current: JsonValue): void {
    if (exceeded) {
      return;
    }
    if (current === null) {
      add(4);
      return;
    }
    if (typeof current === "string") {
      add(utf8ByteLength(JSON.stringify(current)));
      return;
    }
    if (typeof current === "number") {
      add(String(current).length);
      return;
    }
    if (typeof current === "boolean") {
      add(current ? 4 : 5);
      return;
    }
    if (Array.isArray(current)) {
      if (!add(1)) {
        return;
      }
      for (let index = 0; index < current.length; index += 1) {
        if (index > 0 && !add(1)) {
          return;
        }
        const entry = current[index];
        if (entry === undefined) {
          return;
        }
        walk(entry);
      }
      add(1);
      return;
    }
    if (!add(1)) {
      return;
    }
    const keys = Object.keys(current).sort();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) {
        continue;
      }
      if (index > 0 && !add(1)) {
        return;
      }
      if (!add(utf8ByteLength(JSON.stringify(key)))) {
        return;
      }
      if (!add(1)) {
        return;
      }
      const entry = current[key];
      if (entry === undefined) {
        return;
      }
      walk(entry);
    }
    add(1);
  }

  walk(value);
  return total;
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
