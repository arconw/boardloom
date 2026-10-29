import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_MESSAGES,
  createDiagnostic,
  type Diagnostic,
} from "./diagnostics.js";
import { isPlainObject } from "./json.js";
import { DEFAULT_LOCALE, isBoardloomLocale, type BoardloomLocale } from "./locale.js";
import { BUILT_IN_DICTIONARIES } from "./built-in-locales.js";
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

export interface MessageSelection {
  readonly text: string;
  readonly usedFallback: boolean;
}

export interface MessageProvider {
  readonly locale: BoardloomLocale;
  readonly diagnostics: readonly Diagnostic[];
  has(key: string): boolean;
  keys(): readonly string[];
  format(key: string, params?: MessageParams): MessageFormatResult;
  plural(key: string, count: number, params?: MessageParams): MessageFormatResult;
}

export type MessageDictionaries = Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;

export function mergeMessageDictionaries(
  ...layers: readonly (MessageDictionaries | undefined)[]
): MessageDictionaries {
  const merged: Partial<Record<BoardloomLocale, MessageDictionary>> = {};
  for (const layer of layers) {
    if (layer === undefined) {
      continue;
    }
    if (!isPlainObject(layer)) {
      throw new BoardloomError(
        createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_INVALID_DICTIONARY, "messageDictionaries", {
          message: "Message dictionary layers must be plain objects.",
        }),
      );
    }
    for (const [locale, dictionary] of Object.entries(layer)) {
      if (dictionary === undefined) {
        continue;
      }
      if (!isBoardloomLocale(locale)) {
        throw new BoardloomError(
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_LOCALE, `messageDictionaries/${locale}`),
        );
      }
      const current = merged[locale] ?? {};
      merged[locale] = Object.freeze({
        ...current,
        ...normalizeMessageDictionary(dictionary, locale),
      });
    }
  }
  return Object.freeze(merged);
}

export interface MessageProviderOptions {
  readonly locale?: BoardloomLocale;
  readonly dictionaries?: MessageDictionaries;
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

function ownText(dictionary: MessageDictionary, key: string): string | null {
  return Object.hasOwn(dictionary, key) && typeof dictionary[key] === "string"
    ? dictionary[key]
    : null;
}

export function selectMessageText(
  selected: MessageDictionary,
  fallback: MessageDictionary,
  key: string,
): MessageSelection | null {
  const selectedText = ownText(selected, key);
  if (selectedText !== null) {
    return Object.freeze({ text: selectedText, usedFallback: false });
  }
  const fallbackText = ownText(fallback, key);
  if (fallbackText !== null) {
    return Object.freeze({ text: fallbackText, usedFallback: true });
  }
  return null;
}

function interpolateMessageText(
  template: string,
  key: string,
  params: MessageParams,
  diagnostics?: Diagnostic[],
): string {
  const rawParams = params as unknown;
  const parameterSet: MessageParams = isPlainObject(rawParams) ? (rawParams as MessageParams) : {};
  if (!isPlainObject(rawParams)) {
    diagnostics?.push(
      createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_INVALID_PARAM, `message/${key}/params`, {
        message: `Message parameters for ${key} must be a plain object.`,
      }),
    );
  }
  const missing = new Set<string>();
  const text = template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, name: string) => {
    const value = Object.hasOwn(parameterSet, name) ? parameterSet[name] : undefined;
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
    diagnostics?.push(
      createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_INVALID_PARAM, `message/${key}/${name}`, {
        message: `Message parameter ${name} must be a scalar value.`,
      }),
    );
    return "";
  });
  for (const name of missing) {
    diagnostics?.push(
      createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_MISSING_PARAM, `message/${key}/${name}`, {
        message: `Message ${key} requires the parameter ${name}.`,
      }),
    );
  }
  return text;
}

export function formatEnglishMessage(key: string, params: MessageParams = {}): string {
  return interpolateMessageText(ownText(ENGLISH_MESSAGES, key) ?? key, key, params);
}

export function createMessageProvider(options: MessageProviderOptions = {}): MessageProvider {
  if (options.locale !== undefined && !isBoardloomLocale(options.locale)) {
    throw new BoardloomError(createDiagnostic(DIAGNOSTIC_CODES.INVALID_LOCALE, "locale"));
  }

  const locale = options.locale ?? DEFAULT_LOCALE;
  const dictionaries = options.dictionaries ?? {};
  const normalizedDictionaries: Partial<Record<BoardloomLocale, MessageDictionary>> = {};
  for (const [dictionaryLocale, dictionary] of Object.entries(dictionaries)) {
    if (dictionary === undefined) {
      continue;
    }
    if (!isBoardloomLocale(dictionaryLocale)) {
      throw new BoardloomError(
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_LOCALE, `dictionaries/${dictionaryLocale}`),
      );
    }
    normalizedDictionaries[dictionaryLocale] = normalizeMessageDictionary(
      dictionary,
      dictionaryLocale,
    );
  }

  const hostDictionary = normalizedDictionaries[locale];
  const selected: MessageDictionary = Object.freeze({
    ...BUILT_IN_DICTIONARIES[locale],
    ...(hostDictionary ?? {}),
  });
  const unknownKeyDiagnostics: Diagnostic[] = [];
  for (const [dictionaryLocale, dictionary] of Object.entries(normalizedDictionaries)) {
    for (const key of Object.keys(dictionary ?? {})) {
      if (Object.hasOwn(ENGLISH_MESSAGES, key) || /^(plugin|ext)\./.test(key)) {
        continue;
      }
      unknownKeyDiagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.MESSAGE_UNKNOWN_KEY,
          `locale/${dictionaryLocale}/${key}`,
          { message: `The host message key ${key} is not documented in the English catalog.` },
        ),
      );
    }
  }
  const providerDiagnostics = Object.freeze(unknownKeyDiagnostics);

  function lookup(key: string): MessageSelection | null {
    return selectMessageText(selected, ENGLISH_MESSAGES, key);
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
      const neutral =
        selectMessageText(selected, ENGLISH_MESSAGES, "common.unknown")?.text ??
        ENGLISH_MESSAGES["common.unknown"] ??
        "Unknown";
      return Object.freeze({
        key,
        text: neutral,
        diagnostics: Object.freeze(diagnostics),
        usedFallback: true,
      });
    }

    return Object.freeze({
      key,
      text: interpolateMessageText(entry.text, key, params, diagnostics),
      diagnostics: Object.freeze(diagnostics),
      usedFallback: entry.usedFallback,
    });
  }

  function plural(key: string, count: number, params: MessageParams = {}): MessageFormatResult {
    if (!Number.isFinite(count)) {
      return format(key, params);
    }
    const category = new Intl.PluralRules(locale).select(count);
    const merged: Record<string, MessageParam> = isPlainObject(params)
      ? { ...(params as MessageParams) }
      : {};
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

  return Object.freeze({
    locale,
    diagnostics: providerDiagnostics,
    has,
    keys: () => keys,
    format,
    plural,
  });
}
