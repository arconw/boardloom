import { BUILT_IN_DICTIONARIES } from "@boardloom/core";

interface DriverResult {
  readonly checks: Record<string, unknown>;
  readonly errors: string[];
}

const errors: string[] = [];
window.addEventListener("error", (event) => {
  errors.push(event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

async function waitFor(predicate: () => boolean, label: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".boardloom");
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing element ${selector}`);
  }
  return element;
}

function chip(): string {
  return document.querySelector(".bl-filter-chip")?.textContent ?? "";
}

function setSelect(id: string, value: string): void {
  const select = query<HTMLSelectElement>(`#${id}`);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function scenario(): Promise<DriverResult> {
  const checks: Record<string, unknown> = {};
  const check = (name: string, condition: boolean, detail?: unknown): void => {
    checks[name] = condition;
    if (!condition) {
      errors.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
    }
  };
  await waitFor(
    () => root() !== null && document.getElementById("locale-select") !== null,
    "example",
  );
  await waitFor(() => query<HTMLElement>("#example-active").textContent === "1", "active instance");
  const firstInstance = root()?.getAttribute("data-boardloom-instance") ?? "";
  const chipBefore = chip();
  const rowsBefore = document.querySelectorAll(".bl-table tbody tr").length;
  check("tableRows", rowsBefore > 0, rowsBefore);
  check("oneRoot", document.querySelectorAll(".boardloom").length === 1);
  check("activeInstance", query<HTMLElement>("#example-active").textContent === "1");
  check("initialTimezone", root()?.getAttribute("data-boardloom-timezone") === "UTC");
  check("filterChip", chipBefore.includes("North, South"), chipBefore);
  const localeNote = document.getElementById("locale-note")?.textContent ?? "";
  check(
    "localeNote",
    localeNote.includes("T17") &&
      localeNote.toLowerCase().includes("english") &&
      localeNote.toLowerCase().includes("timezone"),
    localeNote,
  );

  setSelect("locale-select", "de");
  setSelect("timezone-select", "Asia/Tokyo");
  await waitFor(
    () =>
      root()?.getAttribute("data-boardloom-timezone") === "Asia/Tokyo" &&
      root()?.getAttribute("data-boardloom-locale") === "de",
    "locale update",
  );
  check("localeForwarded", query<HTMLElement>("#example-locale").textContent === "de");
  check("timezoneForwarded", query<HTMLElement>("#example-timezone").textContent === "Asia/Tokyo");
  check("sameInstance", root()?.getAttribute("data-boardloom-instance") === firstInstance);
  check("filterPreserved", chip().toLowerCase().includes("north, south"), chip());
  check(
    "rowsPreserved",
    document.querySelectorAll(".bl-table tbody tr").length === rowsBefore,
    document.querySelectorAll(".bl-table tbody tr").length,
  );
  await waitFor(
    () => (document.getElementById("last-event")?.textContent ?? "").includes("locale:changed"),
    "locale event",
  );
  check(
    "eventForwarded",
    (document.getElementById("last-event")?.textContent ?? "").includes("locale:changed"),
  );
  const modeText = (): string => query<HTMLElement>('button[data-mode="viewer"]').textContent ?? "";
  check("localizedDe", modeText() === BUILT_IN_DICTIONARIES.de["mode.viewer"], modeText());
  const rowsBeforeLocales = document.querySelectorAll(".bl-table tbody tr").length;
  const localeSamples: Record<string, { text: string; dir: string | null; lang: string | null }> =
    {};
  for (const locale of ["ja", "ar", "ru"] as const) {
    setSelect("locale-select", locale);
    await waitFor(
      () =>
        root()?.getAttribute("data-boardloom-locale") === locale &&
        modeText() === BUILT_IN_DICTIONARIES[locale]["mode.viewer"],
      `localized ${locale}`,
      12000,
    );
    localeSamples[locale] = {
      text: modeText(),
      dir: root()?.getAttribute("dir") ?? null,
      lang: root()?.getAttribute("lang") ?? null,
    };
    check(`localizedMode_${locale}`, modeText() === BUILT_IN_DICTIONARIES[locale]["mode.viewer"]);
    check(`filterPreserved_${locale}`, chip().toLowerCase().includes("north, south"), chip());
    check(
      `rowsPreserved_${locale}`,
      document.querySelectorAll(".bl-table tbody tr").length === rowsBeforeLocales,
      document.querySelectorAll(".bl-table tbody tr").length,
    );
    check(`hostDirUntouched_${locale}`, document.documentElement.getAttribute("dir") === null);
  }
  check("localeJa", localeSamples.ja?.dir === "ltr" && localeSamples.ja?.lang === "ja");
  check("localeArRtl", localeSamples.ar?.dir === "rtl" && localeSamples.ar?.lang === "ar");
  check("localeRu", localeSamples.ru?.dir === "ltr" && localeSamples.ru?.lang === "ru");
  setSelect("locale-select", "en");
  await waitFor(
    () =>
      root()?.getAttribute("data-boardloom-locale") === "en" &&
      modeText() === BUILT_IN_DICTIONARIES.en["mode.viewer"],
    "english restore",
  );
  check("filterAfterLocales", chip().toLowerCase().includes("north, south"), chip());
  check(
    "rowsAfterLocales",
    document.querySelectorAll(".bl-table tbody tr").length === rowsBeforeLocales,
    document.querySelectorAll(".bl-table tbody tr").length,
  );

  query<HTMLInputElement>("#messages-toggle").click();
  await waitFor(
    () => document.querySelector('button[data-mode="viewer"]')?.textContent === "Reader",
    "message override",
  );
  check(
    "messageOverride",
    document.querySelector('button[data-mode="viewer"]')?.textContent === "Reader",
  );

  query<HTMLButtonElement>('button[data-mode="editor"]').click();
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "editor", "editor mode");
  check("builtInEditor", root()?.getAttribute("data-boardloom-mode") === "editor");
  query<HTMLButtonElement>('button[data-mode="viewer"]').click();
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "viewer", "viewer mode");
  check("builtInViewer", root()?.getAttribute("data-boardloom-mode") === "viewer");

  query<HTMLButtonElement>("#host-editor").click();
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "editor", "host editor");
  check("hostEditor", root()?.getAttribute("data-boardloom-mode") === "editor");
  query<HTMLButtonElement>("#host-viewer").click();
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "viewer", "host viewer");
  check("hostViewer", root()?.getAttribute("data-boardloom-mode") === "viewer");

  query<HTMLButtonElement>("#export-document").click();
  await waitFor(() => document.getElementById("export-preview") !== null, "export preview");
  check(
    "exportPreview",
    (document.getElementById("export-preview")?.textContent ?? "").includes("react-example-board"),
  );

  query<HTMLButtonElement>("#toggle-mount").click();
  await waitFor(() => root() === null, "unmount");
  await waitFor(() => query<HTMLElement>("#example-active").textContent === "0", "inactive");
  check("unmountClean", document.querySelectorAll(".boardloom").length === 0);
  check("disposeCounted", query<HTMLElement>("#example-disposed").textContent === "2");

  query<HTMLButtonElement>("#toggle-mount").click();
  await waitFor(() => root() !== null, "remount");
  const secondInstance = root()?.getAttribute("data-boardloom-instance") ?? "";
  check("remount", secondInstance !== "" && secondInstance !== firstInstance);
  check("remountSingle", document.querySelectorAll(".boardloom").length === 1);
  check("remountActive", query<HTMLElement>("#example-active").textContent === "1");

  const disposedBeforeDirty = Number(query<HTMLElement>("#example-disposed").textContent ?? "0");
  query<HTMLButtonElement>('button[data-mode="editor"]').click();
  await waitFor(
    () => root()?.getAttribute("data-boardloom-mode") === "editor",
    "dirty editor mode",
  );
  const addButton = document.querySelector<HTMLButtonElement>('[data-editor-add="text"]');
  check("editorAddAvailable", addButton !== null);
  if (addButton !== null) {
    addButton.click();
    await waitFor(
      () => (document.getElementById("last-event")?.textContent ?? "").includes("draft:changed"),
      "dirty draft",
    );
  }
  query<HTMLButtonElement>("#toggle-mount").click();
  await waitFor(() => document.getElementById("retained-sessions") !== null, "retained session");
  check(
    "dirtyRetained",
    document.querySelectorAll("#retained-sessions [data-retained-view]").length === 1,
  );
  check("dirtyUnmountNoRoot", root() === null);
  check("retainedActiveZero", query<HTMLElement>("#example-active").textContent === "0");
  check("retainedCount", query<HTMLElement>("#example-retained").textContent === "1");
  check("retainedViewNone", query<HTMLElement>("#example-view").textContent === "none");
  check(
    "retainedStatus",
    (document.getElementById("example-action")?.textContent ?? "").includes(
      "DRAFT_REQUIRES_DECISION",
    ),
  );
  query<HTMLButtonElement>('[data-retained-action="cancel"]').click();
  await waitFor(() => document.getElementById("retained-sessions") === null, "retained resolution");
  check("retainedResolved", query<HTMLElement>("#example-retained").textContent === "0");
  check(
    "retainedDisposed",
    Number(query<HTMLElement>("#example-disposed").textContent ?? "0") === disposedBeforeDirty + 1,
  );
  query<HTMLButtonElement>("#toggle-mount").click();
  await waitFor(() => root() !== null, "dirty remount");
  check("dirtyRemountActive", query<HTMLElement>("#example-active").textContent === "1");
  check("dirtyRemountSingle", document.querySelectorAll(".boardloom").length === 1);
  check("dirtyRemountView", query<HTMLElement>("#example-view").textContent !== "none");

  check("noRuntimeErrors", errors.length === 0, errors);
  return { checks, errors };
}

scenario()
  .then((result) => {
    const element = document.createElement("pre");
    element.id = "result";
    element.textContent = JSON.stringify(result);
    document.body.append(element);
  })
  .catch((error: unknown) => {
    const element = document.createElement("pre");
    element.id = "result";
    element.textContent = JSON.stringify({
      checks: {},
      errors: [error instanceof Error ? error.message : String(error)],
    });
    document.body.append(element);
  });
