# SQL AST Completion Tracker

## Current status

- [x] P0.1 WHERE/HAVING unified through AST-evaluation bridge
- [x] P0.2 Guard complex subquery predicates as AST raw nodes (no lossy tokenization)
- [x] P1.1 Preserve parentheses in exprAstToSql for binary trees
- [x] P2.1 FROM subquery represented in AST and routed by AST in query()
- [x] P2.2 UNION / UNION ALL represented in AST and routed by AST in query()
- [x] P3.1 Introduce structured error codes for unsupported/parse/runtime categories
- [ ] P3.2 Restrict raw fallback to explicit unsupported errors outside allowlist (parser/evaluator wide)

## Notes

This file tracks migration from mixed parser/evaluator to AST-first execution.
