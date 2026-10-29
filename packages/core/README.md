# @boardloom/core

Boardloom headless runtime: isolated spaces, lifecycle, view-local modes, editor lease and draft foundations, locale/timezone configuration, formatting and message-provider contracts. The package has no DOM, UI framework, server, SQL, ORM or database dependency. It imports and runs in Node and in browsers.

Status: T02 implements the headless core. T03 adds the versioned board document schema, canonical export, non-destructive import and a synthetic migration harness. T04 adds the dataset/field/slice contract, capability validation, local and async query adapters, canonical query keys, generations, cancellation and query states. T07 adds the DOM-free renderer contract and registry, the normative field-type matrix, shared value formatting, and renderer-neutral chart, KPI and table models plus lifecycle/error containment. T08 adds the shared X/Y/series/group binding model, selectable and fixed binding enforcement, provider aggregation-capability admission and fixed-binding preservation across document replacement and import. T09 adds dataset-qualified scoped filters, explicit mappings, typed operators, deterministic composition, serializable per-space runtime state, reset paths, cross-filter compatibility and loop suppression, comparison-side filter mapping, and atomic rejection that retains the prior accepted state. T10 adds comparison plan construction for primary and reference query sides, dataset-qualified mappings, composite-key alignment after explicit grouping and aggregation, duplicate-key rejection, null-key exclusion with counted diagnostics, outer alignment, absolute and percentage delta arithmetic with explicit unavailable reasons, declared unit conversion, independent time windows, renderer-neutral comparison results and comparison change events. T11 adds the transport-independent query-shaped realtime contract, generation and epoch invalidation, snapshot/update state machine, bounded buffers, reconnect and resync status, the browser WebSocket adapter and a separate in-memory simulation transport. T13 adds the public extension contracts and registries for query adapters, realtime adapters, formatters, message dictionaries and theme packs, with semantic version metadata, API compatibility ranges, duplicate/override policy, deterministic per-space instances, contained failures and runtime extension events. Locale override dictionaries use the same registry. T12 adds the editor document-operation model for adding, deleting, duplicating, reordering, moving, resizing, configuring and resetting every built-in block type, plus validated theme editing, lease-bound view commands and an explicit fixed-block removal decision for editor deletion. Full built-in locale dictionaries and RTL layout belong to T17.

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

## Event batching

`space.beginEventBatch()` suspends event delivery and returns a handle with `flush()` and `discard()`. Events emitted while the batch is open remain queued in sequence; `flush()` resumes delivery in order, and `discard()` removes queued normal events before resuming. Terminal `space:disposed` delivery is deferred while the batch is open; disposal still clears queued normal notifications under the accepted lifetime rule, and the terminal event is delivered when the batch is flushed or discarded. Terminal delivery therefore occurs after disposal completes but before the batch handle is discarded, A batch handle is idempotent and becomes a no-op after space disposal. This supports hosts that must resolve several editor decisions without reentrant observers interleaving new authoring work; delivery that resumes through `flush()` remains reentrancy-safe and sequence-ordered per space.

## Injection

`createRuntime` accepts an injected clock, ID factory, logger, document validator, provider validation catalog, formatter factory, message dictionaries, draft history limit, block-type allowlist and extension registry. Tests use a fake clock and deterministic ID factory; hosts can provide their own. The default clock uses host timer functions, the default logger is silent and the default ID factory is runtime-scoped. A host document validator is composed after the schema baseline. Message dictionaries are validated as plain enumerable string-to-string records before use; non-plain containers and accessor-backed dictionaries are rejected with `MESSAGE_INVALID_DICTIONARY`.

## Extensions

`createExtensionRegistry()` exposes registries for query adapters, realtime adapters, formatters, message dictionaries and theme packs. Every definition carries a stable ID, semantic `version`, `apiVersion` and optional `apiCompatibility` range and capability list. The registry rejects incompatible API versions, malformed definitions, duplicate IDs and unknown theme tokens with stable diagnostics; `{ override: true }` is the only replacement path and marks the registration as replaced.

