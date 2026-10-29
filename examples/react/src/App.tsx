import { useMemo, useRef, useState } from "react";
import type { Diagnostic, MessageDictionary, SpaceEvent } from "@boardloom/core";
import {
  BoardloomView,
  type BoardloomRetainedSession,
  type BoardloomViewHandle,
} from "@boardloom/react";
import "@boardloom/view-dom/styles.css";
import { createExampleDocument, createExampleProvider } from "./data.js";
import "./styles.css";

const LOCALES = ["en", "ru", "es", "fr", "de", "pt-BR", "zh-CN", "ja", "ko", "ar", "hi"] as const;

const TIMEZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
] as const;

function describeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path}`).join(", ");
}

export function App() {
  const [locale, setLocale] = useState<string>("en");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [overrideMessages, setOverrideMessages] = useState(false);
  const [variant, setVariant] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [events, setEvents] = useState<readonly string[]>([]);
  const [lastEvent, setLastEvent] = useState("none");
  const [readyCount, setReadyCount] = useState(0);
  const [disposedCount, setDisposedCount] = useState(0);
  const [retainedSessions, setRetainedSessions] = useState<readonly BoardloomRetainedSession[]>([]);
  const [instance, setInstance] = useState<{
    readonly spaceId: string;
    readonly viewId: string;
  } | null>(null);
  const [action, setAction] = useState("idle");
  const [exported, setExported] = useState("");
  const viewRef = useRef<BoardloomViewHandle | null>(null);

  const provider = useMemo(() => createExampleProvider(), []);
  const document = useMemo(() => createExampleDocument(variant), [variant]);
  const messages = useMemo<MessageDictionary | undefined>(
    () =>
      overrideMessages
        ? {
            "mode.viewer": "Reader",
            "mode.editor": "Author",
          }
        : undefined,
    [overrideMessages],
  );

  const resolveRetained = (
    session: BoardloomRetainedSession,
    decision: "apply" | "cancel",
  ): void => {
    const result = session.handle.dispose({ draftDecision: decision });
    if (!result.ok) {
      setAction(`retained ${decision}: ${describeDiagnostics(result.diagnostics)}`);
      return;
    }
    setRetainedSessions((current) => current.filter((entry) => entry.viewId !== session.viewId));
    setDisposedCount((current) => current + 1);
    setAction(decision === "apply" ? "retained draft applied" : "retained draft discarded");
  };

  const recordEvent = (event: SpaceEvent): void => {
    setLastEvent(event.type);
    setEvents((current) => [event.type, ...current].slice(0, 8));
  };

  const switchToEditor = (): void => {
    const handle = viewRef.current;
    if (handle === null) {
      return;
    }
    let lease = handle.space.getSnapshot().editorLease;
    if (lease === null) {
      const acquired = handle.space.acquireEditorLease({ sessionId: "react-example-host" });
      if (!acquired.ok) {
        setAction(`editor lease: ${describeDiagnostics(acquired.diagnostics)}`);
        return;
      }
      lease = acquired.value;
    }
    const switched = handle.setMode("editor", { lease });
    setAction(
      switched.ok
        ? "host switched to editor"
        : `editor: ${describeDiagnostics(switched.diagnostics)}`,
    );
  };

  const switchToViewer = (): void => {
    const handle = viewRef.current;
    if (handle === null) {
      return;
    }
    const switched = handle.setMode("viewer");
    setAction(
      switched.ok
        ? "host switched to viewer"
        : `viewer: ${describeDiagnostics(switched.diagnostics)}`,
    );
  };

  const focusContent = (): void => {
    const handle = viewRef.current;
    if (handle === null) {
      return;
    }
    const focused = handle.focus("content");
    setAction(
      focused.ok ? "focused board content" : `focus: ${describeDiagnostics(focused.diagnostics)}`,
    );
  };

  const exportDocument = (): void => {
    const handle = viewRef.current;
    if (handle === null) {
      return;
    }
    const result = handle.exportDocument();
    if (!result.ok) {
      setAction(`export: ${describeDiagnostics(result.diagnostics)}`);
      return;
    }
    setAction("exported committed document");
    setExported(JSON.stringify(result.value).slice(0, 480));
  };

  return (
    <main className="example">
      <header className="example__header">
        <div>
          <h1>Boardloom React example</h1>
          <p>
            Synthetic revenue data. The board is rendered by @boardloom/react from the built
            package.
          </p>
          <p className="example__note" id="locale-note">
            Locale selection changes number, date and timezone presentation. UI labels remain
            English until T17.
          </p>
        </div>
        <dl className="example__facts" id="example-lifecycle">
          <div>
            <dt>Locale</dt>
            <dd id="example-locale">{locale}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd id="example-timezone">{timezone}</dd>
          </div>
          <div>
            <dt>Adapter ready</dt>
            <dd id="example-ready">{readyCount}</dd>
          </div>
          <div>
            <dt>Adapter disposed</dt>
            <dd id="example-disposed">{disposedCount}</dd>
          </div>
          <div>
            <dt>Retained</dt>
            <dd id="example-retained">{retainedSessions.length}</dd>
          </div>
          <div>
            <dt>Active instance</dt>
            <dd id="example-active">
              {Math.max(0, readyCount - disposedCount - retainedSessions.length)}
            </dd>
          </div>
          <div>
            <dt>View</dt>
            <dd id="example-view">{mounted && instance !== null ? instance.viewId : "none"}</dd>
          </div>
        </dl>
      </header>

      <section className="example__controls" aria-label="Example controls">
        <label>
          Locale
          <select
            id="locale-select"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
          >
            {LOCALES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timezone
          <select
            id="timezone-select"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {TIMEZONES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="example__toggle">
          <input
            id="messages-toggle"
            type="checkbox"
            checked={overrideMessages}
            onChange={(event) => setOverrideMessages(event.target.checked)}
          />
          Host message override
        </label>
        <label className="example__toggle">
          <input
            id="variant-toggle"
            type="checkbox"
            checked={variant}
            onChange={(event) => setVariant(event.target.checked)}
          />
          Load variant document
        </label>
        <button id="host-editor" type="button" onClick={switchToEditor}>
          Host editor
        </button>
        <button id="host-viewer" type="button" onClick={switchToViewer}>
          Host viewer
        </button>
        <button id="focus-content" type="button" onClick={focusContent}>
          Focus content
        </button>
        <button id="export-document" type="button" onClick={exportDocument}>
          Export document
        </button>
        <button id="toggle-mount" type="button" onClick={() => setMounted((current) => !current)}>
          {mounted ? "Unmount board" : "Mount board"}
        </button>
      </section>

      <p className="example__status" id="example-action" role="status">
        {action}
      </p>
      <div className="example__log">
        <span>Last event: </span>
        <code id="last-event">{lastEvent}</code>
        <ol id="event-log">
          {events.map((event, index) => (
            <li key={`${event}-${index}`}>{event}</li>
          ))}
        </ol>
      </div>
      {exported === "" ? null : (
        <pre id="export-preview" className="example__export">
          {exported}
        </pre>
      )}

      {retainedSessions.length === 0 ? null : (
        <section
          className="example__retained"
          id="retained-sessions"
          aria-label="Retained dirty sessions"
        >
          <h2>Retained dirty sessions</h2>
          <p>These sessions keep their draft and listeners until you apply or discard them.</p>
          <ul>
            {retainedSessions.map((session) => (
              <li key={session.viewId} data-retained-view={session.viewId}>
                <code>{session.viewId}</code>
                <button
                  type="button"
                  data-retained-action="apply"
                  onClick={() => resolveRetained(session, "apply")}
                >
                  Apply draft
                </button>
                <button
                  type="button"
                  data-retained-action="cancel"
                  onClick={() => resolveRetained(session, "cancel")}
                >
                  Discard draft
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="example__board" id="example-board" aria-label="Boardloom board host">
        {mounted ? (
          <BoardloomView
            ref={viewRef}
            document={document}
            datasetProvider={provider}
            locale={locale}
            timezone={timezone}
            messages={messages}
            provenance="React example"
            onEvent={recordEvent}
            onReady={(info) => {
              setReadyCount((current) => current + 1);
              setInstance({ spaceId: info.spaceId, viewId: info.viewId });
            }}
            onDispose={() => {
              setDisposedCount((current) => current + 1);
              setInstance(null);
            }}
            onExport={(kind, serialization) => {
              setAction(`host export callback (${kind})`);
              setExported(JSON.stringify(serialization).slice(0, 480));
            }}
            onError={(error) => {
              if (error.retained !== undefined) {
                setRetainedSessions((current) =>
                  current.some((entry) => entry.viewId === error.retained?.viewId)
                    ? current
                    : [...current, error.retained as BoardloomRetainedSession],
                );
                setInstance(null);
              }
              setAction(`${error.phase}: ${describeDiagnostics(error.diagnostics)}`);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}
