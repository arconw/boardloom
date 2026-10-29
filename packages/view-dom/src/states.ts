import { defaultDiagnosticMessage, type Diagnostic, type QueryState } from "@boardloom/core";
import { clearElement, createElement, setHostText, setText, setKeyedText } from "./dom.js";
import { pluralKey, type ViewMessages } from "./messages.js";

export function renderLoadingState(container: HTMLElement, messages: ViewMessages): void {
  clearElement(container);
  const state = createElement(container.ownerDocument, "div", "bl-state bl-state--loading");
  state.setAttribute("data-state", "loading");
  state.setAttribute("role", "status");
  const skeleton = createElement(container.ownerDocument, "span", "bl-skeleton");
  skeleton.setAttribute("aria-hidden", "true");
  const title = createElement(container.ownerDocument, "p", "bl-state__title");
  setKeyedText(title, "state.loading.title", messages.text("state.loading.title"));
  state.append(skeleton, title);
  container.append(state);
}

export function renderEmptyState(
  container: HTMLElement,
  messages: ViewMessages,
  scopeText: string | null,
): void {
  clearElement(container);
  const state = createElement(container.ownerDocument, "div", "bl-state bl-state--empty");
  state.setAttribute("data-state", "empty");
  state.setAttribute("role", "status");
  const title = createElement(container.ownerDocument, "p", "bl-state__title");
  setKeyedText(title, "state.empty.title", messages.text("state.empty.title"));
  const body = createElement(container.ownerDocument, "p", "bl-state__body");
  setKeyedText(body, "state.empty.body", messages.text("state.empty.body"));
  state.append(title, body);
  if (scopeText !== null && scopeText !== "") {
    const scope = createElement(container.ownerDocument, "p", "bl-state__scope");
    setHostText(scope, scopeText);
    state.append(scope);
  }
  container.append(state);
}

export function renderCancelledState(container: HTMLElement, messages: ViewMessages): void {
  clearElement(container);
  const state = createElement(container.ownerDocument, "div", "bl-state bl-state--cancelled");
  state.setAttribute("data-state", "cancelled");
  state.setAttribute("role", "status");
  const title = createElement(container.ownerDocument, "p", "bl-state__title");
  setKeyedText(title, "state.cancelled.title", messages.text("state.cancelled.title"));
  const body = createElement(container.ownerDocument, "p", "bl-state__body");
  setKeyedText(body, "state.cancelled.body", messages.text("state.cancelled.body"));
  state.append(title, body);
  container.append(state);
}

export function renderDiagnosticList(
  container: HTMLElement,
  messages: ViewMessages,
  diagnostics: readonly Diagnostic[],
): void {
  clearElement(container);
  if (diagnostics.length === 0) {
    const none = createElement(container.ownerDocument, "p", "bl-diagnostics__none");
    setKeyedText(none, "viewer.diagnostics.none", messages.text("viewer.diagnostics.none"));
    container.append(none);
    return;
  }
  const list = createElement(container.ownerDocument, "ul", "bl-diagnostics__list");
  for (const diagnostic of diagnostics) {
    const item = createElement(container.ownerDocument, "li", "bl-diagnostic");
    item.setAttribute("data-severity", diagnostic.severity);
    const heading = createElement(container.ownerDocument, "p", "bl-diagnostic__heading");
    const severity = createElement(container.ownerDocument, "span", "bl-diagnostic__severity");
    const severityKey =
      diagnostic.severity === "error"
        ? "viewer.diagnostics.severity.error"
        : diagnostic.severity === "warning"
          ? "viewer.diagnostics.severity.warning"
          : "viewer.diagnostics.severity.info";
    setKeyedText(severity, severityKey, messages.text(severityKey));
    const code = createElement(container.ownerDocument, "code", "bl-diagnostic__code");
    setText(code, diagnostic.code);
    heading.append(severity, code);
    const message = createElement(container.ownerDocument, "p", "bl-diagnostic__message");
    const messageKey = `diagnostic.${diagnostic.code}`;
    let detailText: string | null = null;
    if (diagnostic.detailKey !== undefined && messages.has(diagnostic.detailKey)) {
      detailText = messages.text(diagnostic.detailKey, diagnostic.detailParams);
    } else if (
      diagnostic.source === "host" &&
      diagnostic.message.trim() !== "" &&
      diagnostic.message !== defaultDiagnosticMessage(diagnostic.code)
    ) {
      detailText = diagnostic.message;
    }
    if (messages.has(messageKey)) {
      setKeyedText(message, messageKey, messages.text(messageKey));
    } else {
      setText(message, diagnostic.message);
    }
    const pathLabel = createElement(container.ownerDocument, "span", "bl-diagnostic__label");
    setKeyedText(pathLabel, "viewer.diagnostics.path", messages.text("viewer.diagnostics.path"));
    const path = createElement(container.ownerDocument, "code", "bl-diagnostic__path");
    setText(path, diagnostic.path);
    const pathRow = createElement(container.ownerDocument, "p", "bl-diagnostic__path-row");
    pathRow.append(pathLabel, path);
    item.append(heading, message);
    if (detailText !== null) {
      const detail = createElement(container.ownerDocument, "p", "bl-diagnostic__detail");
      setText(detail, detailText);
      item.append(detail);
    }
    item.append(pathRow);
    list.append(item);
  }
  container.append(list);
}

