# @boardloom/react

Thin React host adapter around the framework-neutral `@boardloom/view-dom` runtime. The adapter does not contain a second copy of viewer or editor logic. It mounts the shared runtime, forwards props and events, and exposes the shared imperative view handle.

Distribution target: browser ESM with TypeScript declarations. React and React DOM 19 are peer dependencies. npm publication is not authorized, so the scoped name is used for tarball consumers only.

## Usage

```tsx
import { BoardloomView, type BoardloomViewHandle } from "@boardloom/react";
import { useRef } from "react";

const view = useRef<BoardloomViewHandle>(null);

<BoardloomView
  ref={view}
  document={boardDocument}
  datasetProvider={provider}
  locale="en"
  timezone="UTC"
  onEvent={(event) => console.log(event.type)}
/>;
```

`document`, `datasetProvider`, `runtime`, `runtimeOptions`, `space`, `view`, `blockTypes`, `renderers`, `extensions` and `extensionSelection` define the mount session. Plain-data inputs such as `document` and `extensionSelection` are compared by content, so recreating an equal inline object does not remount. Runtime objects such as `space`, `runtime`, `view`, `datasetProvider` and `extensions` keep identity semantics. Function-bearing definitions in `blockTypes`, `renderers` and `runtimeOptions` must use stable function references. If only function identities change, the adapter keeps the existing session and reports the first invalid `mountInputs` diagnostic through `onError` with phase `input` instead of remounting. Presentation inputs in the same render still apply through the shared update contract. Function implementations are fixed for the mounted session: later function-only swaps are ignored until a structural remount. Non-plain-object values in mount inputs, such as class instances, compare by identity and remount when replaced. Changing actual non-function mount content unmounts the current session and mounts a new one.

`locale`, `timezone`, `theme`, `messages`, `realtime`, `provenance`, `mode` and `lease` are reconciled through the shared `update` contract. They preserve the committed document, draft, filters, cross-filter selection, comparison and realtime subscription; the board is not recreated for those updates. Removing `locale` or `timezone` keeps the last applied value; set an explicit value to change it. Removing `messages` clears host overrides.

Passing `messages` supplies host message overrides on top of the space message provider. Removing the prop clears the overrides. Only events whose space matches the displayed session, and whose view matches when the event carries a view identifier, are forwarded; retained sessions and sibling views do not leak events to the host. `onEvent` and `onExport` are read through stable wrappers, so changing those callbacks does not remount the board. Changing whether `onImportDocument` is supplied remounts the session because the shared runtime decides import availability at mount time. `theme`, `realtime` and `provenance` updates apply when supplied; remove an override by remounting. Only the English message foundation is built in; complete built-in dictionaries, locale switching acceptance and Arabic RTL belong to T17.

## Props

| Prop                                                          | Purpose                                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `space`                                                       | Mount an existing host-owned space. The adapter never disposes it.                                                           |
| `runtime`, `runtimeOptions`, `document`, `datasetProvider`    | Create an owned runtime and space from a board document.                                                                     |
| `view`                                                        | Mount an existing host-owned view.                                                                                           |
| `mode`, `lease`                                               | Initial and updated view-local mode and editor lease.                                                                        |
| `locale`, `timezone`, `theme`, `provenance`                   | Presentation forwarding.                                                                                                     |
| `messages`                                                    | Host message overrides.                                                                                                      |
| `realtime`                                                    | Realtime status supplied by the host.                                                                                        |
| `blockTypes`, `renderers`, `extensions`, `extensionSelection` | Extension inputs for the mount session.                                                                                      |
| `draftDecision`                                               | Cleanup decision for a dirty adapter-owned draft: `apply` or `cancel`. Clean or externally owned sessions default to `keep`. |
| `onEvent`                                                     | Space event stream for the currently displayed session. Retained sessions and sibling views are filtered out.                |
| `onModeChange`                                                | Mode changes for this adapter's view.                                                                                        |
| `onImportDocument`, `onExport`                                | Host import and export callbacks.                                                                                            |
| `onReady`, `onDispose`                                        | Lifecycle notifications with the space and view IDs.                                                                         |
| `onError`                                                     | Mount, update, dispose or session-input (`input`) diagnostics, including retained sessions.                                  |
| `className`, `style`, `containerProps`                        | Container element attributes.                                                                                                |

