# SQL AST Completion Tracker

## Current status

- [x] P0.1 WHERE/HAVING unified through AST-evaluation bridge
- [x] P0.2 Guard complex subquery predicates as AST raw nodes (no lossy tokenization)
- [x] P1.1 Preserve parentheses in exprAstToSql for binary trees
- [ ] P2.1 FROM subquery represented in AST (not regex-only rewrite)
- [ ] P2.2 UNION / UNION ALL represented in AST
- [ ] P3.1 Restrict raw fallback to explicit unsupported errors outside allowlist
- [ ] P3.2 Standardized parse/semantic/runtime error codes

## Notes

This file tracks migration from mixed parser/evaluator to AST-first execution.
