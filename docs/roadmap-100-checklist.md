# roadmap-100-checklist — Phase 3: 性能优化与复杂查询（Full Scope）

> 原则：不做最小可上线，按全量能力实施与验收。
> 判定：仅当“实现 + 测试 + 文档 + 基准”全部通过，条目才可勾选。

---

## P3-A. 索引系统（CREATE INDEX + 索引对象分离存储）

- [x] P3-IDX-001 语法支持：`CREATE INDEX` / `DROP INDEX` / 命名索引
- [x] P3-IDX-002 索引元数据 catalog（索引名、表、列、类型、唯一性、状态）
- [x] P3-IDX-003 索引结构：哈希索引（等值查询路径）
- [x] P3-IDX-004 索引结构：B+ 树索引（范围/排序查询路径）
- [x] P3-IDX-005 索引与表数据分离持久化（独立对象存储，支持版本链）
- [x] P3-IDX-006 DML 同步维护索引（INSERT/UPDATE/DELETE 增量更新）
- [x] P3-IDX-007 索引回放与恢复（WAL/版本链恢复后索引一致） [validated: 2026-03-19]
- [x] P3-IDX-008 索引可观测性（命中率、维护成本、失效率） [validated: 2026-03-19]

## P3-B. 查询优化器（CBO）

- [x] P3-OPT-001 逻辑计划与物理计划分层（规则重写 + 代价评估）
- [x] P3-OPT-002 统计信息收集框架（行数、NDV、NULL 比例、直方图） [validated: 2026-03-20]
- [x] P3-OPT-003 统计信息持久化与版本管理（可回放、可比对） [validated: 2026-03-20]
- [x] P3-OPT-004 选择率估算模型（谓词/组合谓词） [validated: 2026-03-20]
- [x] P3-OPT-005 索引选择策略（全表扫 vs 索引扫 vs 索引回表） [validated: 2026-03-20]
- [x] P3-OPT-006 连接顺序搜索（基于代价的 join reorder） [validated: 2026-03-20]
- [x] P3-OPT-007 连接算法实现：Nested Loop / Hash Join / Sort-Merge Join [validated: 2026-03-20]
- [x] P3-OPT-008 计划稳定性与回退策略（bad plan fallback） [validated: 2026-03-19]

## P3-C. 子查询与集合操作

- [x] P3-SUB-001 标量子查询执行与错误语义（单行约束） [validated: 2026-03-19]
- [x] P3-SUB-002 相关子查询执行（outer 引用绑定与代价控制） [validated: 2026-03-19]
- [x] P3-SUB-003 `EXISTS` / `NOT EXISTS` 语义与短路优化 [validated: 2026-03-20]
- [x] P3-SUB-004 `IN` / `NOT IN` 子查询语义（含 NULL 三值逻辑） [validated: 2026-03-20]
- [x] P3-SET-001 `UNION` / `UNION ALL` [validated: 2026-03-20]
- [x] P3-SET-002 `INTERSECT` / `INTERSECT ALL` [validated: 2026-03-20]
- [x] P3-SET-003 `EXCEPT` / `EXCEPT ALL` [validated: 2026-03-20]
- [x] P3-SET-004 集合操作与排序/分页/投影兼容性 [validated: 2026-03-20]

## P3-D. 视图系统（只读视图）

- [x] P3-VIEW-001 `CREATE VIEW` / `DROP VIEW` 语法与 catalog 元数据
- [x] P3-VIEW-002 视图展开（query rewrite）与列映射一致性 [validated: 2026-03-20]
- [x] P3-VIEW-003 对视图执行 `SELECT`（含过滤、排序、聚合、连接）
- [x] P3-VIEW-004 视图依赖分析与失效检测（底表/列变更）
- [x] P3-VIEW-005 视图权限/命名冲突基础策略（最小可控）
- [x] P3-VIEW-006 明确“可更新视图暂缓”边界与错误码

## P3-E. 执行引擎与存储联动（大数据场景）

- [x] P3-EXE-001 索引扫描执行器（等值、范围、前缀） [validated: 2026-03-20]
- [x] P3-EXE-002 Join 执行器多算法切换与内存预算控制 [validated: 2026-03-20]
- [x] P3-EXE-003 大结果集管道化执行（避免全量物化） [validated: 2026-03-20]
- [x] P3-EXE-004 Spill/分块策略（内存受限场景） [validated: 2026-03-20]
- [x] P3-EXE-005 链上/回放读路径下的索引一致读策略 [validated: 2026-03-20]

## P3-F. 测试体系（性能与复杂查询专项）

- [x] P3-TEST-001 单测：索引结构正确性与更新一致性 [validated: 2026-03-20]
- [x] P3-TEST-002 单测：统计信息采集/持久化/恢复 [validated: 2026-03-20]
- [x] P3-TEST-003 集成：CBO 计划选择与计划稳定性回归 [validated: 2026-03-20]
- [x] P3-TEST-004 集成：复杂子查询（标量/相关/EXISTS/IN） [validated: 2026-03-20]
- [x] P3-TEST-005 集成：集合操作全矩阵（含 ALL 变体） [validated: 2026-03-20]
- [x] P3-TEST-006 集成：视图展开与依赖变更回归 [validated: 2026-03-20]
- [x] P3-TEST-007 压测：百万级行数据下索引加速收益验证 [validated: 2026-03-20]
- [x] P3-TEST-008 稳定性：长跑无一致性错误与性能退化阈值控制 [validated: 2026-03-20]

## P3-G. 基准与里程碑验收

- [x] P3-BENCH-001 基线：无索引复杂查询吞吐/延迟报告 [validated: 2026-03-20]
- [x] P3-BENCH-002 对照：有索引同负载收益报告（QPS、P95、成本） [validated: 2026-03-20]
- [x] P3-BENCH-003 CBO 收益：计划选择优于固定规则基线 [validated: 2026-03-20]
- [ ] P3-BENCH-004 大数据集复杂连接/子查询压测报告
- [x] P3-MILE-001 索引系统验收通过（建索引、命中、恢复一致） [validated: 2026-03-20]
- [x] P3-MILE-002 CBO 验收通过（统计驱动计划选择） [validated: 2026-03-20]
- [x] P3-MILE-003 子查询与集合操作全路径验收通过 [validated: 2026-03-20]
- [x] P3-MILE-004 视图 SELECT 能力验收通过（可更新视图暂缓） [validated: 2026-03-20]
- [ ] P3-MILE-005 大数据复杂查询性能达标且稳定
- [ ] P3-MILE-006 全测试管线绿灯（build/unit/integration/regression/bench）
- [ ] P3-MILE-007 文档、示例、运维手册同步

---

## Phase 3 DoD（统一验收标准）

任一条目打勾前必须同时满足：
1. 代码实现完成并通过评审；
2. 关联自动化测试新增且通过；
3. `npm run build`（强制先清空 `dist/`）与相关测试全绿；
4. 文档同步（语义、限制、错误码、操作手册）；
5. 无未解释回归。

