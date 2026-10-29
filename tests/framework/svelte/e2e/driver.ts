export {};

interface E2eResult {
  readonly checks: Record<string, boolean | number | string>;
  readonly errors: readonly string[];
}

const errors: string[] = [];
window.addEventListener("error", (event) => {
  errors.push(`error: ${String(event.message)}`);
});
window.addEventListener("unhandledrejection", (event) => {
  errors.push(`rejection: ${String(event.reason)}`);
});

function waitFor<T>(
  read: () => T | null | undefined | false,
  label: string,
  timeout = 10_000,
): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const value = read();
      if (value !== null && value !== undefined && value !== false) {
        resolve(value);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function text(id: string): string {
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".boardloom");
}

function instance(): string | null {
  return root()?.getAttribute("data-boardloom-instance") ?? null;
}

function modeButton(mode: "viewer" | "editor"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`);
}

function select(id: string, value: string): void {
  const element = document.getElementById(id) as HTMLSelectElement | null;
  if (element === null) {
    throw new Error(`select ${id} was not found`);
  }
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function toggle(id: string, checked: boolean): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (element === null) {
    throw new Error(`toggle ${id} was not found`);
  }
  element.checked = checked;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function click(id: string): void {
  const element = document.getElementById(id) as HTMLButtonElement | null;
  if (element === null) {
    throw new Error(`button ${id} was not found`);
  }
  element.click();
}

async function run(): Promise<void> {
  await waitFor(() => root() && document.getElementById("locale-select"), "initial Boardloom root");
  await waitFor(() => text("example-active") === "1", "active instance");
  const initialInstance = instance();
  const initialMetric = document.querySelector(".bl-metric__value")?.textContent?.trim() ?? "";
  const initialDate =
    document.querySelector(".bl-table tbody td:last-child")?.textContent?.trim() ?? "";
  const checks: Record<string, boolean | number | string> = {
    oneRoot: document.querySelectorAll(".boardloom").length === 1,
    readyCount: text("example-ready"),
    initialLocale: root()?.getAttribute("data-boardloom-locale") ?? "",
    initialTimezone: root()?.getAttribute("data-boardloom-timezone") ?? "",
    initialViewer: modeButton("viewer")?.getAttribute("aria-pressed") === "true",
    tableRows: document.querySelectorAll(".bl-table tbody tr").length,
    initialMetric,
    initialDate,
    initialInstance: initialInstance ?? "",
    svelteHostMarker: document.querySelector("[data-boardloom-svelte]") !== null,
  };

  select("locale-select", "de");
  select("timezone-select", "Asia/Tokyo");
  await waitFor(
    () =>
      root()?.getAttribute("data-boardloom-locale") === "de" &&
      root()?.getAttribute("data-boardloom-timezone") === "Asia/Tokyo",
    "locale and timezone forwarding",
  );
  checks.sameInstanceAfterLocale = instance() === initialInstance;
  checks.localeForwarded = text("example-locale") === "de";
  checks.timezoneForwarded = text("example-timezone") === "Asia/Tokyo";
  checks.localeEventForwarded = text("last-event").includes("locale:changed");
  const localizedMetric = document.querySelector(".bl-metric__value")?.textContent?.trim() ?? "";
  const localizedDate =
    document.querySelector(".bl-table tbody td:last-child")?.textContent?.trim() ?? "";
  checks.metricFormatChanged = localizedMetric !== initialMetric;
  checks.dateFormatChanged = localizedDate !== initialDate;
  checks.filterPreserved = (document.querySelector(".bl-filter-chip")?.textContent?.trim() ?? "")
    .toLowerCase()
    .includes("north, south");
  checks.localizedDe =
    (modeButton("viewer")?.textContent?.trim() ?? "") !== "" &&
    modeButton("viewer")?.textContent?.trim() !== "Viewer";
  const rowsBeforeLocales = document.querySelectorAll(".bl-table tbody tr").length;
  for (const locale of ["ja", "ar", "ru"] as const) {
    select("locale-select", locale);
    await waitFor(
      () =>
        root()?.getAttribute("data-boardloom-locale") === locale &&
        (modeButton("viewer")?.textContent?.trim() ?? "") !== "" &&
        modeButton("viewer")?.textContent?.trim() !== "Viewer",
      `localized ${locale}`,
      12000,
    );
    checks[`localized_${locale}`] =
      (modeButton("viewer")?.textContent?.trim() ?? "") !== "" &&
      modeButton("viewer")?.textContent?.trim() !== "Viewer";
    checks[`dir_${locale}`] = root()?.getAttribute("dir") ?? "";
    checks[`hostDir_${locale}`] = document.documentElement.getAttribute("dir") ?? "none";
    checks[`filter_${locale}`] = (
      document.querySelector(".bl-filter-chip")?.textContent?.trim() ?? ""
    )
      .toLowerCase()
      .includes("north, south");
    checks[`rows_${locale}`] =
      document.querySelectorAll(".bl-table tbody tr").length === rowsBeforeLocales;
  }
  checks.rtlAr = checks.dir_ar === "rtl";
  checks.hostUnaffectedAr = checks.hostDir_ar === "none";
  select("locale-select", "en");
  await waitFor(
    () =>
      root()?.getAttribute("data-boardloom-locale") === "en" &&
      modeButton("viewer")?.textContent?.trim() === "Viewer",
    "english restore",
  );
  checks.localeRestoredEn = root()?.getAttribute("dir") === "ltr";
  select("locale-select", "de");
  await waitFor(() => root()?.getAttribute("data-boardloom-locale") === "de", "german restore");
  checks.tablePreserved =
    document.querySelectorAll(".bl-table tbody tr").length === checks.tableRows;

  toggle("messages-toggle", true);
  await waitFor(
    () => modeButton("viewer")?.textContent?.trim() === "Reader",
    "host message override",
  );
  checks.hostMessages = modeButton("editor")?.textContent?.trim() === "Author";
  checks.sameInstanceAfterMessages = instance() === initialInstance;
  toggle("messages-toggle", false);
  await waitFor(
    () =>
      (modeButton("viewer")?.textContent?.trim() ?? "") !== "" &&
      modeButton("viewer")?.textContent?.trim() !== "Reader",
    "message reset",
  );
  checks.hostMessagesCleared = modeButton("viewer")?.textContent?.trim() !== "Reader";

  click("host-editor");
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "editor", "editor mode");
  checks.editorMode = root()?.getAttribute("data-boardloom-mode") === "editor";
  checks.sameInstanceAfterMode = instance() === initialInstance;
  checks.modeEventForwarded = text("last-event") === "mode:changed";
  checks.editorSurface = document.querySelector(".bl-editor, .bl-draft-bar") !== null;

  click("host-viewer");
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "viewer", "viewer mode");
  checks.viewerMode = root()?.getAttribute("data-boardloom-mode") === "viewer";
  checks.sameInstanceAfterViewer = instance() === initialInstance;

  modeButton("editor")?.click();
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "editor", "built-in editor");
  click("host-viewer");
  await waitFor(
    () => root()?.getAttribute("data-boardloom-mode") === "viewer",
    "host viewer after built-in editor",
  );
  checks.builtInEditorThenHostViewer = true;

  click("focus-content");
  await waitFor(() => text("example-action").includes("focused board content"), "focus action");
  checks.focusAction = true;

  click("export-document");
  await waitFor(() => document.getElementById("export-preview") !== null, "export preview");
  checks.exportPreview = (document.getElementById("export-preview")?.textContent ?? "").includes(
    "svelte-example-board",
  );

  click("toggle-mount");
  await waitFor(() => root() === null, "unmount");
  await waitFor(() => text("example-active") === "0", "inactive");
  checks.unmountClean = document.querySelectorAll(".boardloom").length === 0;
  checks.disposeCounted = text("example-disposed") === "1";

  click("toggle-mount");
  await waitFor(() => root() !== null, "remount");
  await waitFor(() => text("example-active") === "1", "remount active");
  const secondInstance = instance();
  checks.remount = secondInstance !== null && secondInstance !== initialInstance;
  checks.remountSingle = document.querySelectorAll(".boardloom").length === 1;
  checks.remountActive = text("example-active") === "1";

  modeButton("editor")?.click();
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "editor", "dirty editor");
  const addButton = document.querySelector<HTMLButtonElement>('[data-editor-add="text"]');
  checks.editorAddAvailable = addButton !== null;
  addButton?.click();
  await waitFor(() => text("last-event").includes("draft:changed"), "dirty draft");

  click("toggle-mount");
  await waitFor(() => root() === null, "dirty unmount");
  await waitFor(() => document.getElementById("retained-sessions") !== null, "retained session");
  checks.dirtyRetained = text("example-retained") === "1";
  checks.dirtyUnmountNoRoot = document.querySelectorAll(".boardloom").length === 0;
  checks.retainedActiveZero = text("example-active") === "0";
  checks.retainedViewNone = text("example-view") === "none";
  checks.retainedStatus = text("example-action").includes("dispose");

  const apply = document.querySelector<HTMLButtonElement>('[data-retained-action="apply"]');
  checks.retainedResolvedButton = apply !== null;
  apply?.click();
  await waitFor(() => document.getElementById("retained-sessions") === null, "retained resolved");
  checks.retainedResolved = text("example-retained") === "0";
  checks.retainedDisposed = text("example-disposed") === "2";

  click("toggle-mount");
  await waitFor(() => root() !== null, "dirty remount");
  await waitFor(() => text("example-active") === "1", "dirty remount active");
  checks.dirtyRemountActive = text("example-active") === "1";
  checks.dirtyRemountSingle = document.querySelectorAll(".boardloom").length === 1;
  checks.dirtyRemountView = text("example-view") !== "none";
  checks.noRuntimeErrors = true;

  const result: E2eResult = { checks, errors };
  const pre = document.createElement("pre");
  pre.id = "result";
  pre.textContent = JSON.stringify(result);
  document.body.append(pre);
}

run().catch((error: unknown) => {
  errors.push(String(error));
  const result: E2eResult = { checks: {}, errors };
  const pre = document.createElement("pre");
  pre.id = "result";
  pre.textContent = JSON.stringify(result);
  document.body.append(pre);
});
