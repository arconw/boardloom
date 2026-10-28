# @boardloom/core

Boardloom headless runtime: isolated spaces, lifecycle, view-local modes, editor lease and draft foundations, locale/timezone configuration, formatting and message-provider contracts. The package has no DOM, UI framework, server, SQL, ORM or database dependency. It imports and runs in Node and in browsers.

Status: T02 implements the headless core. T03 adds the versioned board document schema, canonical export, non-destructive import and a synthetic migration harness. T04 adds the dataset/field/slice contract, capability validation, local and async query adapters, canonical query keys, generations, cancellation and query states. T07 adds the DOM-free renderer contract and registry, the normative field-type matrix, shared value formatting, and renderer-neutral chart, KPI and table models plus lifecycle/error containment. T08 adds the shared X/Y/series/group binding model, selectable and fixed binding enforcement, provider aggregation-capability admission and fixed-binding preservation across document replacement and import. Filter and comparison execution, realtime transport and the public extension registries belong to later tasks. Full built-in locale dictionaries and RTL layout belong to T17.

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

`getSnapshot()` returns a deeply frozen public state snapshot. Documents, drafts, diagnostics, lease records and view summaries are immutable. A new snapshot is produced for each call. `getDatasetDescriptor(datasetId)` exposes the provider's descriptor for a dataset so renderers can use declared field order, units and value metadata without receiving provider handles; it returns `undefined` for an unknown dataset or after space disposal.

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

Provider aggregation and grouping capability is part of document admission when a validation catalog or the space provider supplies dataset capabilities. The runtime adds provider capabilities to admission even without an explicit catalog; a capabilities-only provider catalog does not change document field/slice admission, while an explicit catalog still supplies its field and slice restrictions. A binding that requests an undeclared aggregation, grouping without grouping capability, or timezone conversion without conversion capability is rejected with `PROVIDER_CAPABILITY_MISMATCH` instead of relying on a later query failure. Grouping admission follows query construction: an aggregated chart or table with any grouped dimension, series or label binding requires provider grouping, including a plain categorical X. `createEffectiveValidationCatalog(catalog, datasets)` reconciles an explicit catalog with provider descriptors; provider restrictions are never bypassed by an incomplete explicit field/slice catalog, and stricter explicit capabilities are preserved. `space.getValidationCatalog()` exposes the same effective catalog the binding API and DOM inspector use.

`defaultDocumentValidator` enforces schema v1 and the descriptor-safe plain-JSON contract for every document admitted through create, load, draft and apply. Every non-empty document must pass the schema, including all required fields. A host-supplied `documentValidator` adds constraints on top of that baseline and cannot disable it; duplicate warning diagnostics are merged once. An explicitly empty or unloaded space can remain empty only if a host lifecycle exposes that state; an arbitrary incomplete object is not a valid board.

## Bindings, aggregation and axis locking

`describeBindingSlots(document, blockId, { catalog })` exposes the X, Y, series and group slots that a chart or metric block can edit. Each slot reports its current binding, field and aggregation options, fixed/selectable mode, and the first diagnostic that makes an option unavailable. `setBindingSlot(document, change, { catalog })` applies one field or aggregation selection atomically and returns either a frozen replacement document or diagnostics. Slot resolution uses the same axis, dimension and series precedence as document validation, chart rendering and query construction. A scatter with two implicit measures exposes its first measure as X and its second as Y; an explicit X wins over earlier dimensions; a label binding is not silently promoted to a series, and a label that is not selected as X or series is also excluded from chart query grouping. Option availability and admitted changes use the same `validateBoardDocument` pass, so the editor foundation and the public API cannot disagree about an illegal field, aggregation or chart combination. A change that would make the edited binding resolve as a different slot is rejected rather than silently reinterpreted. Changing a Y field retargets an explicit aggregation source to the selected field; the previous calculation target is never retained silently. A series or group dimension must use a different dataset-qualified field from X; repeating X is rejected in document admission and in inspector option availability so an accepted configuration cannot produce duplicate query grouping keys. If grouping still produces duplicate category/series points, the chart reports the actionable `RENDERER_DUPLICATE_POINT` diagnostic instead of a generic renderer-policy message.

A binding whose mode is `fixed` is a configuration lock. It cannot be changed, removed or unlocked through the binding API, draft validation, apply, document load or source-space import. Same-space draft, apply and load compare fixed bindings by block and binding identity even if the document ID changes, so an incidental ID edit cannot bypass the constraint. Import as a new space may use a different document identity because it does not replace the source board; the source space remains unchanged. The lock is never an authorization or anti-tamper control: diagnostics, message keys and UI copy state that it is a configuration constraint, not a security boundary.

`view.commands.updateBinding(change)` performs the same operation through an editor view and writes to the space-owned draft. A viewer-bound view returns `VIEWER_READ_ONLY` even when a sibling editor holds the lease. `space.updateBinding(lease, change)` is the corresponding lease-bound API. All changes remain undoable through the existing draft history.