```ts
import { createExtensionRegistry, registerLocaleDictionary } from "@boardloom/core";

const extensions = createExtensionRegistry();
registerLocaleDictionary(extensions, "en", { "host.greeting": "Host dictionary" });
const runtime = createRuntime({
  extensions,
  blockTypes: ["plugin.sample"],
});
const space = runtime.createSpace({
  document,
  extensionSelection: {
    queryAdapter: "host.query",
    formatter: "host.formatter",
    messageDictionaries: ["locale.en"],
    themes: ["host.theme"],
  },
});
```

`extensions.createSession(selection, context)` instantiates only the selected adapters for one space. A factory error is contained and returned as `EXTENSION_FAILED`; other spaces and registrations remain usable. Disposing the space calls the adapter's optional `dispose` hook in reverse creation order, keeps going after a failure and reports `EXTENSION_DISPOSAL_FAILED`. `getExtensionThemeTokens()` exposes the selected theme tokens to the DOM layer, where document tokens take precedence. The core registry performs no DOM work and does not evaluate document content.

## Board document schema

Schema v1 is a JSON object with a stable board `id`, `title`, optional `description`, numeric `createdAt` and `updatedAt` timestamps, `theme`, ordered `blocks`, `layout`, `filters`, dataset and slice references, optional filter groups and comparisons, and optional namespaced `extensions`. Bindings preserve dimension, measure, series, group, size, color, comparison and supporting roles with selectable or fixed mode, explicit axis assignment, aggregation, formatting and temporal bucketing with timezone and granularity. Temporal filters declare their timezone and boundary rule; date-time scalar values require an explicit offset so admission never depends on the host timezone. Filters declare dataset-qualified field identity, an explicit board, group or block target, and optional explicit mappings for other datasets. Cross-dataset propagation is never inferred from labels, keys or array position. Comparisons preserve mappings, alignment keys, time windows, display and delta modes, unit policy and documented or lossless unit conversions. Runtime ownership metadata such as space IDs, lifetime IDs, views, leases, drafts, locale, timezone, active filter values, query state and transport handles is not board content.

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

## Editor document operations

`editor-model.ts` exports pure document operations used by the lease-bound editor commands: `editorAddBlock`, `editorDeleteBlock`, `editorDuplicateBlock`, `editorMoveBlock`, `editorResizeBlock`, `editorReorderBlock`, `editorUpdateBlock`, `editorResetBlock` and `editorSetTheme`. Each returns a replacement document or diagnostics and never mutates its input. Added blocks receive valid defaults from the document's dataset and slice references where the built-in type requires data. Duplicated blocks receive fresh block and binding IDs and remapped column/sort references. Every breakpoint remains a valid, non-overlapping layout: a moved, resized or reordered block claims its requested geometry and conflicting blocks are pushed down deterministically. Deleting a block also removes its placements, block-targeted filters and filter-group references.

`view.commands.addBlock`, `deleteBlock`, `duplicateBlock`, `moveBlock`, `resizeBlock`, `reorderBlock`, `updateBlock`, `resetBlock` and `setTheme` apply those operations to the space-owned draft through the active editor lease. `updateBlock` carries title changes, text-block content and, for registered block types, the validated configuration object. Fields omitted from a patch are preserved, so a text or configuration edit never removes an existing title. `setTheme` merges the supplied token values into the existing overrides and removes only explicitly listed tokens, so a mode-only edit never discards unrelated validated tokens. Movement, resizing and reordering materialize a deterministic fallback layout when the selected breakpoint is absent, then serialize that breakpoint. They share the same viewer-bound rejection, fixed-binding preservation and draft validation as every other authoring path. A deliberate editor deletion of a block with a fixed binding is recorded as an authorized draft removal so apply does not reject it, while host document replacement and ordinary draft updates still reject silent fixed-binding loss. The authorization is part of undo/redo history and applies only while that exact block remains absent; undoing the deletion removes the authorization, and a block that reappears is never exempt from fixed-binding checks. Deleting a block also removes filters that target it, prunes those filter IDs from filter blocks and removes a filter block whose filter list becomes empty. Theme edits require a valid mode. Token names must be known framework tokens, explicit `bl-`/`--bl-` tokens or single-segment `ext.` extension tokens; bare `--` names, deeper-dotted extension names and unknown non-namespaced names are rejected with `INVALID_THEME_TOKEN`. Values are validated as safe color or non-color syntax and reject constructs such as `url()`, `expression()`, imports, braces and control characters. Token containers are own-property safe, so a `__proto__` key is rejected rather than silently dropped. Undo, redo, apply, cancel and revision-conflict handling remain owned by the space.

