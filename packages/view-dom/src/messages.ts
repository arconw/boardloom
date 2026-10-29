import {
  BoardloomError,
  DEFAULT_LOCALE,
  DIAGNOSTIC_CODES,
  ENGLISH_MESSAGES,
  LOCALE_METADATA,
  createDiagnostic,
  createMessageProvider,
  isBoardloomLocale,
  isPlainObject,
  normalizeMessageDictionary,
  type BoardloomLocale,
  type MessageDictionaries,
  type MessageDictionary,
  type Diagnostic,
  type MessageParams,
  type MessageProvider,
  type TextDirection,
} from "@boardloom/core";

export interface ViewMessages {
  readonly locale: BoardloomLocale;
  readonly direction: TextDirection;
  readonly diagnostics: readonly Diagnostic[];
  has(key: string): boolean;
  text(key: string, params?: MessageParams): string;
  plural(key: string, count: number, params?: MessageParams): string;
}

export interface ViewMessageSource {
  readonly provider: MessageProvider;
  readonly overrides?: MessageDictionary;
  readonly dictionaries?: MessageDictionaries;
}

function normalizeDictionaries(dictionaries: MessageDictionaries | undefined): MessageDictionaries {
  if (dictionaries === undefined) {
    return {};
  }
  if (!isPlainObject(dictionaries)) {
    throw new BoardloomError(
      createDiagnostic(DIAGNOSTIC_CODES.MESSAGE_INVALID_DICTIONARY, "messageDictionaries", {
        message: "Per-locale message dictionaries must be a plain object.",
      }),
    );
  }
  const normalized: Partial<Record<BoardloomLocale, MessageDictionary>> = {};
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    if (dictionary === undefined) {
      continue;
    }
    if (!isBoardloomLocale(locale)) {
      throw new BoardloomError(
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_LOCALE, `messageDictionaries/${locale}`),
      );
    }
    normalized[locale] = normalizeMessageDictionary(dictionary, locale);
  }
  return Object.freeze(normalized);
}

export function validateViewMessageOptions(source: {
  readonly overrides?: MessageDictionary;
  readonly dictionaries?: MessageDictionaries;
}): void {
  normalizeDictionaries(source.dictionaries);
  if (source.overrides !== undefined) {
    normalizeMessageDictionary(source.overrides, DEFAULT_LOCALE);
  }
}

export function createViewMessages(source: ViewMessageSource): ViewMessages {
  const { provider } = source;
  const dictionaries = normalizeDictionaries(source.dictionaries);
  const overrides =
    source.overrides === undefined
      ? undefined
      : normalizeMessageDictionary(source.overrides, provider.locale);
  const localeDictionary = dictionaries[provider.locale];
  const selectedOverrides =
    localeDictionary === undefined && overrides === undefined
      ? undefined
      : Object.freeze({ ...(localeDictionary ?? {}), ...(overrides ?? {}) });
  const overrideProvider =
    selectedOverrides === undefined
      ? null
      : createMessageProvider({
          locale: provider.locale,
          dictionaries: { [provider.locale]: selectedOverrides },
        });
  const overrideKeys =
    selectedOverrides === undefined ? null : new Set<string>(Object.keys(selectedOverrides));
  const diagnostics: Diagnostic[] = [...provider.diagnostics];
  const unknown = (dictionary: MessageDictionary, dictionaryLocale: string): void => {
    for (const key of Object.keys(dictionary)) {
      if (Object.hasOwn(ENGLISH_MESSAGES, key) || /^(plugin|ext)\./.test(key)) {
        continue;
      }
      diagnostics.push(
        createDiagnostic(
          DIAGNOSTIC_CODES.MESSAGE_UNKNOWN_KEY,
          `locale/${dictionaryLocale}/${key}`,
          { message: `The view message key ${key} is not documented in the English catalog.` },
        ),
      );
    }
  };
  if (source.overrides !== undefined) {
    unknown(source.overrides, provider.locale);
  }
  for (const [dictionaryLocale, dictionary] of Object.entries(dictionaries)) {
    if (dictionary !== undefined) {
      unknown(dictionary, dictionaryLocale);
    }
  }
  const locale = provider.locale;
  const direction = LOCALE_METADATA[locale].direction;

  function has(key: string): boolean {
    return provider.has(key) || (overrideKeys?.has(key) ?? false);
  }

  function text(key: string, params?: MessageParams): string {
    if (overrideProvider && overrideKeys?.has(key)) {
      return overrideProvider.format(key, params).text;
    }
    return provider.format(key, params).text;
  }

  function plural(key: string, count: number, params?: MessageParams): string {
    if (overrideProvider && overrideKeys) {
      const category = new Intl.PluralRules(locale).select(count);
      const candidates = [`${key}.${category}`, `${key}.other`, key];
      const parameterSet = isPlainObject(params) ? (params as MessageParams) : {};
      const merged: Record<string, string | number | boolean | bigint> = { ...parameterSet };
      if (merged.count === undefined) {
        merged.count = count;
      }
      for (const candidate of candidates) {
        if (overrideKeys.has(candidate)) {
          return overrideProvider.format(candidate, merged).text;
        }
        if (provider.has(candidate)) {
          return provider.format(candidate, merged).text;
        }
      }
    }
    return provider.plural(key, count, params).text;
  }

  return Object.freeze({
    locale,
    direction,
    diagnostics: Object.freeze(diagnostics),
    has,
    text,
    plural,
  });
}

export function pluralKey(messages: ViewMessages, base: string, count: number): string {
  const category = new Intl.PluralRules(messages.locale).select(count);
  const key = `${base}.${category}`;
  return messages.has(key) ? key : `${base}.other`;
}
