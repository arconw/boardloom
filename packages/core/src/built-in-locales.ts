import arDictionary from "./locales/ar.json" with { type: "json" };
import deDictionary from "./locales/de.json" with { type: "json" };
import enDictionary from "./locales/en.json" with { type: "json" };
import esDictionary from "./locales/es.json" with { type: "json" };
import frDictionary from "./locales/fr.json" with { type: "json" };
import hiDictionary from "./locales/hi.json" with { type: "json" };
import jaDictionary from "./locales/ja.json" with { type: "json" };
import koDictionary from "./locales/ko.json" with { type: "json" };
import ptBRDictionary from "./locales/pt-BR.json" with { type: "json" };
import ruDictionary from "./locales/ru.json" with { type: "json" };
import zhCNDictionary from "./locales/zh-CN.json" with { type: "json" };
import type { BoardloomLocale } from "./locale.js";

export type LocaleDictionary = Readonly<Record<string, string>>;

const SOURCE_DICTIONARIES: Readonly<Record<BoardloomLocale, LocaleDictionary>> = Object.freeze({
  en: enDictionary,
  ru: ruDictionary,
  es: esDictionary,
  fr: frDictionary,
  de: deDictionary,
  "pt-BR": ptBRDictionary,
  "zh-CN": zhCNDictionary,
  ja: jaDictionary,
  ko: koDictionary,
  ar: arDictionary,
  hi: hiDictionary,
});

function freezeDictionary(dictionary: LocaleDictionary): LocaleDictionary {
  const entries: Array<readonly [string, string]> = [];
  for (const key of Object.keys(dictionary).sort()) {
    const value = dictionary[key];
    if (typeof value === "string") {
      entries.push(Object.freeze([key, value] as const));
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

export const BUILT_IN_DICTIONARIES: Readonly<Record<BoardloomLocale, LocaleDictionary>> =
  Object.freeze({
    en: freezeDictionary(SOURCE_DICTIONARIES.en),
    ru: freezeDictionary(SOURCE_DICTIONARIES.ru),
    es: freezeDictionary(SOURCE_DICTIONARIES.es),
    fr: freezeDictionary(SOURCE_DICTIONARIES.fr),
    de: freezeDictionary(SOURCE_DICTIONARIES.de),
    "pt-BR": freezeDictionary(SOURCE_DICTIONARIES["pt-BR"]),
    "zh-CN": freezeDictionary(SOURCE_DICTIONARIES["zh-CN"]),
    ja: freezeDictionary(SOURCE_DICTIONARIES.ja),
    ko: freezeDictionary(SOURCE_DICTIONARIES.ko),
    ar: freezeDictionary(SOURCE_DICTIONARIES.ar),
    hi: freezeDictionary(SOURCE_DICTIONARIES.hi),
  });

export function builtInDictionary(locale: BoardloomLocale): LocaleDictionary {
  return BUILT_IN_DICTIONARIES[locale];
}
