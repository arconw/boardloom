# @boardloom/core

Boardloom headless runtime: isolated spaces, lifecycle, view-local modes, editor lease and draft foundations, locale/timezone configuration, formatting and message-provider contracts. The package has no DOM, UI framework, server, SQL, ORM or database dependency. It imports and runs in Node and in browsers.

Status: T02 implements the headless core. T03 adds the versioned board document schema, canonical export, non-destructive import and a synthetic migration harness. Queries, renderers, filters and comparisons execution, realtime and extension registries belong to later tasks. Full built-in locale dictionaries and RTL layout belong to T17.

Distribution target: browser ESM with TypeScript declarations. npm publication is not authorized; planned scoped names are used for tarball consumers only.

## Runtime and spaces

```ts
import { createEmptyBoardDocument, createRuntime } from "@boardloom/core";

const runtime = createRuntime();
const created = runtime.createSpace({
  id: "board-a",
  document: createEmptyBoardDocument({
    id: "board-a",
    title: "Quarterly review",
    createdAt: Date.now(),
  }),
});
if (!created.ok) {
  throw new Error(created.diagnostics[0]?.message);
}
const space = created.value;
```

A runtime owns an explicit space map. Creating a board creates a space. `createSpace` accepts optional per-space `locale` and `timezone` overrides; they are validated against runtime defaults before creation. There is no module-level mutable store. Each space owns its committed document, draft, undo/redo history, locale/timezone, views, event listeners and scheduled tasks.

Every space instance has a `lifetimeId`. Events, snapshots and space summaries expose it so observers can distinguish successive lifetimes that reuse the same public space ID. A disposed ID remains reserved until that lifetime's terminal `space:disposed` event has been delivered through both the space and runtime observation channels; `createSpace` with the same ID returns `SPACE_ALREADY_EXISTS` until then. After terminal delivery the ID can be reused, and old events remain attributed to their original lifetime.

`getSnapshot()` returns a deeply frozen public state snapshot. Documents, drafts, diagnostics, lease records and view summaries are immutable. A new snapshot is produced for each call.

`dispose()` is idempotent at the view, space and runtime level. Disposal cancels space-owned timers, clears listeners, marks views disposed and ignores late callbacks. A space with zero views stays alive until the host disposes it. `space.schedule(callback, delayMs)` creates a space-owned task; cancellation, space disposal and runtime disposal clear it, and late callbacks are ignored.

## Injection

`createRuntime` accepts an injected clock, ID factory, logger, document validator, provider validation catalog, formatter factory, message dictionaries and draft history limit. Tests use a fake clock and deterministic ID factory; hosts can provide their own. The default clock uses host timer functions, the default logger is silent and the default ID factory is runtime-scoped. A host document validator is composed after the schema baseline. Message dictionaries are validated as plain enumerable string-to-string records before use; non-plain containers and accessor-backed dictionaries are rejected with `MESSAGE_INVALID_DICTIONARY`.

## Board document schema

Schema v1 is a JSON object with a stable board `id`, `title`, optional `description`, numeric `createdAt` and `updatedAt` timestamps, `theme`, ordered `blocks`, `layout`, `filters`, dataset and slice references, optional filter groups and comparisons, and optional namespaced `extensions`. Bindings preserve dimension, measure, series, group, size, color, comparison and supporting roles with selectable or fixed mode, explicit axis assignment, aggregation, formatting and temporal bucketing with timezone and granularity. Temporal filters declare their timezone and boundary rule; date-time scalar values require an explicit offset so admission never depends on the host timezone. Comparisons preserve mappings, alignment keys, time windows, display and delta modes, unit policy and documented or lossless unit conversions. Runtime ownership metadata such as space IDs, lifetime IDs, views, leases, drafts, locale, timezone, active filter values, query state and transport handles is not board content.

```ts
import { createEmptyBoardDocument, validateBoardDocument } from "@boardloom/core";

const document = createEmptyBoardDocument({
  id: "board-a",
  title: "Quarterly review",
  createdAt: Date.now(),
});
const validation = validateBoardDocument(document);
```

`validateBoardDocument` checks the schema envelope, stable IDs, unknown properties, layout geometry and overlap, document-internal references, binding roles and axes, temporal buckets, filter operator and value shapes, temporal windows, slice projections, comparison mappings and alignment keys, unit conversions and namespaced extensions without executing getters or mutating the input. Scalar filter operators reject arrays, temporal values require ISO date or date-time forms, and alignment keys must resolve to primary dimension mappings. A future schema version is rejected. Provider field, slice, renderer and conversion-capability checks run when a `BoardValidationCatalog` is supplied. Conversion providers must be declared in the catalog; an absent or incomplete catalog leaves the conversion unresolved with `REFERENCE_UNVERIFIED` rather than treating it as approved. Checks that cannot be verified are reported as warnings, not successful reference checks. Diagnostics carry stable codes, JSON-pointer paths, severity and optional hints and related IDs.

