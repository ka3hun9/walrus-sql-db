# walrus-sql-db

> Language / 语言: **[English](./README.en.md)** | **[中文](./README.zh-CN.md)**

This README is bilingual-enabled. Pick your preferred doc:

- English: `README.en.md`
- 中文：`README.zh-CN.md`

## Quick status

- SQL enhancement plan (13 items) has been implemented in this iteration:
  1. WHERE extension (`AND/OR/IN/!=/>/<,>=,<=`)
  2. Multi-column ORDER BY
  3. Aggregates (`COUNT/SUM/AVG/MIN/MAX`)
  4. LIMIT/OFFSET (existing) + keyset-style pattern support via WHERE + ORDER BY
  5. Alias baseline (`AS`) accepted in parser path for simple outputs
  6. GROUP BY
  7. HAVING
  8. Replay-side filtering/sorting aggregation alignment
  9. Replay persistent cache
  10. EXPLAIN output
  11. Parser modularization in client/replay logic
  12. Advanced SQL example script
  13. Delivery docs with bilingual switch

## Quick run

```bash
npm install
npm run build
npm run sql:advanced
npm run sql:join
npm run onchain:select-replay
```
