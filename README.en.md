# walrus-sql-db (English)

Back to hub: [README.md](./README.md) | 中文: [README.zh-CN.md](./README.zh-CN.md)

## Phase status

- Phase-3 ✅ on-chain CRUD
- Phase-4.0~4.6 ✅ query replay baseline
- Phase-5 ✅ persistent replay cache + benchmark
- Phase-6 ✅ payload v2 hash-chain verification
- Phase-7 ✅ advanced SQL capability + runnable example
- Phase-8 ✅ delivery docs + bilingual README switch

## SQL enhancements implemented

1. WHERE: `AND/OR/IN/!=/>/<,>=,<=`
2. ORDER BY: multi-column sorting
3. Aggregates: `COUNT/SUM/AVG/MIN/MAX`
4. Pagination: `LIMIT/OFFSET` + keyset-style (`WHERE id > ... ORDER BY id`)
5. Alias baseline (`AS`) in parser outputs
6. GROUP BY
7. HAVING
8. Replay executor alignment with advanced query fields
9. Persistent replay cache (`WALRUS_SQL_REPLAY_CACHE_FILE`)
10. EXPLAIN support (`EXPLAIN SELECT ...`)
11. Parser structure modularization
12. Advanced SQL demo script (`npm run sql:advanced`)
13. Bilingual docs switch

## Run

```bash
npm install
npm run build
npm run sql:advanced
npm run onchain:select-replay
npm run onchain:benchmark-replay
```
