# G3-C (Window / Set-Op) Notes

## Window semantics (ROW_NUMBER) first-cut

Implemented behavior:
- Supports `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...) AS <alias>`
- Partition-local ranking starts from 1
- Ranking is computed before final outer `ORDER BY`

Regression:
- `examples/sql-g3c-window-row-number.ts`

## Next in G3-C
- set-op parity pass (UNION/UNION ALL projection and ordering edge cases)
- additional window edge coverage (ties, null ordering behavior)
