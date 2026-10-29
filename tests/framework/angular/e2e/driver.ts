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
  await waitFor(() => root(), "initial Boardloom root");
  const initialInstance = instance();
  const initialMetric = document.querySelector(".bl-metric__value")?.textContent?.trim() ?? "";
  const initialDate =
    document.querySelector(".bl-table tbody td:last-child")?.textContent?.trim() ?? "";
  const initialFilter = document.querySelector(".bl-filter-chip")?.textContent?.trim() ?? "";
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
  };

  select("locale-select", "de");
  select("timezone-select", "Europe/Berlin");
  await waitFor(
    () =>
      root()?.getAttribute("data-boardloom-locale") === "de" &&
      root()?.getAttribute("data-boardloom-timezone") === "Europe/Berlin",
    "locale and timezone forwarding",
  );
  checks.sameInstanceAfterLocale = instance() === initialInstance;
  checks.localeForwarded = text("example-locale") === "de";
  checks.timezoneForwarded = text("example-timezone") === "Europe/Berlin";
  checks.localeEventForwarded = text("last-event").includes("locale:changed");
  const localizedMetric = document.querySelector(".bl-metric__value")?.textContent?.trim() ?? "";
  const localizedDate =
    document.querySelector(".bl-table tbody td:last-child")?.textContent?.trim() ?? "";
  checks.metricFormatChanged = localizedMetric !== initialMetric;
  checks.dateFormatChanged = localizedDate !== initialDate;
  checks.filterPreserved =
    (document.querySelector(".bl-filter-chip")?.textContent?.trim() ?? "") === initialFilter;
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
  await waitFor(() => modeButton("viewer")?.textContent?.trim() === "Viewer", "message reset");
  checks.hostMessagesCleared = true;

  click("host-editor");
  await waitFor(() => root()?.getAttribute("data-boardloom-mode") === "editor", "editor mode");
  checks.editorMode = root()?.getAttribute("data-boardloom-mode") === "editor";
  checks.sameInstanceAfterMode = instance() === initialInstance;
  checks.modeEventForwarded = text("last-event") === "mode:changed";
  checks.modeOutput = text("example-action").includes("mode output: editor");
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
    "angular-example-board",
  );

  click("host-editor");
  await waitFor(
    () => root()?.getAttribute("data-boardloom-mode") === "editor",
    "host editor again",
  );
  click("host-viewer");
  await waitFor(
    () => root()?.getAttribute("data-boardloom-mode") === "viewer",
    "host viewer again",
  );
  click("toggle-mount");
  await waitFor(() => document.querySelectorAll(".boardloom").length === 0, "lease unmount");
  click("toggle-mount");
  await waitFor(() => document.querySelectorAll(".boardloom").length === 1, "lease remount");
  await waitFor(() => text("example-active") === "1", "lease remount active");
  checks.leaseRemountSingle = document.querySelectorAll(".boardloom").length === 1;
  checks.leaseRemountActive = text("example-active") === "1";
  checks.leaseRemountNoRetained = text("example-retained") === "0";
  checks.leaseRemountNoError = !text("example-action").startsWith("mount:");

  const beforeVariant = instance();
  toggle("variant-toggle", true);
  await waitFor(
    () => root()?.getAttribute("data-boardloom-locale") === "de" && instance() !== beforeVariant,
    "variant remount",
  );
  checks.variantRemount = instance() !== beforeVariant;
  checks.variantTitle =
    (document.querySelector(".bl-title")?.textContent?.trim() ?? "") ===
    "Revenue overview (variant)";
  checks.variantLocalePreserved = root()?.getAttribute("data-boardloom-locale") === "de";
  checks.oneRootAfterVariant = document.querySelectorAll(".boardloom").length === 1;

  click("toggle-mount");
  await waitFor(() => document.querySelectorAll(".boardloom").length === 0, "unmount cleanup");
  await waitFor(() => text("example-view") === "none", "disposed output");
  checks.unmountCleansRoot = true;
  checks.disposedCounted = Number(text("example-disposed")) >= 1;
  checks.activeAfterUnmount = text("example-active") === "0";

  click("toggle-mount");
  await waitFor(() => document.querySelectorAll(".boardloom").length === 1, "remount");
  await waitFor(() => text("example-active") === "1", "single active instance");
  checks.remountSingle = document.querySelectorAll(".boardloom").length === 1;
  checks.remountActive = text("example-active") === "1";
  checks.remountInstance = instance() !== null;

  const result: E2eResult = { checks, errors };
  const pre = document.createElement("pre");
  pre.id = "result";
  pre.textContent = JSON.stringify(result);
  document.body.append(pre);
}

void run().catch((error: unknown) => {
  const pre = document.createElement("pre");
  pre.id = "result";
  pre.textContent = JSON.stringify({
    checks: { driverFailed: true },
    errors: [...errors, error instanceof Error ? error.message : String(error)],
  });
  document.body.append(pre);
});
