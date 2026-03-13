# G3-B Differential Fixture Mapping

Purpose: map newly added G3-B semantic regressions into sqlite differential categories.

## Category
- `g3b-fixture`

## Mapped cases
1. correlated exists by outer id
   - walrus: `SELECT id FROM users WHERE EXISTS (SELECT id FROM orders WHERE orders.user_id = outer.id AND amount >= 20) ORDER BY id`
   - sqlite: `SELECT u.id AS id FROM users u WHERE EXISTS (SELECT o.id FROM orders o WHERE o.user_id = u.id AND o.amount >= 20) ORDER BY u.id`

2. expr composed cast nullif
   - walrus/sqlite: `SELECT id FROM orders WHERE CAST(amount AS INT) >= 20 AND NULLIF(status, 'draft') IS NOT NULL ORDER BY id`

3. not in subquery paid users
   - walrus/sqlite: `SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders WHERE status = 'paid') ORDER BY id`

## Run commands
- Category only:
  - `tsx examples/sql-compare-matrix.ts reports/sql-compare-g3b-fixture.json reports/mre pr g3b-fixture`
- Full PR matrix:
  - `npm run sql:compare:matrix`

## Notes
- This mapping is the bridge between semantic regression examples and matrix differential visibility.
- Keep this file updated when adding/removing G3-B regression scenarios.