export function renderErrorState(
  container: HTMLElement,
  messages: ViewMessages,
  diagnostics: readonly Diagnostic[],
): void {
  clearElement(container);
  const state = createElement(container.ownerDocument, "div", "bl-state bl-state--error");
  state.setAttribute("data-state", "error");
  state.setAttribute("role", "alert");
  const title = createElement(container.ownerDocument, "p", "bl-state__title");
  setKeyedText(title, "state.error.title", messages.text("state.error.title"));
  const body = createElement(container.ownerDocument, "p", "bl-state__body");
  setKeyedText(body, "state.error.body", messages.text("state.error.body"));
  state.append(title, body);
  if (diagnostics.length > 0) {
    const listContainer = createElement(container.ownerDocument, "div", "bl-state__diagnostics");
    renderDiagnosticList(listContainer, messages, diagnostics);
    state.append(listContainer);
  }
  container.append(state);
}

export function renderQueryState(
  container: HTMLElement,
  messages: ViewMessages,
  state: QueryState | null,
  fallbackDiagnostics: readonly Diagnostic[] | null,
  scopeText: string | null = null,
): boolean {
  clearElement(container);
  if (fallbackDiagnostics !== null && fallbackDiagnostics.length > 0) {
    renderErrorState(container, messages, fallbackDiagnostics);
    return false;
  }
  if (state === null || state.phase === "idle" || state.phase === "loading") {
    renderLoadingState(container, messages);
    return false;
  }
  if (state.phase === "error") {
    renderErrorState(container, messages, state.diagnostics);
    return false;
  }
  if (state.phase === "cancelled") {
    renderCancelledState(container, messages);
    return false;
  }
  if (state.phase === "empty" || state.rows.length === 0) {
    renderEmptyState(container, messages, scopeText);
    return false;
  }
  return true;
}

export function renderDataBanner(
  container: HTMLElement,
  messages: ViewMessages,
  state: QueryState | null,
  formatters: {
    formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
  },
): void {
  clearElement(container);
  if (state === null) {
    return;
  }
  if (state.phase === "stale") {
    const banner = createElement(container.ownerDocument, "p", "bl-banner bl-banner--stale");
    banner.setAttribute("data-state", "stale");
    banner.setAttribute("role", "status");
    const title = createElement(container.ownerDocument, "span", "bl-banner__title");
    setKeyedText(title, "state.stale.title", messages.text("state.stale.title"));
    banner.append(title);
    if (state.updatedAt !== null && Number.isFinite(state.updatedAt)) {
      const body = createElement(container.ownerDocument, "span", "bl-banner__body");
      setKeyedText(
        body,
        "state.stale.body",
        messages.text("state.stale.body", {
          time: formatters.formatDate(state.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
        }),
      );
      banner.append(body);
    }
    container.append(banner);
    return;
  }
  if (state.phase === "partial") {
    const banner = createElement(container.ownerDocument, "p", "bl-banner bl-banner--partial");
    banner.setAttribute("data-state", "partial");
    banner.setAttribute("role", "status");
    const title = createElement(container.ownerDocument, "span", "bl-banner__title");
    setKeyedText(title, "state.partial.title", messages.text("state.partial.title"));
    banner.append(title);
    const total = state.counts.totalRows;
    if (total !== null) {
      const body = createElement(container.ownerDocument, "span", "bl-banner__body");
      const key = pluralKey(messages, "state.partial.body", state.counts.returnedRows);
      setKeyedText(
        body,
        key,
        messages.plural("state.partial.body", state.counts.returnedRows, {
          returned: state.counts.returnedRows,
          total,
        }),
      );
      banner.append(body);
    }
    container.append(banner);
  }
}
