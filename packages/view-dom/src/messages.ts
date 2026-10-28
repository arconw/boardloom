import {
  LOCALE_METADATA,
  createMessageProvider,
  type BoardloomLocale,
  type MessageDictionary,
  type MessageParams,
  type MessageProvider,
  type TextDirection,
} from "@boardloom/core";

export interface ViewMessages {
  readonly locale: BoardloomLocale;
  readonly direction: TextDirection;
  has(key: string): boolean;
  text(key: string, params?: MessageParams): string;
  plural(key: string, count: number, params?: MessageParams): string;
}

export interface ViewMessageSource {
  readonly provider: MessageProvider;
  readonly overrides?: MessageDictionary;
}

export function createViewMessages(source: ViewMessageSource): ViewMessages {
  const { provider, overrides } = source;
  const overrideProvider =
    overrides === undefined
      ? null
      : createMessageProvider({
          locale: provider.locale,
          dictionaries: { [provider.locale]: overrides },
        });
  const overrideKeys = overrides === undefined ? null : new Set<string>(Object.keys(overrides));
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
      if (overrideKeys.has(`${key}.${category}`) || overrideKeys.has(`${key}.other`)) {
        return overrideProvider.plural(key, count, params).text;
      }
    }
    return provider.plural(key, count, params).text;
  }

  return Object.freeze({ locale, direction, has, text, plural });
}

export function pluralKey(messages: ViewMessages, base: string, count: number): string {
  const category = new Intl.PluralRules(messages.locale).select(count);
  const key = `${base}.${category}`;
  return messages.has(key) ? key : `${base}.other`;
}
