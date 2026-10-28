import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_MESSAGES,
  createDiagnostic,
  type Diagnostic,
} from "./diagnostics.js";
import { isPlainObject } from "./json.js";
import { DEFAULT_LOCALE, isBoardloomLocale, type BoardloomLocale } from "./locale.js";
import { UI_MESSAGES } from "./ui-messages.js";

export interface MessageDictionary {
  readonly [key: string]: string;
}

export type MessageParam = string | number | boolean | bigint;
export type MessageParams = Readonly<Record<string, MessageParam>>;

export interface MessageFormatResult {
  readonly key: string;
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly usedFallback: boolean;
}

export interface MessageProvider {
  readonly locale: BoardloomLocale;
  has(key: string): boolean;
  keys(): readonly string[];
  format(key: string, params?: MessageParams): MessageFormatResult;
  plural(key: string, count: number, params?: MessageParams): MessageFormatResult;
}

export interface MessageProviderOptions {
  readonly locale?: BoardloomLocale;
  readonly dictionaries?: Partial<Record<BoardloomLocale, MessageDictionary>>;
}

const DIAGNOSTIC_MESSAGE_KEYS: MessageDictionary = Object.freeze(
  Object.fromEntries(
    Object.entries(DIAGNOSTIC_MESSAGES).map(([code, message]) => [`diagnostic.${code}`, message]),
  ),
);

export const ENGLISH_MESSAGES: MessageDictionary = Object.freeze({
  ...UI_MESSAGES,
  ...DIAGNOSTIC_MESSAGE_KEYS,
});

function dictionaryError(locale: string, path: string, message: string): BoardloomError {
  return new BoardloomError(
    createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_INVALID_DICTIONARY, `locale/${locale}/${path}`, {
      message,
    }),
  );
}

export function normalizeMessageDictionary(
  dictionary: MessageDictionary,
  locale: string,
): MessageDictionary {
  if (!isPlainObject(dictionary)) {
    throw dictionaryError(locale, "", `The ${locale} message dictionary must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(dictionary).length > 0) {
    throw dictionaryError(locale, "[symbol]", "Symbol keys are not valid message keys.");
  }

  const descriptors = Object.getOwnPropertyDescriptors(dictionary);
  const normalized: Record<string, string> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw dictionaryError(
        locale,
        key,
        `Message value for ${key} in ${locale} must not be an accessor.`,
      );
    }
    if (!descriptor.enumerable) {
      throw dictionaryError(
        locale,
        key,
        `Message value for ${key} in ${locale} must be enumerable data.`,
      );
    }
    if (typeof descriptor.value !== "string") {
      throw dictionaryError(locale, key, `Message value for ${key} in ${locale} must be a string.`);
    }
    Object.defineProperty(normalized, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(normalized);
}

export function createMessageProvider(options: MessageProviderOptions = {}): MessageProvider {
  if (options.locale !== undefined && !isBoardloomLocale(options.locale)) {
    throw new BoardloomError(createDiagnostic(DIAGNOSTIC_CODES.INVALID_LOCALE, "locale"));
  }

  const locale = options.locale ?? DEFAULT_LOCALE;
  const dictionaries = options.dictionaries ?? {};
  const normalizedDictionaries: Partial<Record<BoardloomLocale, MessageDictionary>> = {};
  for (const [dictionaryLocale, dictionary] of Object.entries(dictionaries)) {
    if (dictionary !== undefined) {
      normalizedDictionaries[dictionaryLocale as BoardloomLocale] = normalizeMessageDictionary(
        dictionary,
        dictionaryLocale,
      );
    }
  }

  const hostDictionary = normalizedDictionaries[locale];
  const selected: MessageDictionary =
    locale === DEFAULT_LOCALE
      ? Object.freeze({ ...ENGLISH_MESSAGES, ...(hostDictionary ?? {}) })
      : Object.freeze({ ...(hostDictionary ?? {}) });

  function lookup(key: string): { text: string; usedFallback: boolean } | null {
    const selectedText = selected[key];
    if (typeof selectedText === "string") {
      return { text: selectedText, usedFallback: false };
    }
    const fallbackText = ENGLISH_MESSAGES[key];
    if (typeof fallbackText === "string") {
      return { text: fallbackText, usedFallback: true };
    }
    return null;
  }

  function has(key: string): boolean {
    return lookup(key) !== null;
  }

  function format(key: string, params: MessageParams = {}): MessageFormatResult {
    const diagnostics: Diagnostic[] = [];
    const entry = lookup(key);
    if (!entry) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_MISSING_KEY, `message/${key}`, {
          message: `No message is defined for the key ${key}.`,
        }),
      );
      return Object.freeze({
        key,
        text: key,
        diagnostics: Object.freeze(diagnostics),
        usedFallback: false,
      });
    }

    const missing = new Set<string>();
    const text = entry.text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, name: string) => {
      const value = params[name];
      if (value === undefined) {
        missing.add(name);
        return "";
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
      ) {
        return String(value);
      }
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_INVALID_PARAM, `message/${key}/${name}`, {
          message: `Message parameter ${name} must be a scalar value.`,
        }),
      );
      return "";
    });

    for (const name of missing) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_MISSING_PARAM, `message/${key}/${name}`, {
          message: `Message ${key} requires the parameter ${name}.`,
        }),
      );
    }

    return Object.freeze({
      key,
      text,
      diagnostics: Object.freeze(diagnostics),
      usedFallback: entry.usedFallback,
    });
  }

  function plural(key: string, count: number, params: MessageParams = {}): MessageFormatResult {
    if (!Number.isFinite(count)) {
      return format(key, params);
    }
    const category = new Intl.PluralRules(locale).select(count);
    const merged: Record<string, MessageParam> = { ...params };
    if (merged.count === undefined) {
      merged.count = count;
    }
    const categoryKey = `${key}.${category}`;
    if (has(categoryKey)) {
      return format(categoryKey, merged);
    }
    const otherKey = `${key}.other`;
    if (has(otherKey)) {
      return format(otherKey, merged);
    }
    return format(key, merged);
  }

  const keys = Object.freeze(
    [...new Set([...Object.keys(ENGLISH_MESSAGES), ...Object.keys(selected)])].sort(),
  );

  return Object.freeze({ locale, has, keys: () => keys, format, plural });
}
