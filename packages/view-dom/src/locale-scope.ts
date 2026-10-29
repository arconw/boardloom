import {
  LOCALE_METADATA,
  isBoardloomLocale,
  type BoardloomLocale,
  type TextDirection,
} from "@boardloom/core";

export interface LocaleScope {
  readonly locale: BoardloomLocale;
  readonly direction: TextDirection;
  readonly applied: boolean;
  apply(element: Element): void;
  clear(element: Element): void;
}

export function createLocaleScope(locale: BoardloomLocale): LocaleScope {
  if (!isBoardloomLocale(locale)) {
    throw new TypeError(`Unsupported Boardloom locale: ${String(locale)}`);
  }
  const direction = LOCALE_METADATA[locale].direction;
  let applied = false;
  return Object.freeze({
    locale,
    direction,
    get applied() {
      return applied;
    },
    apply(element: Element): void {
      element.setAttribute("lang", locale);
      element.setAttribute("dir", direction);
      element.setAttribute("data-boardloom-locale", locale);
      applied = true;
    },
    clear(element: Element): void {
      element.removeAttribute("lang");
      element.removeAttribute("dir");
      element.removeAttribute("data-boardloom-locale");
      applied = false;
    },
  });
}

export function applyLocaleScope(element: Element, locale: BoardloomLocale): LocaleScope {
  const scope = createLocaleScope(locale);
  scope.apply(element);
  return scope;
}
