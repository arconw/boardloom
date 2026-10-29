import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EditorLease, SpaceEvent, ThemeMode, ViewMode } from "@boardloom/core";
import { BoardloomView, type BoardloomViewHandle } from "@boardloom/react";
import {
  createExampleDocument,
  createExampleProvider,
} from "../../../../examples/react/src/data.js";

interface HarnessConfig {
  readonly locale: string;
  readonly timezone: string;
  readonly override: boolean;
  readonly variant: boolean;
  readonly show: boolean;
  readonly theme: ThemeMode | undefined;
  readonly mode: ViewMode | undefined;
  readonly lease: EditorLease | undefined;
}

interface HarnessApi {
  setLocale(value: string): void;
  setTimezone(value: string): void;
  setOverride(value: boolean): void;
  setVariant(value: boolean): void;
  setShow(value: boolean): void;
  setTheme(value: ThemeMode | undefined): void;
  setModeProp(value: ViewMode | undefined): void;
  setLease(value: EditorLease | undefined): void;
  handle(): BoardloomViewHandle | null;
  readonly counts: { ready: number; disposed: number };
  readonly instanceIds: string[];
  readonly events: SpaceEvent[];
  readonly errors: string[];
}

declare global {
  interface Window {
    __boardloomHarness?: HarnessApi;
  }
}

function Harness() {
  const [config, setConfig] = useState<HarnessConfig>({
    locale: "en",
    timezone: "UTC",
    override: false,
    variant: false,
    show: true,
    theme: undefined,
    mode: undefined,
    lease: undefined,
  });
  const viewRef = useRef<BoardloomViewHandle | null>(null);
  const counts = useRef({ ready: 0, disposed: 0 });
  const instanceIds = useRef<string[]>([]);
  const events = useRef<SpaceEvent[]>([]);
  const errors = useRef<string[]>([]);
  const provider = useRef(createExampleProvider());
  const boardDocument = useMemo(() => createExampleDocument(config.variant), [config.variant]);

  useEffect(() => {
    window.__boardloomHarness = {
      setLocale(value) {
        setConfig((current) => ({ ...current, locale: value }));
      },
      setTimezone(value) {
        setConfig((current) => ({ ...current, timezone: value }));
      },
      setOverride(value) {
        setConfig((current) => ({ ...current, override: value }));
      },
      setVariant(value) {
        setConfig((current) => ({ ...current, variant: value }));
      },
      setShow(value) {
        setConfig((current) => ({ ...current, show: value }));
      },
      setTheme(value) {
        setConfig((current) => ({ ...current, theme: value }));
      },
      setModeProp(value) {
        setConfig((current) => ({ ...current, mode: value }));
      },
      setLease(value) {
        setConfig((current) => ({ ...current, lease: value }));
      },
      handle() {
        return viewRef.current;
      },
      counts: counts.current,
      instanceIds: instanceIds.current,
      events: events.current,
      errors: errors.current,
    };
  }, [config]);

  if (!config.show) {
    return null;
  }

  return (
    <BoardloomView
      ref={viewRef}
      document={boardDocument}
      datasetProvider={provider.current}
      locale={config.locale}
      timezone={config.timezone}
      theme={config.theme}
      mode={config.mode}
      lease={config.lease}
      messages={config.override ? { "mode.viewer": "Reader", "mode.editor": "Author" } : undefined}
      onEvent={(event) => {
        events.current.push(event);
      }}
      onReady={(info) => {
        counts.current.ready += 1;
        instanceIds.current.push(info.viewId);
      }}
      onDispose={(info) => {
        counts.current.disposed += 1;
        instanceIds.current.push(`disposed:${info.viewId}`);
      }}
      onError={(error) => {
        errors.current.push(
          `${error.phase}:${error.diagnostics.map((item) => item.code).join(",")}`,
        );
      }}
      containerProps={{ id: "harness-host" }}
    />
  );
}

function render() {
  const target = document.createElement("div");
  target.id = "app";
  document.body.append(target);
  const result = document.createElement("pre");
  result.id = "result";
  document.body.append(result);
  createRoot(target).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}

interface ScenarioResult {
  readonly checks: Record<string, unknown>;
  readonly errors: string[];
}