## Import, export and migration

`runtime.importDocument(textOrObject, options)` enforces a configurable byte limit, depth, node, collection and string limits, measures parsed objects incrementally without building the complete canonical string, parses safely, rejects malformed JSON and future versions, migrates older known versions, validates the result, and only then creates a new space with a fresh runtime space ID. A supplied provider catalog is carried through parsing, target-space creation, later authoring and export instead of being discarded after admission. When `sourceSpaceId` is supplied, the imported target inherits that source space's effective dataset provider unless the import options provide one explicitly; otherwise the runtime default applies.

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

## Data contract and query adapters

A dataset provider publishes descriptors before any query runs. A dataset descriptor has a stable ID and version, a default IANA timezone, an explicit temporal value representation (`iso8601-offset`, `epoch-milliseconds` or `epoch-seconds`), fields, slices and capabilities. A field has a stable ID and key, value type, semantic role (`dimension`, `measure` or `temporal`), nullability, optional timezone, optional unit descriptor with display scale, allowed values, range, format hints and supported filter operators. Field identity is dataset-qualified; equal keys or labels in different datasets are distinct. Date-only values are interpreted against the declared field or dataset timezone. A civil date that does not occur in that zone is rejected with a diagnostic that identifies the nonexistent start or end, and repeated civil dates resolve to their earliest occurrence; this is a targeted helper contract, not an exhaustive IANA conformance claim. Temporal result metadata resolves field or dataset defaults for representation and timezone, including applicable aggregations.

Capabilities declare grouping, supported aggregations, supported filter operators, time window and timezone conversion support, local/static data, pushdown filtering, server paging, realtime, comparison and the maximum result size. The planner rejects an aggregation, filter operator, grouping, slice operation or version that the descriptor does not declare, and reports the exact path instead of silently dropping the operation. Percentages are represented explicitly: for example a fraction stored in `0..1` uses a unit scale of `100` to display percent. The provider contract is validated from own data properties without executing accessors; accessor-backed providers are rejected with `QUERY_PROVIDER_INVALID`. `createBoardValidationCatalog(datasets)` explicitly adapts these descriptors to the T03 document-validation catalog so field, operator, unit and slice checks use the same provider identity. When a query selects a slice without an explicit projection, the slice field list is the default projection. Sparse or non-index query collections are rejected before normalization. Filter and time-window timezones must match the field timezone unless the dataset declares timezone conversion capability. Query specifications are admitted as descriptor-safe JSON before planning, so accessor-backed or sparse specifications return `QUERY_INVALID` without executing getters. Query plans snapshot and freeze caller-owned filter values, so later mutation of the caller array cannot change a key, an in-flight request or a settled state.

```ts
import { createLocalDatasetProvider, createRuntime } from "@boardloom/core";

const provider = createLocalDatasetProvider({
  providerId: "host-fixture",
  datasets: [
    {
      descriptor,
      rows: syntheticRows,
    },
  ],
});
if (!provider.ok) {
  throw new Error(provider.diagnostics[0]?.message);
}

const runtime = createRuntime({ datasetProvider: provider.value });
const space = runtime.createSpace({ document });
if (!space.ok) {
  throw new Error(space.diagnostics[0]?.message);
}

const query = space.value.setQuery("scores", {
  datasetId: descriptor.id,
  sliceId: "summary",
  fields: ["school_id"],
  groupBy: [{ fieldId: "school_id" }],
  aggregations: [{ output: "attempts", type: "count" }],
  orderBy: [{ key: "school_id", direction: "ascending" }],
});
if (!query.ok) {
  throw new Error(query.diagnostics[0]?.message);
}
```

Every request receives a monotonically increasing request token, a request ID and a canonical query key. The key includes provider and dataset identity, dataset version, slice, projection, grouping and time buckets, aggregations, normalized filters, time window, ordering, limit, cursor and any comparison input identity. A changed key increments the generation, emits `query:invalidated`, cancels the superseded request and starts the replacement. A new request for the same key keeps the generation but supersedes the older request through the token. Cancellation captures its request identity before aborting, so an abort listener may start a replacement without the outer cancellation overwriting it. Late results from an older token, key or generation are ignored and reported through `query:stale`; they never overwrite a newer state, including after cancellation or invalidation without a replacement. Ordering uses planned output semantics, including bucket date types and aggregation output types.

`setQuery`, `refreshQuery`, `invalidateQuery`, `cancelQuery`, `removeQuery`, `getQueryState` and `getQueryStates` are space-owned. Query states are included in `SpaceSnapshot.queries` and are exposed through `query:started`, `query:settled`, `query:failed`, `query:cancelled`, `query:stale` and `query:invalidated` events. Disposal aborts in-flight work, drops the state and ignores late callbacks.

