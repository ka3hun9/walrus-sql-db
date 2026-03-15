# ORDER BY Parsing

## B-PARSE-014
- Parser accepts ORDER BY variants:
  - multi-key sort (`ORDER BY a DESC, b ASC`)
  - alias references (`ORDER BY alias_name`)
  - expression terms (`ORDER BY score + tax DESC`)
- ORDER BY terms are preserved with explicit direction metadata (`ASC`/`DESC`).
