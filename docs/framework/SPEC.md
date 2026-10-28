# Boardloom Specification

Status: T00 revised draft after round-1 review feedback, ready for re-review. No implementation is claimed by this document.

Source of truth: the English `docs/framework/ARCHITECT_BRIEF.md`, plus the binding owner updates recorded in `.questions/README.md`. This specification refines them into verifiable requirements, contracts, flows, matrices, quality targets and acceptance criteria. Conflicts or task-level choices are recorded in the decision log or the T00 implementer handoff.

Normative words: MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used in the conventional requirements sense.

## 1. Product definition and boundaries

Boardloom is an installable, client-side framework for analytical boards and a visual board editor. It is a standalone product, not a wrapper around the existing ClassScope application.

Confirmed constraints:

- The public repository is `arconw/boardloom`.
- The architecture is a client library plus application adapters.
- The current Fastify, Prisma, SQLite and database runtime are not part of Boardloom runtime or published packages.
- The current repository is the working baseline. Existing local files MUST be preserved. Real records, database dumps, credentials, private URLs and local environment files MUST NOT be copied into the framework, examples, fixtures or demo.
- GitHub Pages deployment is authorized.
- The product is Boardloom and the repository slug is `boardloom` under owner `arconw`; this naming is confirmed by the owner.
- License is MIT, confirmed by the owner. The repository `LICENSE` uses `Copyright (c) 2026 Boardloom contributors`; the holder string may be replaced by the owner without changing the MIT terms.
- npm publication is NOT authorized. Planned scoped package names may be used for tarball consumers even while registry namespace ownership is unverified. Do not claim npm registry availability and do not publish without a provided publisher context.
- All documentation, READMEs, decision logs and prose authored for the project are English. User-interface strings live in locale dictionaries and naturally contain their respective languages.
- The framework MUST support localization of the complete UI, not only number formatting. First-release built-in locales are `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar` and `hi`.

Terminology:

- Board: one serializable analytical document shown in a space.
- Space: the isolated runtime container for one board, its document, runtime state, queries, realtime subscriptions and lifecycle.
- Viewer: mode that allows data interaction and permitted filters but no structural or configuration changes.
- Editor: mode that changes the board structure, bindings, filters, comparisons and theme through a draft.
- Dataset: a provider-owned collection of fields and rows.
- Slice: a stable, provider-understood reference to a subset or projection of a dataset.
- Block: a layout unit of type chart, KPI, table, text or filter, or a registered extension type.
- Renderer: a pluggable implementation that mounts a block visualization into a host element.
- Host: the consuming application, page or framework adapter that embeds Boardloom.
- Locale pack: a validated dictionary of stable message keys and locale metadata for one UI locale.
- RTL: right-to-left layout direction for locales such as Arabic, scoped to the Boardloom host element.

Non-goals for v0.1:

- A hosted analytics service, authentication, authorization, accounts or multi-tenant storage.
- A server, SQL client, ORM, database driver or data warehouse connector inside published packages.
- A general-purpose BI query language or a replacement for a data platform.
- A promise that client-side filtering is a security boundary.
- A sandbox for untrusted third-party JavaScript. Plugins are trusted host code in v0.1.
- Automatic migration of the current ClassScope database or backend.
- UMD or CommonJS publication unless separately built and verified.
- Professional or native-speaker certification of translations. Functional locale coverage and message-key parity are required; linguistic certification is not claimed.

## 2. Architecture

Layers:

1. Headless core: document model, validation and migrations, spaces, modes, draft history, filter composition, comparison model, capability checks, query orchestration, realtime orchestration, extension registries. No DOM and no UI framework dependency.
2. DOM runtime and design system: framework-neutral viewer and editor that mount into an element, consume the core and render accessible, localized UI. It may depend on a browser DOM, built-in locale packs and built-in renderers, but MUST NOT require React, Angular or Svelte.
3. Renderers: built-in chart, KPI and table renderers, plus the public custom renderer contract. ECharts is the proposed chart engine because it is already proven in the baseline; the decision is confirmed by an implementation spike in T07.
4. Adapters: thin React, Angular and Svelte wrappers around the shared DOM runtime and common host contract. Plain JavaScript and TypeScript consumers use the DOM runtime directly.
5. Examples and demo: runnable consumers that install the built tarball, plus the static Pages demo. Examples MUST NOT depend only on workspace source aliases.

Proposed package set. Planned scoped names may be used for tarball consumers; registry namespace ownership and availability are not claimed:

| Provisional package | Responsibility | Must not contain |
| --- | --- | --- |
| `@boardloom/core` | Headless runtime, document, contracts, filters, comparisons, realtime orchestration, registries | DOM, React/Angular/Svelte, server, SQL, Prisma |
| `@boardloom/view-dom` | Framework-neutral viewer/editor DOM runtime, design tokens, accessible shell | Backend client, database |
| `@boardloom/renderers-echarts` | Line, area, bar, stacked bar, scatter and donut renderers | Core coupling to a specific app |
| `@boardloom/react` | React host adapter | A second copy of core UI logic |
| `@boardloom/angular` | Angular host adapter | A second copy of core UI logic |
| `@boardloom/svelte` | Svelte host adapter | A second copy of core UI logic |

KPI, table and text blocks may be implemented in the DOM runtime or in the renderer package, but they MUST use the same public renderer and block contracts. Built-in locale packs may ship with the DOM runtime or a dedicated locale package; the split is fixed in T17/T19 and verified by key-parity, size and tarball checks. The final split is recorded as an architecture decision in T01/T07 and verified by package-boundary checks.

Proposed repository layout for later tasks:

- `packages/` for publishable packages.
- `examples/` for plain JavaScript, TypeScript, React, Angular and Svelte consumers.
- `apps/demo/` for the static GitHub Pages demo.
- `docs/` for product, API, recipes and migration documentation.
- The legacy application remains in place and isolated until its migration guide is accepted.

The framework MAY live in the same repository as the legacy application. Published packages MUST NOT import legacy `src/`, `prisma/`, `frontend/` application code, `.env`, `.ctx` or generated build directories.

Data flow:

1. Host creates a runtime and a space with a board document and dataset provider.
2. The space validates the document, resolves slices through the provider, and builds a query plan.
3. The query orchestrator calls the provider with cancellation and stale-response protection.
4. The core builds a renderer-neutral view model, applying scoped filters, comparisons and capability checks.
5. The DOM runtime mounts the active view and renderers into the host element.
6. Realtime transports deliver snapshots and updates to the space; the query/view layer reconciles them under bounded-buffer and resync rules.
7. The host observes events, persists exported documents and disposes spaces when done.

There is no hidden global store. Shared code and immutable default registries MAY be shared. All mutable board state, caches, subscriptions, timers and listeners belong to a space and are released by `dispose()`.

## 3. Board document and versioning

### 3.1 Document envelope

A board document is a JSON-serializable value with these required concepts:

| Part | Required content |
| --- | --- |
| Schema version | Integer `schemaVersion`, currently 1 for the first accepted schema |
| Identity | Stable board `id`, title, optional description, created/updated timestamps from the host or core clock |
| Theme | Theme mode (`light`, `dark`, `system`) and optional token overrides |
| Data references | Dataset and slice references only; no embedded row data, credentials, functions or runtime handles |
| Blocks | Ordered block definitions with stable IDs, type, bindings, configuration and group membership |
| Layout | Per-breakpoint placement for each block |
| Filters | Filter definitions with explicit target IDs, field identity, operator and value |
| Comparisons | Optional comparison definitions with mapping, alignment, windows, units and display mode |
| Extension data | Only namespaced extension keys; unknown non-namespaced keys are validation errors |

Runtime handles, DOM nodes, query objects, AbortControllers, WebSocket instances, caches, subscriptions, functions and class instances MUST NOT be serialized.

UI locale, display timezone, active filter values, cross-selections and viewer-only display preferences are not part of the persisted board document unless a host deliberately stores them in its own envelope. The document remains locale-neutral.

### 3.2 Stable identifiers

- Dataset, field, slice, block, filter group, filter, comparison and block IDs are non-empty strings and stable across save/load.
- IDs are unique within their namespace in one document. Duplicate block, filter, group or comparison IDs are validation errors.
- Renaming a label MUST NOT change an ID.
- Imported stable IDs are preserved. New IDs are generated through an injected ID factory so tests can be deterministic.
- Field and slice identity is provider-defined. A board MUST NOT assume array order is identity.

### 3.3 Schema validation and diagnostics

Validation runs on load, import, apply and before rendering. It MUST be deterministic and MUST NOT mutate the input.

Every diagnostic includes:

- `code`: stable machine-readable code.
- `path`: JSON pointer or dotted path to the offending value.
- `message`: human-readable explanation.
- `severity`: `error` or `warning`.
- Optional `hint`, `relatedIds` and `source` for provider or migration diagnostics.

Required error families:

- Malformed JSON or non-object root.
- Unsupported future schema version.
- Missing or duplicate required ID.
- Unknown block or renderer type.
- Invalid layout geometry or overlap.
- Invalid field, slice or dataset reference.
- Incompatible binding, aggregation, filter or comparison.
- Invalid theme token.
- Unknown non-namespaced property.
- Provider capability mismatch.
- Migration failure.

Invalid documents MUST NOT be partially rendered as if valid. The UI shows a blocking error state with paths and a recovery path such as import another file or reset the draft.

### 3.4 Import, export and migration

- Export produces a plain JSON-serializable document with no runtime values.
- A document exported by the same schema version MUST round-trip without semantic loss. Deterministic test fixtures compare a canonical representation, not raw key order.
- Import accepts text or an already parsed object, enforces a configurable size limit and validates before use.
- Import is non-destructive by construction. A valid import creates a NEW space with a fresh runtime space ID. It never replaces the committed document or draft of an existing space.
- Document and block IDs round-trip into the new space, but their scope is the new space. The source space keeps its committed document, dirty draft, undo history, filters, cross-filter selection, queries and subscriptions.
- The UI labels the operation as import or open as a new board. Activating the imported board MUST NOT silently dispose the source space or discard its draft. Host-owned source spaces remain host-owned.
- An invalid import creates no space and changes no state, focus, committed document or draft. It emits an actionable diagnostic with path and reason.
- v0.1 has no implicit merge or replace-in-place import API. Host-authored replacement, if provided through an explicit editor/host command, follows the separate draft and revision-conflict contract and MUST NOT be presented as import.
- Older documents are migrated by a versioned, tested chain of pure migration functions. Each step records from-version, to-version, warnings and preserved/added/removed fields.
- A document from a newer unsupported version is rejected with a clear diagnostic; it is never silently downgraded.
- Migration never invents data values. Missing data references remain invalid and are reported.
- The original imported value MAY be retained in memory for diagnostics but MUST NOT be written to a package or external service by Boardloom.
- Import/export, migration and import failure are events available to the host. Successful import emits `space:imported` with the new space ID and optional source space ID; invalid import emits `import:failed`.

### 3.5 Layout

- Layout supports at least desktop, tablet and narrow breakpoints. Proposed reference widths: desktop at 1280 px and above, tablet from 768 to 1279 px, narrow below 768 px, with the UI usable at 320 px. Proposed grid columns: 12 desktop, 8 tablet, 4 narrow.
- A block has placement coordinates, width and height per breakpoint, plus minimum size constraints.
- Placement MUST not overlap within a breakpoint. Missing breakpoint placement falls back deterministically from the nearest larger breakpoint and is flagged for editor review.
- Resizing and reordering MUST preserve block identity and configuration.
- Drag interactions MUST have a keyboard alternative for moving and resizing blocks.
- Layout is serialized; viewport pixel values and transient drag state are not.