async function waitFor(predicate: () => boolean, label: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function viewerRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>(".boardloom");
  if (root === null) {
    throw new Error("viewer root missing");
  }
  return root;
}

function modeButton(mode: "viewer" | "editor"): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`);
  if (button === null) {
    throw new Error(`mode button ${mode} missing`);
  }
  return button;
}

function filterChip(): string {
  return document.querySelector(".bl-filter-chip")?.textContent ?? "";
}

async function scenario(): Promise<ScenarioResult> {
  const checks: Record<string, unknown> = {};
  const errors: string[] = [];
  const check = (name: string, condition: boolean, detail?: unknown): void => {
    checks[name] = condition;
    if (!condition) {
      errors.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
    }
  };

  await waitFor(() => document.querySelectorAll(".boardloom").length === 1, "first viewer");
  await waitFor(() => window.__boardloomHarness !== undefined, "harness api");
  const api = window.__boardloomHarness;
  if (api === undefined) {
    throw new Error("harness api missing");
  }
  const root = viewerRoot();
  const firstInstance = root.getAttribute("data-boardloom-instance");
  check("singleRoot", document.querySelectorAll(".boardloom").length === 1);
  check("strictReady", api.counts.ready === 2, api.counts);
  check("strictDisposed", api.counts.disposed === 1, api.counts);
  check("strictActive", api.counts.ready - api.counts.disposed === 1, api.counts);
  check("initialTimezone", root.getAttribute("data-boardloom-timezone") === "UTC");
  check("initialLocale", root.getAttribute("data-boardloom-locale") === "en");
  check("initialMessage", modeButton("viewer").textContent === "Viewer");
  const chipBefore = filterChip();
  check("filterChipInitial", chipBefore.includes("North, South"), chipBefore);
  const rowsBefore = document.querySelectorAll(".bl-table tbody tr").length;
  check("tableRows", rowsBefore > 0, rowsBefore);

  api.setLocale("ja");
  api.setTimezone("Asia/Tokyo");
  api.setOverride(true);
  await waitFor(
    () =>
      viewerRoot().getAttribute("data-boardloom-timezone") === "Asia/Tokyo" &&
      viewerRoot().getAttribute("data-boardloom-locale") === "ja" &&
      modeButton("viewer").textContent === "Reader",
    "locale and timezone update",
  );
  check(
    "sameInstanceAfterUpdate",
    viewerRoot().getAttribute("data-boardloom-instance") === firstInstance,
  );
  check("messagesOverride", modeButton("editor").textContent === "Author");
  check("filterPreserved", filterChip().toLowerCase().includes("north, south"), filterChip());
  check(
    "rowsPreserved",
    document.querySelectorAll(".bl-table tbody tr").length === rowsBefore,
    document.querySelectorAll(".bl-table tbody tr").length,
  );
  check(
    "localeEvent",
    api.events.some((event) => event.type === "locale:changed"),
  );

  modeButton("editor").click();
  await waitFor(() => viewerRoot().getAttribute("data-boardloom-mode") === "editor", "editor mode");
  check("editorMode", viewerRoot().getAttribute("data-boardloom-mode") === "editor");
  modeButton("viewer").click();
  await waitFor(() => viewerRoot().getAttribute("data-boardloom-mode") === "viewer", "viewer mode");
  check("viewerMode", viewerRoot().getAttribute("data-boardloom-mode") === "viewer");
  check("modeEvents", api.events.filter((event) => event.type === "mode:changed").length >= 2);

  const handle = api.handle();
  check("handleReady", handle !== null);
  if (handle !== null) {
    check("focusResult", handle.focus("content").ok);
    const exported = handle.exportDocument();
    check("exportResult", exported.ok);
    const themeUpdate = handle.update({ theme: "dark" });
    check("themeUpdate", themeUpdate.ok);
    await waitFor(() => viewerRoot().getAttribute("data-boardloom-theme") === "dark", "dark theme");
    check("themeApplied", viewerRoot().getAttribute("data-boardloom-theme") === "dark");
  }

  api.setLocale("en");
  api.setOverride(false);
  await waitFor(
    () =>
      viewerRoot().getAttribute("data-boardloom-locale") === "en" &&
      modeButton("viewer").textContent === "Viewer",
    "override cleared",
  );
  check("messagesCleared", modeButton("viewer").textContent === "Viewer");

  const modeErrors = api.errors.length;
  const preRecoveryHandle = api.handle();
  const retainedLease = preRecoveryHandle?.space.getSnapshot().editorLease ?? null;
  if (retainedLease !== null && preRecoveryHandle !== null) {
    const released = preRecoveryHandle.space.releaseEditorLease(retainedLease, {
      decision: "cancel",
    });
    check("leaseCleared", released.ok);
  }
  api.setModeProp("editor");
  await waitFor(
    () =>
      viewerRoot().getAttribute("data-boardloom-mode") === "viewer" &&
      api.errors.length === modeErrors + 1,
    "mode update failure",
  );
  check("modeRecoveryPending", viewerRoot().getAttribute("data-boardloom-mode") === "viewer");
  const activeHandle = api.handle();
  const recoveryLease = activeHandle?.space.acquireEditorLease({
    sessionId: "react-harness-recovery",
  });
  check("recoveryLease", recoveryLease?.ok === true);
  if (recoveryLease?.ok === true) {
    api.setLease(recoveryLease.value);
    await waitFor(
      () => viewerRoot().getAttribute("data-boardloom-mode") === "editor",
      "mode recovery",
    );
    check("modeRecovered", viewerRoot().getAttribute("data-boardloom-mode") === "editor");
    check("modeRecoverySingleError", api.errors.length === modeErrors + 1, api.errors);
    api.setModeProp("viewer");
    api.setLease(undefined);
    await waitFor(
      () => viewerRoot().getAttribute("data-boardloom-mode") === "viewer",
      "viewer recovery",
    );
  }

  api.setLocale("ja");
  await waitFor(
    () => viewerRoot().getAttribute("data-boardloom-locale") === "ja",
    "locale before invalid theme",
  );
  const themeErrors = api.errors.length;
  api.setLocale("de");
  api.setTheme("neon" as unknown as ThemeMode);
  await waitFor(
    () =>
      api.errors.length === themeErrors + 1 &&
      viewerRoot().getAttribute("data-boardloom-locale") === "ja",
    "invalid theme failure",
  );
  check("siblingSuppressed", viewerRoot().getAttribute("data-boardloom-locale") === "ja");
  api.setTheme("dark");
  await waitFor(
    () =>
      viewerRoot().getAttribute("data-boardloom-locale") === "de" &&
      viewerRoot().getAttribute("data-boardloom-theme") === "dark",
    "sibling recovery",
  );
  check("siblingLocaleRecovered", viewerRoot().getAttribute("data-boardloom-locale") === "de");
  check("siblingThemeRecovered", viewerRoot().getAttribute("data-boardloom-theme") === "dark");
  check("siblingSingleError", api.errors.length === themeErrors + 1, api.errors);

  api.setShow(false);
  await waitFor(() => document.querySelectorAll(".boardloom").length === 0, "unmount");
  check("unmountRoots", document.querySelectorAll(".boardloom").length === 0);
  check("unmountDisposed", api.counts.disposed === 2, api.counts);

  api.setShow(true);
  await waitFor(() => document.querySelectorAll(".boardloom").length === 1, "remount");
  const secondInstance = viewerRoot().getAttribute("data-boardloom-instance");
  check("remountNewInstance", secondInstance !== firstInstance);
  check("remountReady", api.counts.ready === 4, api.counts);
  check("noDuplicateRoots", document.querySelectorAll(".boardloom").length === 1);

  check(
    "expectedUpdateErrors",
    api.errors.length === 2 &&
      api.errors[0] === "update:EDITOR_LEASE_REQUIRED" &&
      api.errors[1] === "update:INVALID_ARGUMENT",
    api.errors,
  );
  return { checks, errors };
}

render();
scenario()
  .then((result) => {
    const element = document.getElementById("result");
    if (element !== null) {
      element.textContent = JSON.stringify(result);
    }
  })
  .catch((error: unknown) => {
    const element = document.getElementById("result");
    if (element !== null) {
      element.textContent = JSON.stringify({
        checks: {},
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  });
