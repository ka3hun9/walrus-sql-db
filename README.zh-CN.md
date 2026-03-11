# walrus-sql-db（中文）

返回总览：[README.md](./README.md) | English: [README.en.md](./README.en.md)

## 阶段状态

- Phase-3 ✅ 链上 CRUD
- Phase-4.0~4.6 ✅ 查询回放基础能力
- Phase-5 ✅ 持久化缓存 + 性能基准
- Phase-6 ✅ payload v2 哈希链校验
- Phase-7 ✅ SQL 能力增强 + 可运行示例
- Phase-8 ✅ 交付文档 + 中英文切换

## 已实现的 SQL 增强（13项）

1. WHERE 扩展：`AND/OR/IN/!=/>/<,>=,<=`
2. ORDER BY 多字段排序
3. 聚合：`COUNT/SUM/AVG/MIN/MAX`
4. 分页：`LIMIT/OFFSET` + keyset 风格（`WHERE id > ... ORDER BY id`）
5. 别名基础支持（`AS`）
6. GROUP BY
7. HAVING
8. Replay 执行器与高级查询字段对齐
9. Replay 缓存持久化（`WALRUS_SQL_REPLAY_CACHE_FILE`）
10. EXPLAIN（`EXPLAIN SELECT ...`）
11. Parser 结构化改造
12. 高级 SQL 示例脚本（`npm run sql:advanced`）
13. README 中英文切换

## 运行方式

```bash
npm install
npm run build
npm run sql:advanced
npm run onchain:select-replay
npm run onchain:benchmark-replay
```