Query phases are `idle`, `loading`, `settled`, `empty`, `partial`, `error`, `cancelled` and `stale`. A successful result with no rows and no diagnostics is `empty`; a real zero measure is a settled row with value `0`; null measures are excluded from aggregation and counted separately. Provider warnings, error diagnostics, an incomplete result, or zero rows carrying diagnostics produce `partial` with `complete: false`. A declared maximum result size truncates explicitly with `QUERY_RESULT_TRUNCATED`. A global aggregate may return one output row for zero filtered input rows; otherwise returned rows cannot exceed filtered rows, and total rows cannot be smaller than filtered rows. Count and distinct-count outputs are dimensionless unless a future explicit count-unit contract is added. A provider failure always carries at least one error-severity diagnostic; warning-only failure results gain `QUERY_FAILED`. Cancellation is a warning state, not a hard provider error.

The async adapter wraps a consumer query function. It forwards the normalized request and an abort signal, requires the consumer to echo the request identity and to declare the filters, groupings, aggregations, time window and comparison input it applied. Missing declarations fail with `QUERY_REQUEST_NOT_HONORED` instead of returning a misleading result. Grouped or aggregated async responses must provide counts; otherwise the result is rejected instead of deriving false null counts from absent source keys. The adapter catches thrown errors without copying raw error payloads into diagnostics. Async consumer output is admitted as descriptor-safe JSON before applied declarations, rows, fields or counts are read. Provider results are likewise admitted without executing accessors before identity and nested metadata are read; accessor or normalization failures become request-owned query diagnostics. Result metadata must match the planned output fields, and counts, cursors and completeness are validated before a state is published. The local adapter applies typed filters, timezone-aware day/week/month/quarter/year buckets, deterministic grouping and aggregation, stable ordering and explicit row limits over in-memory JSON rows. Neither adapter ships a backend, endpoint, credential or real record; tests use a deterministic synthetic assessment fixture.

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

`restoreViewSession(view, mode, lease)` restores a core `ViewImpl` view's mode and active lease without creating a new view. Adapters use it to roll back a host-owned core view's session when a mount fails after a requested mode change. An editor target requires a live lease; a viewer target accepts a null lease. Structurally compatible wrapper implementations are not supported by this helper and must restore or reject their own session changes.

## Events

`space.subscribe(listener)` delivers immutable events owned by that space. `runtime.subscribe(listener)` observes events from every space, including `space:created` and `space:disposed`. Each space has its own monotonically increasing sequence. Event delivery is synchronous and ordered. Listener failures are isolated and reported through the logger. Subscriptions after disposal are inert and late callbacks do not resurrect disposed spaces.

Event payloads belong to the operation that triggered them: initial creation warnings, successful load document and schema, imported-document identity, draft revision/history, revision-conflict expected/actual revisions, invalid diagnostics and migration data are captured before the first observer notification, so a reentrant observer cannot substitute another operation's document, revision or warnings. Disposal cancels pending normal notifications. If disposal happens while a notification is in flight, that notification stops before remaining listeners, and the terminal `space:disposed` event is delivered exactly once to observers registered at disposal time. The callback that invoked disposal may finish its current execution; the event it was already handling is not a later delivery. Listeners removed by disposal receive no later normal events. Runtime disposal applies the same rule to runtime observers and forwards only terminal space disposal events. A space disposed while the runtime remains active removes its queued normal events from the runtime observation queue and stops remaining delivery of its active normal notification; its terminal event remains exactly once. A terminal event queued before runtime disposal is preserved and delivered through the runtime channel.

The event set covers `space:created`, `space:loaded`, `space:disposed`, `mode:changed`, `view:disposed`, `editor:lease-changed`, `draft:changed`, `draft:applied`, `draft:cancelled`, `draft:conflict`, `document:changed`, `document:invalid`, `locale:changed`, `diagnostics:changed`, `document:exported`, `document:migrated`, `space:imported`, `import:failed`, `query:started`, `query:settled`, `query:failed`, `query:cancelled`, `query:stale` and `query:invalidated`. Host load emits `document:changed` followed by `space:loaded`; draft apply emits `document:changed` followed by `draft:applied`. Failed structural load, draft update and apply paths emit `document:invalid` with the diagnostics after publishing the diagnostics change, while leaving the committed document and draft unchanged. Each event retains the rejected operation's own immutable diagnostics even if a diagnostics observer reenters. If a listener disposes the space during that event, the existing terminal rules suppress later normal events.

## Locale, timezone, formatting and messages

Locale and display timezone are space runtime state, not persisted board document content. The default is `en` with `UTC`. Both are explicit; changing the UI language does not change the timezone. Changing either preserves the document, draft, undo history and views.

Supported UI locale codes: `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar`, `hi`. Arabic is marked RTL in locale metadata. T02 ships the English common and diagnostic foundation; T06 extends the English dictionary with the approved viewer, state, table, chart, editor and accessible-name keys. Other locales fall back to English until T17 supplies complete dictionaries.

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
