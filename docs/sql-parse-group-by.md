# GROUP BY Parsing

## B-PARSE-011
- Parser accepts GROUP BY forms:
  - single key (`GROUP BY region`)
  - multi-key (`GROUP BY region, product`)
  - expression keys (`GROUP BY amount + tax`)
- GROUP BY keys are stored in AST in source order for downstream planning.
