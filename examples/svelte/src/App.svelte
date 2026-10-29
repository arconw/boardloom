<script lang="ts">
  import type { Diagnostic, MessageDictionary, SpaceEvent } from "@boardloom/core";
  import {
    BoardloomView,
    type BoardloomRetainedSession,
    type BoardloomViewHandle,
  } from "@boardloom/svelte";
  import { createExampleDocument, createExampleProvider } from "./data.js";

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

  let locale = $state("en");
  let timezone = $state("UTC");
  let overrideMessages = $state(false);
  let variant = $state(false);
  let mounted = $state(true);
  let events = $state<string[]>([]);
  let lastEvent = $state("none");
  let readyCount = $state(0);
  let disposedCount = $state(0);
  let retainedSessions = $state<BoardloomRetainedSession[]>([]);
  let instance = $state<{ spaceId: string; viewId: string } | null>(null);
  let action = $state("idle");
  let exported = $state("");
  let handle = $state<BoardloomViewHandle | null>(null);

  const provider = createExampleProvider();
  const document = $derived(createExampleDocument(variant));
  const messages = $derived<MessageDictionary | undefined>(
    overrideMessages
      ? {
          "mode.viewer": "Reader",
          "mode.editor": "Author",
        }
      : undefined,
  );
  const active = $derived(Math.max(0, readyCount - disposedCount - retainedSessions.length));

  function recordEvent(event: SpaceEvent): void {
    lastEvent = event.type;
    events = [event.type, ...events].slice(0, 8);
  }

  function switchToEditor(): void {
    const current = handle;
    if (current === null) {
      return;
    }
    let lease = current.space.getSnapshot().editorLease;
    if (lease === null) {
      const acquired = current.space.acquireEditorLease({ sessionId: "svelte-example-host" });
      if (!acquired.ok) {
        action = `editor lease: ${describeDiagnostics(acquired.diagnostics)}`;
        return;
      }
      lease = acquired.value;
    }
    const switched = current.setMode("editor", { lease });
    action = switched.ok
      ? "host switched to editor"
      : `editor: ${describeDiagnostics(switched.diagnostics)}`;
  }

  function switchToViewer(): void {
    const current = handle;
    if (current === null) {
      return;
    }
    const switched = current.setMode("viewer");
    action = switched.ok
      ? "host switched to viewer"
      : `viewer: ${describeDiagnostics(switched.diagnostics)}`;
  }

  function focusContent(): void {
    const current = handle;
    if (current === null) {
      return;
    }
    const focused = current.focus("content");
    action = focused.ok
      ? "focused board content"
      : `focus: ${describeDiagnostics(focused.diagnostics)}`;
  }

  function exportDocument(): void {
    const current = handle;
    if (current === null) {
      return;
    }
    const result = current.exportDocument();
    if (!result.ok) {
      action = `export: ${describeDiagnostics(result.diagnostics)}`;
      return;
    }
    action = "exported committed document";
    exported = JSON.stringify(result.value).slice(0, 480);
  }

  function resolveRetained(session: BoardloomRetainedSession, decision: "apply" | "cancel"): void {
    const result = session.handle.dispose({ draftDecision: decision });
    if (!result.ok) {
      action = `retained ${decision}: ${describeDiagnostics(result.diagnostics)}`;
      return;
    }
    retainedSessions = retainedSessions.filter((entry) => entry.viewId !== session.viewId);
    disposedCount += 1;
    action = decision === "apply" ? "retained draft applied" : "retained draft discarded";
  }
</script>

