# ADR-0004: Realtime orchestration and adapter layering

- Status: Accepted
- Date: 2026-10-28
- Task: T01
- Supersedes: none
- Refines: Q029, FR-090, FR-091 and SPEC section 6

## Context

Realtime data must be testable without a network and must not force a transport or a backend into published packages. Query identity, stale responses and resync behavior affect correctness across primary and comparison sources. Raw row patches cannot be merged safely into aggregated results.

## Decision

The headless core owns transport-independent realtime orchestration. A transport adapter delivers messages to a space; it does not own query semantics, buffers or reconciliation. The default live contract streams query-shaped result rows for a complete canonical query key that covers dataset and slice identity, filters, projection, bindings, grouping, aggregation and comparison-side inputs.

Every snapshot or update carries dataset identity, query key, generation, epoch or provider version and a sequence or cursor. The provider issues dataset, epoch, sequence and cursor; the runtime issues request ID, serialized query key, generation and view subscription mapping. A change increments the generation, cancels old work and replaces subscriptions. The current generation store is authoritative; an older snapshot never overwrites newer stream data. A new or incomparable epoch triggers resync through a new snapshot. Primary and reference sources have separate generations.

Raw row patches are never merged into aggregated results. Resync uses a complete snapshot. Bounded buffers, duplicate and gap detection, pause and resume, backpressure, unsubscribe and dispose belong to the space lifecycle.

## Consequences

- Realtime logic is unit-testable with a fake transport.
- A WebSocket adapter can be replaced without changing query or view code.
- Providers must supply stable query-key, generation, epoch and sequence identity.
- The runtime must handle adversarial races rather than assuming ordered delivery.

## Cost of change

Changing the identity fields after adapters exist would break providers and stored subscriptions. Adding a transport means implementing the adapter contract and integration tests; it does not require core changes. Moving reconciliation into adapters is rejected because it would duplicate correctness logic and bypass the generation store.

## References

- `docs/framework/SPEC.md` section 6
- `docs/framework/TASKS.md` task T11
- `.questions/README.md` Q029 (local decision log)
