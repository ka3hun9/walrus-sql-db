# FROM Alias Parsing

## B-PARSE-002
- Base table references accept aliases in both forms:
  - `FROM users AS u`
  - `FROM users u`
- Parser records the alias on the table reference node and continues parsing trailing clauses normally.
- Alias-qualified identifiers (`u.id`) are accepted in projection and predicates for single-table SELECT.
