# Sprint G — Hybrid Execution Plan (Full Grammar Skeleton First)

Status: Drafted and aligned with latest decision (2026-03-13)

## Goal
Build toward **Full SQL parser/AST + edge semantic coverage** with minimal total rework by:
1) freezing the meta-model first,
2) laying out a full grammar skeleton,
3) then incrementally enabling semantics/execution,
4) and integrating dialect plugins last.

---

## G0 (P0) Freeze Meta-Model Contracts

### Deliverables
- Stable AST taxonomy:
  - Query / Relation / Expr / Predicate / Window / SetOp / CTE
- Stable semantic interfaces:
  - name resolution
  - type inference & coercion
  - unified 3VL/NULL evaluator contract
- Stable SQL error-code families:
  - syntax
  - semantic
  - unsupported dialect feature

### Exit Criteria
- AST and semantic interface changes require explicit RFC-style change note.
- Error code map documented and referenced by parser/semantic layers.

---

## G1 (P1) Full Grammar Skeleton (One-pass Structure)

### Deliverables
- Complete grammar framework for ANSI query surface (and reserved extension points for dialects).
- Parser recognizes full rule structure.
- Features not yet executable are represented in AST as explicit `unsupported`/`unimplemented` nodes with deterministic errors.
- parse -> AST -> print round-trip baseline for covered forms.

### Exit Criteria
- No regex-splice fallback for newly introduced grammar surface.
- Unsupported features fail explicitly (no silent compatibility).

---

## G2 (P2) Freeze Grammar Baseline v1 (Phase Freeze)

### Deliverables
- `docs/sql-spec-baseline-v1.md`:
  - in-scope grammar
  - out-of-scope grammar
  - expected errors / codes
- Change policy for v1 core grammar contracts.

### Exit Criteria
- v1 baseline approved; subsequent changes must be additive via defined extension points.

---

## G3 (P3) Incremental Semantic/Execution Enablement

### Batch A
- Scope/alias/outer-ref resolution hardening
- 3VL consistency for core predicates

### Batch B
- complex expressions + subquery edge semantics

### Batch C
- window/set-op semantic parity improvements

### Exit Criteria
- Each batch lands with conformance tests + no regression against prior batch.

---

## G4 (P4) Verification System (Parallel Track)

### Deliverables
- Conformance suite (ANSI-first)
- Differential testing:
  - SQLite first
  - PostgreSQL/MySQL next
- SQL fuzz + reducer:
  - auto-minimized repro on mismatch/crash

### Exit Criteria
- CI reports deterministic category summaries.
- Repro artifacts generated automatically for failures.

---

## G5 (P5) Dialect Plugins (Last)

Target order (configurable): PostgreSQL / MySQL / SQLite / SQL Server

### Deliverables
- Dialect plugin modules for keywords/functions/types/operators/quoting/limit-top-fetch behavior.
- Non-target dialect syntax produces explicit error (no silent fallback).

### Exit Criteria
- Dialect gating tests green by profile.
- Cross-dialect leak tests green (syntax from A rejected in B when unsupported).

---

## Definition of Done (Program-level)

- Parser/AST coverage reaches agreed threshold.
- Semantic consistency rate reaches agreed threshold in differential suite.
- Full regression green.
- Dialect grouped suite green.
- Long-run fuzz stable with no crash and tracked mismatch budget.

---

## Immediate Next Actions

1. Create `docs/sql-spec-baseline-v1.md` skeleton.
2. Add AST contract section to existing SQL docs.
3. Add `unsupported` node/error-code test cases.
4. Create Sprint G tracker issues (G0/G1/G2/G3/G4/G5).