## Scoped filters, composition and cross-filtering

A filter definition has a stable ID, a dataset-qualified `{ datasetId, fieldId }` identity, a typed operator, a serializable default, a viewer-editable flag, an optional temporal timezone/boundary declaration, optional explicit `mappings` and an explicit target. Targets are `board`, `group` with a stable group ID, or `block` with a stable block ID. Text blocks are not data consumers and are outside filter scope. A filter block exposes configured filter IDs; it never creates a hidden board-wide filter.

Field mappings use the same explicit `{ source, target }` model for ordinary filters and cross-filters. A mapping must preserve field type, unit and temporal timezone semantics; timezone conversion and unit conversion are never implicit. A mapping source must equal the filter or selection field. At most one mapping per target dataset is admitted. On a board or group target, every applicable data block must already use the same dataset-qualified field or have an explicit mapping; otherwise admission rejects the change with `FILTER_TARGET_UNMAPPED`. A block without discovered dataset fields produces `FILTER_SCHEMA_PENDING` rather than a guessed field.

Composition is deterministic:

1. Board filters in document order.
2. Group filters in group order, then document order within a group.
3. Block filters in document order.
4. Ephemeral cross-filter selections last, in selection order, with their source block ID.

Definitions are combined with AND. `composeBlockFilters` produces the effective field-qualified filters, scope origins and diagnostics. Contradictory filters on the same target field, such as equality and inequality of the same value or disjoint set membership, produce `FILTER_CONFLICT` and an empty result instead of being ignored. Date ranges retain their declared timezone and inclusive, exclusive or half-open boundary rule through provider execution.

Active values are runtime state, not document content. Each space owns a serializable `FilterRuntimeState` with active values and cross-filter selections. `getFilterState()`, `setFilterValue()`, `setFilterRuntimeState()`, `resetFilter()`, `resetFilterScope()`, `resetAllFilters()`, `setCrossFilter()`, `setCrossFilters()` and `clearCrossFilters()` are space methods. A viewer may change only a filter marked `viewerEditable`; locked filters reject with `VIEWER_READ_ONLY` unless an explicit editor path passes `allowLocked`. Every change is validated against the current document before it is accepted. On failure the prior accepted state, committed document, queries and rendered blocks remain unchanged.

Document load, draft update and draft apply validate the active runtime state against the candidate structure. A structural change that would orphan or invalidate an active filter is rejected atomically. Applying a valid draft prunes active values for removed filters and cross selections whose source block no longer exists. New spaces, imports and sibling spaces start with isolated empty filter state; no filter or selection is shared through module globals.

Temporal filter definitions must use the field timezone unless every effective dataset declares timezone conversion capability through the validation catalog. The same rule applies to document admission, each mapped target, both comparison sides, active values, serialized state and provider query planning; an unverified definition is rejected instead of leaving an unusable default. Parameterless predicates reject default values because the value cannot change the predicate. Comparison blocks receive scoped filters symmetrically on both sides. The filter field resolves on each side through the comparison's explicit mapping, the filter's explicit mapping or the same dataset-qualified identity when both sides share the dataset. An unmapped or type/unit/timezone-incompatible side rejects the configuration; a comparison is never filtered on only one side. `composeComparisonFilterSides` exposes the two effective sides for later comparison query planning.

Runtime changes emit per-filter `filter:changed` events with the filter ID, target scope, effective value and active flag, and per-selection `crossfilter:changed` events with the source block, compatible target block IDs and clear state. Payloads are immutable and ordered on both space and runtime observation channels.

Cross-filter compatibility uses the same field identity, mapping, provider operator and compatibility rules. Unsupported target blocks are excluded with `CROSS_FILTER_INCOMPATIBLE` and the UI disables them with a reason rather than silently dropping the selection. Equality selections from the same source block and field toggle deterministically and suppress echo updates: repeating an identical selection emits no new state, selecting another value replaces the prior value for that source field, and the source block is not filtered by its own selection. Cross-filter selections are ephemeral and never mutate persisted filter definitions or defaults.