## 4. Spaces, modes and lifecycle

### 4.1 Space isolation invariants

- Each board has exactly one owning space. Creating a new board creates a new space.
- A space owns its committed document, editor draft, undo/redo history, query cache, selected filters, cross-filter selection, realtime subscriptions, timers and listeners.
- Views own their DOM, listeners, observers and local view state. Sharing a space MUST NOT share view-local state.
- No mutable state may be shared between spaces through module globals.
- Filters, data, selections and diagnostics from one space MUST NOT appear in another.
- Subscription callbacks from a disposed or stale space MUST be ignored.
- Switching the visible space MUST NOT copy runtime state between spaces.
- Stress tests MUST create and dispose many spaces while asserting no cross-space updates and no retained listeners.

### 4.2 Lifecycle

Required lifecycle operations:

- Create a runtime with injected clock, ID factory and optional logger.
- Create a space with ID, initial document, dataset provider, optional realtime factory and extension registrations.
- Load or replace a committed document through an explicit authoring/host API, with validation.
- Open one or more views for a space. Each view has its own mode and session context.
- Update view properties, resize, unmount and change that view's mode.
- Acquire or release one editor lease for a space and apply or cancel its draft.
- Pause and resume realtime and query activity for an inactive space.
- Explicitly dispose a view, a space and the runtime. Dispose is idempotent and releases all resources.

View and space ownership:

- Views own their DOM, listeners, observers and local view state.
- A space owns the committed document, draft, undo history, query cache, filters, cross-filter selection and realtime subscriptions.
- Unmounting a view MUST NOT dispose an externally supplied space, cancel sibling views or break their state. It releases only that view's resources.
- Adapters dispose spaces they explicitly created and own. An externally supplied space is host-owned and must be disposed explicitly by the host.
- A zero-view space remains alive until explicit disposal and MAY pause query and realtime activity while retaining state. Resume performs the normal stale/gap checks.
- After disposal, commands fail with a deterministic `SPACE_DISPOSED` diagnostic or rejected result. Late promises, timers or socket messages MUST NOT update disposed state or emit normal change events.

### 4.3 Viewer, editor, authority and drafts

Mode belongs to a view or controller, not to one mutable space-wide flag.

- A viewer-bound command interface rejects structural and configuration edits even while a sibling editor view exists in the same space.
- Every authoring command carries an explicit editor session context and lease. There is no ambient "space is in editor mode" privilege.
- Host-driven loading or replacement of a document uses a separate explicit authoring/host API. It MUST NOT be reachable through viewer commands.
- These are API behavior guarantees for cooperating hosts, not a security boundary against hostile host code.

v0.1 editor policy:

- One active editor session/lease per space. A second edit-session request is rejected with `EDITOR_LEASE_CONFLICT`; concurrent collaborative editing is not implied.
- The space owns the draft, revision and undo/redo history. The lease references that draft; it does not create a second source of truth.
- The lease holder may open a viewer view without releasing the lease. The viewer shows the committed document while the editor draft is preserved.
- Releasing or closing an editor lease with a dirty draft requires an explicit apply or cancel decision. It MUST NOT silently discard the draft. The runtime reports `DRAFT_REQUIRES_DECISION` and keeps the draft until the host resolves it.
- Apply validates the draft against the base committed revision. If the committed revision has advanced, apply is rejected with `REVISION_CONFLICT`, the draft is preserved and no newer committed state is overwritten. v0.1 provides no automatic merge.
- Cancel is explicit, discards the draft and restores the committed document without losing valid runtime state.
- Switching a view between viewer and editor does not lose the committed document, draft, undo history or applicable runtime state. The viewer always shows the committed document; the editor restores the draft.
- Structural operations include add, delete, duplicate, reorder, resize, move and configure for every registered block type. Adding or changing a block validates active inherited filters before the structural change is applied.

### 4.4 Event catalog

Public events are delivered as immutable notifications with a space ID, monotonically ordered event sequence and optional timestamp. The exact transport is host-specific.

| Event | When | Key payload |
| --- | --- | --- |
| `space:created` | Space is ready | spaceId |
| `space:loaded` | Document loaded and validated | spaceId, schemaVersion, warnings |
| `space:disposed` | Disposal completed | spaceId |
| `mode:changed` | A view mode changed | spaceId, viewId, sessionId, from, to |
| `document:changed` | Committed document replaced | spaceId, document, source |
| `draft:changed` | Draft mutated or undo/redo | spaceId, revision, canUndo, canRedo |
| `draft:applied` | Draft committed | spaceId, revision, document |
| `draft:cancelled` | Draft discarded | spaceId, revision |
| `draft:conflict` | Apply found a newer committed revision | spaceId, expectedRevision, actualRevision, diagnostics |
| `editor:lease-changed` | Editor lease acquired, released or rejected | spaceId, sessionId, status, diagnostic |
| `space:imported` | Import created a new space | newSpaceId, sourceSpaceId, documentId, schemaVersion, migrationReport |
| `import:failed` | Import rejected without state change | sourceSpaceId, diagnostics |
| `document:exported` | Export requested | spaceId, document |
| `document:invalid` | Validation failed | spaceId, diagnostics |
| `query:started` | Provider query begins | spaceId, requestId, datasetId, sliceId |
| `query:settled` | Query succeeded | spaceId, requestId, rowCount, nullCount |
| `query:failed` | Query failed | spaceId, requestId, diagnostic |
| `query:cancelled` | Query aborted | spaceId, requestId, reason |
| `query:stale` | Late or older-generation result ignored | spaceId, requestId, queryKey, generation |
| `query:invalidated` | Canonical query key or generation changed | spaceId, previousQueryKey, newQueryKey, previousGeneration, newGeneration, reason |
| `filter:changed` | Persistent filter changed | spaceId, filterId, scope, value |
| `crossfilter:changed` | Ephemeral linked selection changed | spaceId, sourceBlockId, targetIds |
| `comparison:changed` | Comparison configured or cleared | spaceId, comparisonId |
| `realtime:status` | Connection/subscription status | spaceId, status, attempt, reason |
| `realtime:applied` | Snapshot or update applied | spaceId, sequence, kind, appliedCount |
| `realtime:resync` | Resync requested or completed | spaceId, reason, queryKey, generation, fromEpoch, toEpoch |
| `realtime:backpressure` | Buffer limit or slow consumer | spaceId, dropped, strategy |
| `extension:registered` | Extension accepted | runtimeId, kind, id, version |
| `extension:error` | Extension rejected | runtimeId, kind, id, diagnostic |
| `diagnostics:changed` | User-visible diagnostics changed | spaceId, diagnostics |
| `locale:changed` | UI locale or display timezone changed | spaceId, locale, timezone, fromLocale, fromTimezone |
| `a11y:announce` | UI status announcement | spaceId, politeness, message |

Hosts MUST be able to unobserve. Event delivery MUST NOT resurrect disposed spaces.

## 5. Data contract

### 5.1 Capability discovery

A dataset provider exposes descriptors before data is queried:

| Concept | Required content |
| --- | --- |
| Dataset descriptor | Stable dataset ID, label, fields, default timezone, dataset version, capabilities |
| Field descriptor | Stable field ID, key, label, data type, semantic role, unit, nullable flag, allowed values or range when known, format hints, timezone for temporal fields |
| Dataset capabilities | Grouping, aggregation kinds, time window, timezone conversion, local/static data, pushdown filtering, server paging, realtime, comparison support, maximum result size |
| Slice descriptor | Stable slice ID, label, dataset ID, parameters schema, supported operations and compatibility notes |

Data types: string, number, date/time, boolean. Semantic roles: dimension, measure, temporal. The core MUST validate that a binding, filter or comparison is allowed by both the field role/type and the dataset capabilities.

Stable identifiers and timezone rules:

- Field and slice IDs are stable across provider sessions when the underlying schema is unchanged.
- Field identity is dataset-qualified: `{datasetId, fieldId}`. Equal field IDs, keys or labels in different datasets are distinct and are not implicitly matched.
- Temporal values are represented as ISO 8601 strings with an explicit offset or as epoch values with a declared unit. The provider MUST declare which representation it uses.
- Every temporal field declares a timezone or inherits the dataset timezone. Display and bucket boundaries are explicit; no hidden local-time conversion.
- Units are explicit. Percentages distinguish fraction (0..1) from percent (0..100) through `unitScale` or an equivalent descriptor.

### 5.2 Query contract

A query request contains:

- Dataset ID, slice reference and stable request ID.
- Requested fields and field-level projections.
- Grouping fields and date bucket granularity.
- Aggregations with validated output names.
- Typed filters composed by the core.
- Optional time window with explicit timezone and half-open boundaries.
- Ordering, limit and cursor or paging parameters supported by the provider.
- An AbortSignal or equivalent cancellation handle.

A query result contains:

- Request ID, dataset version and slice reference.
- Rows as records keyed by stable field IDs.
- Field metadata used for the response.
- Counts: returned rows, total rows when known, filtered rows, null/missing counts per measure.
- Diagnostics for partial results, truncation and unsupported operations.
- Optional next cursor and a flag indicating whether the result is complete.

The provider MUST NOT silently drop unsupported filters or aggregations. If it cannot honor a request it returns a diagnostic that prevents a misleading render.

### 5.3 Adapters and runtime states

Required adapters:

- Local/static adapter for in-memory rows and deterministic synthetic fixtures.
- Async query adapter for a consumer-provided function or endpoint. Boardloom does not ship a backend.

Every query flows through loading, settled, empty, partial, error, cancelled and stale states. Stale protection:

- Each request has a monotonic request token and an AbortController equivalent.
- A result is applied only if it belongs to the current space, canonical query key, generation and request token.
- Any change to filters, projection, bindings, grouping, aggregation or comparison input invalidates the canonical query, increments its generation, cancels superseded work and replaces the relevant subscription.
- Starting a new request for the same canonical query cancels or supersedes the previous one.
- Cancellation MUST NOT surface as a user-visible hard error.
- Late results after disposal, space switch or newer request are ignored and reported as stale only in diagnostics or debug events.

Empty results are distinct from errors and from zero values. The UI shows an explicit empty state with the active filter summary. Errors preserve the last valid render when policy allows, but mark it stale; the default is to show an error state rather than silently mixing old and new data.

### 5.4 Canonical query key and live result ownership

The default generic live contract streams QUERY-SHAPED result rows for a complete canonical query key.

Canonical query key components:

- Dataset and slice identity, including provider dataset version when it affects semantics.
- Projection and requested fields.
- Scoped filters and cross-filter inputs.
- Bindings, grouping, date buckets and aggregation.
- Comparison input identity for the primary and reference sides separately.
- Ordering, limit and paging inputs where they change the result.

Rules:

- A raw dataset feed MAY be adapted by an application/provider. Raw row patches MUST NOT be merged blindly into aggregated query results.
- Every live-capable snapshot and realtime envelope MUST carry mandatory dataset identity, canonical query key, generation, epoch/provider version, and sequence/cursor. There is no "when available" weakening.
- Source/provider-issued values: dataset identity, slice identity, provider dataset version/epoch, sequence/cursor, snapshot rows and row keys.
- Runtime-issued values: request ID, canonical query key serialization, generation and the mapping from a view to its active subscription.
- A provider that cannot establish a consistent snapshot/cursor cannot claim live capability under this contract.
- In live mode, the current generation's versioned store is authoritative. A later-arriving older query snapshot MUST NOT replace newer stream data.
- Incomparable or new epochs require resync. They are never patched into an unknown base.
- Changing filters, bindings, projection, grouping or comparison input increments the generation, cancels old work and replaces relevant subscriptions. Old callbacks and results are ignored even after a transport reconnect.
- Primary and reference input generations are tracked separately for comparison.
- The initial handshake uses an authoritative subscribe snapshot or cursor replay. Updates that arrive before a snapshot are buffered within the bounded policy. If a consistent cursor or snapshot cannot be established, the subscription resyncs and displays stale/loading state.

