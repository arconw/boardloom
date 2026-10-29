# @boardloom/angular

Thin Angular host adapter around the framework-neutral `@boardloom/view-dom` runtime. The adapter does not contain a second copy of viewer or editor logic. It mounts the shared runtime in a standalone component, forwards inputs and outputs, and exposes the shared imperative view handle.

Distribution target: browser ESM with TypeScript declarations. `@angular/core` 21.2.x is the supported peer range, verified against Angular `21.2.25`; Angular 22 is outside this range and is not claimed. The package is compiled in Angular full compilation mode, so the emitted component definition is tied to the Angular 21.2 compiler. A partial-compilation path with an Angular linker step for tarball consumers remains T19 packaging work. npm publication is not authorized, so the scoped name is used for tarball consumers only.

## Usage

```ts
import { Component } from "@angular/core";
import { BoardloomViewComponent, type BoardloomViewHandle } from "@boardloom/angular";

@Component({
  selector: "app-board",
  standalone: true,
  imports: [BoardloomViewComponent],
  template: `
    <boardloom-view
      [document]="boardDocument"
      [datasetProvider]="provider"
      locale="en"
      timezone="UTC"
      (event)="onEvent($event)"
      (adapterError)="onError($event)"
    ></boardloom-view>
  `,
})
export class AppBoardComponent {}
```

`document`, `datasetProvider`, `runtime`, `runtimeOptions`, `space`, `view`, `blockTypes`, `renderers`, `extensions` and `extensionSelection` define the mount session. Plain-data inputs such as `document` and `extensionSelection` are compared by content, so recreating an equal inline object does not remount. Runtime objects such as `space`, `runtime`, `view`, `datasetProvider` and `extensions` keep identity semantics. Function-bearing definitions in `blockTypes`, `renderers` and `runtimeOptions` must use stable function references. If only function identities change, the adapter keeps the existing session and emits the first invalid `mountInputs` diagnostic through `adapterError` with phase `input` instead of remounting. Presentation inputs in the same update still apply through the shared update contract. Function implementations are fixed for the mounted session: later function-only swaps are ignored until a structural remount. Non-plain-object values in mount inputs, such as class instances, compare by identity and remount when replaced. Changing actual non-function mount content unmounts the current session and mounts a new one.

`locale`, `timezone`, `theme`, `messages`, `realtime`, `provenance`, `mode` and `lease` are reconciled through the shared `update` contract. They preserve the committed document, draft, filters, cross-filter selection, comparison and realtime subscription; the board is not recreated for those updates.

Passing `messages` supplies host message overrides on top of the space message provider. Removing the input clears the overrides. Removing `locale` or `timezone` keeps the last applied value; set an explicit value to change it. Only events whose space matches the displayed session, and whose view matches when the event carries a view identifier, are forwarded; retained sessions and sibling views do not leak events to the host. `event`, `modeChange` and `documentExport` use stable wrappers, so replacing output handlers does not remount the board. Changing whether `importDocument` is supplied remounts the session because the shared runtime decides import availability at mount time. `theme`, `realtime` and `provenance` updates apply when supplied; remove an override by remounting. Only the English message foundation is built in; complete built-in dictionaries, locale switching acceptance and Arabic RTL belong to T17.

## Inputs

| Input                                                         | Purpose                                                                                                                      |
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
| `className`                                                   | Additional host class on the `boardloom-view` element.                                                                       |
| `importDocument`                                              | Optional host import callback for the mounted session.                                                                       |

## Outputs

| Output           | Payload                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `event`          | Every `SpaceEvent` for the currently displayed session. Retained sessions and sibling views are filtered out. |
| `modeChange`     | `{ mode, event }` for mode changes of this adapter's view.                                                    |
| `ready`          | Space ID, view ID and element after a successful mount.                                                       |
| `disposed`       | Space ID, view ID and element after successful disposal.                                                      |
| `adapterError`   | Mount, update, dispose or session-input (`input`) diagnostics, with an optional retained session.             |
| `documentExport` | Host export callback payload with kind and serialization.                                                     |

## Imperative access

Use a template reference to reach the component methods: `handle` (nullable), `isMounted`, `isDisposed`, `boardSpace`, `boardView`, `boardElement`, `update`, `setMode`, `refresh`, `exportDocument`, `focus`, `unmount` and `dispose`. The handle exists after a successful mount, so use the `ready` output before calling methods. `boardSpace`, `boardView` and `boardElement` throw when no session is mounted; methods return a diagnostic result instead.

