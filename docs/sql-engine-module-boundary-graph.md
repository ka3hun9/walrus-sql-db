# SQL Engine Module Boundaries

## I-ENG-003

## Module Boundaries
- `src/types`:
  - runtime SQL type model and shared core data contracts.
- `src/error`:
  - unified error enums and constructors for parser/semantic/execution/client layers.
- `src/catalog`:
  - schema metadata helpers and constraint/index cost statistics helpers.
- `src/parser`:
  - SQL grammar surface and AST parsing/export entrypoint.
- `src/executor`:
  - query normalization/semantic evaluation and `WalrusSqlClient` execution API entrypoint.
- `src/storage`:
  - onchain Move-call planning and replay query executor helpers.
- Root entrypoint:
  - `src/index.ts` re-exports all stable module entrypoints above.

## Dependency Graph
```mermaid
flowchart LR
  T[src/types]
  E[src/error]
  C[src/catalog]
  P[src/parser]
  X[src/executor]
  S[src/storage]
  I[src/index]
  G[src/config + src/logger]

  T --> P
  T --> X
  T --> S
  E --> P
  E --> X
  C --> X
  P --> X
  G --> X
  X --> S
  T --> I
  E --> I
  C --> I
  P --> I
  X --> I
  S --> I
```