## Comparisons

`buildComparisonPlan(document, comparisonId, blockId, { descriptors, catalog, filterState })` validates a comparison against the block's explicit grouping and aggregation and returns two query plans with separate comparison input identities. `alignComparisonResults(plan, primary, reference)` aligns one row per declared composite key, rejects duplicate output keys with `DUPLICATE_ALIGNMENT_KEY`, excludes null composite keys with counted `NULL_ALIGNMENT_KEY` warnings, keeps primary-only and reference-only rows visible, and reports aligned, matched, missing, excluded and per-measure non-null counts. `absoluteDelta` and `percentageDelta` implement the specified arithmetic; missing pairs, null or non-finite operands and zero reference denominators produce unavailable results with stable reasons instead of zero, NaN or Infinity. Comparisons use explicit time windows and declared unit conversion only; no implicit conversion is applied. Side-by-side display may show different measure units when deltas are disabled, while overlay requires compatible units or a documented conversion. Unit names with different declared scales are rejected instead of being treated as identical. Count aggregates remain unitless and are never converted as source measures. Conversions that cannot preserve aggregate semantics, such as a non-zero offset after a sum or a negative factor for min/max, are rejected. A changed comparison definition emits `comparison:changed` with the comparison ID and active state. Comparison-producing operations enqueue diagnostics, comparison, draft or document and loaded notifications as one ordered batch before the queue is flushed. A re-entrant listener therefore cannot receive a nested operation's draft revision or document before the outer operation's events. Undo and redo emit comparison changes consistently from captured immutable target documents. Renderer inputs carry the renderer-neutral comparison result for renderers that declare comparison capability.

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

## Realtime live queries

`createWebSocketRealtimeTransport({ url, protocols?, reconnect?, createSocket? })` adapts a consumer-provided WebSocket endpoint to the transport-independent live contract. `createSimulatedRealtimeTransport()` is a separate in-memory transport for the demo; it exposes `simulated: true` and a `publish(envelope)` method, and it never opens a socket. Core does not ship a service URL, backend or credential.

```ts
const realtime = createWebSocketRealtimeTransport({
  url: hostProvidedEndpoint,
  reconnect: { initialDelayMs: 500, maxAttempts: 10 },
});
const runtime = createRuntime({ datasetProvider, realtime });
const space = runtime.createSpace({ document });
const live = space.setQuery("schools", querySpec, { live: true });
```

A live query requires a provider descriptor with `capabilities.realtime`. The runtime issues the subscription ID, serialized canonical query key, generation and view-to-subscription mapping. Every snapshot or update envelope must carry a non-empty message ID, dataset and slice identity, canonical query key, generation, provider epoch, monotonically increasing sequence, optional cursor, kind, affected result-row keys, query-shaped rows, and a timestamp. `validateRealtimeEnvelope` rejects malformed, incomplete or unknown fields. Result row keys are the canonical JSON array of values for the declared key fields; the default is the grouped field IDs for aggregated queries and the projected field IDs for raw rows. `setQuery(..., { live: true, keyFields?, cursor?, limits? })` starts with a loading state and waits for an authoritative snapshot. Updates that arrive before the snapshot are buffered within the bounded policy, then reconciled against the snapshot in ascending sequence. A buffered gap triggers resync rather than a silent drop. If an age-expired buffered update would be newer than the accepted snapshot, or belongs to a different epoch, the snapshot cannot erase that uncertainty: recovery remains required. Paused snapshot buffering retains newer and mixed-epoch entries so resume reaches the same epoch-mismatch rule instead of silently discarding them.

Query input changes increment the generation, cancel old work and replace the subscription. A replaced or disposed subscription cannot mutate the current result even if its old listener is invoked later. Snapshots from an older epoch are not patched into the current base. A sequence gap, epoch mismatch, invalid envelope or buffer overflow marks the current data stale, requests a resync and keeps the last confirmed rows visible until an authoritative snapshot replaces them atomically. An older same-epoch snapshot at or below the current sequence is ignored in both normal and recovery paths, so a resync response cannot roll back newer data. A reconnect while paused or while recovery is required preserves the recovery requirement; status stays paused or resyncing until an authoritative snapshot establishes the new base.

