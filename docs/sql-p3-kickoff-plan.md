# P3 Phase Kickoff Plan

## 背景
Phase 2（事务与一致性）已完成并补齐 MILE-007/008 证据链。
当前进入 Phase 3：性能优化与复杂查询。

## 本阶段目标（对齐 roadmap-100-checklist）
1. 索引系统（CREATE INDEX，索引对象分离存储，索引维护与恢复）
2. 查询优化器（CBO + 统计信息 + join reorder + 多算法执行）
3. 子查询与集合操作完善（标量/相关/EXISTS/IN + UNION/INTERSECT/EXCEPT 及 ALL）
4. 视图系统（CREATE VIEW + 视图展开 + SELECT，更新视图暂缓）
5. 大数据场景下可验证性能收益（基准和稳定性）

## 执行顺序建议
- Step 1（先打地基）: P3-A 索引系统 + P3-F 对应单测
- Step 2: P3-B CBO（先统计，再代价，再计划选择）
- Step 3: P3-C 子查询/集合操作补齐
- Step 4: P3-D 视图系统
- Step 5: P3-E 联动优化 + P3-G 基准里程碑

## 验收约束
- 每完成一个条目，必须同时补齐：实现 + 测试 + 文档 + 可运行示例。
- 所有性能结论必须有可复现实验脚本和报告文件。

## 首个落地任务（下一步）
- P3-IDX-001：支持 CREATE INDEX / DROP INDEX / 命名索引语法
- 同步新增：
  - parser 单测
  - executor/catal​​og 基础单测
  - 文档 `docs/sql-parse-create-index.md`（或同类命名）