## 6. Realtime contract

### 6.1 Transport-independent subscription

The core consumes a transport interface with these responsibilities:

- Open a subscription for a canonical query key and generation and return a handle with a stable subscription ID.
- Deliver an authoritative snapshot first or a cursor that establishes the base, then query-shaped ordered updates. If no consistent snapshot or cursor exists, report a status rather than pretending the stream is live.
- Report connection and subscription status: connecting, open, reconnecting, resyncing, paused, degraded, closed, error.
- Accept pause, resume, resync and close commands.
- Replace the subscription when the canonical query key or generation changes.
- Never require a specific WebSocket library in core contracts.

Every snapshot and update envelope MUST carry: message ID, dataset identity, slice identity, canonical query key, generation, epoch/provider version, monotonically increasing sequence or cursor, kind, affected result-row keys, query-shaped payload and timestamp. Kinds: snapshot, append, upsert, delete, reset, heartbeat, error. A transport that cannot provide these fields cannot claim live capability under this contract.

### 6.2 Correctness rules

- Snapshot replaces the current query-shaped result state for that canonical query key and generation, and establishes the baseline epoch and sequence/cursor.
- Current generation state is authoritative. A later-arriving older query snapshot or a snapshot from an older generation is ignored and reported as stale.
- Per subscription, updates are applied in ascending sequence. Duplicates and messages older than the last applied sequence are ignored.
- A sequence gap, epoch/provider version mismatch, generation mismatch, incomparable epoch or resync request triggers resync: request a new snapshot or cursor, keep the previous state visible as stale, buffer bounded updates if policy allows, then replace atomically.
- Query-result row identity comes from the canonical query key and declared result key fields. Upserts replace by result key; deletes remove by result key; duplicate keys within one message are rejected or deterministically coalesced with a diagnostic.
- Updates for a different space, dataset, slice, canonical query key or generation are ignored.
- Reconnect uses exponential backoff with jitter and a documented maximum attempt policy. Proposed v0.1 defaults: 0.5 s initial delay, 2x factor, 30 s cap, 10 attempts, with jitter; the status becomes degraded after repeated failures. Reconnect does not pretend the data is current; status is visible.
- Pause stops applying updates but keeps a bounded buffer. Resume applies ordered buffered messages if no gap remains; otherwise it resyncs.
- Backpressure policy: bounded message count, byte size and time window. Proposed v0.1 defaults per subscription: 1,000 buffered messages, 5 MB, or 5 seconds, whichever limit is reached first. Excess is coalesced by row key where possible, otherwise the oldest entries are dropped, `realtime:backpressure` is emitted, and a gap triggers resync.
- Backpressure must not block the socket reader indefinitely or freeze the UI.
- Unsubscribe and dispose close transports, clear buffers and listeners, and ignore late messages.
- Switching spaces does not move subscriptions. The space owns its subscription. Inactive spaces may pause realtime by default; resume performs gap detection and resync when needed.
- Primary and reference comparison inputs have separate generations, subscriptions and stale checks.

### 6.3 WebSocket adapter

The WebSocket adapter implements the transport interface with a consumer-provided URL, protocol options and reconnect policy. It MUST:

- Support a real socket connection and structured JSON messages with validation.
- Expose close/error/status without leaking payloads or credentials to logs by default.
- Pass an integration test against a real local WebSocket server started on an ephemeral port. The test covers snapshot, ordered updates, duplicate/out-of-order messages, reconnect, resync, pause/resume, bounded buffer and unsubscribe.
- Not depend on the demo simulation. The demo simulation is a separate in-memory transport and is labeled visibly as simulated.

## 7. Blocks and layout

Built-in block types:

- Chart: line, area, bar, stacked bar, scatter, donut.
- Metric/KPI: one scalar or aggregated measure with optional comparison delta.
- Table: tabular fields with formatting, sorting and accessible paging or virtualization.
- Text: plain text content with safe escaping; no untrusted HTML by default.
- Filter: exposes one or more filter definitions and their active state.

A block registry maps stable type IDs to validation, default configuration, renderer resolution and optional editor UI. Unknown types are rejected at validation unless a registered extension supplies them.

Required editor operations for every built-in type: add, delete, duplicate, reorder, move, resize, configure, and reset to defaults. Duplicate creates new block and filter-reference IDs where required, without sharing mutable state with the original.

Draft and commit semantics apply to block operations. Undo/redo covers block structure, layout, bindings, filters, comparisons, theme edits and text edits. Import/export and mode switching do not silently discard a non-empty draft.

## 8. Visualizations

### 8.1 Built-in chart matrix

| Built-in | Required field roles | Optional roles | Aggregation | Notes |
| --- | --- | --- | --- | --- |
| Line | X temporal or ordered dimension; Y numeric measure | Series dimension, comparison | Mean/sum per X when duplicates exist, explicitly disclosed | Zero line shown; non-zero baseline allowed with visible labeling |
| Area | X temporal or ordered dimension; Y numeric measure | Series dimension, stacking | Mean/sum per X | Zero baseline required; negative values use explicit diverging policy or diagnostic |
| Bar | X category, date bucket or binned numeric; Y numeric measure | Series dimension, horizontal orientation | Sum/mean/count/selected aggregation | Zero baseline required; grouped or stacked |
| Stacked bar | X category/date bucket; Y numeric measure; series dimension | Comparison | Sum or configured aggregation per series | Requires non-negative values; negative values reject the stack with a diagnostic or switch to grouped only by an explicit user action |
| Scatter | X numeric measure; Y numeric measure | Series dimension, size/color measures if supported | No aggregation unless duplicate rows are explicitly grouped | Padded numeric axes, zero line optional, no false precision |
| Donut | One category dimension; one non-negative numeric measure | Comparison | Sum by category; explicit "Other" only when configured | Requires non-negative total; zero total shows empty; no implicit absolute values |
| KPI | One measure or aggregated measure | Comparison, sparkline if supported | Declared aggregation | Null shows no data, not zero; unit and precision explicit |
| Table | Any fields | Measure formatting, sorting | Raw rows or grouped aggregates | Accessible header semantics; virtualized rows must retain keyboard access and status |

Normative v0.1 field-type matrix:

| Visual | X field type | Y field type | Series field type | Aggregation | Comparison | Additional constraints |
| --- | --- | --- | --- | --- | --- | --- |
| Line | Temporal, ordered categorical, or numeric with explicit numeric ordering | Numeric | Categorical | Mean or sum per X when duplicates exist, disclosed | Absolute and percentage | Zero line visible; non-zero baseline only with visible labeling |
| Area | Temporal or ordered categorical | Numeric | Categorical | Mean or sum per X | Absolute and percentage | Zero baseline; stacking only for non-negative series |
| Bar | Categorical, date bucket, or binned numeric | Numeric | Categorical | Sum, mean, count, min, max | Absolute and percentage | Zero baseline; grouped or stacked |
| Stacked bar | Categorical or date bucket | Numeric, non-negative | Categorical | Sum | Absolute and percentage | Negative values reject the stack; grouped mode requires explicit action |
| Scatter | Numeric | Numeric | Categorical, optional | None unless duplicate rows are explicitly grouped | Absolute and percentage | Padded axes; no false precision; no stacking |
| Donut | Categorical | Numeric, non-negative | None | Sum | Optional where supported by the renderer | Non-negative total; zero total empty; explicit "Other" only |
| KPI | None | Numeric | None | Declared aggregation | Absolute and percentage | Null shows no data, not zero; unit and precision explicit |
| Table | None | None | None | Raw rows or grouped aggregates | Optional column-level delta where supported | Any fields; accessible headers; virtualized rows retain focus and status |

A custom renderer declares its accepted roles, capabilities and validation rules. The core enforces those declarations before calling the renderer.

### 8.2 Aggregations

Supported aggregation names are explicit and validated: sum, mean, median, minimum, maximum, count, distinct count, and mode for categorical values where the provider supports it. Time buckets: instant, day, week, month, quarter, year, with declared week start and timezone.

Unsupported aggregation or missing required capability is a validation error, not a silent fallback. Mean of nulls excludes nulls and discloses the denominator. Count includes rows according to the documented null policy. Distinct count uses provider semantics and never client-side approximations without disclosure.

### 8.3 Null, empty, zero, negative and ordering semantics

- Null is not zero. A null measure is excluded from numeric aggregation unless a documented aggregation explicitly includes it; the UI discloses missing counts.
- Zero is a real value and must render as zero, distinct from an empty result.
- Empty data shows an explicit empty state with active scope and filters. It must not render fabricated axes or placeholder zeros.
- Negative values are supported for line, area, bar, scatter, KPI and table. Stacked bar and donut reject or explicitly transform negative values according to a visible policy. No stacked geometry may imply a valid total when negative segments are present.
- Category order is `declared`, `data order`, `ascending` or `descending`, selected explicitly. Declared order comes from the field descriptor. Unknown values follow declared values deterministically. "Other" aggregation is opt-in and labeled, never silent.
- Numeric formatting respects locale, declared decimals, units and unit scale. Very small, very large, negative, zero and non-finite inputs have explicit display rules. Non-finite raw values are invalid data and are reported, not rendered as zero.
- Temporal formatting respects the field timezone and selected display timezone. Axis buckets and labels must agree; a day bucket near a timezone boundary must not be labeled as a different day.
- Legends, tooltips, axis titles, accessible names and data alternatives use the same units and formatting as the visual marks.

### 8.4 Custom renderers

A renderer receives a renderer-neutral spec, current data, theme tokens, locale/timezone, host element and a capability context. It returns a handle with update and destroy. It MUST NOT mutate the board document directly. Renderer errors are contained to the block with a diagnostic and do not take down the whole board. Renderer registration is validated and versioned.

## 9. Bindings, aggregation and axis locking

A binding names a field ID and role for X, Y, series, group, size, color or comparison. The editor and public API use the same validation:

- Field must exist in the dataset descriptor.
- Field role must be accepted by the block and renderer.
- Aggregation must be supported by the field and provider.
- X/Y/series combinations must be legal for the selected visualization.
- Temporal bucketing must declare timezone and granularity.
- Comparison mappings must be type-compatible.

Binding mode is `selectable` or `fixed`:

- `selectable` permits changing the binding through the editor.
- `fixed` renders the binding as locked in the editor and rejects changes through the public API/import.
- Locking is a configuration constraint only. It is not an authorization or anti-tamper boundary and MUST NOT be described as secure.
- A document that violates schema constraints is rejected even if it claims a valid fixed binding.

Illegal combinations are rejected with actionable diagnostics. The implementation MUST NOT silently substitute another field, aggregation, chart type or axis.

## 10. Filters

### 10.1 Scope and targeting

A filter has a stable ID, a dataset-qualified field identity, a typed operator, a serializable default value, a viewer-editable flag and an explicit target:

- `board`: applies to every applicable data-consuming block in the space.
- `group`: applies to blocks in one filter group, identified by a stable group ID.
- `block`: applies to one block, identified by a stable block ID.

Field identity is `{datasetId, fieldId}`. A bare display label, field key or coincidentally equal field name is not identity. Cross-dataset filter propagation requires an explicit field mapping with compatible type, operator, units and time semantics. There is no implicit matching by label.

Target IDs MUST resolve at validation time. Filters do not infer targets from array position or display order. Text and other non-data-consuming blocks are N/A for data filters. A filter block displays controls for one or more filter IDs; it does not create hidden global filters.

