# SQL Baseline v1 (Grammar + Contracts)

Status: Phase-freeze baseline (G0/G2 foundation)
Version: `baseline-v1`
Freeze State: `FROZEN` (see `docs/sql-baseline-v1-freeze.md`)

## 1) Scope policy
- This baseline freezes **contracts**, not future capability.
- New syntax can be added only through explicit extension points.
- Unsupported syntax/features must fail with explicit SQL error code families.

## 2) AST contract (stable categories)

Top-level statement categories:
- `select`
- `union`
- `unknown` (temporary compatibility path; planned to shrink over time)

Core model categories (contract-level taxonomy):
- Query
- Relation
- Expr
- Predicate
- Window
- SetOp
- CTE

Current implementation status:
- Query/Relation/Expr/SetOp: partial production use
- Predicate: represented through expression tree ops
- Window/CTE: partial / staged

## 3) Semantic contracts (stable interfaces)

Frozen interface families:
- Name resolution
  - scope resolution
  - alias resolution
  - outer reference handling
- Type inference
  - expression type inference
  - coercion policy hooks
- 3VL evaluator
  - TRUE / FALSE / UNKNOWN
  - unified predicate evaluation entry

Reference TypeScript contracts:
- `src/sql-semantics.ts`

## 4) Error-code contract (stable families)

Families:
- `SQL_SYNTAX_*`
- `SQL_SEMANTIC_*`
- `SQL_DIALECT_*`

Reference implementation:
- `src/sql-errors.ts`

Initial code set:
- Syntax:
  - `SQL_SYNTAX_UNEXPECTED_TOKEN`
  - `SQL_SYNTAX_UNTERMINATED_LITERAL`
  - `SQL_SYNTAX_INCOMPLETE_STATEMENT`
  - `SQL_SYNTAX_INVALID_CLAUSE_ORDER`
- Semantic:
  - `SQL_SEMANTIC_UNKNOWN_IDENTIFIER`
  - `SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER`
  - `SQL_SEMANTIC_TYPE_MISMATCH`
  - `SQL_SEMANTIC_INVALID_GROUPING`
- Dialect:
  - `SQL_DIALECT_UNSUPPORTED_SYNTAX`
  - `SQL_DIALECT_UNSUPPORTED_FUNCTION`
  - `SQL_DIALECT_UNSUPPORTED_OPERATOR`

## 5) Grammar v1 boundary (phase-freeze)

In-scope (current baseline path):
- SELECT ... FROM ...
- WHERE / GROUP BY / HAVING
- ORDER BY / LIMIT / OFFSET
- basic JOIN (INNER/LEFT/RIGHT first-cut)
- UNION / UNION ALL (first-cut)
- expression core (arithmetic, CASE, COALESCE, NULLIF, CAST)
- core predicate forms (IN/BETWEEN/LIKE/IS NULL/distinctness variants)

Out-of-scope or partial (must error explicitly or stay staged):
- full SQL-complete grammar
- full dialect-specific syntax by default
- transaction semantics
- optimizer/full planner semantics

## 6) Parser observability (G1)

Parser now exposes two entry points:
- `parseSqlToAst(sql)`
- `parseSqlToAstWithMeta(sql)` -> `{ ast, grammar }`

`grammar` comes from `inspectSqlGrammarSkeleton` and provides:
- statement kind
- clause presence map
- explicit unsupported feature list

This is the baseline observability layer for G2 freeze and later conformance diagnostics.

## 7) Baseline freeze checks (G2)

Run:
- `npx tsx examples/sql-parser-g1-gate.ts`
- `npx tsx examples/sql-baseline-v1-matrix.ts`

Reference freeze declaration:
- `docs/sql-baseline-v1-freeze.md`

## 8) G3-A semantic convergence notes

Current convergence policy:
- AST predicate path uses strict identifier semantics (`SQL_SEMANTIC_UNKNOWN_IDENTIFIER` / `SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER`).
- Raw-expression fallback path is retained for staged features but remains explicit and bounded by allowlist.

Regression examples:
- `examples/sql-semantics-g3a.ts`
- `examples/sql-client-g3a-strict-where.ts`
- `examples/sql-client-g3a-ast-tree-consistency.ts`

## 9) Change-control rules

Any baseline-breaking change requires:
1. contract note (what changed and why)
2. tests updated for parser/semantic boundary
3. explicit compatibility note in docs
