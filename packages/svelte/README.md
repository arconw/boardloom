# @boardloom/svelte

Thin Svelte 5 host adapter around the shared `@boardloom/view-dom` runtime and host contract. The
adapter renders the framework-neutral Boardloom viewer and editor into a host element and must not
contain a second copy of core UI logic.

## Install

```sh
npm install @boardloom/svelte @boardloom/core @boardloom/view-dom svelte
```

Svelte 5 is a peer dependency. This delivery is verified only with Svelte 5.57.3. The peer range is `^5.57.3`; other Svelte 5.x versions remain untested, and Svelte 4 and earlier are not supported.

The packed tarball ships the component source under `dist/`. Consume it through a Svelte-aware bundler such as Vite with `@sveltejs/vite-plugin-svelte`; Node-only or plain TypeScript consumers must use the framework-neutral `@boardloom/view-dom` runtime instead. The packed tarball is verified with both a Vite plus `@sveltejs/vite-plugin-svelte` consumer and a minimal Svelte compiler/esbuild consumer; this is not a promise that every Svelte bundler is supported.

## Usage

```svelte
<script lang="ts">
  import { BoardloomView, type BoardloomViewHandle } from "@boardloom/svelte";
  import "@boardloom/view-dom/styles.css";

  let handle = $state<BoardloomViewHandle | null>(null);
  let locale = $state("en");
  let timezone = $state("UTC");

  const document = createBoardDocument();
  const provider = createDatasetProvider();
</script>

<select bind:value={locale}>
  <option value="en">en</option>
  <option value="de">de</option>
</select>
<input bind:value={timezone} />

<BoardloomView
  bind:handle
  {document}
  datasetProvider={provider}
  {locale}
  {timezone}
  onEvent={(event) => console.log(event.type)}
  onError={(error) => console.error(error.phase, error.diagnostics)}
/>
```

The component accepts the shared mount and presentation inputs: `space`, `runtime`,
`runtimeOptions`, `document`, `datasetProvider`, `view`, `mode`, `lease`, `locale`, `timezone`,
`theme`, `messages`, `realtime`, `provenance`, `blockTypes`, `renderers`, `extensions`,
`extensionSelection` and `draftDecision`. It also accepts `class`, `style` and `containerProps` for
the host element.

Callbacks are the Svelte equivalent of the React props: `onEvent`, `onModeChange`,
`onImportDocument`, `onExport`, `onReady`, `onDispose` and `onError`. `bind:handle` exposes the
shared `BoardViewHandle` with `update`, `setMode`, `refresh`, `exportDocument`, `focus`, `unmount`
and `dispose`. Calling `unmount` or `dispose` on the bindable handle ends the adapter session:
`onDispose` fires once, the bindable handle becomes null and the session does not remount unless the
component is recreated.

## Lifecycle and ownership

The adapter mounts once per component instance and forwards presentation changes through the shared
update contract. Locale, timezone, theme, messages, realtime, provenance, mode and lease changes do
not recreate the view, so board state, drafts, filters, comparisons and queries are preserved.
Changing function-bearing mount inputs reports one `input` diagnostic while keeping the existing
session and still applies locale, timezone, theme, messages, realtime, provenance, mode and lease
updates from the same render. Changing a plain mount input such as the document remounts the view
through the same lifecycle as a fresh mount.

An adapter-created space is owned by the component and is disposed when the component is destroyed.
A space supplied through the `space` prop remains host-owned and is never disposed by the adapter.
If an owned space still has a dirty draft and the supplied `draftDecision` is anything other than
`apply` or `cancel` (including `keep` or no decision), the session is retained and reported through
`onError` with the retained handle so the host can apply or discard it.

## Scope

T16 implements the adapter, the runnable example, unit and Chromium tests and a packed-tarball
consumer smoke check. Only the English message dictionary is built in today. Full built-in locale
dictionaries, Arabic RTL and the complete locale acceptance matrix remain T17/T19 work.