## Imperative handle

The ref exposes the shared view handle: `space`, `view`, `element`, `mounted`, `disposed`, `update`, `setMode`, `refresh`, `exportDocument`, `focus`, `unmount` and `dispose`. The ref is `null` until React attaches it, and the handle is cleared after React unmounts the component. The underlying view exists after the mount effect, so use `onReady` before calling handle methods. Space and view getters throw when no session is mounted; methods return a diagnostic result instead.

A successful imperative `unmount` or `dispose` clears the adapter session and emits `onDispose` exactly once with the same payload as effect cleanup, after the shared handle reports success and the viewer has torn down its DOM and owned resources. When a host-owned view or space is disposed directly, `onDispose` is emitted from the disposal event during that call, before the viewer finishes teardown; handlers must not assume DOM cleanup is complete in that path. The same terminal cleanup is triggered when a host-owned space or the mounted view is disposed externally: the adapter observes the disposal event, clears the session, emits `onDispose` once and does not remount on later renders. `mounted` becomes false, `disposed` becomes true and the getters throw. A rejected disposal, such as a dirty owned draft without an `apply` or `cancel` decision, keeps the session and returns diagnostics. The handle then stays terminally unmounted: later renders with changed inputs do not recreate the board, and repeated `unmount` or `dispose` calls return success without another output. Re-create the component to mount it again.

Use `handle.space` for explicit host actions such as acquiring an editor lease, importing a document into a new space or inspecting space state. Mode changes still follow the core and DOM viewer contracts.

## Lifecycle and ownership

- The adapter owns the space and runtime only when it created them from `document` / `runtimeOptions`. An externally supplied `space` or `runtime` stays host-owned and is never disposed by the adapter.
- Unmounting releases the adapter's view, DOM listeners, plugin styles and owned space or runtime. Cleanup is idempotent, so React Strict Mode setup/cleanup cycles leave exactly one mounted instance and no leaked roots.
- Clean sessions default to `keep`. A host-owned space also defaults to `keep`: unmount disposes only the adapter-created view and preserves the host's lease and dirty draft. An adapter-created space with a dirty draft is never discarded silently: without an explicit `apply` or `cancel`, unmount or a mount-session change detaches the board, reports `DRAFT_REQUIRES_DECISION` through `onError`, and retains the handle so the host can resolve it.
- A failed explicit disposal is also retained and reported. The error payload exposes the retained handle, space ID and view ID; resolving it with `apply`, `cancel` or a corrected decision releases the viewer, listeners and adapter-owned space or runtime.
- Imperative `unmount` and `dispose` use the same ownership and dirty-draft rules as effect cleanup. On success they clear the adapter session, emit `onDispose` once and leave the handle terminally unmounted; repeated cleanup returns success without another output. On failure they keep the session for host resolution. External view or space disposal is observed through the space event stream and ends the session in the same way.
- Successful unmounting releases the adapter's view, DOM listeners, plugin styles and owned space or runtime. Cleanup is idempotent, so React Strict Mode setup/cleanup cycles leave exactly one mounted instance and no leaked roots.
- A function-only mount-input instability reports phase `input` with path `mountInputs`, keeps the existing session and creates no retained session.
- The container element is rendered by React; the shared runtime creates and removes its own board root inside it. `containerProps` excludes `children` and `dangerouslySetInnerHTML` so host markup cannot conflict with the runtime root.

## Example and checks

`examples/react` is a runnable Vite example with synthetic revenue data. It consumes the built packages under `.tmp/build/packages`, not workspace source aliases. Run `npm run build` at the repository root, then `npm run dev --workspace @boardloom/example-react`.

The adapter test suite covers mount, Strict Mode, state-preserving updates, failed-update recovery, dirty-draft retention, host message overrides, events, imperative actions, external-space ownership, cleanup and mount failure. It also covers inline mount-input reconciliation, comparison results and realtime status preservation. A Chromium E2E suite runs the adapter and the runnable example. `verify:consumers` installs packed tarballs into a clean React consumer, typechecks the example against the staged declarations, runs a Node smoke, mounts and unmounts the adapter in a DOM environment, and bundles a React consumer. Full accessibility and localization acceptance remain later tasks.
