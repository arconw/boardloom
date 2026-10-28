# Boardloom architecture decision records

Status: T01 foundation decisions. These records confirm or refine decisions from the accepted T00 package. A later task may supersede a record only by adding a new record and updating this index.

| ADR                                             | Decision                                                          | Task |
| ----------------------------------------------- | ----------------------------------------------------------------- | ---- |
| [ADR-0001](ADR-0001-workspace-layout.md)        | Root npm workspace layout with isolated legacy application        | T01  |
| [ADR-0002](ADR-0002-native-dom-runtime.md)      | Native-DOM runtime with ECharts renderers and thin adapters       | T01  |
| [ADR-0003](ADR-0003-esm-packaging.md)           | Browser ESM package surface with declarations and CSS entry       | T01  |
| [ADR-0004](ADR-0004-realtime-layering.md)       | Transport-independent realtime orchestration and adapter layering | T01  |
| [ADR-0005](ADR-0005-package-boundaries.md)      | Package boundaries and supply-chain enforcement                   | T01  |
| [ADR-0006](ADR-0006-toolchain.md)               | Pinned toolchain, single lockfile and reproducible installs       | T01  |
| [ADR-0007](ADR-0007-quality-gates.md)           | Quality command contract, stage manifest and staged-tree gate     | T01  |
| [ADR-0008](ADR-0008-echarts-renderer-engine.md) | Pinned ECharts engine and renderer split                          | T07  |

Toolchain sources and verified behavior are recorded in [toolchain-evidence.md](toolchain-evidence.md). Project ownership, license and publication boundaries are recorded in [GOVERNANCE.md](../GOVERNANCE.md). The reversible workspace migration route is recorded in [MIGRATION_PLAN.md](../MIGRATION_PLAN.md).