A scoped filter targets every applicable data-consuming block in its declared scope. If a required target lacks a mapped compatible field:

- Reject the attempted configuration or change atomically.
- Expose the target block/path and the reason.
- Retain the prior accepted filter state.
- Never silently skip a chart or partially update a board filter.

To target only compatible blocks, the author uses an explicit group or block scope. Adding or changing a block MUST validate active inherited filters before applying the structural change; an invalid structural change is rejected atomically. Deferred schema discovery has an explicit pending/error state and never guesses a field or silently drops a filter.

Inheritance and composition order are deterministic:

1. Board filters in document order.
2. Group filters in group order, then document order within a group.
3. Block filters in document order.
4. Ephemeral cross-filter selection appended last with its source block ID.

Filters are combined with AND across definitions. On the same dataset-qualified field, compatible ranges intersect, sets intersect, and equality combines with range intersection. A conflicting combination evaluates to an empty set and raises a visible diagnostic; it must not be ignored. Incompatible field types, operators, units or time semantics are validation errors.

For a comparison block, a scoped filter applies symmetrically to the primary and reference inputs using explicit mappings, before grouping and alignment. An unmapped or incompatible comparison side rejects the change atomically; the runtime never filters only one side. Configuration validation failures are reported separately from a later adapter/query transport error.

### 10.2 Typed operators

- Number: equals, not equals, greater/less than or equal, between inclusive, in set, is null, is not null.
- Category/text: equals, not equals, in set, not in set, contains only when the provider declares support, is null, is not null.
- Date/time: before, after, on or before, on or after, between with explicit inclusive/exclusive boundaries, in set, is null, is not null. Time windows declare timezone and whether the end is inclusive.
- Boolean: is true, is false, is null.

Operators are validated against field type, role and provider capability. UI labels and API semantics are identical. Date ranges use half-open or fully declared boundaries; no hidden end-of-day assumption.

### 10.3 Runtime behavior

- Filter changes update the active scope and re-query only affected blocks where the provider/capability allows; otherwise the whole board updates atomically.
- A rejected filter change leaves the prior accepted filter state, queries and rendered blocks unchanged. Transport failures after an accepted change use the normal error/stale state and do not roll back the filter definition silently.
- Filter origin is shown in the UI with the source scope and, for a block filter, the block name. Origin chips are accessible and removable where permitted.
- Reset exists for one filter, one scope, one block and the whole board. Reset restores declared defaults and does not invent values.
- Filter definitions, targets, operators and defaults persist in the document. Active values are runtime state by default. A viewer may change an active value only when the filter is marked viewer-editable; an editor changes the definition and defaults.
- The host may choose to persist active values separately, but Boardloom does not silently write runtime filter values into the board document. Cross-filter selections are runtime state unless the host explicitly saves them.
- Filter state is serializable and isolated per space. A field whose schema is still unknown is in an explicit pending state; no filter is applied by guessing.

### 10.4 Cross-filtering and linked interactions

- A linked selection from a chart may target compatible blocks only.
- Compatibility uses the same dataset-qualified identity and explicit mapping model as ordinary filters: matching field identity plus compatible type, operator, unit and time semantics. There is no implicit label matching.
- Unsupported targets are visibly disabled with a reason. They are not silently dropped.
- Cross-filter selection is ephemeral, labeled with its source, cleared by explicit reset or an incompatible interaction, and never mutates a persisted filter definition.
- Cross-filtering must not trigger an infinite update loop. The runtime tracks origin and suppresses echo updates.
- Deterministic composition and compatibility are tested with multi-dataset boards, incompatible units, unknown fields and multiple source blocks.

## 11. Comparisons

A comparison definition contains:

- Stable comparison ID and label.
- Base (primary) and reference dataset/slice references, each with dataset-qualified field identity.
- Dimension and measure mapping from primary field IDs to reference field IDs.
- Alignment keys, including composite keys, with declared collation and normalization.
- Optional time windows for primary and reference, each with explicit timezone and boundary rules.
- Display mode: overlay or side-by-side.
- Delta mode: absolute, percentage or both.
- Unit policy: identical units required for direct delta; no automatic unit conversion. Explicit conversion is allowed only when the provider declares a lossless or documented conversion.

### 11.1 Alignment, duplicates and null keys

- Align one result row per declared composite key after the slice's explicitly declared grouping and aggregation.
- Raw rows with duplicate composite keys require an explicit grouping/aggregation before comparison. The comparison does not invent a join.
- Duplicate output keys after the declared grouping/aggregation are a validation error, `DUPLICATE_ALIGNMENT_KEY`. There is no implicit many-to-many join and no silently chosen first row.
- A composite key with any null component is a null composite key. It is excluded from matching and counted; no null component is matched to another null. Diagnostics identify the excluded key count and which components were null.
- Outer alignment preserves unmatched primary and reference keys. Missing pairs remain visible and are never filled with zero.
- A matched pair whose measure is null or non-finite produces an unavailable/null delta with an explicit reason, never zero.
- Count semantics are explicit and consistent with query aggregation:
  - `rowCount`: aligned output rows before matching, including outer-only rows.
  - `matchedRowCount`: keys present on both sides.
  - `primaryOnlyCount`: keys present only on the primary side.
  - `referenceOnlyCount`: keys present only on the reference side.
  - `excludedNullKeyCount`: composite keys excluded because at least one component is null.
  - `matchedNonNullMeasureCount`: matched rows with a finite non-null measure on both sides, per measure.
- Row counts and non-null measure-value counts are different and are both disclosed. Null measure values are not counted as zero.

### 11.2 Delta arithmetic

Let P be the primary value and R the reference value.

- Absolute delta = `P - R` when both operands are finite. The labels "Primary" and "Reference" are shown.
- Percentage delta = `100 * (P - R) / abs(R)` when both operands are finite and R is nonzero.
- The denominator intentionally uses the absolute reference value. This expresses change relative to the reference magnitude and works for negative references; the sign of the delta and the direction of change are preserved in the numerator.
- If R is zero, percentage delta is unavailable ("not available"), including when P is also zero. The implementation MUST NOT display Infinity, NaN, a huge sentinel or an invented zero percent.
- If either operand is null or non-finite on a matched pair, absolute and percentage deltas are unavailable with an explicit reason such as `PRIMARY_NULL`, `REFERENCE_NULL`, `PRIMARY_NON_FINITE` or `REFERENCE_NON_FINITE`.
- Missing pairs have unavailable deltas and a missing reason; they are not zeros.
- No automatic unit conversion. Incompatible units, roles, types, timezone assumptions or mapping collisions reject the comparison with a diagnostic list.

### 11.3 Required fixtures

T10 must implement and trace these expected values:

| Fixture | Primary P | Reference R | Absolute delta | Percentage delta | Notes |
| --- | --- | --- | --- | --- | --- |
| Basic positive | 5 | 2 | 3 | 150% | Standard case |
| Negative reference | 10 | -5 | 15 | 300% | Absolute reference denominator |
| Zero primary, positive reference | 0 | 5 | -5 | -100% | Zero is a real value |
| Zero reference | 10 | 0 | 10 | unavailable | No Infinity/NaN/invented zero |
| Both zero | 0 | 0 | 0 | unavailable | Absolute zero, percentage unavailable |
| Primary null | null | 5 | unavailable | unavailable | Matched pair, reason `PRIMARY_NULL`, non-null matched count 0 |
| Reference null | 5 | null | unavailable | unavailable | Matched pair, reason `REFERENCE_NULL` |
| Duplicate composite key after aggregation | duplicate | duplicate | rejected | rejected | `DUPLICATE_ALIGNMENT_KEY`, no first-row choice |
| Null composite key | key component null | matching value | excluded | excluded | Excluded and counted, no null-to-null match |
| Primary-only key | value | missing | unavailable | unavailable | Outer row, `primaryOnlyCount` |
| Reference-only key | missing | value | unavailable | unavailable | Outer row, `referenceOnlyCount` |

Additional rules:

- Overlay requires compatible measure units and scales; otherwise the UI rejects overlay and offers side-by-side without a delta.
- Side-by-side may show different units only when delta is disabled and the unit difference is visible.
- Comparison results are renderer-neutral and available to every supported block/renderer that declares comparison capability.
- Comparing data from a different dataset is allowed only when the mapping is complete and validated.
- Primary and reference input generations are tracked separately.

## 12. Framework integration

### 12.1 Core runtime contract

The headless core exposes:

- Runtime creation with dependency injection for clock, ID factory, logger and extension registries.
- Space creation, explicit authoring/host load, editor lease/draft operations, view mount requests, export/import as new space, dispose.
- Locale/timezone configuration and formatting/message-provider contracts used by every UI view.
- Subscription to space state snapshots and public events.
- Stable state snapshots that never expose mutable internal objects.

The core MUST import in Node and browser environments without touching DOM globals. The DOM runtime may require a browser.

### 12.2 Common view host contract

Every view host, regardless of framework, provides:

- `mount(target, props)` or an equivalent adapter lifecycle.
- `update(props)` with reconciliation that does not recreate the whole board when avoidable.
- `unmount()` and `dispose()` with idempotent cleanup.
- A view-local mode and session context. Mode changes apply to that view, not to a space-wide mutable flag.
- Access to committed document, draft revision, view mode, editor lease state, diagnostics, realtime status, UI locale and display timezone.
- Event/change callbacks for document, draft, diagnostics, status, mode, lease and locale changes.
- Locale and timezone updates that do not reset the board, draft, filters, comparison or realtime subscription.
- An imperative escape hatch for host actions that cannot be expressed in props, such as focus management, export and explicit host authoring.
- Unmounting one view releases only its DOM, listeners and local state. It MUST NOT dispose an externally supplied space or break sibling views.
- Adapters dispose only spaces they explicitly created and own. Externally supplied spaces are host-owned and require host disposal.
- A zero-view space remains alive until explicit disposal and may pause queries/realtime while retaining state.

The host owns persistence. Boardloom does not write to localStorage, IndexedDB, cookies or a remote service by default.

### 12.3 Adapters and examples

Required real adapters and runnable examples:

- Plain JavaScript, browser ESM.
- TypeScript with declarations.
- React.
- Angular.
- Svelte.

Each example consumes the built package or packed tarball, not only source aliases. Each example demonstrates create, document load, viewer, editor, mode switch, locale/timezone selection, locale switching and disposal. React, Angular and Svelte adapters must demonstrate framework-appropriate props/inputs, events/outputs and cleanup on unmount.

A README-only text snippet is not evidence of integration. Consumer smoke tests and E2E checks are required.

## 13. Extension points

Public extension categories:

- Block types.
- Chart/renderer implementations.
- Query (dataset) adapters.
- Realtime transports.
- Formatting, locale, unit and message-dictionary providers.
- Theme token packs.

Registration contract:

- Stable extension ID, semantic version, API compatibility range and declared capabilities.
- Validation hooks for document configuration and data compatibility.
- Per-space instance creation and deterministic disposal where the extension has state.
- Duplicate IDs are rejected by default. Replacement is an explicit operation with a new registration event.
- Incompatible API versions, invalid schemas or missing renderers produce `extension:error` and never a silent fallback.
- Extension errors are contained and visible; one broken plugin must not corrupt other spaces.

Styling:

- Published UI uses CSS custom properties/design tokens for color, typography, spacing, radius, elevation, focus and motion.
- Styles are scoped to the Boardloom host (Shadow DOM or a documented prefix strategy) so host pages and multiple instances do not leak styles.
- Theme overrides are validated. Unknown non-namespaced tokens are rejected or preserved under an extension namespace.
- Components must not rely on external fonts being present; a system font fallback is declared.