`defaultDocumentValidator` enforces schema v1 and the descriptor-safe plain-JSON contract for every document admitted through create, load, draft and apply. Every non-empty document must pass the schema, including all required fields. A host-supplied `documentValidator` adds constraints on top of that baseline and cannot disable it; duplicate warning diagnostics are merged once. An explicitly empty or unloaded space can remain empty only if a host lifecycle exposes that state; an arbitrary incomplete object is not a valid board.

## Import, export and migration

`runtime.importDocument(textOrObject, options)` enforces a configurable byte limit, depth, node, collection and string limits, measures parsed objects incrementally without building the complete canonical string, parses safely, rejects malformed JSON and future versions, migrates older known versions, validates the result, and only then creates a new space with a fresh runtime space ID. A supplied provider catalog is carried through parsing, target-space creation, later authoring and export instead of being discarded after admission.

```ts
const imported = runtime.importDocument(fileText, {
  sourceSpaceId: source.id,
  maxBytes: 2_000_000,
});
if (imported.ok) {
  const target = imported.value.space;
}
```

A successful import preserves the document and block IDs but never replaces an existing space. The source space keeps its committed document, dirty draft, undo history, views, filters and subscriptions. The runtime emits `space:imported` with the new space ID and optional source space ID; migrated imports also emit `document:migrated`. An invalid import creates no space, changes no source state or focus, and emits `import:failed` on the runtime observation channel. `import:failed` is explicitly runtime-scoped: it carries the runtime ID, an empty space ID and lifetime ID, an optional source space ID, and its own monotonic sequence so it never claims or reorders the source lifetime event stream. A runtime observer may explicitly dispose the successfully created target during its `space:created` event. Import remains a published success and returns that now-disposed target; it does not roll back, resurrect or claim the target remains active, and later normal events for that target are suppressed under the T02 terminal rules.

`space.exportDocument()` validates the committed document again and returns `{ document, canonical, schemaVersion }`. The canonical representation sorts object keys while preserving array order. A successful export emits `document:exported`. Exported JSON contains no runtime handles or ownership metadata.

The built-in migration chain contains one pure synthetic `0 -> 1` step for an unpublished pre-release fixture shape. It is not presented as a historical Boardloom format, and it never invents data values. The harness supports custom multi-step chains and reports each step's from/to versions, warnings, preserved, added and removed fields, and preserved board, dataset, field, slice, block, binding, filter group, filter and comparison IDs. Each step outcome is descriptor-safe, JSON-validated, bounded and byte-limited before the next step. A missing step, malformed result, migration failure or future version never downgrades or partially imports a document.

## Views, modes and editor lease

Mode is per view. A viewer-bound view cannot author. Editor views require an active editor lease:

```ts
const lease = space.acquireEditorLease({ sessionId: "host-session" });
if (!lease.ok) {
  // EDITOR_LEASE_CONFLICT means another editor already holds the lease.
}

const view = space.createView({ mode: "editor", lease: lease.value });
if (view.ok) {
  view.value.commands.updateDraft({
    ...space.getSnapshot().committedDocument,
    title: "Edited",
  });
  view.value.commands.applyDraft();
}
```

One editor lease is allowed per space. The lease holder can also open a viewer view. Switching a view between viewer and editor preserves the committed document, draft and undo history. Viewer commands return `VIEWER_READ_ONLY` even while a sibling editor exists.

The space owns the draft. Releasing a dirty lease or disposing a dirty editor view without a decision returns `DRAFT_REQUIRES_DECISION`. Pass `{ decision: "apply" }` or `{ decision: "cancel" }`. Applying against an advanced committed revision returns `REVISION_CONFLICT`, preserves the draft and never overwrites newer state. Invalid drafts fail atomically. Authoring commands are rejected while a lease release is in progress, so reentrant event listeners cannot create a draft that the release would discard.

`view.dispose({ draftDecision: "keep" })` is the explicit lease and draft handoff. It disposes only that view and returns the still-active lease as `retainedLease`; the space keeps its draft, undo history and lease. The host can then open a replacement editor view with the retained lease, or apply, cancel or release it through the space. A replacement viewer created with the lease still rejects authoring with `VIEWER_READ_ONLY`. Keep never applies, cancels or releases the draft on its own.