A successful imperative `unmount` or `dispose` clears the adapter session, emits `disposed` exactly once with the same payload as component destroy, and makes `handle` null and `isMounted` false. For adapter-initiated unmount or dispose, that output is emitted after the shared handle reports success and the viewer has torn down its DOM and owned resources. For host-initiated direct disposal of the handle, view or space, the event-driven output is emitted during that disposal call, before the viewer finishes teardown; handlers must not assume DOM cleanup is complete in that path. A rejected disposal, such as a dirty owned draft without an `apply` or `cancel` decision, keeps the session and returns the diagnostics. The component then stays unmounted: later input changes do not recreate the board, and repeated `unmount` or `dispose` calls return success without another output. Re-create the component to mount it again. If the host disposes the underlying handle or a host-owned space directly, the adapter observes the disposal event, clears the session and emits `disposed` once at that operation; the getters then treat the handle as absent and the component stays unmounted.

Use `handle.space` or `boardSpace` for explicit host actions such as acquiring an editor lease, importing a document into a new space or inspecting space state. Mode changes still follow the core and DOM viewer contracts.

## Change detection and zone behavior

Mount, update and disposal run outside the Angular zone so Boardloom DOM listeners, observers and query callbacks do not schedule host application change detection for every internal interaction. Outputs are emitted back inside the zone, so ordinary zone-based applications receive adapter events through their normal change-detection path. Zoneless applications work as well: the adapter emits outputs directly and host signal or mark-for-check updates follow the application's configured scheduler. The component uses `OnPush`. Initial mount and input reconciliation are scheduled as a microtask after the current change-detection pass, so the adapter never mutates DOM or emits a mount event in the middle of Angular's check. The `ready` output follows that reconciliation. The adapter never writes into Angular-bound template state.

## Lifecycle and ownership

- The adapter owns the space and runtime only when it created them from `document` / `runtimeOptions`. An externally supplied `space` or `runtime` stays host-owned and is never disposed by the adapter.
- Destroying the standalone component releases the adapter's view, DOM listeners, plugin styles and owned space or runtime. Cleanup is idempotent, so repeated mount and destroy cycles leave one board root at most.
- Clean sessions default to `keep`. A host-owned space also defaults to `keep`: destroy disposes only the adapter-created view and preserves the host's lease and dirty draft. An adapter-created space with a dirty draft is never discarded silently: without an explicit `apply` or `cancel`, destroy or a mount-session change detaches the board, emits `DRAFT_REQUIRES_DECISION` through `adapterError`, and retains the handle so the host can resolve it.
- A failed explicit disposal is also retained and reported. The error payload exposes the retained handle, space ID and view ID; resolving it with `apply`, `cancel` or a corrected decision releases the viewer, listeners and adapter-owned space or runtime.
- Imperative `unmount` and `dispose` use the same ownership and dirty-draft rules as component destroy. On success they clear the adapter session, emit `disposed` once and leave the component terminally unmounted; repeated cleanup returns success without another output. On failure they keep the session for host resolution. Direct disposal of the exposed handle and disposal of a host-owned space are observed through the space event stream and follow the same terminal cleanup at the triggering operation.
- A function-only mount-input instability emits phase `input` with path `mountInputs`, keeps the existing session, still applies current presentation inputs and creates no retained session.

## Example and checks

`examples/angular` is a runnable Angular standalone-component example with synthetic revenue data. It consumes the built packages under `.tmp/build/packages`, not workspace source aliases. Run `npm run build` at the repository root, then `npm run dev --workspace @boardloom/example-angular`.

The adapter test suite covers mount, state-preserving locale/timezone/message updates, dirty-draft and undo preservation across presentation updates, input-driven mode switching, failed-update recovery, retention and resolution, host-owned ownership, equal-content reconciliation, function-identity stability, imperative actions and cleanup. A Chromium E2E suite builds and runs the AOT example through locale and timezone forwarding, host message overrides, editor/viewer switching, export, variant remount and unmount/remount cleanup. `verify:consumers` installs all four packed tarballs into one temporary consumer root and runs a Node/happy-dom Angular mount/destroy smoke against the packed component. The Angular example typecheck in that script resolves staged declarations rather than installing a separate tarball-only Angular application; a full packed Angular AOT consumer matrix remains T19. Full accessibility and localization acceptance remain later tasks.
