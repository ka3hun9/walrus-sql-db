# SELECT Parser Baseline

## B-PARSE-001
- SELECT list supports:
  - direct column fields (`id`)
  - aliased fields (`name AS n`)
  - expression items (`price * 2 AS double_price`)
  - CAST expressions (`CAST(price AS INT) AS p_int`)
- Parser and executor are verified together to ensure parsed expressions and aliases are projected correctly in query results.