```ts
const disposal = view.dispose({ draftDecision: "keep" });
if (disposal.ok && disposal.value.retainedLease) {
  const replacement = space.createView({
    mode: "editor",
    lease: disposal.value.retainedLease,
  });
  // Author, then apply, cancel or release through the space.
}
```

## Events

`space.subscribe(listener)` delivers immutable events owned by that space. `runtime.subscribe(listener)` observes events from every space, including `space:created` and `space:disposed`. Each space has its own monotonically increasing sequence. Event delivery is synchronous and ordered. Listener failures are isolated and reported through the logger. Subscriptions after disposal are inert and late callbacks do not resurrect disposed spaces.

Event payloads belong to the operation that triggered them: initial creation warnings, successful load document and schema, imported-document identity, draft revision/history, revision-conflict expected/actual revisions, invalid diagnostics and migration data are captured before the first observer notification, so a reentrant observer cannot substitute another operation's document, revision or warnings. Disposal cancels pending normal notifications. If disposal happens while a notification is in flight, that notification stops before remaining listeners, and the terminal `space:disposed` event is delivered exactly once to observers registered at disposal time. The callback that invoked disposal may finish its current execution; the event it was already handling is not a later delivery. Listeners removed by disposal receive no later normal events. Runtime disposal applies the same rule to runtime observers and forwards only terminal space disposal events. A space disposed while the runtime remains active removes its queued normal events from the runtime observation queue and stops remaining delivery of its active normal notification; its terminal event remains exactly once. A terminal event queued before runtime disposal is preserved and delivered through the runtime channel.

The event set covers `space:created`, `space:loaded`, `space:disposed`, `mode:changed`, `editor:lease-changed`, `draft:changed`, `draft:applied`, `draft:cancelled`, `draft:conflict`, `document:changed`, `document:invalid`, `locale:changed`, `diagnostics:changed`, `document:exported`, `document:migrated`, `space:imported` and `import:failed`. Host load emits `document:changed` followed by `space:loaded`; draft apply emits `document:changed` followed by `draft:applied`. Failed structural load, draft update and apply paths emit `document:invalid` with the diagnostics after publishing the diagnostics change, while leaving the committed document and draft unchanged. Each event retains the rejected operation's own immutable diagnostics even if a diagnostics observer reenters. If a listener disposes the space during that event, the existing terminal rules suppress later normal events.

## Locale, timezone, formatting and messages

Locale and display timezone are space runtime state, not persisted board document content. The default is `en` with `UTC`. Both are explicit; changing the UI language does not change the timezone. Changing either preserves the document, draft, undo history and views.

Supported UI locale codes: `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar`, `hi`. Arabic is marked RTL in locale metadata. T02 ships only the English message dictionary; other locales fall back to English until T17 supplies complete dictionaries.

Formatting uses `Intl` APIs and the configured timezone. Non-finite numbers, invalid dates and invalid timezones raise `BoardloomError` with a stable diagnostic code instead of being rendered as zero. The formatter provider can be replaced through `formatterFactory`.

Message keys are stable, namespaced strings. Examples include `diagnostic.REVISION_CONFLICT`, `common.apply`, `common.rows.one` and `mode.editor`. Host dictionaries merge before the built-in English fallback. Interpolation accepts scalar values only, never evaluates code and reports missing or invalid parameters deterministically. Plural forms use `Intl.PluralRules` with `.one`/`.other` fallback keys.

## Diagnostics and results

Expected command rejections return a discriminated result:

```ts
{ ok: true, value: ... }
{ ok: false, diagnostics: [{ code, path, message, severity }] }
```

Diagnostic codes are stable and documented constants, for example `SPACE_DISPOSED`, `EDITOR_LEASE_CONFLICT`, `DRAFT_REQUIRES_DECISION`, `REVISION_CONFLICT`, `VIEWER_READ_ONLY` and `INVALID_TIMEZONE`.

A document validator may return non-blocking warnings with a valid result. Those warnings appear in the `space:loaded` payload and in `SpaceSnapshot.diagnostics` until a later successful validation replaces them. Values that are not JSON objects, arrays of JSON values or plain objects, including dates, maps, sets, boxed primitives and class instances, are rejected with `DOCUMENT_INVALID` rather than being rewritten. Own accessor properties, non-enumerable properties, symbol keys, array holes and non-index array properties are also rejected without invoking accessors. Own string keys, including `__proto__`, are preserved as data properties.

## Cleanup

Call `view.dispose()`, `space.dispose()` and `runtime.dispose()` according to ownership. Adapters dispose spaces they create; externally supplied spaces are host-owned. Dispose the runtime at host shutdown to release all spaces and runtime listeners.