<main class="example">
  <header class="example__header">
    <div>
      <h1>Boardloom Svelte example</h1>
      <p>
        Synthetic revenue data. The board is rendered by @boardloom/svelte from the built package.
      </p>
      <p class="example__note" id="locale-note">
        Locale selection changes number, date and timezone presentation. UI labels remain English
        until T17.
      </p>
    </div>
    <dl class="example__facts" id="example-lifecycle">
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
        <dd id="example-active">{active}</dd>
      </div>
      <div>
        <dt>View</dt>
        <dd id="example-view">{mounted && instance !== null ? instance.viewId : "none"}</dd>
      </div>
    </dl>
  </header>

  <section class="example__controls" aria-label="Example controls">
    <label>
      Locale
      <select
        id="locale-select"
        value={locale}
        onchange={(event) => {
          locale = (event.currentTarget as HTMLSelectElement).value;
        }}
      >
        {#each LOCALES as value (value)}
          <option {value}>{value}</option>
        {/each}
      </select>
    </label>
    <label>
      Timezone
      <select
        id="timezone-select"
        value={timezone}
        onchange={(event) => {
          timezone = (event.currentTarget as HTMLSelectElement).value;
        }}
      >
        {#each TIMEZONES as value (value)}
          <option {value}>{value}</option>
        {/each}
      </select>
    </label>
    <label class="example__toggle">
      <input
        id="messages-toggle"
        type="checkbox"
        checked={overrideMessages}
        onchange={(event) => {
          overrideMessages = (event.currentTarget as HTMLInputElement).checked;
        }}
      />
      Host message override
    </label>
    <label class="example__toggle">
      <input
        id="variant-toggle"
        type="checkbox"
        checked={variant}
        onchange={(event) => {
          variant = (event.currentTarget as HTMLInputElement).checked;
        }}
      />
      Load variant document
    </label>
    <button id="host-editor" type="button" onclick={switchToEditor}>Host editor</button>
    <button id="host-viewer" type="button" onclick={switchToViewer}>Host viewer</button>
    <button id="focus-content" type="button" onclick={focusContent}>Focus content</button>
    <button id="export-document" type="button" onclick={exportDocument}>Export document</button>
    <button id="toggle-mount" type="button" onclick={() => (mounted = !mounted)}>
      {mounted ? "Unmount board" : "Mount board"}
    </button>
  </section>

  <p class="example__status" id="example-action" role="status">{action}</p>
  <div class="example__log">
    <span>Last event: </span>
    <code id="last-event">{lastEvent}</code>
    <ol id="event-log">
      {#each events as event, index (`${event}-${index}`)}
        <li>{event}</li>
      {/each}
    </ol>
  </div>
  {#if exported !== ""}
    <pre id="export-preview" class="example__export">{exported}</pre>
  {/if}

  {#if retainedSessions.length > 0}
    <section class="example__retained" id="retained-sessions" aria-label="Retained dirty sessions">
      <h2>Retained dirty sessions</h2>
      <p>These sessions keep their draft and listeners until you apply or discard them.</p>
      <ul>
        {#each retainedSessions as session (session.viewId)}
          <li data-retained-view={session.viewId}>
            <code>{session.viewId}</code>
            <button
              type="button"
              data-retained-action="apply"
              onclick={() => resolveRetained(session, "apply")}>Apply draft</button
            >
            <button
              type="button"
              data-retained-action="cancel"
              onclick={() => resolveRetained(session, "cancel")}>Discard draft</button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="example__board" id="example-board" aria-label="Boardloom board host">
    {#if mounted}
      <BoardloomView
        bind:handle
        {document}
        datasetProvider={provider}
        {locale}
        {timezone}
        {messages}
        provenance="Svelte example"
        onEvent={recordEvent}
        onReady={(info) => {
          readyCount += 1;
          instance = { spaceId: info.spaceId, viewId: info.viewId };
        }}
        onDispose={() => {
          disposedCount += 1;
          instance = null;
        }}
        onExport={(kind, serialization) => {
          action = `host export callback (${kind})`;
          exported = JSON.stringify(serialization).slice(0, 480);
        }}
        onError={(error) => {
          if (error.retained !== undefined) {
            const retained = error.retained;
            if (!retainedSessions.some((entry) => entry.viewId === retained.viewId)) {
              retainedSessions = [...retainedSessions, retained];
            }
            instance = null;
          }
          action = `${error.phase}: ${describeDiagnostics(error.diagnostics)}`;
        }}
      />
    {/if}
  </section>
</main>
