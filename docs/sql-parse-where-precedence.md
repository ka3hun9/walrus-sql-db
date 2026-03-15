# WHERE Logic Precedence

## B-PARSE-004
- Logical precedence follows SQL baseline:
  - `NOT` > `AND` > `OR`
- Parentheses override default precedence and are parsed/evaluated as explicit grouping.
- Nested parentheses are supported in WHERE expressions.