Per-subscription buffers use the v0.1 limits of 1,000 messages, 5 MB and 5 seconds, whichever is reached first. Every buffered kind, including a paused snapshot, is subject to the byte bound. Overflow coalesces by result row key where possible, otherwise drops the oldest entries, emits `realtime:backpressure` with the dropped count and chosen strategy, and triggers resync. Pause keeps buffering; resume first expires entries outside the time window, then applies a contiguous buffered sequence or resyncs when a gap remains. `pauseRealtime`, `resumeRealtime`, `resyncRealtime` and `closeRealtime` accept a query ID or all live queries. `getRealtimeState(queryId)` exposes status, attempt, epoch, sequence, cursor, counters and buffer usage. `getRealtimeInfo()` exposes the transport ID and the explicit simulation flag. Space pause and resume also pause and resume its live subscriptions. Removing a query, cancelling it, disposing its space or disposing the runtime closes the transport and clears buffers. A listener may remove or replace a live query from inside one of its own realtime events; that superseded session emits no later normal status, applied, resync or backpressure event. A listener may also pause or request resync from an applied event: buffered reconciliation stops, pending entries remain within the bounded buffer, and the pause or recovery command is not overwritten by later buffered updates. Synchronously delivered updates are merged with the retained pending entries, deduplicated by message and epoch sequence, sorted in stream order and subjected to the same age and size bounds. Commands issued from a backpressure event are equally binding: snapshot acceptance and resume recheck pause and recovery after any pruning callback, so an observer pause remains paused and an observer resync waits for a fresh base. If an observer pauses while an initial snapshot is being accepted and that snapshot is not applied, the session records that a new base is required and requests it on resume. Resume draining applies the same checks after each applied event, so a re-entrant pause or resync stops the drain and retains or recovers the remaining entries.

Realtime events are `realtime:status`, `realtime:applied`, `realtime:resync`, `realtime:stale`, `realtime:duplicate`, `realtime:backpressure`, `realtime:error` and `realtime:closed`. `realtime:applied` reports the applied kind, stream sequence, epoch, cursor and applied row count. `realtime:resync` reports the reason, from/to epoch and the stream boundary. `realtime:backpressure` reports the dropped count and strategy. All events carry the space and lifetime sequence, query and subscription identity, query key and generation. A partial live snapshot keeps its partial phase, completeness, authoritative counts and query pagination cursor across later updates; the stream cursor remains separate subscription state. A replacement that preserves row identity and null status keeps the snapshot counts authoritative. Deletes, introduced rows and null-status changes set `countsStale`, set the unknown total to null and recompute held-row null counts, so updated results do not present stale totals as current. Payload and credentials are never copied into adapter logs or diagnostics. Primary and reference comparison queries keep separate query IDs, generations and subscriptions. No transport address is required by the core contracts, and the WebSocket adapter does not expose a default endpoint.

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

The event set covers `space:created`, `space:loaded`, `space:disposed`, `mode:changed`, `view:disposed`, `editor:lease-changed`, `draft:changed`, `draft:applied`, `draft:cancelled`, `draft:conflict`, `document:changed`, `document:invalid`, `locale:changed`, `diagnostics:changed`, `filter:changed`, `crossfilter:changed`, `filter:rejected`, `document:exported`, `document:migrated`, `space:imported`, `import:failed`, `query:started`, `query:settled`, `query:failed`, `query:cancelled`, `query:stale` and `query:invalidated`. Host load emits `document:changed` followed by `space:loaded`; draft apply emits `document:changed` followed by `draft:applied`. Failed structural load, draft update and apply paths emit `document:invalid` with the diagnostics after publishing the diagnostics change, while leaving the committed document and draft unchanged. Each event retains the rejected operation's own immutable diagnostics even if a diagnostics observer reenters. If a listener disposes the space during that event, the existing terminal rules suppress later normal events.

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