Trust model:

- Plugins execute as trusted host JavaScript in v0.1. No sandbox or capability isolation is promised.
- Boardloom escapes untrusted text and never evaluates document strings as code.
- Custom renderers receive a host element and data; they are responsible for safe DOM construction.

## 14. Design, accessibility and localization

### 14.1 Design system

A coherent visual system is required before the large UI stage:

- Tokenized color roles for background, surface, text, muted text, border, accent, success, warning, danger and focus.
- Light, dark and system modes with equivalent semantic contrast.
- Typography scale, spacing scale, radii, elevation, motion durations and chart palette.
- Components: buttons, icon buttons, text fields, selects/comboboxes, checkboxes, switches, segmented controls, tabs, popovers/dialogs, tables, badges/chips, toolbars, empty/error/loading states and live-region announcements.
- Editor composition: block library, canvas, property inspector, filter manager, comparison builder, draft status, apply/cancel controls.
- Viewer composition: title/meta, filters with origin, board grid, block headers, realtime status, diagnostics.
- States: default, hover, focus, active, selected, disabled, read-only, loading, empty, error, stale data and partial data.
- Desktop and narrow layouts. At narrow widths the inspector becomes a drawer or stacked region and charts remain usable without page-level horizontal overflow.

### 14.2 Accessibility acceptance

Target: WCAG 2.2 AA for the framework shell, viewer and editor.

Required checks:

- Complete core flows with keyboard only: create/open board, switch viewer/editor, select chart fields, add/move/resize blocks with keyboard alternatives, edit filters, configure comparisons, apply/cancel, reset, use realtime pause/resume.
- Visible focus indicators that meet contrast and are not obscured.
- All interactive controls have accessible names, roles, states and descriptions. Icon-only controls have labels.
- Dialogs trap focus correctly, return focus on close and close with Escape. Menus/popovers are keyboard operable.
- Charts expose a text alternative and an accessible data table or summary with units, missing counts and the active filter scope.
- Color is not the only carrier of meaning. Series identity is also available in text/legend and data alternatives.
- Status changes such as loading, stale data, reconnect and apply results are announced through appropriate live regions without excessive interruption.
- Reduced motion is honored for transitions and chart animation; users can stop animation.
- Text and UI contrast meet AA; focus and non-text UI indicators meet contrast requirements.
- Content reflows at 320 CSS px and at 200 percent zoom without loss of function.
- Target sizes and spacing support touch and motor accessibility; interactive targets meet the WCAG 2.2 AA minimum target size of 24 by 24 CSS pixels unless a documented exception applies.
- Automated axe checks report zero critical and zero serious violations for the tested pages, plus a documented manual checklist. Automated checks alone are not acceptance.

### 14.3 Reference mocks and visual acceptance

T05 MUST produce reference mocks and visual acceptance criteria before T06 builds the production UI. Required mock coverage:

- Viewer, desktop, light and dark.
- Viewer, narrow.
- Editor, desktop, light and dark, with inspector and block library.
- Editor, narrow.
- Key states: loading, empty, error, stale, diagnostics, filter origin, comparison, realtime reconnect, plugin error.
- Token tables for color, typography, spacing, radii, elevation and motion.
- Accessibility annotations: focus order, labels, landmarks, live regions and keyboard alternatives.

Reviewers approve or reject mocks against the brief. Final UI screenshots and video must match the approved direction or record an approved deviation. Public documentation screenshots are selected separately from raw review/test evidence. Mocks are evidence, not a claim that implementation exists.

### 14.4 Localization and RTL

Localization is a first-class framework capability, not only number formatting.

Dependency order is binding: core/T02 introduces locale/timezone configuration and formatting/message-provider contracts; T05/T06 use stable message keys and the English foundation from inception; T14-T16 verify forwarding and state-preserving updates against that foundation, including host message overrides; T17 completes and validates the eleven built-in dictionaries, all flows, Arabic RTL and full locale acceptance over all adapters. No task may require a localization capability introduced only by a future dependency.

Built-in UI locales for the first release: `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar` and `hi`. Locale packs are data, not code branches. English is the deterministic fallback.

Requirements:

- Every built-in locale has complete message-key parity for UI copy, ARIA names and descriptions, status announcements, validation errors, empty/loading/error states, diagnostics, editor controls, filter labels, comparison labels, realtime status and plugin-facing host messages.
- Message keys are stable, namespaced and documented. Renaming a key requires a compatibility strategy for host overrides.
- Host applications can provide locale overrides or custom dictionaries. Merge precedence is: host override, selected built-in locale, English fallback. Unknown keys are reported; they are not silently accepted as a different message.
- Missing keys fall back to English deterministically. A missing key in English falls back to a documented human-readable key or neutral text and raises a development diagnostic; raw internal identifiers are not shown as normal UI copy.
- Interpolation is typed and escaped. Placeholder substitution must not evaluate code or inject HTML. Missing or invalid parameters produce a deterministic, non-crashing message and a diagnostic.
- Pluralization follows the locale rules through `Intl.PluralRules` or an equivalent standard mechanism. Strings are not assembled by concatenating translated fragments with different word order.
- Numbers, dates, times, durations, relative times and units use `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` and `Intl.DisplayNames` or equivalent standard APIs where applicable. Unit labels are localizable separately from raw dataset units.
- The display timezone is explicit and independent from UI language. Changing the UI language must not silently change the timezone or the meaning of a date bucket.
- Changing locale re-renders the UI without losing the board document, editor draft, undo history, active filter values, cross-filter selection, comparison configuration, realtime subscription state or scroll/focus context where practical.
- The persisted board document is locale-neutral. It stores stable IDs, values, timestamps and locale-independent configuration, not a UI locale or translated labels. A host may persist a display preference separately.
- Host dataset field labels and data values are not silently translated. Only framework-owned messages are localized; hosts may explicitly provide localized labels through their data contract.
- Arabic and other RTL locales set `dir` and relevant layout direction only on the Boardloom host or its scoped root, not on the whole host document. Layout, focus order, icon direction, menus and charts remain usable. Numeric chart axes and data values keep their correct data direction and locale formatting.
- Locale packs can be loaded or replaced without changing document semantics. Package size and lazy-loading strategy are measured in T17/T19.
- Professional or native-speaker translation certification is not available and MUST NOT be claimed. Reviewers verify key parity, functional coverage, fallback, interpolation, CJK rendering and Arabic RTL in real browser flows. Linguistic quality is reported as a limitation.

The DEMO includes language switching and an Arabic RTL demonstration. Documentation is authored in English; localized UI dictionaries are product assets, not translated project documentation.

## 15. Performance and scale targets

v0.1 reference environment:

- Browser: current stable Chromium on desktop Linux, 4 performance cores, 16 GB RAM, 1440 x 900 viewport, production build, no remote network latency.
- Dataset: 5,000 rows, 12 fields, up to 20 series, 8 blocks including 4 charts, one table, one KPI and one filter block.
- Filters: board plus one group plus one block scope. One comparison. Realtime updates at 10 messages per second.

v0.1 measurable targets:

| Metric | Target | Measurement |
| --- | --- | --- |
| Initial viewer ready after provider data is available | p95 <= 1,500 ms | Playwright trace with marks |
| Filter or axis change feedback | p95 <= 300 ms for the 5,000-row fixture | Interaction trace, long-task check |
| Full board re-render with 8 blocks | p95 <= 900 ms | Trace from interaction to settled |
| Realtime update application at 10 msg/s | no sustained queue growth; p95 apply <= 100 ms | Bounded-buffer instrumentation |
| Memory after 10 open/close cycles | no monotonic growth beyond 10 percent from baseline | Browser heap snapshots |
| Core package size | <= 40 KB gzip | Build size report |
| Adapter packages | <= 8 KB gzip each, excluding shared runtime already loaded | Build size report |
| DOM runtime | <= 90 KB gzip excluding ECharts and fonts | Build size report |
| ECharts renderer chunk | <= 400 KB gzip, tree-shaken to used charts | Build size report |
| Locale switch on an 8-block board | p95 <= 500 ms, board/draft/filter state preserved | Browser trace with state assertions |
| Locale pack size | <= 100 KB gzip per built-in locale; larger packs must be lazy-loadable and documented | Build size report |

Staged scale targets, each requiring explicit measurement and review before a release claim:

- v0.2: 25,000 rows, 20 blocks, 50 series, 50 realtime messages per second, no unbounded memory growth.
- v0.3: 100,000 rows through paged/remote providers, virtualized table and charts with capped visible points; no silent client-side truncation.
- Scale targets do not defer required functionality. All mandatory FRs must be present in v0.1; only scale ceilings, browser breadth and optional packaging formats may be staged.

Performance claims must include the fixture, hardware, browser version, commit and local measurement evidence. A claim without evidence is not an acceptance criterion.

## 16. Security, privacy and package boundaries

- No secrets, API keys, tokens, private URLs or credentials in the repository, fixtures, examples, docs, demo or packages.
- No real data, database exports or user files. Only synthetic fixtures derived from the application's domain are permitted.
- Published packages MUST NOT include Fastify, Prisma, SQL clients, Node-only server modules or legacy application imports.
- Boardloom ships no default backend endpoint and no default WebSocket URL.
- Import has a size limit and schema validation. Deeply nested or oversized values are rejected safely.
- Text is escaped by default. Document content is not executed as code. No `eval`, `Function` constructor or equivalent for board content.
- Plugin registration does not execute untrusted document content. Plugin code is host-supplied and trusted in v0.1.
- Realtime and query errors shown to users do not include credentials, full URLs with tokens or raw payloads. Logging is opt-in and redacted by default.
- Secret scanning in CI MUST fail without printing matching secret values.
- `.env`, `.ctx`, local databases, private keys and credentials must be ignored and never packaged.
- Ignore rules must protect secrets and exclude `.evidence/`. Challenge journals, review reports and videos are local-only and are not committed or published. Public README/docs screenshots are separate approved documentation assets.

## 17. Delivery, packaging, demo and CI

### 17.1 Packaging

Every published package MUST declare:

- A documented `exports` map with browser ESM entry points.
- JavaScript runtime and TypeScript declarations.
- CSS entry for the DOM runtime and optional theme packs.
- Side-effect and tree-shaking metadata where applicable.
- Peer dependencies with compatible ranges where the host supplies a framework.
- A package boundary test that fails if forbidden imports or files are included.
- MIT license metadata and `LICENSE` inclusion in the packed artifact.

v0.1 packaging decision: browser ESM is the supported runtime. UMD and CommonJS are NOT promised by v0.1. If a CJS build is added later, it requires an explicit build, consumer test and documentation; no unverified compatibility claim is allowed.

Tarball verification:

- `npm pack` each package.
- Install the tarballs into clean consumer fixtures under the project `.tmp` directory, never `/tmp`.
- Run plain JavaScript browser ESM, TypeScript, React, Angular and Svelte smoke tests against the packed output.
- Verify declarations, exports, CSS, source maps, `LICENSE`, locale packs and absence of forbidden files.

Versions use SemVer. The first accepted release is 0.x. No `1.0.0` is assigned before acceptance. The license is MIT and the repository `LICENSE` is included in release artifacts. npm publication remains blocked until a publisher context and registry namespace are provided; planned scoped names may be used for tarball consumers without a registry-availability claim.

### 17.2 GitHub Pages demo

The `DEMO` branch contains a reproducible static HTML demo deployed to GitHub Pages and consuming the same package API. It must demonstrate:

- Editor to save/export to viewer.
- A second board and switching between them.
- Dataset comparison with mapping and delta.
- Every built-in visualization.
- Board, group and block filter scopes with origin and reset.
- Fixed and selectable axis bindings.
- Realtime with an honestly labeled simulated transport.
- A plugin block/renderer loaded through the public extension API.
- Language switching across built-in locales with preserved board, draft and filter state.
- Arabic RTL scoped to the Boardloom host, with viewer and editor remaining usable.

The demo shows synthetic data and its provenance, the transport type, and the package version. It must not require a backend, secrets or a private API. The Pages base path must be correct for the repository path and verified by an E2E navigation test. The demo must not claim that simulated realtime validates the WebSocket transport; a separate integration test does that.

### 17.3 Documentation

The README and docs MUST include:

- A strong product README with a cover and screenshots from the real UI. Public documentation screenshots are deliberately selected assets, distinct from raw review/test evidence.
- Working quickstarts for plain JavaScript, TypeScript, React, Angular and Svelte.
- A data contract example and capability explanation.
- An architecture diagram and package map.
- Viewer and editor guidance.
- Filters, comparison, realtime and plugin guides.
- Lifecycle and cleanup guidance.
- Localization guidance: built-in locales, stable message keys, host overrides, English fallback, interpolation safety, locale switching, timezone independence and RTL.
- Limitations and trust model, including the absence of professional/native translation certification.
- A link to the Pages demo.
- Generated or curated API documentation.
- Recipes for common boards and custom renderers.
- A migration guide from the current ClassScope project, without migrating its backend, database, secrets or real records.

Documentation claims MUST be backed by tests or a recorded manual verification. Public screenshots must be real Boardloom UI, not mocks or legacy ClassScope screenshots. Mockups may be labeled as design references only. Project documentation and READMEs are authored in English; UI locale dictionaries are separate assets.

### 17.4 CI and release gates

PR checks:

- Reproducible install from the committed lockfile.
- Lint and typecheck.
- Unit and contract tests with meaningful assertions.
- Integration tests, including a real local WebSocket test.
- Browser E2E for viewer, editor, filters, comparison, realtime and plugins.
- Localization checks: complete message-key parity, missing-key fallback, interpolation safety, English/Russian, a CJK locale and Arabic RTL across the real viewer/editor flows.
- Acceptance-owner uniqueness and reviewed public stage manifest/staged-tree checks.
- Accessibility checks plus manual checklist evidence for UI-affecting changes.
- Package build, package-boundary check, `npm pack` and tarball consumer matrix for all adapters.
- Docs and demo builds.
- Secret scanning with redacted output.
- CI failure diagnostics: logs, coverage and traces. Never upload the cumulative challenge journal, review reports, selected review/test screenshots or video recordings.

Workflow rules:

- Least-privilege permissions.
- Actions pinned to immutable commit SHAs and recorded versions.
- Concurrency groups cancel superseded PR runs.
- Separate PR checks, Pages deployment and release workflows.
- No secrets are required for PR test workflows, especially from forks.
- PR workflows do not deploy to Pages or publish packages.
- Pages deploy is restricted to the `DEMO` branch and the approved artifact.
- Release is manual, gated, and may remain a dry run while npm publishing is unauthorized.

Release gates:

- Both independent reviewers PASS the identical final snapshot.
- All mandatory FRs and ACs pass.
- No unresolved P0/P1 findings or challenges.
- Performance evidence meets v0.1 targets for the declared fixture.
- License is MIT and the `LICENSE` file is present; brand and repository naming are confirmed; npm publication is withheld unless a publisher context and registry namespace are provided.
- Localization evidence includes key parity for all built-in locales and functional browser coverage; no native-speaker certification is claimed.
- Local review evidence remains under `.evidence/` and is not committed or uploaded; public documentation screenshots are separately approved.
- No secrets or real data in the release artifact.
- SemVer 0.x tag and release notes; no AI mentions in commit messages or co-author fields.

### 17.5 Local evidence policy

Review evidence is local by owner decision.

- `.evidence/README.md` explains the layout and retention policy.
- `.evidence/challenges/CHALLENGES.md` is the cumulative append-only challenge journal maintained by OC reviewers.
- `.evidence/reviews/<task-id>/` contains implementer handoffs and both reviewer reports.
- `.evidence/videos/<task-id>/` contains selected final UI-testing/code walkthrough videos, screenshots and manifests.
- `.evidence/` is ignored by Git.

Rules:

- Challenges, review reports, review/test screenshots and videos MUST NOT be committed to Git, pushed, attached to GitHub Releases, uploaded by CI or sent to an external service.
- The OC reviewer still MUST record real UI-testing and relevant code walkthrough videos for tasks that require them. Only storage and publication changed.
- Product screenshots deliberately selected for the public README or documentation are distinct public documentation assets. They may be committed under `docs/` when approved. Raw review/test evidence MUST NOT be copied from `.evidence/` into public docs without explicit architect approval.
- CI may upload ordinary build/test diagnostics such as logs, coverage and traces according to the CI request. CI MUST NOT upload the cumulative challenge journal, review reports, selected review/test screenshots or video recordings.
- Public docs may explain local evidence requirements as plain paths but MUST NOT contain broken Markdown links to files intentionally absent from Git.
- Raw takes and intermediate scripts/logs stay in `.tmp/`. Final selected evidence under `.evidence/` is retained as a local deliverable, not disposable temporary material.
- Evidence remains local for the release decision. The architect decides post-acceptance retention.
- The public initial commit contains only the accepted planning package, `LICENSE` and a safe `.gitignore`; no unreviewed legacy source or real data. T01 preserves existing local code, establishes the framework workspace and documents a reversible migration plan.

## 18. Requirement catalog

### 18.1 Functional requirements

| ID | Requirement |
| --- | --- |
| FR-001 | Provide distinct BoardViewer and BoardEditor modes. Viewer permits chart interaction and permitted filters; only Editor changes structure and configuration. |
| FR-002 | Switching modes preserves committed state, draft state and applicable runtime state without data loss. |
| FR-010 | Provide multiple isolated spaces. A space owns one board, its configuration, runtime state, subscriptions and lifecycle. |
| FR-011 | Creating a new board creates a new space. Disposal releases state, queries, subscriptions, timers and listeners. |
| FR-012 | Multiple spaces coexist and switch without hidden global storage, filter/data leakage or stale updates. |
| FR-020 | Provide a versioned, serializable board document containing layout, blocks, data slice references, chart specs, filters, comparisons and theme. Runtime handles are separate and non-serializable. |
| FR-021 | Support import and export with runtime validation, actionable errors and safe size handling. Import creates a new space and never replaces an existing committed document or draft. |
| FR-022 | Provide a tested migration strategy for older documents and deterministic round-trip behavior for the current version. |
| FR-030 | Define an explicit DataSource/Dataset/Slice contract with field schema, types, dimensions, measures, units, timezone, stable identifiers, allowed operations and capability discovery. |
| FR-031 | Provide local/static and async query adapters with cancellation, stale-response protection and loading, empty, partial, error and cancelled states. |
| FR-032 | Distinguish loading, empty, partial, error, cancelled and stale query states and expose them to the UI and host. |
| FR-033 | Keep servers, SQL clients, ORMs, database drivers and backend runtime out of published packages. |
| FR-040 | Provide chart, KPI/metric, table, text and filter blocks through an extensible block registry. |
| FR-041 | Support block add, delete, duplicate, reorder, move and resize with responsive layout and lossless serialization. |
| FR-042 | Provide undo/redo, draft/apply/cancel and atomic validated commits. |
| FR-050 | Provide built-in line, area, bar, stacked bar, scatter, donut, KPI and table visualizations, plus custom renderer registration. |
| FR-051 | Enforce a field/visualization compatibility matrix in UI and public API; never silently build illegal combinations. |
| FR-052 | Handle null, empty, zero, negative values, category order, formatting and units without misleading output. |
| FR-060 | Allow X, Y, series, grouping and aggregation selection with selectable and fixed/locked bindings. |
| FR-061 | Enforce schema constraints identically in UI, core and API. Axis lock is a configuration constraint, not a security boundary. |
| FR-070 | Support board-wide, selected-group and single-block filters with explicit target IDs, dataset-qualified field identity, inheritance, reset and visible origin. Missing mapped targets reject atomically without partial board updates. |
| FR-071 | Support typed number, category, date and range filter operators. |
| FR-072 | Define deterministic filter composition order and explicit behavior for incompatible dataset-qualified fields, units, time semantics, unmapped targets and conflicting filters. Comparison filters apply symmetrically or reject atomically. |
| FR-073 | Support compatible cross-filtering and linked interactions with explicit compatibility rules. |
| FR-080 | Support comparison with another dataset/slice through explicit field mapping, alignment keys, time windows and units. Align one row per composite key after explicit grouping/aggregation; reject duplicate output keys and exclude null composite keys with counted diagnostics. |
| FR-081 | Support overlay and side-by-side comparison plus absolute and percentage delta, with explicit missing pairs and zero division. Reject incompatible slices with diagnostics. |
| FR-090 | Provide a transport-independent realtime subscribe contract and a WebSocket adapter that stream query-shaped rows for a complete canonical query key with mandatory dataset, generation, epoch and sequence/cursor identity. |
| FR-091 | Handle realtime snapshot plus updates, ordering, duplicates, reconnect, resync, bounded buffers, pause/resume, backpressure, errors, connection status, unsubscribe and space switching. Query-key or generation changes cancel old work and replace subscriptions; older snapshots cannot overwrite newer stream data. |
| FR-092 | Label simulated realtime and synthetic data honestly in the Pages demo, and validate the real transport with a separate real local WebSocket integration test. |
| FR-100 | Provide a framework-neutral runtime installable in plain JavaScript and TypeScript. |
| FR-101 | Provide real React, Angular and Svelte adapters and runnable examples. |
| FR-102 | Provide a common state and mount/update/unmount contract with cleanup. Core must not depend on a UI framework. |
| FR-110 | Expose extension points for block types, renderers, query adapters, realtime adapters, formatting and themes, with compatibility checks and registration errors. |
| FR-111 | Define CSS variables/design tokens and scoped styles. |
| FR-120 | Deliver a coherent design system with typography, spacing, colors, light/dark themes, editor controls and states. |
| FR-121 | Support keyboard operation, visible focus, labels, reduced motion, contrast, text alternatives for data, desktop and narrow screens. |
| FR-122 | Produce reference mocks and visual acceptance criteria before the large UI implementation stage. |
| FR-130 | Provide a strong README with real UI cover and selected public screenshots, working quickstarts for five environments, data contract example, architecture diagram, viewer/editor, filters, comparison, realtime, plugins, lifecycle and Pages link, plus API docs, recipes, limitations and a migration guide. |
| FR-131 | Provide a DEMO branch with a reproducible static GitHub Pages demo using the same package API, all required flows, synthetic data, transport labeling and a correct base path. |
| FR-132 | Define package exports maps, JavaScript runtime, TypeScript declarations, CSS entry points and tarball installation. Support browser ESM and state the UMD/CJS decision explicitly. |
| FR-133 | Provide CI for reproducible install, lint, typecheck, meaningful unit/contract tests, integration tests, browser E2E, accessibility, package/tarball consumers for all adapters, docs/demo builds, package boundaries and redacted secret scanning, with minimal permissions, pinned actions, concurrency, separated PR/Pages/release workflows, acceptance-owner uniqueness, reviewed public stage manifests/staged trees and ordinary failure diagnostics. CI must not upload local review evidence or videos. |
| FR-134 | Assign versions and SemVer tags after acceptance, without premature 1.0.0 and without npm publication until authorized. |
| FR-135 | Provide a migration guide from the current project without moving its backend, database, secrets or real records. |
| FR-136 | Record licensing and package ownership as explicit decisions. MIT is confirmed; do not publish from an unowned organization. |
| FR-140 | Provide built-in complete UI localization for `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar` and `hi`, including ARIA, status, error and diagnostic messages with stable keys and deterministic English fallback. |
| FR-141 | Support host-provided locale overrides and custom dictionaries, typed and escaped interpolation, pluralization, and locale switching without losing board, draft, filter, comparison or realtime state. |
| FR-142 | Use locale-aware `Intl` number, date, time, duration and unit formatting, with an explicit display timezone independent from UI language. |
| FR-143 | Scope Arabic RTL direction and layout to the Boardloom host without leaking into the host page; keep viewer, editor and charts usable. |
| FR-144 | Keep the persisted board contract locale-neutral, and do not silently translate host dataset field labels or data values. |

### 18.2 Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-001 | Meet the v0.1 performance and memory targets on the declared fixture and reference environment, with evidence. |
| NFR-002 | Meet WCAG 2.2 AA for the shell, viewer and editor, including keyboard-only operation and data alternatives. |
| NFR-003 | Protect privacy and security: no secrets or real data, safe import, escaped text, no eval, no default endpoints, redacted logs and errors. |
| NFR-004 | Enforce package boundaries and supply-chain hygiene in code, packed artifacts and CI. |
| NFR-005 | Make reviews and builds reproducible through committed lockfiles, recorded fingerprints, pinned tooling and clean-checkout builds. |
| NFR-006 | Declare and test a supported browser matrix; do not claim unverified compatibility. |
| NFR-007 | Make document serialization, filtering, comparison, grouping and formatting deterministic. |
| NFR-008 | Provide actionable diagnostics with stable codes and paths for validation, provider, renderer, filter, comparison and realtime failures. |
| NFR-009 | Keep documentation accurate, complete and backed by executable quickstarts or recorded verification. |
| NFR-010 | Use meaningful unit, contract, integration, E2E, accessibility and consumer tests; avoid coverage theater and unverified claims. |
| NFR-011 | Handle locale, timezone, units and formatting consistently across data, axes, tooltips, tables and accessible alternatives. |
| NFR-012 | Document scale ceilings honestly; do not silently truncate data or defer mandatory capabilities to meet a scale target. |
| NFR-013 | Localization completeness and quality: all built-in locales have complete key parity; fallback, interpolation, CJK rendering and Arabic RTL are verified in real flows. Professional/native translation certification is not claimed. |
| NFR-014 | Keep challenges, review reports and videos in the ignored local `.evidence/` directory; never commit or upload them. Keep selected public docs screenshots separate and restrict CI uploads to ordinary build/test diagnostics. |

## 19. Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-001 | A viewer-bound view and command interface reject structural/configuration mutations even while a sibling editor exists; host authoring APIs are separate. This is an API behavior guarantee, not a security boundary against hostile host code. |
| AC-002 | Modes are per view. One editor lease per space is enforced; a second request is rejected. Switching views preserves committed document, draft, undo history and applicable runtime state. |
| AC-010 | Two spaces keep documents, filters, data, selections and subscriptions isolated under concurrent use. |
| AC-011 | Creating a board creates a new space; no module-level mutable store is observed by tests. |
| AC-012 | View unmount releases only view resources and does not break sibling views or dispose an externally supplied space. Explicit view/space/runtime disposal is idempotent, cancels shared resources and ignores late callbacks; zero-view spaces remain alive until host disposal. |
| AC-020 | A document round-trips with layout, blocks, slice references, chart specs, filters, comparisons and theme intact and with no runtime handles. |
| AC-021 | Import validates a complete document and creates a new space with a fresh runtime ID; it never replaces an existing space's committed document or draft. Invalid import creates no space and changes no state; future versions are rejected without downgrade. |
| AC-022 | Migration chains run deterministically on fixtures, report changes and preserve stable IDs and user configuration where possible. |
| AC-030 | Dataset, field and slice descriptors expose stable IDs, types, roles, units, timezone and capabilities. |
| AC-031 | Local and async adapters load data; cancellation aborts work; stale results are ignored. |
| AC-032 | Loading, empty, partial, error, cancelled and stale states are distinguishable and accessible. |
| AC-033 | Published packages contain no server, SQL, Prisma, legacy application or secret material. |
| AC-040 | Chart, KPI, table, text and filter blocks are available through the registry, and a custom block can be registered. |
| AC-041 | Add, delete, duplicate, move, resize and reorder work for every built-in type, including keyboard alternatives, and serialize losslessly. |
| AC-042 | Draft, apply, cancel, undo and redo are correct and validated; apply is atomic. A dirty-draft lease release requires an explicit decision, revision conflicts preserve the draft and reject overwrite, and import is not replace-in-place. |
| AC-050 | Line, area, bar, stacked bar, scatter, donut, KPI and table render with fixture data, and a custom renderer registers and renders. |
| AC-051 | The normative field-type compatibility matrix rejects illegal combinations in both UI and public API. |
| AC-052 | Null, empty, zero, negative, category order, units, locale and timezone behavior match the specification. |
| AC-053 | Bar, area, stacked and donut baselines and negative-value policies do not produce misleading geometry. |
| AC-060 | X, Y, series, group and aggregation selection works; fixed bindings are enforced and selectable bindings change. |
| AC-061 | Axis locking is documented and tested as configuration only, not as a security boundary. |
| AC-070 | Board, group and block filters use dataset-qualified field identity, explicit targets and inheritance; text/non-data blocks are N/A. Missing mapped fields or invalid structural changes reject atomically and retain the prior accepted state. |
| AC-071 | Number, category, date and range operators obey declared types, timezone and boundary semantics. |
| AC-072 | Composition order is deterministic; conflicts evaluate empty with a diagnostic; incompatible fields, operators, units, time semantics or unmapped targets reject atomically. Comparison filters apply symmetrically to both sides or reject the change. |
| AC-073 | Cross-filtering uses compatible field identity, disables unsupported targets with a reason and does not mutate persisted filters or loop. |
| AC-080 | Comparison aligns one row per declared composite key after explicit grouping/aggregation; duplicate output keys, null composite keys, null/non-finite measures and missing pairs are handled and counted as specified. Mapping, time windows and units are validated; incompatible slices are rejected. |
| AC-081 | Overlay and side-by-side render; absolute delta is P-R and percentage delta is 100*(P-R)/abs(R) for finite nonzero R. Zero denominators, missing pairs and null/non-finite operands are unavailable with explicit reasons, never zero/Infinity/NaN; negative-reference, duplicate-key, null-key and zero fixtures pass. |
| AC-090 | The generic live contract streams query-shaped rows for a complete canonical query key with mandatory dataset, generation, epoch and sequence/cursor fields. The WebSocket adapter passes a real local-server integration test. |
| AC-091 | Query and realtime generations are consistent: input changes cancel/invalidate and replace subscriptions; older snapshots cannot replace newer stream data; ordering, duplicates, gaps, reconnect, resync, bounded buffers, pause/resume, backpressure, status and unsubscribe are verified under adversarial races. |
| AC-092 | The Pages demo labels simulated realtime and synthetic data; transport validation is not claimed from the simulation. |
| AC-100 | Plain JavaScript and TypeScript consumers install and run the built package without a UI framework. |
| AC-101 | React, Angular and Svelte adapters and runnable examples use the built package and clean up on unmount. |
| AC-102 | The shared host contract has mount/update/unmount semantics; views own DOM/listeners/local state while spaces own shared resources; adapters dispose only owned spaces; repeated cycles leak no listeners, subscriptions or timers; core imports without DOM. |
| AC-110 | Block, renderer, query adapter, realtime adapter, formatter, message-dictionary and theme extension points register, validate, isolate errors and dispose. |
| AC-111 | CSS variables/tokens are documented and styles are scoped so multiple instances and the host page do not collide. |
| AC-120 | Light, dark and system themes, typography, spacing, states and editor/viewer compositions match the approved design system. |
| AC-121 | Keyboard, focus, labels, reduced motion, contrast, text alternatives, 320 px and 200 percent zoom meet WCAG 2.2 AA checks with zero critical/serious automated findings and a manual audit. |
| AC-122 | Reference mocks and visual acceptance criteria exist and are approved before the production UI stage. |
| AC-130 | English README and docs contain the required sections, five verified quickstarts, API docs, recipes, limitations, localization guidance and migration guide, with real selected public screenshots distinct from local review evidence. |
| AC-131 | The DEMO branch builds and deploys to Pages using the package API, correct base path, all required flows, synthetic data, labeled transport and no backend or secrets. |
| AC-132 | Exports, declarations, CSS, browser ESM and tarball consumers are verified; UMD/CJS status is explicitly documented. |
| AC-133 | CI runs all required checks with reproducible installs, pinned actions, minimal permissions, concurrency, acceptance-owner uniqueness, reviewed public stage/staged-tree gates, ordinary failure diagnostics and redacted secret scanning; it uploads no local review evidence or videos. |
| AC-134 | Releases are 0.x SemVer after acceptance; no npm publication occurs without explicit authorization. |
| AC-135 | The migration guide maps the current project to Boardloom and is validated as documentation, without moving real data or secrets. |
| AC-136 | MIT license and ownership decisions are recorded; no unverified registry-availability or legacy-asset reuse claim is made. |
| AC-140 | v0.1 performance targets are measured on the declared fixture and environment and meet the table in section 15. |
| AC-141 | Staged scale targets are measured before their release claim; no mandatory feature is deferred to meet them. |
| AC-142 | Long-running create/switch/dispose stress tests show no cross-space leaks or unbounded growth. |
| AC-143 | Locale, timezone and unit formatting are deterministic across supported environments. |
| AC-144 | Import limits, text escaping, no-eval policy, no default endpoints and redacted error/log behavior are tested. |
| AC-145 | Package boundaries and supply-chain policy are enforced in CI and in the packed artifacts. |
| AC-146 | The supported browser matrix passes E2E on the declared versions. |
| AC-147 | Docs and demo builds are reproducible from a clean checkout with the committed lockfile. |
| AC-150 | Every built-in locale has complete message-key parity for UI, ARIA, status, error and diagnostic copy, with stable documented keys. |
| AC-151 | Missing keys, fallback, interpolation and pluralization are deterministic and safe in unit and browser tests. |
| AC-152 | Locale and timezone changes preserve board, draft, undo, filter, comparison and realtime state; formatting and date buckets remain correct. |
| AC-153 | Arabic RTL is scoped to the Boardloom host, and viewer, editor, charts, filters, comparison and realtime status remain usable. |
| AC-154 | Host overrides and custom dictionaries merge with documented precedence; host dataset labels and values are not silently translated; persisted documents stay locale-neutral. |
| AC-155 | Real browser flows cover English, Russian, a CJK locale and Arabic RTL across viewer, editor, charts, filters, comparison and realtime; no native-speaker certification is claimed. |
| AC-156 | Challenge journal, review reports and videos remain local under `.evidence/`; none are committed, released or uploaded by CI. Public docs screenshots are separately approved, and CI uploads only ordinary build/test diagnostics. |
| AC-157 | T00 uses the explicit unborn-base exception, stages exactly the eight public files, records the working public-document SHA-256 fingerprint and staged tree locally, and invalidates PASS after any restaging until both reviewers re-confirm. Git object IDs are reported separately from raw-file SHA-256 values. |

## 20. Traceability matrix

The task list in each row identifies contributors to the requirement, not final acceptance owners. Final ownership is normative in `TASKS.md` section 2.1: every AC has exactly one final owner, and T23 revalidates all criteria without becoming a second feature owner.

| Requirement | Tasks | Acceptance |
| --- | --- | --- |
| FR-001 viewer/editor | T02, T06, T12 | AC-001 |
| FR-002 mode switch state | T02, T06, T12 | AC-002 |
| FR-010 isolated spaces | T02, T06, T11 | AC-010, AC-142 |
| FR-011 new board new space and cleanup | T02, T12 | AC-011, AC-012 |
| FR-012 multi-space switching | T02, T11, T12 | AC-010, AC-102 |
| FR-020 versioned document | T03 | AC-020 |
| FR-021 import/export validation | T03, T12 | AC-021 |
| FR-022 migration strategy | T03, T21 | AC-022 |
| FR-030 data contract | T04 | AC-030 |
| FR-031 local/async adapters | T04, T06 | AC-031 |
| FR-032 cancel/stale/states | T04, T06 | AC-032 |
| FR-033 no server in packages | T01, T19 | AC-033 |
| FR-040 block types and registry | T06, T07, T13 | AC-040 |
| FR-041 layout and block operations | T06, T12 | AC-041 |
| FR-042 draft/apply/cancel undo/redo | T02, T12 | AC-042 |
| FR-050 built-in renderers and custom renderer | T07, T13 | AC-050 |
| FR-051 field compatibility | T07, T08 | AC-051 |
| FR-052 data semantics | T07 | AC-052, AC-053 |
| FR-060 bindings and aggregation | T08 | AC-060 |
| FR-061 axis lock and schema | T08 | AC-061 |
| FR-070 filter scopes | T09 | AC-070 |
| FR-071 typed operators | T09 | AC-071 |
| FR-072 composition and incompatible fields | T09 | AC-072 |
| FR-073 cross-filtering | T09 | AC-073 |
| FR-080 comparison model | T10 | AC-080 |
| FR-081 comparison display and diagnostics | T10 | AC-081 |
| FR-090 realtime contract and WebSocket adapter | T04, T11 | AC-090 |
| FR-091 realtime correctness | T04, T11 | AC-091 |
| FR-092 honest demo and real integration test | T11, T20 | AC-092 |
| FR-100 framework-neutral runtime | T02, T06, T14-T19 | AC-100 |
| FR-101 React/Angular/Svelte adapters | T14, T15, T16 | AC-101 |
| FR-102 common host contract and cleanup | T06, T14-T16 | AC-102 |
| FR-110 extension points | T13 | AC-110 |
| FR-111 tokens and style scope | T05, T13, T18 | AC-111 |
| FR-120 design system | T05, T06, T07, T12, T17, T18 | AC-120 |
| FR-121 accessibility | T05, T07, T12, T18 | AC-121 |
| FR-122 reference mocks | T05 | AC-122 |
| FR-130 documentation | T21 | AC-130 |
| FR-131 DEMO branch | T20 | AC-131 |
| FR-132 packaging and exports | T19 | AC-132 |
| FR-133 CI | T22 | AC-133 |
| FR-134 release and SemVer | T19, T22, T23 | AC-134 |
| FR-135 migration guide | T21 | AC-135 |
| FR-136 license and ownership | T00, T01, T19, T23 | AC-136 |
| FR-140 built-in UI locales and complete messages | T02, T05, T06, T13, T14, T15, T16, T17, T20, T21, T22 | AC-150 |
| FR-141 overrides, interpolation, locale switching | T02, T06, T13, T14, T15, T16, T17, T20, T21 | AC-151, AC-152, AC-154 |
| FR-142 Intl formatting and explicit timezone | T02, T06, T17, T20, T21 | AC-152 |
| FR-143 Arabic RTL scoped to host | T06, T17, T18, T20 | AC-153, AC-155 |
| FR-144 locale-neutral document and host data | T02, T03, T06, T13, T17 | AC-154 |
| NFR-001 performance | T07, T23 | AC-140, AC-141 |
| NFR-002 accessibility | T05, T17, T18 | AC-121, AC-153 |
| NFR-003 privacy/security | T01, T19, T22 | AC-144, AC-145 |
| NFR-004 package boundaries | T01, T19, T22 | AC-033, AC-145 |
| NFR-005 reproducibility | T00, T01, T22, T23 | AC-133, AC-147, AC-157 |
| NFR-006 browser support | T22, T23 | AC-146 |
| NFR-007 determinism | T03, T07, T09, T10, T11, T17 | AC-022, AC-052, AC-072, AC-081, AC-143, AC-152 |
| NFR-008 diagnostics | T02, T03, T04, T11, T17 | AC-021, AC-032, AC-091, AC-151 |
| NFR-009 documentation quality | T21, T23 | AC-130, AC-147 |
| NFR-010 test quality | T01, T22 | AC-133, AC-147 |
| NFR-011 timezone/locale | T03, T04, T09, T10, T17, T21 | AC-143, AC-152 |
| NFR-012 scale | T23 | AC-140, AC-141 |
| NFR-013 localization quality | T02, T06, T13, T14, T15, T16, T17, T20, T21, T22, T23 | AC-150, AC-151, AC-152, AC-153, AC-155 |
| NFR-014 local evidence policy | T00, all review gates, T22, T23 | AC-156 |

## 21. Confirmed decisions and remaining choices

### 21.1 Owner confirmations

These are binding and are not open questions:

1. Project path: `/home/arcon/dev/export/chartConstructor`.
2. GitHub owner `arconw`; repository `boardloom`; public visibility. Local Git `main` and the remote are initialized by the owner/root.
3. Product brand `Boardloom`, repository slug `boardloom`; titlecase brand and lowercase repository are intentional.
4. Client-only framework plus application adapters; no framework-owned server.
5. License: MIT. The `LICENSE` file uses `Copyright (c) 2026 Boardloom contributors`; the owner may replace the holder string.
6. All project documentation, READMEs, decision logs and prose are English. Owner chat may remain Russian. Locale dictionaries naturally contain their respective languages.
7. Localization is mandatory, including the built-in locales listed in section 14.4. First-release locale selection is an architect decision under this owner requirement.
8. GitHub Pages is authorized. npm publication is not authorized without a publisher context and registry namespace; planned scoped names are allowed for tarball consumers without a registry-availability claim.
9. Existing local files, the legacy application, its database and user history are preserved. Real records, credentials and private context are excluded.
10. Challenges, review reports and videos are local `.evidence/` only. They MUST NOT be committed, pushed, attached to GitHub Releases, uploaded by CI or sent to an external service. Public README/docs screenshots are separate approved assets. CI may upload only ordinary build/test diagnostics such as logs, coverage and traces, not selected review/test screenshots, review reports or videos.
11. The owner-provided project is authorized source for this requested development. Preserve concrete third-party notices and constraints; do not require repeat owner permission for hypothetical provenance worries. Do not copy legacy screenshots as new product evidence.
12. The public initial commit contains only the accepted planning package, `LICENSE` and a safe `.gitignore`; no unreviewed legacy source or real data. T01 preserves existing local code, establishes the framework workspace and documents a reversible migration plan.
13. The owner authorized autonomous decisions for remaining optional questions; no stop for optional clarification.

### 21.2 Architect decisions and defaults

These are recorded with rationale in `.questions/README.md` and may be superseded only by a new recorded decision:

1. Built-in locales: `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar`, `hi`.
2. UI/runtime technique: framework-neutral DOM runtime on native browser DOM, ECharts renderers and thin framework adapters; no UI framework in core. Confirmed by T06/T07 spikes.
3. Package layout: root npm workspace with `packages/*`, `examples/*`, `apps/demo`; legacy application isolated. T01 may adjust mechanics while preserving legacy compatibility.
4. CI/tooling baseline: Node 24.x and npm 11.x as observed; browser ESM packages; legacy application keeps Node `>=22`; exact pins in T01 after official documentation.
5. Defaults: UI locale `en`, display timezone `UTC`, both host-overridable; persisted document locale-neutral; timezone independent from language.
6. Realtime protocol default: JSON snapshot/update messages with dataset version, per-subscription sequence, row keys, resync by snapshot and consumer-provided WebSocket URL. T11 finalizes and tests it.
7. Browser matrix default: current stable Chrome, Edge, Firefox and Safari; previous major where CI capacity allows; final evidence in T23.
8. Plugin trust: trusted host JavaScript in v0.1; no sandbox claim.
9. Chart engine: ECharts behind the renderer contract; exact version fixed in T07.
10. Translation quality: functional coverage and key parity are required; professional/native-speaker certification is not claimed.
11. MIT holder string: `Boardloom contributors` until the owner supplies a different legal holder.
12. Local evidence layout: `.evidence/challenges/CHALLENGES.md`, `.evidence/reviews/<task-id>/`, `.evidence/videos/<task-id>/` and `.evidence/README.md`; all ignored by Git and never uploaded.
13. Public docs screenshots are selected, approved documentation assets under `docs/`; raw review/test evidence is never copied into public docs without explicit architect approval.
14. `LICENSE` and licensing statements are part of the T00 public document review scope.
15. Generic live results are query-shaped for a complete canonical query key with mandatory dataset, generation, epoch and sequence/cursor identity. Raw row patches are never merged into aggregated results. This supersedes the earlier Q019 draft without erasing it.
16. Mode is per view. v0.1 allows one editor lease per space; viewer-bound commands reject edits; dirty-draft release and revision conflicts require explicit decisions; views own local resources and externally supplied spaces are host-owned.
17. Import creates a new space and never replaces an existing committed document or draft. There is no replace-in-place import in v0.1.
18. Every AC has exactly one final owner in `TASKS.md` section 2.1. T23 revalidates all and finally owns only AC-140, AC-141 and AC-146. T00 owns only AC-136 and AC-157.
19. T00 uses the UNBORN base, staged tree and eight-file public SHA-256 fingerprint exception in `WORKFLOW.md`. The fingerprint is local only; any restaging invalidates PASS until both reviewers re-confirm.
20. Status is written to the intended pre-commit state before final review, frozen through the commit, and changed later only through a reviewed task.

### 21.3 Task-level decisions

These are implementation details expected to be finalized in the named task, not blockers for T00 or T01:

1. Exact lint, build, test and package-manager pins: T01, after official primary documentation.
2. Exact ECharts version, tree-shaken bundle and renderer split: T07.
3. Workspace migration mechanics that preserve legacy commands: T01.
4. WebSocket adapter details and message validation: T11.
5. Locale asset provenance and any non-Latin dictionary source: T17. Dictionaries must be real localization assets; English placeholders are not parity. If an implementation agent policy prevents authoring a script, an approved localization asset must supply it.
6. Final browser matrix: T23.
7. Degree of legacy application migration: T21 documentation and examples only for v0.1.
8. Local evidence retention after acceptance: architect decision; no external upload or public repository inclusion.
9. Concrete third-party notices or constraints discovered in the authorized source: preserve and document them in T01/T21.

There is no remaining license, brand or repository-ownership blocker. npm publication remains withheld until a publisher context is provided. There is no unresolved optional question that stops T01.

## 22. Change log

- T00: initial specification from `ARCHITECT_BRIEF.md`. No implementation, tests or acceptance claims.
- T00 revision: applied binding owner updates: English project documentation, MIT license and `LICENSE`, confirmed Boardloom naming, localization and RTL requirements, built-in locale set, new localization acceptance IDs, new T17 localization task, renumbered later tasks, local `.evidence/` storage for challenges/reviews/videos, and public-versus-local evidence rules. No implementation or test claim.
- T00 review round 1: resolved comparison alignment/arithmetic, dataset-qualified filters and atomic mismatch behavior, canonical query/realtime generations, view-local mode authority and editor lease, localization dependency order, unique AC ownership, non-destructive import, explicit field-type matrix, T00 UNBORN fingerprint and stage manifest, and evidence path corrections. No implementation or test claim.
